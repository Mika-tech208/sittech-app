// PLANEJAR COM FLUXO (spec §3–§4) — orquestra estado, hooks do motor e iteração por valor marginal. PURO.
//
//   1. plano BASE   = gerarEscala(entrada)                      (o que a Escala oficial faria hoje)
//   2. plano P0     = gerarEscala(entrada + remPorPool de fluxo)
//   3. it = 1..N    = gerarEscala(entrada + remPorPool + valor marginal do plano anterior + bônus de continuidade θ)
// Cada candidato é avaliado pelo MESMO simulador (avaliar.ts) e conferido por verificarRestricoesDuras. Escolhe-se o de menor tupla J
// (lexicográfica); candidatos com violação dura ou com falta final PIOR que a do plano base são inelegíveis ⇒ nunca pior que o base.

import { gerarEscala } from "../gerarEscala";
import { hashAlocacoes } from "../horizonte";
import { chavePool, type AlocacaoEscala, type EntradaEscala, type ResultadoEscala } from "../types";
import { avaliarComCtx } from "./avaliar";
import { contagensDoPlano, tabelaMarginal, varrerContagens } from "./otimizar";
import { montarEstado, prepararFluxo, type CtxFluxo, type OpcoesInternas } from "./estado";
import { verificarRestricoesDuras } from "./restricoes";
import {
  VERSAO_FLUXO, type AntesFluxo, type AvaliacaoPlano, type ChurnFluxo, type DadosProducaoReal, type DecisaoFluxo, type DepoisFluxo, type ResumoDecisao, type DiagnosticoFluxo, type DiagnosticoItem,
  type IteracaoFluxo, type PostoRef, type ResultadoFluxo, type TuplaObjetivo, type ViolacaoDura,
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

export function thetaPadrao(ctx: CtxFluxo): number {
  if (ctx.opcoes.limiarEstabilidadePecas !== undefined) return ctx.opcoes.limiarEstabilidadePecas;
  const T = ctx.entrada.slots.length;
  const ocupados = new Set(futuras(ctx, ctx.dados.planoVigente).filter((a) => a.maquinaId && a.produtoId && a.etapaId).map((a) => chavePool(a.produtoId as string, a.etapaId as string)));
  const metaMedia = (k: string) => {
    const p = ctx.poolsPorChave.get(k);
    if (!p) return 0;
    const vs: number[] = [];
    for (let t = ctx.aPartirDe; t < T; t++) {
      const m = (p.metas[ctx.entrada.slots[t].periodoId] ?? 0) * (ctx.fator[k] ?? 1);
      if (m > 0) vs.push(m);
    }
    return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : 0;
  };
  const base = (ocupados.size ? [...ocupados] : [...ctx.poolsPorChave.keys()]).map(metaMedia).filter((v) => v > 0);
  const menor = base.length ? Math.min(...base) : 0;
  let rf = 0;
  ctx.grafo.grupos.forEach((g) => (rf += Math.max(0, ctx.grafo.nos[g.sink].quantidade - (ctx.iniAPartirDe.lo.B0[g.sink] ?? 0))));
  return r3(Math.max(menor, 0.005 * rf));
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

export function planejarComFluxo(entrada: EntradaEscala, dados: DadosProducaoReal, opcoes: OpcoesInternas = {}): ResultadoFluxo {
  const ctx = prepararFluxo(entrada, dados, opcoes);
  const estado = montarEstado(ctx);
  const ponderar = opcoes.ponderarPorValor === true;
  const maxIt = Math.max(0, opcoes.maxIteracoes ?? 4);
  const diag: DiagnosticoItem[] = [...estado.diagnosticos];
  const theta = thetaPadrao(ctx);

  // ---- plano BASE ----
  const base = gerarEscala(entrada);
  const avBaseLeve = avaliarComCtx(ctx, base.alocacoes, { contribuicoes: false, trajetoria: false });
  const churnBase = calcularChurn(ctx, base.alocacoes);
  const violBase = verificarRestricoesDuras(entrada, base.alocacoes);
  const tuplaBase = tuplaObjetivo(avBaseLeve, churnBase, ponderar);

  const candidatos: Candidato[] = [];
  const hashes = new Set<string>([hashAlocacoes(base.alocacoes)]);
  const gerar = (indice: number, extra: Partial<EntradaEscala>): Candidato => {
    const ent: EntradaEscala = { ...entrada, remPorPool: estado.remPorPool, ...extra };
    const res = gerarEscala(ent);
    const aval = avaliarComCtx(ctx, res.alocacoes, { contribuicoes: false, trajetoria: false, limites: estado.remPorPool });
    const churn = calcularChurn(ctx, res.alocacoes);
    return { indice, entrada: ent, resultado: res, aval, violacoes: verificarRestricoesDuras(ent, res.alocacoes), churn, tupla: tuplaObjetivo(aval, churn, ponderar), hash: hashAlocacoes(res.alocacoes) };
  };

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

  // ---- escolha: menor J entre os ELEGÍVEIS (sem violação dura; falta final nunca pior que a do base) ----
  const elegivel = (c: Candidato) => c.violacoes.length === 0 && c.aval.totais.faltaFinalLo <= avBaseLeve.totais.faltaFinalLo + EPS_FALTA;
  candidatos.forEach((c) => {
    if (c.violacoes.length > 0) {
      diag.push({ codigo: "VIOLACAO_RESTRICAO_DURA", severidade: "erro", mensagem: `Candidato ${c.indice} descartado: ${c.violacoes.length} violação(ões) de restrição dura (${c.violacoes[0].tipo})`, detalhes: { iteracao: c.indice, violacoes: c.violacoes.length } });
    }
  });
  let escolhido: Candidato | null = null;
  candidatos.filter(elegivel).forEach((c) => {
    if (escolhido === null || compararTuplas(c.tupla, escolhido.tupla) < 0) escolhido = c;
  });
  // só abandona o base se o candidato for estritamente melhor pela tupla
  if (escolhido !== null && compararTuplas((escolhido as Candidato).tupla, tuplaBase) >= 0) escolhido = null;
  const usaFluxo = escolhido !== null;
  const final = escolhido as Candidato | null;

  // ---- estabilidade: quantos postos do 1º período mutável o bônus θ reteve ----
  let retidas = 0;
  if (final && final.indice >= 1 && theta > 0) {
    const semBonus = gerarEscala({ ...final.entrada, bonusContinuidade: undefined });
    const chaveSlotPostos = (l: AlocacaoEscala[]) => new Set(l.filter((a) => a.maquinaId && (ctx.idxSlot.get(`${a.data}|${a.periodoId}`) ?? -1) === ctx.aPartirDe).map((a) => `${a.maquinaId}|${a.produtoId}|${a.etapaId}`));
    const a1 = chaveSlotPostos(final.resultado.alocacoes);
    const a0 = chaveSlotPostos(semBonus.alocacoes);
    retidas = [...a1].filter((k) => !a0.has(k)).length;
    if (retidas > 0) diag.push({ codigo: "ESTABILIDADE_RETEVE_ALOCACAO", severidade: "info", slot: ctx.aPartirDe, mensagem: `${retidas} posto(s) do próximo período mantido(s): ganho de produto final abaixo de θ = ${theta} peças`, detalhes: { theta, retidas } });
  }

  const entradaFluxo = final ? final.entrada : entrada;
  const resultado = final ? final.resultado : base;
  const avFluxo = avaliarComCtx(ctx, resultado.alocacoes, { contribuicoes: true, trajetoria: opcoes.incluirTrajetoria !== false, limites: usaFluxo ? estado.remPorPool : undefined });
  const avBase = avaliarComCtx(ctx, base.alocacoes, { contribuicoes: true, trajetoria: opcoes.incluirTrajetoria !== false });
  const churn = calcularChurn(ctx, resultado.alocacoes, retidas);
  const violacoes = verificarRestricoesDuras(entradaFluxo, resultado.alocacoes);
  diag.push(usaFluxo
    ? { codigo: "PLANO_FLUXO_ESCOLHIDO", severidade: "info", mensagem: `Plano de fluxo (iteração ${final!.indice}) escolhido: falta final prevista ${Math.round(avFluxo.totais.faltaFinalLo)} × ${Math.round(avBase.totais.faltaFinalLo)} do plano base`, detalhes: { iteracao: final!.indice, faltaFluxo: avFluxo.totais.faltaFinalLo, faltaBase: avBase.totais.faltaFinalLo } }
    : { codigo: "PLANO_BASE_MANTIDO", severidade: "info", mensagem: "Nenhum plano de fluxo foi estritamente melhor que o plano base pelo simulador: plano base mantido", detalhes: { faltaBase: avBase.totais.faltaFinalLo } });

  const iteracoes: IteracaoFluxo[] = [
    { indice: -1, tupla: tuplaBase.map(r3), faltaFinalLo: avBaseLeve.totais.faltaFinalLo, violacoes: violBase.length, escolhida: !usaFluxo, hashPlano: hashAlocacoes(base.alocacoes) },
    ...candidatos.map((c) => ({ indice: c.indice, tupla: c.tupla.map(r3), faltaFinalLo: c.aval.totais.faltaFinalLo, violacoes: c.violacoes.length, escolhida: usaFluxo && c.indice === final!.indice, hashPlano: c.hash })),
  ];

  const todasDecisoes = usaFluxo ? decidir(ctx, base.alocacoes, resultado.alocacoes, avBase, avFluxo) : [];
  const maxDec = Math.max(0, opcoes.maxDecisoes ?? 120);
  const decisoes = todasDecisoes.length <= maxDec ? todasDecisoes : [...todasDecisoes].sort((a, b) => Math.abs(b.motivo.ganhoProdutoFinal) * b.quantidade - Math.abs(a.motivo.ganhoProdutoFinal) * a.quantidade || a.slot - b.slot).slice(0, maxDec).sort((a, b) => a.slot - b.slot);
  const resumo = new Map<string, ResumoDecisao & { _s: Set<number> }>();
  todasDecisoes.forEach((d) => {
    const k = `${d.de.produtoId}|${d.de.etapaId}>${d.para.produtoId}|${d.para.etapaId}`;
    const r = resumo.get(k) ?? { de: { produtoId: d.de.produtoId, etapaId: d.de.etapaId }, para: { produtoId: d.para.produtoId, etapaId: d.para.etapaId }, pessoasPeriodo: 0, slots: 0, ganhoProdutoFinal: 0, _s: new Set<number>() };
    r.pessoasPeriodo += d.quantidade;
    r.ganhoProdutoFinal = r3(r.ganhoProdutoFinal + d.motivo.ganhoProdutoFinal);
    r._s.add(d.slot);
    resumo.set(k, r);
  });
  const resumoDecisoes: ResumoDecisao[] = [...resumo.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, r]) => ({ de: r.de, para: r.para, pessoasPeriodo: r.pessoasPeriodo, slots: r._s.size, ganhoProdutoFinal: r.ganhoProdutoFinal }));
  const antes = montarAntes(estado, avBase);
  const dep = (a: AvaliacaoPlano): DepoisFluxo => ({
    produtoFinalPrevisto: { lo: r3(a.totais.finalEntregueLo), hi: r3(a.totais.finalEntregueHi) },
    wipPrevisto: { lo: a.totais.wipFinalLo, hi: a.totais.wipFinalHi },
    faltaPrevista: { lo: a.totais.faltaFinalLo, hi: a.totais.faltaFinalHi },
    excessoWip: a.totais.excessoWip,
  });
  const diagnostico: DiagnosticoFluxo = {
    versao: VERSAO_FLUXO, planoEscolhido: usaFluxo ? "fluxo" : "base", iteracaoEscolhida: usaFluxo ? final!.indice : null, theta, antes, decisoes, decisoesTotal: todasDecisoes.length, resumoDecisoes,
    depois: dep(avFluxo), depoisBase: dep(avBase), churn, iteracoes, violacoes, estado, avaliacaoBase: avBase, avaliacaoFluxo: avFluxo, diagnosticos: diag,
  };
  return { entradaFluxo, resultado, diagnostico };
}

