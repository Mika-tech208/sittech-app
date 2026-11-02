// BUSCA LOCAL DE POSTOS COM DESPACHO FORWARD (sombra, offline, DESLIGADA: nada no motor chama isto). PURO e GENÉRICO (ids opacos).
//
// Por que existe: o plano reverso (planoReverso.ts) + otimizador de alvos (propostaCorte.ts) decidem QUANTO de cada produto, mas modelam o tempo por PERFIS (alap/asap/nivelado)
// e não conseguem TROCAR quem faz o quê entre períodos (ex.: pré-produzir Rosquear/Parafusar/Montar Presilha num período com pessoa livre para liberar a pessoa de um período
// saturado). Aqui o plano é um conjunto de LINHAS DE POSTO (período × máquina × operação) e a produção é DERIVADA por um despacho forward que respeita, por construção:
//   • lote de 1 período (a produção de Tn só existe para a etapa seguinte em Tn+1);  • nunca consumir mais do que o estoque do início do período (cadeia válida);
//   • teto de WIP útil (a etapa k nunca produz além do que o alvo final ainda pode consumir);  • teto de demanda por produto;  • uma máquina = um posto = uma pessoa;
//   • ≤ pessoas[t] linhas por período;  • no máximo `limiteOp` linhas da MESMA operação por bloco (manhã/tarde) — condição necessária do revezamento de bloco.
// Uma linha de máquina pode distribuir a capacidade entre produtos da MESMA operação (Etiquetadora 15 / Embalagem 17 com Conv + Autom): `detalhes` por linha = DISTRIBUICAO_DA_QUANTIDADE_POR_PRODUTO.
import type { ProdutoRev, RecursoRev } from "./planoReverso";

const EPS = 1e-6;

export interface DetalheLinha { produtoId: string; etapaId: string; etapaIdx: number; pecas: number }
export interface LinhaPostoD { t: number; recursoId: string; operacaoId: string }
export interface ConfigDespacho {
  /** primeiro período livre (os anteriores são congelados e NÃO entram) */
  t0: number;
  produtos: ProdutoRev[]; // wipInicial = estoque no INÍCIO de t0 (por ligação)
  recursos: RecursoRev[];
  /** pessoas disponíveis por período do horizonte completo */
  pessoas: number[];
  operacaoDe: (produtoId: string, etapaId: string) => string;
  /** peças finais ainda desejadas por produto (teto; demanda restante) */
  alvo: Record<string, number>;
  /** piso de peças finais por produto no futuro (EQUILIBRIO); penalizado se não atingido */
  piso?: Record<string, number>;
  /** valor por peça final (R$ de margem, ou 1 para "peças") */
  margem: Record<string, number>;
  /** ordem de prioridade entre produtos que dividem uma linha (a 1ª recebe primeiro) */
  prioridade: string[];
  blocos: number[][];
  limiteOp: number;
  /** linhas da MESMA operação já usadas no bloco pelo passado congelado: abatem do limite */
  abatimentoOp?: (bloco: number, operacaoId: string) => number;
  penalPiso?: number;
  /** ESTOQUE DE SAÍDA útil (para a semana seguinte): por produto, teto de peças em cada ligação no fim do horizonte que ainda têm valor; `saidaPeso` × margem × (fração do roteiro já feita) por peça. Sem isto, produção sem destino dentro do horizonte seria indiferente. */
  saidaTeto?: Record<string, number>;
  saidaPeso?: number;
}
export interface ResultadoDespacho {
  finais: Record<string, number>;
  obj: number;
  detalhes: DetalheLinha[][][]; // [t][idxLinha] — alinhado a `linhas` ordenadas por (t, recursoId)
  wip: Record<string, number[][]>; // produto -> ligação -> estoque no início de cada período (H+1), a partir de t0
  producao: Record<string, number[][]>; // produto -> etapa -> peças por período (H)
  linhasOciosas: LinhaPostoD[]; // linhas que não produziram nada (sem material / sem demanda)
}

