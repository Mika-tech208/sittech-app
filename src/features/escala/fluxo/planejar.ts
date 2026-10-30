// PLANEJAR COM FLUXO (spec §3–§4) — orquestra estado, hooks do motor e iteração por valor marginal. PURO.
//
//   1. plano BASE   = gerarEscala(entrada)                      (o que a Escala oficial faria hoje)
//   2. plano P0     = gerarEscala(entrada + remPorPool de fluxo)
//   3. it = 1..N    = gerarEscala(entrada + remPorPool + valor marginal do plano anterior + bônus de continuidade θ)
// Cada candidato é avaliado pelo MESMO simulador (avaliar.ts) e conferido por verificarRestricoesDuras. Escolhe-se o de menor tupla J
// (lexicográfica); candidatos com violação dura ou com falta final PIOR que a do plano base são inelegíveis ⇒ nunca pior que o base.

import { estabilizarPessoas, reatribuirPessoasBloco } from "../estabilidade";
import { gerarEscala } from "../gerarEscala";
import { sobrepoe } from "../tempo";
import { hashAlocacoes } from "../horizonte";
import { chavePool, type AlocacaoEscala, type EntradaEscala, type ResultadoEscala } from "../types";
import { avaliarComCtx } from "./avaliar";
import { contagensDoPlano, tabelaMarginal, varrerContagens } from "./otimizar";
import { montarEstado, prepararFluxo, type CtxFluxo, type OpcoesInternas } from "./estado";
import { explicarMudanca } from "./explicar";
import { verificarRestricoesDuras } from "./restricoes";
import {
  VERSAO_FLUXO, type AntesFluxo, type AvaliacaoPlano, type ChurnFluxo, type DadosProducaoReal, type DecisaoFluxo, type DepoisFluxo, type ResumoDecisao, type DiagnosticoFluxo, type DiagnosticoItem,
  type EstabilizacaoPessoas, type IteracaoFluxo, type PlanoEscolhido, type PostoRef, type ReconciliacaoGanho, type ResultadoFluxo, type SituacaoVigente, type TuplaObjetivo, type ViolacaoDura,
} from "./tipos";

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const EPS_FALTA = 1e-6;

interface Candidato {
  indice: number; // 0 = P0
  entrada: EntradaEscala;
  resultado: ResultadoEscala;
  aval: AvaliacaoPlano;
  violacoes: ViolacaoDura[];
  churn: ChurnFluxo;
  tupla: TuplaObjetivo;
  hash: string;
}

function futuras(ctx: CtxFluxo, l: AlocacaoEscala[]): AlocacaoEscala[] {
  return l.filter((a) => (ctx.idxSlot.get(`${a.data}|${a.periodoId}`) ?? -1) >= ctx.aPartirDe);
}

const postoDe = (a: AlocacaoEscala | undefined): PostoRef => ({ maquinaId: a?.maquinaId ?? null, produtoId: a?.produtoId ?? null, etapaId: a?.etapaId ?? null });
const chavePosto = (p: PostoRef) => `${p.maquinaId ?? ""}|${p.produtoId ?? ""}|${p.etapaId ?? ""}`;

export function calcularChurn(ctx: CtxFluxo, alocacoes: AlocacaoEscala[], retidas = 0): ChurnFluxo {
  const novas = futuras(ctx, alocacoes);
  const vig = new Map(futuras(ctx, ctx.dados.planoVigente).map((a) => [`${a.data}|${a.periodoId}|${a.funcionarioId}`, a]));
  let linhas = 0, trocas = 0, primeiro = 0;
  const postosNovos = new Set<string>();
  const postosVig = new Set<string>();
  novas.forEach((a) => {
    if (a.maquinaId) postosNovos.add(`${a.data}|${a.periodoId}|${chavePosto(postoDe(a))}`);
    const v = vig.get(`${a.data}|${a.periodoId}|${a.funcionarioId}`);
    if (!v) return;
    if (chavePosto(postoDe(v)) !== chavePosto(postoDe(a))) {
      linhas++;
      if (v.maquinaId && a.maquinaId) trocas++;
      if ((ctx.idxSlot.get(`${a.data}|${a.periodoId}`) ?? -1) === ctx.aPartirDe) primeiro++;
    }
  });
  vig.forEach((v) => {
    if (v.maquinaId) postosVig.add(`${v.data}|${v.periodoId}|${chavePosto(postoDe(v))}`);
  });
  let postosAlt = 0;
  postosNovos.forEach((k) => { if (!postosVig.has(k)) postosAlt++; });
  postosVig.forEach((k) => { if (!postosNovos.has(k)) postosAlt++; });
  return { linhasAlteradas: linhas, trocasDePosto: trocas, postosAlterados: postosAlt, alteradasNoPrimeiroPeriodo: primeiro, retidasPorEstabilidade: retidas };
}