function montarAntes(estado: ReturnType<typeof montarEstado>, avBase: AvaliacaoPlano): AntesFluxo {
  const demandaRestante: Record<string, number> = {};
  estado.produtos.forEach((p) => (demandaRestante[p.produtoId] = p.demandaFinalRestante));
  const remLegado: Record<string, number> = {};
  estado.demanda.forEach((d) => (remLegado[d.chave] = d.remLegado));
  const gargalos = avBase.produtos.map((p) => p.gargaloFluxo).filter((g): g is NonNullable<typeof g> => g !== null);
  const unicos = gargalos.filter((g, i) => gargalos.findIndex((h) => h.produtoId === g.produtoId && h.etapaId === g.etapaId) === i);
  return { demandaRestante, remLegado, wip: estado.pares, gargalosFluxo: unicos, faltaFinal: { lo: avBase.totais.faltaFinalLo, hi: avBase.totais.faltaFinalHi } };
}

function decidir(ctx: CtxFluxo, base: AlocacaoEscala[], novo: AlocacaoEscala[], avBase: AvaliacaoPlano, avFluxo: AvaliacaoPlano): DecisaoFluxo[] {
  const contribBase = new Map(avBase.postos.map((p) => [`${p.slot}|${p.maquinaId}`, p.pecasFinais]));
  const contribNovo = new Map(avFluxo.postos.map((p) => [`${p.slot}|${p.maquinaId}`, p.pecasFinais]));
  const b = new Map(futuras(ctx, base).map((a) => [`${a.data}|${a.periodoId}|${a.funcionarioId}`, a]));
  const grupos = new Map<string, DecisaoFluxo>();
  const excessoReduzido = Math.max(0, avBase.totais.excessoWip - avFluxo.totais.excessoWip);
  futuras(ctx, novo).forEach((a) => {
    const antigo = b.get(`${a.data}|${a.periodoId}|${a.funcionarioId}`);
    const de = postoDe(antigo);
    const para = postoDe(a);
    if (chavePosto(de) === chavePosto(para)) return;
    const slot = ctx.idxSlot.get(`${a.data}|${a.periodoId}`) as number;
    const k = `${slot}|${chavePosto(de)}|${chavePosto(para)}`;
    let d = grupos.get(k);
    if (!d) {
      const cDe = de.maquinaId ? contribBase.get(`${slot}|${de.maquinaId}`) ?? 0 : 0;
      const cPara = para.maquinaId ? contribNovo.get(`${slot}|${para.maquinaId}`) ?? 0 : 0;
      const ganho = r3(cPara - cDe);
      const noPara = para.produtoId && para.etapaId ? ctx.grafo.noDoPool[chavePool(para.produtoId, para.etapaId)] : undefined;
      const poolPara = para.produtoId && para.etapaId ? ctx.poolsPorChave.get(chavePool(para.produtoId, para.etapaId)) : undefined;
      const mu = poolPara ? (poolPara.metas[a.periodoId] ?? 0) * (ctx.fator[chavePool(poolPara.produtoId, poolPara.etapaId)] ?? 1) : 0;
      let wipDisp = 0;
      if (noPara) ctx.grafo.entradas[noPara].forEach((e) => (wipDisp += Math.max(0, ctx.iniAPartirDe.lo.W0[e] ?? 0)));
      const consome = ganho > 0 && wipDisp > 0 ? r3(Math.min(mu, wipDisp)) : 0;
      const noDe = de.produtoId && de.etapaId ? ctx.grafo.noDoPool[chavePool(de.produtoId, de.etapaId)] : undefined;
      const evita = noDe && ctx.grafo.nos[noDe].succ !== null && excessoReduzido > 0 ? r3(Math.min(excessoReduzido, ctx.poolsPorChave.get(chavePool(de.produtoId as string, de.etapaId as string))?.metas[a.periodoId] ?? 0)) : 0;
      const acao = !de.maquinaId ? "ocupa posto antes vazio" : !para.maquinaId ? "deixa o posto" : "troca de posto";
      d = {
        data: a.data, periodoId: a.periodoId, slot, de, para, quantidade: 0, funcionarios: [],
        motivo: {
          ganhoProdutoFinal: ganho, reducaoFalta: Math.max(0, ganho), wipConsumido: consome, wipEvitado: evita,
          texto: `${acao}; ganho estimado ${ganho} peça(s) final(is)${consome > 0 ? `; consome ~${Math.round(consome)} de WIP existente` : ""}${evita > 0 ? `; evita ~${Math.round(evita)} de WIP excedente` : ""}`,
        },
      };
      grupos.set(k, d);
    }
    d.quantidade++;
    d.funcionarios.push(a.funcionarioId);
  });
  return [...grupos.values()].sort((x, y) => x.slot - y.slot || (chavePosto(x.de) < chavePosto(y.de) ? -1 : 1) || (chavePosto(x.para) < chavePosto(y.para) ? -1 : 1));
}