interface PoolD { pid: string; k: number; n: number; etapaId: string; op: string; prio: number; rate: Map<number, number[]> /* recIdx -> taxa por t */ }

export function prepararDespacho(C: ConfigDespacho) {
  const H = C.pessoas.length;
  const recIdx = new Map(C.recursos.map((r, i) => [r.id, i]));
  const pools: PoolD[] = [];
  C.produtos.forEach((p) => p.etapas.forEach((e, k) => {
    const rate = new Map<number, number[]>();
    e.alternativas.forEach((a) => rate.set(recIdx.get(a.recursoId) as number, a.pecasPorPosto));
    pools.push({ pid: p.id, k, n: p.etapas.length, etapaId: e.id, op: C.operacaoDe(p.id, e.id), prio: Math.max(0, C.prioridade.indexOf(p.id)), rate });
  }));
  const ops = [...new Set(pools.map((p) => p.op))];
  const opIdx = new Map(ops.map((o, i) => [o, i]));
  // por (recurso, op): pools compatíveis, ordenados por prioridade
  const poolsDe: PoolD[][][] = C.recursos.map(() => ops.map(() => [] as PoolD[]));
  pools.forEach((pl) => pl.rate.forEach((_, r) => poolsDe[r][opIdx.get(pl.op) as number].push(pl)));
  poolsDe.forEach((a) => a.forEach((l) => l.sort((x, y) => x.prio - y.prio || y.k - x.k)));
  const opsDoRec = C.recursos.map((_, r) => ops.map((_, o) => o).filter((o) => poolsDe[r][o].length > 0));
  const blocoDe = new Array<number>(H).fill(-1);
  C.blocos.forEach((b, i) => b.forEach((t) => (blocoDe[t] = i)));
  const prodIdx = new Map(C.produtos.map((p, i) => [p.id, i]));
  // teto de produção por etapa (WIP útil): peças que passam pela etapa k ≤ alvo − estoque já além dela
  const capUp = C.produtos.map((p) => p.etapas.map((_, k) => {
    if (k === p.etapas.length - 1) return C.alvo[p.id] ?? 0;
    let alem = 0;
    for (let j = k; j < p.wipInicial.length; j++) alem += p.wipInicial[j];
    return Math.max(0, (C.alvo[p.id] ?? 0) + (C.saidaTeto?.[p.id] ?? 0) - alem);
  }));
  return { H, recIdx, pools, ops, opIdx, poolsDe, opsDoRec, blocoDe, prodIdx, capUp };
}
export type PrepD = ReturnType<typeof prepararDespacho>;

