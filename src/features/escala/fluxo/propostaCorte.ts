// PROPOSTA COM CORTE (sombra, offline, DESLIGADO: nada no motor chama isto).
// PURO e GENÉRICO (ids opacos). Quando a demanda inteira NÃO cabe fisicamente com N pessoas, escolhe QUANTO produzir de cada produto (e, logo, o que CORTAR).
//
// O plano reverso (planoReverso.ts) vira RESTRIÇÃO FÍSICA MÍNIMA — não substitui o otimizador:
//   (1) alvo de peças finais por produto  →  (2) upstream MÍNIMO que o sustenta (lead time 1, WIP inicial, capacidade compartilhada)  →
//   (3) RESERVA desse upstream nos períodos certos (ledger de recursos)  →  (4) sobra de capacidade/pessoas = antecipação útil (2ª camada do reverso).
// A escolha dos alvos NÃO é por quantidade de peças: é por um objetivo explícito (`pesos` = R$ ou peças ou ponderação) sob a restrição de HEADCOUNT
// (postos obrigatórios por período ≤ pessoas) — o custo de cada produto em pessoas/postos-período, o uso de recursos compartilhados e o upstream entram
// porque o alvo só é viável se o plano reverso fecha a cadeia e cabe nas pessoas. Busca: guloso por valor/posto-período + trocas par-a-par (hill-climbing).
import { planejarReverso, type EntradaReverso, type ProdutoRev, type ResultadoReverso } from "./planoReverso";

const EPS = 1e-6;
const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);

export interface AvaliacaoAlvos {
  alvo: Record<string, number>;
  ordem: string[];
  res: ResultadoReverso;
  entregue: Record<string, number>;
  /** todos os alvos foram entregues (cadeia fecha fisicamente) e o headcount obrigatório cabe nas pessoas em TODOS os períodos */
  viavel: boolean;
  fisicoOk: boolean;
  deficitPessoas: number; // Σ_t max(0, postos obrigatórios − pessoas)
  picoPostos: number;
  postosPeriodo: number; // Σ postos-período obrigatórios (todos os produtos)
}

export interface LimiteOperacaoBloco {
  /** blocos = listas de índices de período (manhã/tarde de cada dia); revezamento: ninguém repete a MESMA operação no bloco ⇒ Σ postos da operação no bloco ≤ pessoas */
  blocos: number[][];
  operacaoDe: (produtoId: string, etapaId: string) => string;
  limite: number;
}
export interface OpcoesAvaliacao { tolRel?: number; perfilFinal?: "alap" | "asap" | "nivelado"; extensaoPeriodos?: number; semAntecipacao?: boolean; limiteOpBloco?: LimiteOperacaoBloco; upstreamCedo?: number; /** perfis a tentar (default: todos) */ combos?: [("alap" | "asap" | "nivelado"), number][] }

/** Σ de excesso (postos da operação no bloco − limite). Conta o uso total (obrigatório + antecipação) com teto por recurso/período (conservador para recurso compartilhado). */
export function excessoOperacaoBloco(res: ResultadoReverso, L: LimiteOperacaoBloco): number {
  let ex = 0;
  for (const b of L.blocos) {
    const porOp = new Map<string, number>();
    res.produtos.forEach((p) => p.etapas.forEach((e) => {
      const op = L.operacaoDe(p.produtoId, e.etapaId);
      for (const t of b) { let k = 0; Object.values(e.usoPorRecurso).forEach((v) => (k += Math.ceil((v[t] ?? 0) - 1e-6))); if (k > 0) porOp.set(op, (porOp.get(op) ?? 0) + k); }
    }));
    porOp.forEach((v) => (ex += Math.max(0, v - L.limite)));
  }
  return ex;
}