export function tuplaObjetivo(aval: AvaliacaoPlano, churn: ChurnFluxo, ponderar: boolean): TuplaObjetivo {
  const t = aval.totais;
  return [ponderar ? t.faltaPonderada : t.faltaFinalLo, t.faltaFinalHi, -t.capacidadeGargalo, t.wipLegadoResidual, t.excessoWip, t.capacidadeDesperdicada, churn.linhasAlteradas];
}

// lexicográfica; componentes 0–1 com tolerância mínima, os demais com tolerância de 1 peça (ruído numérico não decide)
export function compararTuplas(a: TuplaObjetivo, b: TuplaObjetivo): number {
  for (let i = 0; i < a.length; i++) {
    const tol = i <= 1 ? EPS_FALTA : i === a.length - 1 ? 0.5 : 1;
    if (Math.abs(a[i] - b[i]) > tol) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** θ (v2): default 0 — NENHUMA retenção por limiar; a estabilidade vem da re-atribuição de pessoas (`estabilizarPessoas`), que mantém os postos e a falta. Medido no replay
 *  de PROD (docs/escala-fluxo-criterios-ativacao.md §4): toda retenção por θ custa peça final e quase não reduz o churn (o churn está nas PESSOAS). */
export function thetaPadrao(ctx: CtxFluxo): number {
  return ctx.opcoes.limiarEstabilidadePecas ?? 0;
}

function bonusDoPlanoVigente(ctx: CtxFluxo, theta: number): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  if (theta <= 0 || ctx.aPartirDe >= ctx.entrada.slots.length) return out;
  const slot = ctx.entrada.slots[ctx.aPartirDe];
  futuras(ctx, ctx.dados.planoVigente).forEach((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId || a.data !== slot.data || a.periodoId !== slot.periodoId) return;
    const k = chavePool(a.produtoId, a.etapaId);
    (out[String(ctx.aPartirDe)] ??= {})[`${a.maquinaId}|${k}`] = theta;
  });
  return out;
}


// ---- plano vigente como candidato ----------------------------------------------------------------------------------------------

/** Troca manual vigente que o motor manteve continua "manual" (a re-atribuição de pessoas não pode movê-la). Mesma regra de processar.ts. */
function marcarManuais(entrada: EntradaEscala, linhas: AlocacaoEscala[]): AlocacaoEscala[] {
  const chave = (x: AlocacaoEscala) => `${x.data}|${x.periodoId}|${x.funcionarioId}|${x.maquinaId ?? ""}`;
  const manuais = new Set((entrada.trocasManuais ?? []).map(chave));
  return linhas.map((x) => (manuais.has(chave(x)) && x.origem !== "manual" ? { ...x, origem: "manual" as const } : x));
}

/** O futuro vigente cobre exatamente as pessoas que o motor escalaria em cada slot mutável (nem dia novo sem linhas, nem pessoa nova/ausente fora do plano)? */
function vigenteCompleto(ctx: CtxFluxo, vig: AlocacaoEscala[]): string | null {
  const { entrada } = ctx;
  const porSlot = new Map<number, Set<string>>();
  vig.forEach((a) => {
    const t = ctx.idxSlot.get(`${a.data}|${a.periodoId}`) as number;
    (porSlot.get(t) ?? porSlot.set(t, new Set()).get(t)!).add(a.funcionarioId);
  });
  for (let t = ctx.aPartirDe; t < entrada.slots.length; t++) {
    const slot = entrada.slots[t];
    const presentes = new Set(entrada.funcionarios.map((f) => f.id).filter((f) => !entrada.ausencias.some((a) => a.funcionarioId === f && a.data === slot.data && (a.inicioMin === null || a.fimMin === null || sobrepoe(a.inicioMin, a.fimMin, slot.inicioMin, slot.fimMin)))));
    const tem = porSlot.get(t) ?? new Set<string>();
    if (tem.size !== presentes.size || [...presentes].some((f) => !tem.has(f))) return `plano vigente incompleto/desatualizado em ${slot.data} ${slot.periodoId} (${tem.size} pessoa(s) nas linhas × ${presentes.size} disponíveis)`;
  }
  return null;
}