/** occ[t][r] = índice da operação + 1 (0 = desligada) */
export function despachar(C: ConfigDespacho, D: PrepD, occ: Uint8Array[], completo = false): ResultadoDespacho {
  const { H, poolsDe } = D;
  const np = C.produtos.length;
  const stock = C.produtos.map((p) => p.wipInicial.slice());
  const cum = C.produtos.map((p) => new Array(p.etapas.length).fill(0));
  const fin = new Array(np).fill(0);
  const detalhes: DetalheLinha[][][] = completo ? Array.from({ length: H }, () => []) : [];
  const producao: Record<string, number[][]> = {};
  const wip: Record<string, number[][]> = {};
  if (completo) C.produtos.forEach((p, i) => { producao[p.id] = p.etapas.map(() => new Array(H).fill(0)); wip[p.id] = p.wipInicial.map((w) => { const a = new Array(H + 1).fill(NaN); a[C.t0] = w; return a; }); void i; });
  const ociosas: LinhaPostoD[] = [];
  const arr = C.produtos.map((p) => new Array(p.etapas.length).fill(0));
  for (let t = C.t0; t < H; t++) {
    for (let i = 0; i < np; i++) arr[i].fill(0);
    const row = occ[t];
    for (let r = 0; r < row.length; r++) {
      const o = row[r];
      if (!o) continue;
      const lista = poolsDe[r][o - 1];
      let frac = 1;
      const det: DetalheLinha[] = [];
      for (const pl of lista) {
        const rate = pl.rate.get(r)?.[t] ?? 0;
        if (rate <= 0 || frac <= EPS) continue;
        const pi = D.prodIdx.get(pl.pid) as number;
        const mat = pl.k === 0 ? Number.POSITIVE_INFINITY : stock[pi][pl.k - 1];
        const head = pl.k === pl.n - 1 ? (C.alvo[pl.pid] ?? 0) - fin[pi] : D.capUp[pi][pl.k] - cum[pi][pl.k];
        const q = Math.min(rate * frac, mat, head);
        if (q <= EPS) continue;
        if (pl.k > 0) stock[pi][pl.k - 1] -= q;
        cum[pi][pl.k] += q;
        if (pl.k === pl.n - 1) fin[pi] += q; else arr[pi][pl.k] += q;
        frac -= q / rate;
        if (completo) { det.push({ produtoId: pl.pid, etapaId: pl.etapaId, etapaIdx: pl.k, pecas: q }); producao[pl.pid][pl.k][t] += q; }
      }
      if (completo) { detalhes[t].push(...[det]); if (det.length === 0) ociosas.push({ t, recursoId: C.recursos[r].id, operacaoId: D.ops[o - 1] }); }
    }
    for (let i = 0; i < np; i++) for (let k = 0; k < arr[i].length; k++) if (arr[i][k]) stock[i][k] += arr[i][k];
    if (completo) C.produtos.forEach((p, i) => p.wipInicial.forEach((_, j) => (wip[p.id][j][t + 1] = stock[i][j])));
  }
  let obj = 0, falta = 0;
  const finais: Record<string, number> = {};
  C.produtos.forEach((p, i) => { finais[p.id] = fin[i]; obj += (C.margem[p.id] ?? 0) * fin[i]; falta += Math.max(0, (C.piso?.[p.id] ?? 0) - fin[i]); });
  obj -= (C.penalPiso ?? 1) * falta;
  if (C.saidaTeto) C.produtos.forEach((p, i) => stock[i].forEach((v, j) => { obj += (C.saidaPeso ?? 0.25) * (C.margem[p.id] ?? 0) * ((j + 1) / p.etapas.length) * Math.min(v, C.saidaTeto?.[p.id] ?? 0); }));
  return { finais, obj, detalhes, wip, producao, linhasOciosas: ociosas };
}

/** Quantas linhas por período e por (bloco, operação) — para as restrições duras da busca. */
export function restricoesOk(C: ConfigDespacho, D: PrepD, occ: Uint8Array[], t: number): boolean {
  let n = 0;
  const row = occ[t];
  for (let r = 0; r < row.length; r++) if (row[r]) n++;
  if (n > (C.pessoas[t] ?? 0)) return false;
  const b = D.blocoDe[t];
  if (b < 0) return true;
  const cont = new Array(D.ops.length).fill(0);
  for (const tt of C.blocos[b]) { if (tt < C.t0) continue; const rw = occ[tt]; for (let r = 0; r < rw.length; r++) if (rw[r]) cont[rw[r] - 1]++; }
  for (let o = 0; o < cont.length; o++) if (cont[o] > C.limiteOp - (C.abatimentoOp?.(b, D.ops[o]) ?? 0)) return false;
  return true;
}