/** Roda o plano reverso com alvos de peças finais por produto (demandaFinal := alvo) e prioridade de recurso na ordem dada. */
export function avaliarAlvos(base: EntradaReverso, alvo: Record<string, number>, ordem: string[], op: OpcoesAvaliacao = {}): AvaliacaoAlvos {
  if (!op.perfilFinal && !base.perfilFinal) {
    // tenta combinações (perfil de tempo da etapa final × antecipação do upstream θ); fica com a primeira viável. θ>0 só ajuda onde há pessoa/máquina livre cedo.
    const combos = op.combos ?? ([["nivelado", 0], ["alap", 0], ["asap", 0], ["nivelado", 0.5], ["nivelado", 1], ["alap", 0.5], ["alap", 1], ["asap", 1]] as [("alap" | "asap" | "nivelado"), number][]);
    let melhor: AvaliacaoAlvos | null = null;
    for (const [perfil, cedo] of combos) {
      const a = avaliarUm(base, alvo, ordem, { ...op, perfilFinal: perfil, upstreamCedo: cedo });
      if (a.viavel) return a;
      if (!melhor || (a.fisicoOk && !melhor.fisicoOk) || (a.fisicoOk === melhor.fisicoOk && a.deficitPessoas < melhor.deficitPessoas)) melhor = a;
    }
    return melhor as AvaliacaoAlvos;
  }
  return avaliarUm(base, alvo, ordem, op);
}

function avaliarUm(base: EntradaReverso, alvo: Record<string, number>, ordem: string[], op: OpcoesAvaliacao): AvaliacaoAlvos {
  const por = new Map(base.produtos.map((p) => [p.id, p]));
  const produtos: ProdutoRev[] = ordem.filter((id) => por.has(id)).map((id) => ({ ...(por.get(id) as ProdutoRev), demandaFinal: Math.max(0, alvo[id] ?? 0) }));
  const res = planejarReverso({
    ...base, produtos, compartilhamento: "prioridade", perfilFinal: op.perfilFinal ?? base.perfilFinal, upstreamCedo: op.upstreamCedo ?? base.upstreamCedo,
    extensaoPeriodos: op.semAntecipacao ? 0 : op.extensaoPeriodos ?? base.extensaoPeriodos, limitarPorPessoas: false,
  });
  const entregue: Record<string, number> = {};
  let fisicoOk = true;
  res.produtos.forEach((p) => {
    entregue[p.produtoId] = p.entregavel;
    const a = alvo[p.produtoId] ?? 0;
    if (p.entregavel + Math.max(5, a * (op.tolRel ?? 0.002)) < a) fisicoOk = false;
  });
  const pessoas = base.pessoas ?? [];
  let deficit = 0, pico = 0, pp = 0;
  res.headcount.forEach((h) => { deficit += Math.max(0, h.postosObrigatorios - (pessoas[h.periodo] ?? Number.POSITIVE_INFINITY)); pico = Math.max(pico, h.postosObrigatorios); });
  res.produtos.forEach((p) => p.etapas.forEach((e) => (pp += soma(e.postosObrigatorios))));
  if (op.limiteOpBloco) deficit += excessoOperacaoBloco(res, op.limiteOpBloco);
  return { alvo: { ...alvo }, ordem, res, entregue, viavel: fisicoOk && deficit === 0, fisicoOk, deficitPessoas: deficit, picoPostos: pico, postosPeriodo: pp };
}

export interface ParamsOtimizar {
  base: EntradaReverso;
  /** valor por peça FINAL entregue (R$ de margem, ou 1 para "peças", ou ponderado) */
  pesos: Record<string, number>;
  /** piso de peças finais por produto (equilíbrio / cobertura mínima); default 0 */
  piso?: Record<string, number>;
  /** teto por produto (default: a demanda cheia) */
  teto?: Record<string, number>;
  /** conjuntos de produtos que disputam recurso: as permutações de ordem de cada grupo são testadas */
  grupos?: string[][];
  passoRel?: number; // passo da busca guloso (fração da demanda); default 0.04
  opAval?: OpcoesAvaliacao;
  /** orçamento máximo de avaliações do reverso (proteção) */
  maxAval?: number;
  niveisGrade?: number[];
  maxGrade?: number;
}
export interface ResultadoOtimizar { melhor: AvaliacaoAlvos; objetivo: number; avaliacoes: number; trilha: string[] }

