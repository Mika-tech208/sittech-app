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
import { aplicarProdutividade } from "./produtividade";
import { precoDoGrupo, objetivoFinanceiro } from "./financeiro";
import { analisarCapacidade } from "./capacidade";
import { contagensDoPlano, melhorarPorTrocas, tabelaMarginal, varrerContagens, varrerContagensPreservando, type Contagens } from "./otimizar";
import { montarEstado, prepararFluxo, type CtxFluxo, type OpcoesInternas } from "./estado";
import { explicarMudanca } from "./explicar";
import { verificarRestricoesDuras } from "./restricoes";
import {
  VERSAO_FLUXO, type AntesFluxo, type DiagnosticoAtingibilidade, type DiagnosticoFinanceiro, type DiagnosticoEconomia, type PostoMinimoSlot, type VariacaoProduto, type AvaliacaoPlano, type ChurnFluxo, type DadosProducaoReal, type DecisaoFluxo, type DepoisFluxo, type ResumoDecisao, type DiagnosticoFluxo, type DiagnosticoItem,
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

export function tuplaObjetivo(aval: AvaliacaoPlano, churn: ChurnFluxo, ponderar: boolean, t1: boolean = aval.atingibilidade !== undefined): TuplaObjetivo {
  const t = aval.totais;
  const base = [ponderar ? t.faltaPonderada : t.faltaFinalLo, t.faltaFinalHi, -t.capacidadeGargalo, t.wipLegadoResidual, ponderar ? t.excessoWip2p ?? t.excessoWip : t.excessoWip, t.capacidadeDesperdicada, churn.linhasAlteradas];
  // preservarAtingibilidade: tier 1 = [metas atingíveis que o plano NÃO entrega, déficit relativo ponderado] ANTES de peças finais (2), gargalo (3), WIP (4–5), estabilidade (6)
  return t1 && aval.atingibilidade ? [aval.atingibilidade.atingiveisPerdidas, aval.atingibilidade.deficitRelativo, ...base] : base;
}

// lexicográfica; componentes 0–1 com tolerância mínima, os demais com tolerância de 1 peça (ruído numérico não decide)
export function compararTuplas(a: TuplaObjetivo, b: TuplaObjetivo): number {
  const pref = Math.max(0, a.length - 7); // 2 componentes de tier 1 quando preservarAtingibilidade
  for (let i = 0; i < a.length; i++) {
    const j = i - pref;
    const tol = j < 0 ? (i === 0 ? 0.5 : 1e-6) : j <= 1 ? EPS_FALTA : i === a.length - 1 ? 0.5 : 1;
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

export function planejarComFluxo(entradaOriginal: EntradaEscala, dados: DadosProducaoReal, opcoes: OpcoesInternas = {}): ResultadoFluxo {
  const entrada = aplicarProdutividade(entradaOriginal, opcoes, dados.agoraMs).entrada; // provedor de produtividade esperada (default: sem alteração)
  // produtividade NOMINAL (meta sem f) de cada pool, para o diagnóstico de capacidade (nominal × esperada)
  const nominais: Record<string, Record<string, number>> = Object.fromEntries(entradaOriginal.pools.map((p) => { const k = chavePool(p.produtoId, p.etapaId); const f = opcoes.fatoresEmbutidos?.[k] ?? 1; return [k, Object.fromEntries(Object.entries(p.metas).map(([per, v]) => [per, f > 0 ? v / f : v]))]; }));
  const ctx = prepararFluxo(entrada, dados, opcoes);
  const estado = montarEstado(ctx);
  const ponderar = ctx.opcoes.ponderarPorValor === true; // objetivo financeiro ⇒ falta em R$ (preço congelado), não em peças
  const preservar = ctx.opcoes.preservarAtingibilidade === true;
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
      const est = estabilizarPessoas(linhas, vigFut, ent.congeladas, ent.slots, { escopo: ent.revezamentoDuro ? ent.revezamentoEscopo : undefined, equivalencias: ent.equivalenciaOperacoes, exposicaoExecutada: ent.exposicaoExecutada });
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
    return { indice, entrada: ent, resultado: { ...res, alocacoes: linhas }, aval, violacoes, churn, tupla: tuplaObjetivo(aval, churn, ponderar, preservar), hash: hashAlocacoes(linhas) };
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
      vigC = { indice: -2, entrada, resultado: { ...base, alocacoes: vigFut }, aval: avVigLeve, violacoes: [], churn: churn0, tupla: tuplaObjetivo(avVigLeve, churn0, ponderar, preservar), hash: hashAlocacoes(vigFut) };
    }
    // REVEZAMENTO POR BLOCO: vigente inválido SÓ por repetir operação no bloco (manhã/tarde) ⇒ candidato "vigente com pessoas re-atribuídas": os MESMOS postos (mesma falta,
    // mesmo WIP), só QUEM os ocupa muda, até zerar as repetições. Sem solução ⇒ não é candidato (cai nos regenerados, que podem deixar posto vazio com diagnóstico).
    if (!vigente.valido && !incompleto && entrada.revezamentoDuro && entrada.revezamentoEscopo === "bloco" && violVig.length > 0 && violVig.every((v) => v.tipo === "revezamento")) {
      const rea = reatribuirPessoasBloco(vigFut, entrada.congeladas, entrada.slots, { escopo: "bloco", equivalencias: entrada.equivalenciaOperacoes, exposicaoExecutada: entrada.exposicaoExecutada });
      if (rea) {
        const linhasRea = marcarManuais(entrada, rea.linhas);
        const violRea = verificarRestricoesDuras(entrada, linhasRea);
        if (violRea.length === 0) {
          const churnR = calcularChurn(ctx, linhasRea);
          vigReC = { indice: -3, entrada, resultado: { ...base, alertas: base.alertas.filter((a) => a.tipo !== "rotacao_sem_solucao"), alocacoes: linhasRea }, aval: avVigLeve, violacoes: [], churn: churnR, tupla: tuplaObjetivo(avVigLeve, churnR, ponderar, preservar), hash: hashAlocacoes(linhasRea) };
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
    const varredura = preservar ? varrerContagensPreservando(ctx, contagens, estado.remPorPool) : { ...varrerContagens(ctx, contagens, estado.remPorPool), minimos: undefined as Contagens | undefined };
    contagens = varredura.contagens;
    const tabela = tabelaMarginal(ctx, contagens, estado.remPorPool, varredura.minimos);
    const cand = gerar(i, { ordemPostos: { valorMarginal: tabela }, bonusContinuidade: bonusDoPlanoVigente(ctx, theta) });
    candidatos.push(cand);
    const repetido = hashes.has(cand.hash);
    hashes.add(cand.hash);
    if (repetido || varredura.slotsAlterados === 0) break;
  }
  // Objetivo financeiro: a heurística de PEÇAS (sweeps sem peso de R$) entra como mais um CANDIDATO; o julgamento segue em R$ (J). Assim o financeiro nunca fica abaixo do que a
  // heurística de peças já alcança (o guloso ponderado não é ótimo).
  if (ponderar) {
    const ctxP: CtxFluxo = { ...ctx, opcoes: { ...ctx.opcoes, ponderarPorValor: false, objetivo: "pecas" as const } };
    let contP = contagensDoPlano(ctx, p0.resultado.alocacoes);
    for (let i = 1; i <= maxIt; i++) {
      const varredura = preservar ? varrerContagensPreservando(ctxP, contP, estado.remPorPool) : { ...varrerContagens(ctxP, contP, estado.remPorPool), minimos: undefined as Contagens | undefined };
      contP = varredura.contagens;
      const cand = gerar(10 + i, { ordemPostos: { valorMarginal: tabelaMarginal(ctxP, contP, estado.remPorPool, varredura.minimos) }, bonusContinuidade: bonusDoPlanoVigente(ctx, theta) });
      const repetido = hashes.has(cand.hash);
      hashes.add(cand.hash);
      if (!repetido) candidatos.push(cand);
      if (repetido || varredura.slotsAlterados === 0) break;
    }
  }

  // Diversificação: sweeps sobre variantes determinísticas da produtividade (robustez a erro de estimativa); os planos são julgados no modelo REAL (ctx).
  if (ctx.opcoes.diversificarCandidatos) {
    const ultimoDoDia = (per: string) => per === entrada.slots[entrada.slots.length - 1].periodoId;
    const nosFinais = new Set(entrada.pools.filter((p) => !entrada.pools.some((q) => q.produtoId === p.produtoId && q.ordemEtapa > p.ordemEtapa)).map((p) => chavePool(p.produtoId, p.etapaId)));
    const variantes: ((p: EntradaEscala["pools"][number], per: string) => number)[] = [
      (_p, per) => (ultimoDoDia(per) ? 0.91 : 1),
      (p) => (nosFinais.has(chavePool(p.produtoId, p.etapaId)) ? 1 : 0.9),
      (p) => (nosFinais.has(chavePool(p.produtoId, p.etapaId)) ? 0.9 : 1),
    ];
    variantes.forEach((fator, v) => {
      const entPert: EntradaEscala = { ...entrada, pools: entrada.pools.map((p) => ({ ...p, metas: Object.fromEntries(Object.entries(p.metas).map(([per, x]) => [per, x * fator(p, per)])) })) };
      const ctxV = prepararFluxo(entPert, dados, opcoes);
      let contV = contagensDoPlano(ctx, p0.resultado.alocacoes);
      for (let i = 1; i <= Math.min(maxIt, 2); i++) {
        const varredura = preservar ? varrerContagensPreservando(ctxV, contV, estado.remPorPool) : { ...varrerContagens(ctxV, contV, estado.remPorPool), minimos: undefined as Contagens | undefined };
        contV = varredura.contagens;
        const cand = gerar(40 + 10 * v + i, { ordemPostos: { valorMarginal: tabelaMarginal(ctxV, contV, estado.remPorPool, varredura.minimos) }, bonusContinuidade: bonusDoPlanoVigente(ctx, theta) });
        const repetido = hashes.has(cand.hash);
        hashes.add(cand.hash);
        if (!repetido) candidatos.push(cand);
        if (repetido || varredura.slotsAlterados === 0) break;
      }
    });
  }

  // Busca local por TROCAS (dois nós por período) a partir do melhor conjunto de contagens do guloso: complementaridades que o guloso e a remoção unitária não enxergam (ex.: ligar a Máquina 8 em
  // todos os períodos e tirar uma pessoa do posto comum). Julgada no modelo real, como qualquer candidato.
  if (ctx.opcoes.diversificarCandidatos) {
    const base0 = contagensDoPlano(ctx, (candidatos.find((c) => c.indice > 0 && c.indice < 10) ?? p0).resultado.alocacoes);
    const bt = melhorarPorTrocas(ctx, base0, estado.remPorPool);
    if (bt.trocas > 0) {
      const cand = gerar(70, { ordemPostos: { valorMarginal: tabelaMarginal(ctx, bt.contagens, estado.remPorPool) }, bonusContinuidade: bonusDoPlanoVigente(ctx, theta) });
      if (!hashes.has(cand.hash)) { hashes.add(cand.hash); candidatos.push(cand); }
    }
  }

  // Atingibilidade COM limite econômico: o melhor plano PURAMENTE econômico (sem reservar postos) também é candidato; os planos que preservam a atingibilidade só vencem se o custo
  // de oportunidade em R$ não superar k × o valor recuperado (ver `limiteEconomico`).
  const economico = preservar && ponderar;
  if (economico) {
    let contE = contagensDoPlano(ctx, p0.resultado.alocacoes);
    for (let i = 1; i <= maxIt; i++) {
      const varredura = varrerContagens(ctx, contE, estado.remPorPool);
      contE = varredura.contagens;
      const cand = gerar(20 + i, { ordemPostos: { valorMarginal: tabelaMarginal(ctx, contE, estado.remPorPool) }, bonusContinuidade: bonusDoPlanoVigente(ctx, theta) });
      const repetido = hashes.has(cand.hash);
      hashes.add(cand.hash);
      if (!repetido) candidatos.push(cand);
      if (repetido || varredura.slotsAlterados === 0) break;
    }
  }

  // ---- escolha: menor J entre os ELEGÍVEIS. Elegível = 0 violação dura E falta final nunca pior que a do plano base NEM a do plano vigente VÁLIDO (mesmo simulador) ----
  const faltaDe = (c: Candidato) => (ponderar ? c.aval.totais.faltaPonderada : c.aval.totais.faltaFinalLo); // R$ no objetivo financeiro
  const faltaRef = Math.min(faltaDe(baseC), vigC ? faltaDe(vigC) : Number.POSITIVE_INFINITY, vigReC ? faltaDe(vigReC) : Number.POSITIVE_INFINITY);
  // preservarAtingibilidade: a falta TOTAL só pode piorar se o tier 1 (metas atingíveis mantidas) MELHORAR estritamente em relação a cada referência (base e vigente válido);
  // o tier 1 nunca pode piorar em relação à melhor referência.
  const t1 = (c: Candidato): [number, number] => (preservar && c.aval.atingibilidade ? [c.aval.atingibilidade.atingiveisPerdidas, c.aval.atingibilidade.deficitRelativo] : [0, 0]);
  const t1Ref: [number, number] = [baseC, ...(vigC ? [vigC] : []), ...(vigReC ? [vigReC] : [])].map(t1).reduce((m, x) => (x[0] < m[0] - 0.5 || (Math.abs(x[0] - m[0]) <= 0.5 && x[1] < m[1] - 1e-6) ? x : m));
  const t1Pior = (a: [number, number], b: [number, number]) => a[0] > b[0] + 0.5 || (Math.abs(a[0] - b[0]) <= 0.5 && a[1] > b[1] + 1e-6);
  // Comparação econômica UNIFORME: todos os candidatos gerados são reavaliados SEM o `rem` explícito (como o vigente/base), para o custo em R$ não ser inflado pelo limite de geração.
  if (economico) {
    candidatos.forEach((c) => {
      c.aval = avaliarComCtx(ctx, c.resultado.alocacoes, { contribuicoes: false, trajetoria: false });
      c.tupla = tuplaObjetivo(c.aval, c.churn, ponderar, preservar);
    });
  }
  // ---- LIMITE ECONÔMICO da atingibilidade (objetivo econômico + atingibilidade ativa) ----
  // A = melhor plano puramente econômico (menor falta em R$). Um plano c que preserva MAIS metas atingíveis que A só é candidato se
  //   custo(c) = falta_R$(c) − falta_R$(A)  ≤  k × valorRecuperado(c) = k × Σ_g (falta evitável_A,g − falta evitável_c,g) × valor_g   (metas atingíveis).
  const kEco = ctx.opcoes.atingibilidadeK ?? 2;
  const todos: Candidato[] = [...(vigC ? [vigC] : []), ...(vigReC ? [vigReC] : []), baseC, ...candidatos];
  let melhorEco: Candidato | null = null;
  if (economico) {
    todos.filter((c) => c.violacoes.length === 0).forEach((c) => {
      if (melhorEco === null) melhorEco = c;
      else {
        const d = faltaDe(c) - faltaDe(melhorEco);
        if (d < -EPS_FALTA || (Math.abs(d) <= EPS_FALTA && compararTuplas(c.tupla, (melhorEco as Candidato).tupla) < 0)) melhorEco = c;
      }
    });
  }
  const precoG = ctx.grafo.grupos.map((_, i) => precoDoGrupo(ctx, i, true));
  const limiteDe = (c: Candidato) => {
    const A = melhorEco as Candidato;
    const custo = Math.max(0, faltaDe(c) - faltaDe(A));
    const gA = A.aval.atingibilidade?.grupos ?? [];
    const gC = c.aval.atingibilidade?.grupos ?? [];
    const valorRec = gA.reduce((sum, g, i) => sum + (g.atingivel ? Math.max(0, g.faltaEvitavel - (gC[i]?.faltaEvitavel ?? g.faltaEvitavel)) * precoG[i] : 0), 0);
    const melhorT1 = t1Pior(t1(A), t1(c));
    return { custo, valorRec, razao: valorRec > 1e-9 ? custo / valorRec : null, justificado: melhorT1 && custo <= kEco * valorRec + 1e-9 };
  };
  const elegivel = (c: Candidato) => {
    if (c.violacoes.length > 0) return false;
    if (economico && melhorEco !== null) return c === melhorEco || limiteDe(c).justificado;
    if (!preservar) return faltaDe(c) <= faltaRef + EPS_FALTA;
    if (t1Pior(t1(c), t1Ref)) return false;
    return faltaDe(c) <= faltaRef + EPS_FALTA || t1Pior(t1Ref, t1(c));
  };
  candidatos.forEach((c) => {
    if (c.violacoes.length > 0) {
      diag.push({ codigo: "VIOLACAO_RESTRICAO_DURA", severidade: "erro", mensagem: `Candidato ${c.indice} descartado: ${c.violacoes.length} violação(ões) de restrição dura (${c.violacoes[0].tipo})`, detalhes: { iteracao: c.indice, violacoes: c.violacoes.length } });
    }
  });
  // ordem de desempate (primeiro vence): vigente (zero churn) > base > fluxo — só se troca por candidato ESTRITAMENTE melhor pela tupla
  const ordem: Candidato[] = todos;
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
  const limitesFinal = usaFluxo && !economico ? estado.remPorPool : undefined;
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

  // ---- atingibilidade (só com preservarAtingibilidade): metas atingíveis/inatingíveis do plano de referência e do escolhido + postos mínimos por período ----
  let atingibilidade: DiagnosticoAtingibilidade | undefined;
  let minimosPorNo: Record<string, number[]> | undefined;
  if (avFluxo.atingibilidade) {
    const ref = (avVig ?? avBase).atingibilidade ?? avFluxo.atingibilidade;
    const cntPlano = contagensDoPlano(ctx, resultado.alocacoes);
    const varMin = varrerContagensPreservando(ctx, cntPlano, limitesFinal ?? {}, true);
    minimosPorNo = varMin.minimos;
    const postosMinimos: PostoMinimoSlot[] = varMin.preservacao.map((x) => ({
      slot: x.slot, data: ctx.entrada.slots[x.slot].data, periodoId: ctx.entrada.slots[x.slot].periodoId, grupo: x.grupo, alvo: r3(x.alvo), meta: r3(x.meta), atingivel: x.atingivel,
      producaoObrigatoria: r3(x.producaoObrigatoria), minimos: x.minimos, noPlano: Object.fromEntries(Object.keys(x.minimos).map((n) => [n, cntPlano[n]?.[x.slot] ?? 0])), atendido: x.atendido,
    }));
    atingibilidade = { antes: ref, depois: avFluxo.atingibilidade, postosMinimos };
    avFluxo.atingibilidade.grupos.forEach((g) => {
      if (g.status === "META_ATINGIDA_PELO_PLANO") return;
      const nomes = g.produtos.map((p) => p.produtoId).join("+");
      diag.push({
        codigo: "META_NAO_ATINGIVEL", severidade: "aviso", produtoId: g.produtos[0]?.produtoId, etapaId: g.produtos[0]?.etapaFinalId,
        mensagem: g.status === "META_NAO_ATINGIVEL"
          ? `Meta semanal NÃO atingível (${nomes}): máximo possível ${Math.round(g.maximoPossivel)} de ${Math.round(g.meta)} (falta inevitável ${Math.round(g.faltaInevitavel)}); o plano prevê ${Math.round(g.finalPrevisto)}`
          : `Meta semanal atingível (${nomes}) mas NÃO entregue pelo plano: prevê ${Math.round(g.finalPrevisto)} de ${Math.round(g.meta)} (máximo possível ${Math.round(g.maximoPossivel)}); pessoas/máquinas não cobrem todas as metas`,
        detalhes: { status: g.status, meta: g.meta, maximoPossivel: g.maximoPossivel, faltaInevitavel: g.faltaInevitavel, finalPrevisto: g.finalPrevisto, faltaEvitavel: g.faltaEvitavel },
      });
    });
    if (planoEscolhido === "fluxo" && preservar) {
      const n1 = postosMinimos.filter((x) => x.slot === ctx.aPartirDe).reduce((s, x) => s + Object.values(x.minimos).reduce((a, b) => a + b, 0), 0);
      diag.push({ codigo: "POSTOS_MINIMOS_APLICADOS", severidade: "info", slot: ctx.aPartirDe, mensagem: `Preservação da atingibilidade: ${n1} posto(s) mínimo(s) no primeiro período mutável (tier 1, antes de maximizar peças finais)`, detalhes: { postosMinimosPrimeiroPeriodo: n1 } });
    }
  }

  // ---- financeiro (R$ pelo preço CONGELADO): referência × escolhido, produto a produto; sacrifícios nunca silenciosos ----
  let financeiro: DiagnosticoFinanceiro | undefined;
  if (avFluxo.financeiro) {
    const refF = (avVig ?? avBase).financeiro ?? avFluxo.financeiro;
    const variacao: VariacaoProduto[] = avFluxo.financeiro.produtos.map((p) => {
      const q = refF.produtos.find((x) => x.produtoId === p.produtoId && x.etapaFinalId === p.etapaFinalId);
      return { produtoId: p.produtoId, pecas: r3(p.finalProjetado - (q?.finalProjetado ?? 0)), rs: Math.round((p.rsProjetadoFechamento - (q?.rsProjetadoFechamento ?? 0)) * 100) / 100 };
    });
    financeiro = { antes: refF, depois: avFluxo.financeiro, variacao, deltaRsProjetado: Math.round((avFluxo.financeiro.total.rsProjetadoFechamento - refF.total.rsProjetadoFechamento) * 100) / 100 };
    variacao.filter((v) => v.pecas < -0.5).forEach((v) => {
      diag.push({ codigo: "PRODUTO_SACRIFICADO", severidade: "aviso", produtoId: v.produtoId, mensagem: `Produto com ${Math.round(-v.pecas)} peça(s) a menos que na referência (R$ ${v.rs.toFixed(2)}); variação total do plano: R$ ${financeiro!.deltaRsProjetado.toFixed(2)}`, detalhes: { pecas: v.pecas, rs: v.rs, deltaRsTotal: financeiro!.deltaRsProjetado } });
    });
  }

  // ---- economia: capacidade física/saturação por etapa, valor marginal, custo de oportunidade por decisão e limite econômico da atingibilidade ----
  let economia: DiagnosticoEconomia | undefined;
  if (objetivoFinanceiro(ctx.opcoes) || avFluxo.atingibilidade) {
    const an = analisarCapacidade(ctx, resultado.alocacoes, minimosPorNo, limitesFinal, nominais);
    const ate = ctx.aPartirDe + Math.max(1, ctx.opcoes.economiaSlots ?? 6);
    const nivel = avFluxo.financeiro?.produtos.some((p) => p.nivelValor === "margem") ? "margem" : "receita";
    const limiteEconomico = economico && melhorEco !== null
      ? {
          k: kEco, referencia: (melhorEco as Candidato).indice,
          candidatos: todos.filter((c) => c.violacoes.length === 0 && c !== melhorEco && t1Pior(t1(melhorEco as Candidato), t1(c))).map((c) => {
            const l = limiteDe(c);
            return { indice: c.indice, atingiveisPerdidas: c.aval.atingibilidade?.atingiveisPerdidas ?? 0, custoRs: r3(l.custo), valorRecuperadoRs: r3(l.valorRec), razao: l.razao === null ? null : r3(l.razao), justificado: l.justificado };
          }),
        }
      : undefined;
    economia = { nivel, capacidade: an.capacidade.filter((x) => x.slot < ate), decisoes: an.decisoes.filter((x) => x.slot < ate), ...(limiteEconomico ? { limiteEconomico } : {}) };
    an.capacidade.filter((x) => x.slot === ctx.aPartirDe && x.diagnostico !== "OK").forEach((x) => {
      if (x.diagnostico === "OK") return;
      diag.push({ codigo: x.diagnostico, severidade: "info", produtoId: x.produtoId, etapaId: x.etapaId, slot: x.slot, mensagem: `${x.diagnostico}: ${x.postosOcupados}/${x.postosMaximos} posto(s), valor marginal de mais uma pessoa R$ ${x.valorMarginalAdicionar}`, detalhes: { postosOcupados: x.postosOcupados, postosMaximos: x.postosMaximos, valorMarginalAdicionar: x.valorMarginalAdicionar } });
    });
    if (limiteEconomico && !limiteEconomico.candidatos.some((c) => c.justificado && c.indice === final.indice)) {
      const rec = limiteEconomico.candidatos.filter((c) => !c.justificado).sort((a, b) => a.atingiveisPerdidas - b.atingiveisPerdidas || (a.razao ?? 0) - (b.razao ?? 0))[0];
      if (rec) diag.push({ codigo: "ATINGIBILIDADE_NAO_PRESERVADA_CUSTO", severidade: "aviso", mensagem: `Meta atingível NÃO preservada: custo de oportunidade R$ ${rec.custoRs} > ${kEco} × valor recuperado R$ ${rec.valorRecuperadoRs} (razão ${rec.razao ?? "∞"})`, detalhes: { k: kEco, custoRs: rec.custoRs, valorRecuperadoRs: rec.valorRecuperadoRs, razao: rec.razao } });
    }
    if ((ctx.opcoes.objetivo === "margem" || ctx.opcoes.objetivo === "lucro_hora") && nivel === "receita") diag.push({ codigo: "MARGEM_INDISPONIVEL", severidade: "aviso", mensagem: "Objetivo margem sem margem confiável: decidindo por RECEITA marginal (não é lucro)", detalhes: {} });
  }

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
    versao: VERSAO_FLUXO, ...(economia ? { economia } : {}), ...(atingibilidade ? { atingibilidade } : {}), ...(financeiro ? { financeiro } : {}), planoEscolhido, referencia, vigente, estabilizacao: estab, reconciliacao: expl.reconciliacao, iteracaoEscolhida: usaFluxo ? final.indice : null, theta, antes,
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