function prng(sem: number): () => number {
  let a = (sem + 0x9e3779b9) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function linhasParaOcc(C: ConfigDespacho, D: PrepD, linhas: LinhaPostoD[]): Uint8Array[] {
  const occ = Array.from({ length: D.H }, () => new Uint8Array(C.recursos.length));
  linhas.forEach((l) => { if (l.t >= C.t0) occ[l.t][D.recIdx.get(l.recursoId) as number] = (D.opIdx.get(l.operacaoId) as number) + 1; });
  return occ;
}
export function occParaLinhas(C: ConfigDespacho, D: PrepD, occ: Uint8Array[]): LinhaPostoD[] {
  const out: LinhaPostoD[] = [];
  for (let t = C.t0; t < D.H; t++) for (let r = 0; r < C.recursos.length; r++) if (occ[t][r]) out.push({ t, recursoId: C.recursos[r].id, operacaoId: D.ops[occ[t][r] - 1] });
  return out;
}

export interface OpcoesBusca { iter?: number; semente?: number; temp0?: number; tempFim?: number; reinicios?: number; /** orçamento de tempo: verificado a cada 1024 iterações; verdadeiro ⇒ interrompe a busca (quem chama decide descartar) */ parar?: () => boolean }
export interface ResultadoBusca { linhas: LinhaPostoD[]; desp: ResultadoDespacho; objInicial: number; iter: number; aceitas: number; melhorias: number; interrompida?: boolean }

/** Recozimento simulado sobre as linhas de posto. Sempre devolve o melhor plano visto (nunca pior que o inicial). Restrições duras mantidas em cada passo. */
export function buscaLocal(C: ConfigDespacho, inicial: LinhaPostoD[], op: OpcoesBusca = {}): ResultadoBusca {
  const D = prepararDespacho(C);
  const R = C.recursos.length, H = D.H;
  const occ0 = linhasParaOcc(C, D, inicial);
  const ini = despachar(C, D, occ0);
  let melhorOcc = occ0.map((r) => r.slice());
  let melhorObj = ini.obj;
  const total = op.iter ?? 200000;
  let aceitas = 0, melhorias = 0, it = 0;
  const reinicios = op.reinicios ?? 2;
  let interrompida = false;
  for (let rr = 0; rr < reinicios; rr++) {
    const rnd = prng((op.semente ?? 1) + rr * 7919);
    const occ = melhorOcc.map((r) => r.slice());
    let cur = despachar(C, D, occ).obj;
    const T0 = op.temp0 ?? Math.max(5, Math.abs(cur) * 0.002), T1 = op.tempFim ?? 0.05;
    const n = Math.floor(total / reinicios);
    for (let i = 0; i < n; i++, it++) {
      if ((i & 1023) === 0 && op.parar?.()) { interrompida = true; break; }
      const T = T0 * Math.pow(T1 / T0, i / n);
      // move: sorteia
      const u = rnd();
      const undo: { t: number; r: number; v: number }[] = [];
      const set = (t: number, r: number, v: number) => { undo.push({ t, r, v: occ[t][r] }); occ[t][r] = v; };
      const tt = C.t0 + Math.floor(rnd() * (H - C.t0));
      const livre = (t: number, r: number) => occ[t][r] === 0 && (C.recursos[r].unidades[t] ?? 0) > 0;
      const sorteiaRec = () => Math.floor(rnd() * R);
      const sorteiaOp = (r: number) => { const l = D.opsDoRec[r]; return l.length ? l[Math.floor(rnd() * l.length)] + 1 : 0; };
      const tocados = new Set<number>();
      if (u < 0.25) { // ADD
        const r = sorteiaRec(), o = sorteiaOp(r);
        if (!o || !livre(tt, r)) continue;
        set(tt, r, o); tocados.add(tt);
      } else if (u < 0.40) { // REMOVE
        const r = sorteiaRec();
        if (!occ[tt][r]) continue;
        set(tt, r, 0); tocados.add(tt);
      } else if (u < 0.55) { // CHANGE_OP
        const r = sorteiaRec();
        if (!occ[tt][r]) continue;
        const o = sorteiaOp(r);
        if (!o || o === occ[tt][r]) continue;
        set(tt, r, o); tocados.add(tt);
      } else if (u < 0.80) { // MOVE para outro (t, r)
        const r = sorteiaRec();
        if (!occ[tt][r]) continue;
        const t2 = C.t0 + Math.floor(rnd() * (H - C.t0)), r2 = rnd() < 0.5 ? r : sorteiaRec();
        const o2 = r2 === r ? occ[tt][r] : sorteiaOp(r2);
        if (!o2 || !livre(t2, r2) || (t2 === tt && r2 === r)) continue;
        set(tt, r, 0); set(t2, r2, o2); tocados.add(tt); tocados.add(t2);
      } else { // SHIFT ±1..3 da mesma máquina/operação
        const r = sorteiaRec();
        if (!occ[tt][r]) continue;
        const d = (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 3));
        const t2 = tt + d;
        if (t2 < C.t0 || t2 >= H || !livre(t2, r)) continue;
        const o = occ[tt][r];
        set(tt, r, 0); set(t2, r, o); tocados.add(tt); tocados.add(t2);
      }
      let ok = true;
      for (const t of tocados) if (!restricoesOk(C, D, occ, t)) { ok = false; break; }
      if (ok) {
        const nv = despachar(C, D, occ).obj - 1e-6 * undo.length * 0; // empate: nenhuma preferência
        const d = nv - cur;
        if (d >= 0 || rnd() < Math.exp(d / T)) {
          cur = nv; aceitas++;
          if (cur > melhorObj + 1e-9) { melhorObj = cur; melhorOcc = occ.map((r) => r.slice()); melhorias++; }
          continue;
        }
      }
      for (let k = undo.length - 1; k >= 0; k--) occ[undo[k].t][undo[k].r] = undo[k].v;
    }
    if (interrompida) break;
  }
  // PODA: linha cuja remoção não reduz o objetivo não tem destino útil (peça que não chega a produto final nem a estoque de saída útil) ⇒ pessoa fica SEM posto (explicada), não em posto inútil
  for (let t = H - 1; t >= C.t0; t--) for (let r = 0; r < R; r++) {
    if (!melhorOcc[t][r]) continue;
    const ob = despachar(C, D, melhorOcc).obj, v = melhorOcc[t][r];
    melhorOcc[t][r] = 0;
    if (despachar(C, D, melhorOcc).obj < ob - 1e-9) melhorOcc[t][r] = v;
  }
  // remove linhas sem produção (pessoa em posto sem material = proibido) e fixa o resultado completo
  let desp = despachar(C, D, melhorOcc, true);
  const dropar = desp.linhasOciosas;
  if (dropar.length) { dropar.forEach((l) => (melhorOcc[l.t][D.recIdx.get(l.recursoId) as number] = 0)); desp = despachar(C, D, melhorOcc, true); }
  return { linhas: occParaLinhas(C, D, melhorOcc), desp, objInicial: ini.obj, iter: it, aceitas, melhorias, interrompida };
}

/** Detalhes alinhados às linhas devolvidas por `buscaLocal` (ordem: t, depois índice do recurso). */
export function linhasComDetalhes(C: ConfigDespacho, linhas: LinhaPostoD[], desp: ResultadoDespacho): { linha: LinhaPostoD; detalhes: DetalheLinha[] }[] {
  const idx = new Map(C.recursos.map((r, i) => [r.id, i]));
  const por = new Map<number, LinhaPostoD[]>();
  linhas.forEach((l) => (por.get(l.t) ?? por.set(l.t, []).get(l.t)!).push(l));
  const out: { linha: LinhaPostoD; detalhes: DetalheLinha[] }[] = [];
  [...por.keys()].sort((a, b) => a - b).forEach((t) => {
    const ls = por.get(t)!.sort((a, b) => (idx.get(a.recursoId) as number) - (idx.get(b.recursoId) as number));
    ls.forEach((l, i) => out.push({ linha: l, detalhes: desp.detalhes[t]?.[i] ?? [] }));
  });
  return out;
}