const perm = <T,>(a: T[]): T[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => perm([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])));

export function objetivoDe(pesos: Record<string, number>, entregue: Record<string, number>): number {
  return Object.entries(entregue).reduce((s, [id, q]) => s + (pesos[id] ?? 0) * q, 0);
}

/** Escolhe os alvos por produto que maximizam Σ pesos·peças com a cadeia fechando e o headcount ≤ pessoas em todos os períodos. */
export function otimizarAlvos(P: ParamsOtimizar): ResultadoOtimizar {
  const ids = P.base.produtos.map((p) => p.id);
  const dem = Object.fromEntries(P.base.produtos.map((p) => [p.id, p.demandaFinal]));
  const teto = (id: string) => Math.min(dem[id], P.teto?.[id] ?? dem[id]);
  const piso = (id: string) => Math.min(teto(id), P.piso?.[id] ?? 0);
  const passo = P.passoRel ?? 0.04;
  let n = 0;
  const trilha: string[] = [];
  const ev = (alvo: Record<string, number>, ordem: string[]) => { n++; return avaliarAlvos(P.base, alvo, ordem, P.opAval); };
  const obj = (a: AvaliacaoAlvos) => objetivoDe(P.pesos, a.entregue);

  const grupos = (P.grupos ?? []).filter((g) => g.length > 1);
  // ordens candidatas: produto cada grupo permutado; os demais mantêm a ordem de `ids`
  const ordensCand: string[][] = [];
  const emGrupo = new Set(grupos.flat());
  const livres = ids.filter((i) => !emGrupo.has(i));
  const combos = grupos.reduce<string[][][]>((acc, g) => acc.flatMap((a) => perm(g).map((p) => [...a, p])), [[]]);
  combos.forEach((c) => ordensCand.push([...c.flat(), ...livres]));
  // MULTI-START: o headcount obrigatório é limitado no PICO por período (não na soma de postos-período), então o guloso por densidade pode errar o produto
  // que "enche" as pessoas. Além dele, tenta a maximização SEQUENCIAL em cada permutação de produtos (a ordem também é a prioridade de recurso).
  const sequenciais: { alvo: Record<string, number>; av: AvaliacaoAlvos; ordem: string[]; obj: number }[] = [];
  if (ids.length <= 6) {
    for (const ordem of perm(ids)) {
      let alvo: Record<string, number> = Object.fromEntries(ids.map((i) => [i, piso(i)]));
      let a = ev(alvo, ordem);
      if (!a.viavel) continue;
      for (const id of ordem) {
        const topo = ev({ ...alvo, [id]: teto(id) }, ordem);
        if (topo.viavel) { alvo = { ...alvo, [id]: teto(id) }; a = topo; continue; }
        let lo = alvo[id], hi = teto(id), mel: AvaliacaoAlvos | null = null;
        for (let k = 0; k < 9; k++) { const mid = (lo + hi) / 2; const t = ev({ ...alvo, [id]: mid }, ordem); if (t.viavel) { lo = mid; mel = t; } else hi = mid; }
        if (mel) { alvo = { ...alvo, [id]: lo }; a = mel; }
      }
      sequenciais.push({ alvo, av: a, ordem, obj: obj(a) });
    }
    sequenciais.sort((x, y) => y.obj - x.obj);
  }
  // BUSCA EM GRADE com poda (a viabilidade é monótona em cada alvo): o headcount é quantizado em PESSOAS INTEIRAS (ceil por recurso), então trocas pequenas não
  // liberam uma pessoa; níveis de 10% da demanda capturam os degraus (ex.: 4 máquinas de Montar Presilha → 3).
  const niveis = P.niveisGrade ?? [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const grade: { alvo: Record<string, number>; ordem: string[]; obj: number }[] = [];
  let melhorGrade = -Infinity;
  const limiteGrade = P.maxGrade ?? 60000;
  let nGrade = 0;
  for (const ordem of ordensCand) {
    const pisoVec = Object.fromEntries(ids.map((i) => [i, piso(i)]));
    const rec = (k: number, alvo: Record<string, number>) => {
      if (nGrade > limiteGrade) return;
      if (k === ids.length) { const a = ev(alvo, ordem); nGrade++; if (a.viavel) { const o = obj(a); grade.push({ alvo: { ...alvo }, ordem, obj: o }); if (o > melhorGrade) melhorGrade = o; } return; }
      const id = ids[k];
      for (const lv of niveis) {
        const v = Math.max(piso(id), Math.min(teto(id), lv * dem[id]));
        const alvo2 = { ...alvo, [id]: v };
        const ub = ids.reduce((sm, j) => sm + (P.pesos[j] ?? 0) * (j in alvo2 && ids.indexOf(j) <= k ? alvo2[j] : teto(j)), 0);
        if (ub <= melhorGrade + 1e-9) continue;
        const t = ev({ ...pisoVec, ...alvo2 }, ordem); nGrade++;
        if (!t.viavel) break; // níveis maiores deste produto também são inviáveis
        rec(k + 1, alvo2);
      }
    };
    rec(0, {});
  }
  grade.sort((x, y) => y.obj - x.obj);
  const partidas: { ordem: string[]; alvo?: Record<string, number> }[] = [...grade.slice(0, 4).map((g) => ({ ordem: g.ordem, alvo: g.alvo })), ...ordensCand.map((o) => ({ ordem: o })), ...sequenciais.slice(0, 3).map((s2) => ({ ordem: s2.ordem, alvo: s2.alvo }))];

  let globalMelhor: ResultadoOtimizar | null = null;
  for (const partida of partidas) {
    const ordem = partida.ordem;
    // ponto de partida: pisos (reduzidos uniformemente se nem eles cabem) ou a solução sequencial
    let alvo: Record<string, number> = partida.alvo ? { ...partida.alvo } : Object.fromEntries(ids.map((i) => [i, piso(i)]));
    let a = ev(alvo, ordem);
    if (!a.viavel && !partida.alvo) {
      let lo = 0, hi = 1;
      for (let k = 0; k < 10 && n < (P.maxAval ?? 40000); k++) { const mid = (lo + hi) / 2; const t = Object.fromEntries(ids.map((i) => [i, piso(i) * mid])); if (ev(t, ordem).viavel) lo = mid; else hi = mid; }
      alvo = Object.fromEntries(ids.map((i) => [i, piso(i) * lo]));
      a = ev(alvo, ordem);
    }
    const maximizarProduto = (id: string, alvo0: Record<string, number>, lim: number): { alvo: Record<string, number>; av: AvaliacaoAlvos } | null => {
      // maior valor de alvo[id] ∈ [alvo0[id], lim] viável (bisseção; viabilidade monótona em cada produto na prática)
      const tent = (v: number) => ev({ ...alvo0, [id]: v }, ordem);
      const topo = tent(lim);
      if (topo.viavel) return { alvo: { ...alvo0, [id]: lim }, av: topo };
      let lo = alvo0[id], hi = lim, melhor: AvaliacaoAlvos | null = null;
      for (let k = 0; k < 9; k++) { const mid = (lo + hi) / 2; const t = tent(mid); if (t.viavel) { lo = mid; melhor = t; } else hi = mid; }
      return melhor ? { alvo: { ...alvo0, [id]: lo }, av: melhor } : null;
    };
    // ---- 1) guloso por valor / posto-período marginal ----
    let guard = 0;
    for (;;) {
      if (guard++ > 400 || n > (P.maxAval ?? 40000)) break;
      let best: { id: string; alvo: Record<string, number>; av: AvaliacaoAlvos; dens: number } | null = null;
      for (const id of ids) {
        const stepQ = Math.max(500, dem[id] * passo);
        if (alvo[id] >= teto(id) - EPS) continue;
        const v = Math.min(teto(id), alvo[id] + stepQ);
        const t = ev({ ...alvo, [id]: v }, ordem);
        if (!t.viavel) continue;
        const dObj = obj(t) - obj(a), dPP = Math.max(0.05, t.postosPeriodo - a.postosPeriodo);
        if (dObj <= EPS) continue;
        const dens = dObj / dPP;
        if (!best || dens > best.dens) best = { id, alvo: { ...alvo, [id]: v }, av: t, dens };
      }
      if (!best) break;
      alvo = best.alvo; a = best.av;
    }
    // ---- 2) refinamento: para cada produto, estica até o limite viável (passos pequenos não pegam o último trecho) ----
    for (let rodada = 0; rodada < 3 && n < (P.maxAval ?? 40000); rodada++) {
      let mudou = false;
      for (const id of [...ids].sort((x, y) => (P.pesos[y] ?? 0) - (P.pesos[x] ?? 0))) {
        if (alvo[id] >= teto(id) - EPS) continue;
        const r = maximizarProduto(id, alvo, teto(id));
        if (r && obj(r.av) > obj(a) + 1e-6) { alvo = r.alvo; a = r.av; mudou = true; }
      }
      if (!mudou) break;
    }
    // ---- 3) trocas par-a-par: tira de A, dá a B (maximiza B); aceita se o objetivo sobe ----
    let melhorou = true, voltas = 0;
    while (melhorou && voltas++ < 6 && n < (P.maxAval ?? 40000)) {
      melhorou = false;
      for (const dec of ids) for (const inc of ids) {
        if (dec === inc || alvo[dec] <= piso(dec) + EPS || alvo[inc] >= teto(inc) - EPS) continue;
        for (const fr of [0.2, 0.08, 0.03]) {
          const corte = Math.min(alvo[dec] - piso(dec), dem[dec] * fr);
          if (corte < 100) continue;
          const base1 = { ...alvo, [dec]: alvo[dec] - corte };
          const t0 = ev(base1, ordem);
          if (!t0.viavel) continue;
          const r = maximizarProduto(inc, base1, teto(inc));
          if (r && obj(r.av) > obj(a) + 1e-6) { alvo = r.alvo; a = r.av; melhorou = true; trilha.push(`troca: -${Math.round(corte)} ${dec} / +${Math.round(r.alvo[inc] - base1[inc])} ${inc}`); break; }
        }
      }
    }
    const cand: ResultadoOtimizar = { melhor: a, objetivo: obj(a), avaliacoes: n, trilha };
    if (!globalMelhor || cand.objetivo > globalMelhor.objetivo + 1e-6) globalMelhor = cand;
  }
  return { ...(globalMelhor as ResultadoOtimizar), avaliacoes: n };
}

/** Maior cobertura UNIFORME c (alvo_i = c·demanda_i) viável: base do critério de EQUILÍBRIO (max-min). */
export function coberturaUniformeMaxima(base: EntradaReverso, ordem: string[], op: OpcoesAvaliacao = {}): { c: number; av: AvaliacaoAlvos } {
  const dem = Object.fromEntries(base.produtos.map((p) => [p.id, p.demandaFinal]));
  const tent = (c: number) => avaliarAlvos(base, Object.fromEntries(Object.entries(dem).map(([i, d]) => [i, d * c])), ordem, op);
  const t1 = tent(1);
  if (t1.viavel) return { c: 1, av: t1 };
  let lo = 0, hi = 1, melhor = tent(0);
  for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; const t = tent(mid); if (t.viavel) { lo = mid; melhor = t; } else hi = mid; }
  return { c: lo, av: melhor };
}