export function planejarComFluxo(entrada: EntradaEscala, dados: DadosProducaoReal, opcoes: OpcoesInternas = {}): ResultadoFluxo {
  const ctx = prepararFluxo(entrada, dados, opcoes);
  const estado = montarEstado(ctx);
  const ponderar = opcoes.ponderarPorValor === true;
  const maxIt = Math.max(0, opcoes.maxIteracoes ?? 4);
  const diag: DiagnosticoItem[] = [...estado.diagnosticos];
  const theta = thetaPadrao(ctx);
  const estabilizar = opcoes.estabilizarPessoas !== false;

  // ---- plano em vigor (futuro) ----
  const vigFut = futuras(ctx, ctx.dados.planoVigente).map((a) => ({ ...a }));
  const temVigente = vigFut.some((a) => a.maquinaId);
  const avVigLeve = temVigente ? avaliarComCtx(ctx, vigFut, { contribuicoes: false, trajetoria: false }) : null;

  // ---- plano BASE ----
  const base = gerarEscala(entrada);

  // Constrói um candidato: opcionalmente re-atribui as PESSOAS para manter o posto do plano vigente (mesmos postos), reavalia a falta e as restrições duras DEPOIS
  // da re-atribuição e descarta-a se piorou. A tupla (e o churn dela) é a do plano já estabilizado.
  const estabInfo = new Map<number, EstabilizacaoPessoas>();
  const construir = (indice: number, ent: EntradaEscala, res: ResultadoEscala, limites?: Record<string, number>): Candidato => {
    const avalia = (l: AlocacaoEscala[]) => avaliarComCtx(ctx, l, { contribuicoes: false, trajetoria: false, ...(limites ? { limites } : {}) });
    let linhas = marcarManuais(ent, res.alocacoes);
    let aval = avalia(linhas);
    let violacoes = verificarRestricoesDuras(ent, linhas);
    const linhasAntes = calcularChurn(ctx, linhas).linhasAlteradas;
    const info: EstabilizacaoPessoas = { aplicada: false, periodosAjustados: 0, linhasAntes, linhasDepois: linhasAntes, motivoDescarte: null };
    if (estabilizar && temVigente && linhas.length > 0) {
      const est = estabilizarPessoas(linhas, vigFut, ent.congeladas, ent.slots, { escopo: ent.revezamentoDuro ? ent.revezamentoEscopo : undefined, equivalencias: ent.equivalenciaOperacoes, exposicaoExecutada: ent.exposicaoExecutada, ...(ent.revezamentoPonteM3T1 ? { ponteM3T1: true } : {}) });
      if (est.estabilizou) {
        const aval2 = avalia(est.linhas);
        const viol2 = verificarRestricoesDuras(ent, est.linhas);
        if (viol2.length > violacoes.length) info.motivoDescarte = `${viol2.length} violação(ões) de restrição dura após a re-atribuição`;
        else if (aval2.totais.faltaFinalLo > aval.totais.faltaFinalLo + EPS_FALTA || aval2.totais.faltaFinalHi > aval.totais.faltaFinalHi + EPS_FALTA) info.motivoDescarte = `falta final piorou ${r3(aval2.totais.faltaFinalLo - aval.totais.faltaFinalLo)} peça(s) após a re-atribuição`;
        else {
          linhas = est.linhas;
          aval = aval2;
          violacoes = viol2;
          info.aplicada = true;
          info.periodosAjustados = est.periodosAjustados;
          info.linhasDepois = calcularChurn(ctx, linhas).linhasAlteradas;
        }
      }
    }
    estabInfo.set(indice, info);
    const churn = calcularChurn(ctx, linhas);
    return { indice, entrada: ent, resultado: { ...res, alocacoes: linhas }, aval, violacoes, churn, tupla: tuplaObjetivo(aval, churn, ponderar), hash: hashAlocacoes(linhas) };
  };

  const baseC = construir(-1, entrada, base);
  const hashes = new Set<string>([hashAlocacoes(base.alocacoes)]);
  const gerar = (indice: number, extra: Partial<EntradaEscala>): Candidato => {
    const ent: EntradaEscala = { ...entrada, remPorPool: estado.remPorPool, ...extra };
    const res = gerarEscala(ent);
    const c = construir(indice, ent, res, estado.remPorPool);
    c.hash = hashAlocacoes(res.alocacoes); // dedupe pelo plano BRUTO do motor (a re-atribuição é determinística sobre ele)
    return c;
  };

  // ---- candidato "plano vigente mantido" (válido só se não violar restrição dura HOJE e estiver completo) ----
  let vigC: Candidato | null = null;
  let vigReC: Candidato | null = null; // vigente com pessoas re-atribuídas (revezamento por bloco)
  let vigenteReatribuidoPeriodos = 0;
  const vigente: SituacaoVigente = { disponivel: temVigente, valido: false, motivo: temVigente ? null : "sem linhas vigentes em períodos mutáveis", violacoes: 0, falta: avVigLeve ? { lo: avVigLeve.totais.faltaFinalLo, hi: avVigLeve.totais.faltaFinalHi } : null };
  if (temVigente && avVigLeve) {
    const violVig = verificarRestricoesDuras(entrada, vigFut);
    const incompleto = vigenteCompleto(ctx, vigFut);
    vigente.violacoes = violVig.length;
    if (violVig.length > 0) vigente.motivo = `${violVig.length} violação(ões) de restrição dura hoje (ex.: ${violVig[0].tipo})`;
    else if (incompleto) vigente.motivo = incompleto;
    else {
      vigente.valido = true;
      const churn0 = calcularChurn(ctx, vigFut);
      vigC = { indice: -2, entrada, resultado: { ...base, alocacoes: vigFut }, aval: avVigLeve, violacoes: [], churn: churn0, tupla: tuplaObjetivo(avVigLeve, churn0, ponderar), hash: hashAlocacoes(vigFut) };
    }
    // REVEZAMENTO POR BLOCO: vigente inválido SÓ por repetir operação no bloco (manhã/tarde) ⇒ candidato "vigente com pessoas re-atribuídas": os MESMOS postos (mesma falta,
    // mesmo WIP), só QUEM os ocupa muda, até zerar as repetições. Sem solução ⇒ não é candidato (cai nos regenerados, que podem deixar posto vazio com diagnóstico).
    if (!vigente.valido && !incompleto && entrada.revezamentoDuro && entrada.revezamentoEscopo === "bloco" && violVig.length > 0 && violVig.every((v) => v.tipo === "revezamento")) {
      const rea = reatribuirPessoasBloco(vigFut, entrada.congeladas, entrada.slots, { escopo: "bloco", equivalencias: entrada.equivalenciaOperacoes, exposicaoExecutada: entrada.exposicaoExecutada, ...(entrada.revezamentoPonteM3T1 ? { ponteM3T1: true } : {}) });
      if (rea) {
        const linhasRea = marcarManuais(entrada, rea.linhas);
        const violRea = verificarRestricoesDuras(entrada, linhasRea);
        if (violRea.length === 0) {
          const churnR = calcularChurn(ctx, linhasRea);
          vigReC = { indice: -3, entrada, resultado: { ...base, alertas: base.alertas.filter((a) => a.tipo !== "rotacao_sem_solucao"), alocacoes: linhasRea }, aval: avVigLeve, violacoes: [], churn: churnR, tupla: tuplaObjetivo(avVigLeve, churnR, ponderar), hash: hashAlocacoes(linhasRea) };
          vigenteReatribuidoPeriodos = rea.periodosAjustados;
        }
      }
    }
    if (!vigente.valido) diag.push({ codigo: "PLANO_VIGENTE_DESCARTADO", severidade: "aviso", mensagem: `Plano vigente não é candidato: ${vigente.motivo}`, detalhes: { violacoes: violVig.length } });
  }

  const candidatos: Candidato[] = [];
  const p0 = gerar(0, {});
  candidatos.push(p0);
  hashes.add(p0.hash);
  let contagens = contagensDoPlano(ctx, p0.resultado.alocacoes);
  for (let i = 1; i <= maxIt; i++) {
    const varredura = varrerContagens(ctx, contagens, estado.remPorPool);
    contagens = varredura.contagens;
    const tabela = tabelaMarginal(ctx, contagens, estado.remPorPool);
    const cand = gerar(i, { ordemPostos: { valorMarginal: tabela }, bonusContinuidade: bonusDoPlanoVigente(ctx, theta) });
    candidatos.push(cand);
    const repetido = hashes.has(cand.hash);
    hashes.add(cand.hash);
    if (repetido || varredura.slotsAlterados === 0) break;
  }

  // ---- escolha: menor J entre os ELEGÍVEIS. Elegível = 0 violação dura E falta final nunca pior que a do plano base NEM a do plano vigente VÁLIDO (mesmo simulador) ----
  const faltaRef = Math.min(baseC.aval.totais.faltaFinalLo, vigC ? vigC.aval.totais.faltaFinalLo : Number.POSITIVE_INFINITY, vigReC ? vigReC.aval.totais.faltaFinalLo : Number.POSITIVE_INFINITY);
  const elegivel = (c: Candidato) => c.violacoes.length === 0 && c.aval.totais.faltaFinalLo <= faltaRef + EPS_FALTA;
  candidatos.forEach((c) => {
    if (c.violacoes.length > 0) {
      diag.push({ codigo: "VIOLACAO_RESTRICAO_DURA", severidade: "erro", mensagem: `Candidato ${c.indice} descartado: ${c.violacoes.length} violação(ões) de restrição dura (${c.violacoes[0].tipo})`, detalhes: { iteracao: c.indice, violacoes: c.violacoes.length } });
    }
  });
  // ordem de desempate (primeiro vence): vigente (zero churn) > base > fluxo — só se troca por candidato ESTRITAMENTE melhor pela tupla
  const ordem: Candidato[] = [...(vigC ? [vigC] : []), ...(vigReC ? [vigReC] : []), baseC, ...candidatos];
  let escolhido: Candidato | null = null;
  ordem.filter(elegivel).forEach((c) => {
    if (escolhido === null || compararTuplas(c.tupla, (escolhido as Candidato).tupla) < 0) escolhido = c;
  });
  let final: Candidato = (escolhido as Candidato | null) ?? baseC; // sem elegível (base com violação e nada melhor): o base é o fallback histórico
  // Um candidato gerado cujas linhas são IDÊNTICAS às vigentes É o plano vigente (a avaliação com `rem` pode desempatá-lo por ruído numérico): devolve-se como vigente,
  // com os alertas desse "gêmeo" (assim a assinatura de alertas do recálculo anterior se repete e o NO-OP do processar funciona).
  const gemeo: Candidato | null = vigC ? [baseC, ...candidatos].find((c) => c.hash !== undefined && hashAlocacoes(c.resultado.alocacoes) === vigC!.hash) ?? null : null;
  if (vigC && final.indice !== -2 && gemeo && hashAlocacoes(final.resultado.alocacoes) === vigC.hash) final = vigC;
  const planoEscolhido: PlanoEscolhido = final.indice === -2 || final.indice === -3 ? "vigente" : final.indice === -1 ? "base" : "fluxo";
  const usaFluxo = planoEscolhido === "fluxo";

  // ---- estabilidade por θ (só se θ > 0): quantos postos do 1º período mutável o bônus reteve ----
  let retidas = 0;
  if (usaFluxo && theta > 0) {
    const semBonus = gerarEscala({ ...final.entrada, bonusContinuidade: undefined });
    const chaveSlotPostos = (l: AlocacaoEscala[]) => new Set(l.filter((a) => a.maquinaId && (ctx.idxSlot.get(`${a.data}|${a.periodoId}`) ?? -1) === ctx.aPartirDe).map((a) => `${a.maquinaId}|${a.produtoId}|${a.etapaId}`));
    const a1 = chaveSlotPostos(final.resultado.alocacoes);
    const a0 = chaveSlotPostos(semBonus.alocacoes);
    retidas = [...a1].filter((k) => !a0.has(k)).length;
    if (retidas > 0) diag.push({ codigo: "ESTABILIDADE_RETEVE_ALOCACAO", severidade: "info", slot: ctx.aPartirDe, mensagem: `${retidas} posto(s) do próximo período mantido(s): ganho de produto final abaixo de θ = ${theta} peças`, detalhes: { theta, retidas } });
  }
  const estab = estabInfo.get(final.indice) ?? { aplicada: false, periodosAjustados: 0, linhasAntes: 0, linhasDepois: 0, motivoDescarte: null };
  if (final.indice !== -2 && estab.aplicada) diag.push({ codigo: "ESTABILIZACAO_PESSOAS", severidade: "info", mensagem: `Pessoas re-atribuídas em ${estab.periodosAjustados} período(s) para manter o posto do plano vigente: linhas alteradas ${estab.linhasAntes} → ${estab.linhasDepois} (mesmos postos, mesma falta)`, detalhes: { periodosAjustados: estab.periodosAjustados, linhasAntes: estab.linhasAntes, linhasDepois: estab.linhasDepois } });
  if (estab.motivoDescarte) diag.push({ codigo: "ESTABILIZACAO_DESCARTADA", severidade: "aviso", mensagem: `Re-atribuição de pessoas descartada: ${estab.motivoDescarte}`, detalhes: { iteracao: final.indice } });

  const entradaFluxo = final.entrada;
  const resultado: ResultadoEscala = final.indice === -2 && gemeo ? { ...gemeo.resultado, alocacoes: vigFut } : final.resultado;
  const limitesFinal = usaFluxo ? estado.remPorPool : undefined;
  const avFluxo = avaliarComCtx(ctx, resultado.alocacoes, { contribuicoes: true, trajetoria: opcoes.incluirTrajetoria !== false, limites: limitesFinal });
  const avBase = avaliarComCtx(ctx, base.alocacoes, { contribuicoes: true, trajetoria: opcoes.incluirTrajetoria !== false });
  const avVig = temVigente ? avaliarComCtx(ctx, vigFut, { contribuicoes: false, trajetoria: false }) : null;
  const churn = calcularChurn(ctx, resultado.alocacoes, retidas);
  // restrições duras sobre o plano DEVOLVIDO (já estabilizado): só as linhas novas importam (as congeladas foram gravadas sob outras condições)
  const violacoes = verificarRestricoesDuras(entradaFluxo, resultado.alocacoes, { somenteLinhasNovas: true });
  const faltaTxt = (a: AvaliacaoPlano) => Math.round(a.totais.faltaFinalLo);
  diag.push(
    planoEscolhido === "fluxo"
      ? { codigo: "PLANO_FLUXO_ESCOLHIDO", severidade: "info", mensagem: `Plano de fluxo (iteração ${final.indice}) escolhido: falta final prevista ${faltaTxt(avFluxo)} × ${faltaTxt(avBase)} do plano base${avVig ? ` × ${faltaTxt(avVig)} do plano vigente` : ""}`, detalhes: { iteracao: final.indice, faltaFluxo: avFluxo.totais.faltaFinalLo, faltaBase: avBase.totais.faltaFinalLo, faltaVigente: avVig ? avVig.totais.faltaFinalLo : null } }
      : planoEscolhido === "vigente"
        ? final.indice === -3
          ? { codigo: "PLANO_VIGENTE_REATRIBUIDO_BLOCO", severidade: "info", mensagem: `Postos do plano VIGENTE mantidos (mesma falta e WIP); pessoas re-atribuídas em ${vigenteReatribuidoPeriodos} período(s) para eliminar repetição de operação no bloco (manhã/tarde)`, detalhes: { periodosAjustados: vigenteReatribuidoPeriodos } }
          : { codigo: "PLANO_VIGENTE_MANTIDO", severidade: "info", mensagem: "Nenhum plano (base ou de fluxo) foi estritamente melhor que o plano VIGENTE pelo simulador: plano vigente mantido (sem alterações)", detalhes: { faltaVigente: avVig ? avVig.totais.faltaFinalLo : null, faltaBase: avBase.totais.faltaFinalLo } }
        : { codigo: "PLANO_BASE_MANTIDO", severidade: "info", mensagem: "Nenhum plano de fluxo foi estritamente melhor que o plano base pelo simulador: plano base mantido", detalhes: { faltaBase: avBase.totais.faltaFinalLo } }
  );

  const iteracoes: IteracaoFluxo[] = [
    ...(vigC ? [{ indice: -2, tupla: vigC.tupla.map(r3), faltaFinalLo: vigC.aval.totais.faltaFinalLo, violacoes: 0, escolhida: final.indice === -2, hashPlano: vigC.hash }] : []),
    ...(vigReC ? [{ indice: -3, tupla: vigReC.tupla.map(r3), faltaFinalLo: vigReC.aval.totais.faltaFinalLo, violacoes: 0, escolhida: final.indice === -3, hashPlano: vigReC.hash }] : []),
    { indice: -1, tupla: baseC.tupla.map(r3), faltaFinalLo: baseC.aval.totais.faltaFinalLo, violacoes: baseC.violacoes.length, escolhida: final.indice === -1, hashPlano: baseC.hash },
    ...candidatos.map((c) => ({ indice: c.indice, tupla: c.tupla.map(r3), faltaFinalLo: c.aval.totais.faltaFinalLo, violacoes: c.violacoes.length, escolhida: final.indice === c.indice, hashPlano: c.hash })),
  ];

  // ---- explicação CONTRA o plano vigente (o que o supervisor vê); sem vigente futuro, contra o base ----
  const referencia: "vigente" | "base" = avVig ? "vigente" : "base";
  const expl = planoEscolhido === "vigente"
    ? { decisoes: [] as DecisaoFluxo[], resumo: [] as ResumoDecisao[], reconciliacao: { referencia, finalReferencia: r3(avFluxo.totais.finalEntregueLo), finalPlano: r3(avFluxo.totais.finalEntregueLo), diferenca: 0, somaGanhos: 0, residuo: 0, explicacaoResiduo: "Plano vigente mantido: nenhuma alteração." } as ReconciliacaoGanho }
    : explicarMudanca(ctx, avVig ? vigFut : base.alocacoes, resultado.alocacoes, avVig ?? avBase, avFluxo, referencia);
  const todasDecisoes = expl.decisoes;
  const maxDec = Math.max(0, opcoes.maxDecisoes ?? 500);
  const decisoes = todasDecisoes.length <= maxDec ? todasDecisoes : [...todasDecisoes].sort((a, b) => Math.abs(b.motivo.ganhoProdutoFinal) * b.quantidade - Math.abs(a.motivo.ganhoProdutoFinal) * a.quantidade || a.slot - b.slot).slice(0, maxDec).sort((a, b) => a.slot - b.slot);
  const antes = montarAntes(estado, avVig ?? avBase, referencia);
  const dep = (a: AvaliacaoPlano): DepoisFluxo => ({
    produtoFinalPrevisto: { lo: r3(a.totais.finalEntregueLo), hi: r3(a.totais.finalEntregueHi) },
    wipPrevisto: { lo: a.totais.wipFinalLo, hi: a.totais.wipFinalHi },
    faltaPrevista: { lo: a.totais.faltaFinalLo, hi: a.totais.faltaFinalHi },
    excessoWip: a.totais.excessoWip,
  });
  const diagnostico: DiagnosticoFluxo = {
    versao: VERSAO_FLUXO, planoEscolhido, referencia, vigente, estabilizacao: estab, reconciliacao: expl.reconciliacao, iteracaoEscolhida: usaFluxo ? final.indice : null, theta, antes,
    decisoes, decisoesTotal: todasDecisoes.length, resumoDecisoes: expl.resumo,
    depois: dep(avFluxo), depoisBase: dep(avBase), depoisVigente: avVig ? dep(avVig) : null, churn, iteracoes, violacoes, estado, avaliacaoBase: avBase, avaliacaoFluxo: avFluxo, diagnosticos: diag,
  };
  return { entradaFluxo, resultado, diagnostico };
}

function montarAntes(estado: ReturnType<typeof montarEstado>, avRef: AvaliacaoPlano, referencia: "vigente" | "base"): AntesFluxo {
  const demandaRestante: Record<string, number> = {};
  estado.produtos.forEach((p) => (demandaRestante[p.produtoId] = p.demandaFinalRestante));
  const remLegado: Record<string, number> = {};
  estado.demanda.forEach((d) => (remLegado[d.chave] = d.remLegado));
  const gargalos = avRef.produtos.map((p) => p.gargaloFluxo).filter((g): g is NonNullable<typeof g> => g !== null);
  const unicos = gargalos.filter((g, i) => gargalos.findIndex((h) => h.produtoId === g.produtoId && h.etapaId === g.etapaId) === i);
  return { referencia, demandaRestante, remLegado, wip: estado.pares, gargalosFluxo: unicos, faltaFinal: { lo: avRef.totais.faltaFinalLo, hi: avRef.totais.faltaFinalHi } };
}
