// SIMULADOR DE FLUXO — núcleo determinístico e puro. Uma única implementação para o plano oficial e o inteligente.
//
// Modelo (por GRUPO do grafo; grupos são independentes entre si no fluxo — só competem por pessoas/máquinas no motor):
//   • estado: B (boas acumuladas por nó) e W (estoque nas arestas, entre etapas), mais L (parte "legada" de W: o estoque inicial, FIFO).
//   • por slot, nós em ordem topológica: produção x = real (já apontada, forçada) + base (capacidade das linhas do PREVISTO, limitada pelo
//     restante previsto do nó) + adicional (linhas de carga adicional), sempre ≤ material disponível (W das arestas que chegam; com
//     `mesmoPeriodo` inclui o que a etapa anterior produz NO MESMO período) e, no nó final, ≤ o que falta para a meta.
//   • consumo sai das arestas de entrada proporcionalmente ao disponível em cada uma; o legado é consumido primeiro (FIFO).
//   • dois cenários rodam com a mesma função: "lo" (pessimista: boas e WIP no limite inferior) e "hi" (otimista).
// Limites assumidos (documentados em docs/escala-fluxo-nucleo.md): 1 peça de entrada = 1 peça de saída; sem lead time dentro do
// período além do flag mesmoPeriodo; capacidade de linha = meta do período × f (as pessoas já estão decididas pelo plano avaliado).

import { chavePool, type AlocacaoEscala, type PoolEscala, type SlotEscala } from "../types";
import type { Grafo, GrupoFluxo } from "./grafo";

export const EPS_FLUXO = 1e-9;

export interface CapNo {
  base: number[]; // capacidade (peças) do PREVISTO por slot absoluto
  adic: number[]; // capacidade de carga adicional por slot
  real: number[]; // produção já apontada (forçada) por slot
}

export interface ParamsSim {
  tIni: number;
  tFim: number; // exclusivo
  cap: Record<string, CapNo>;
  B0: Record<string, number>;
  W0: Record<string, number>;
  L0: Record<string, number>;
  Q: Record<string, number>; // quantidade prevista por nó
  limiteFut?: { desde: number; valor: Record<string, number> }; // limite da produção base a partir de `desde` (rem explícito do plano de fluxo)
  mesmoPeriodo: boolean;
  trajetoria?: boolean;
  /** Restante do previsto por nó JÁ em curso (continuação a partir de um estado salvo); tem precedência sobre limiteFut/Q−B0. */
  baseLeft0?: Record<string, number>;
}

export interface ResultadoSim {
  B: Record<string, number>;
  W: Record<string, number>;
  L: Record<string, number>;
  x: Record<string, number[]>; // produção por slot (índice t − tIni)
  traj: Record<string, number[]>; // W ao fim de cada slot (índice t − tIni)
  baseLeft: Record<string, number>; // restante do previsto por nó ao fim (para continuar a simulação)
  desperdicioBase: number; // capacidade de postos do PREVISTO que não produziu (sem material, sem demanda restante ou meta já atendida)
  bloqueadoPelaMeta: number; // peças do nó final que o plano produziria além da meta (capacidade desperdiçada)
}

export function simularGrupo(grafo: Grafo, g: GrupoFluxo, p: ParamsSim): ResultadoSim {
  const B: Record<string, number> = {};
  const W: Record<string, number> = {};
  const L: Record<string, number> = {};
  const baseLeft: Record<string, number> = {};
  g.nos.forEach((n) => {
    B[n] = p.B0[n] ?? 0;
    // restante do PREVISTO: Q − B0, ou o rem explícito com que o plano foi gerado (limiteFut; vale para tIni = desde)
    const lim = p.limiteFut?.valor[n];
    baseLeft[n] = p.baseLeft0?.[n] !== undefined ? (p.baseLeft0[n] as number) : lim !== undefined ? Math.max(0, lim) : Math.max(0, (p.Q[n] ?? 0) - B[n]);
  });
  g.arestas.forEach((e) => {
    W[e] = Math.max(0, p.W0[e] ?? 0);
    L[e] = Math.min(W[e], Math.max(0, p.L0[e] ?? 0));
  });
  let bloq = 0;
  let desperdicio = 0;
  const x: Record<string, number[]> = {};
  const traj: Record<string, number[]> = {};
  g.nos.forEach((n) => (x[n] = []));
  g.arestas.forEach((e) => (traj[e] = []));

  for (let t = p.tIni; t < p.tFim; t++) {
    const Wini: Record<string, number> = { ...W };
    g.nos.forEach((n) => {
      const no = grafo.nos[n];
      const ins = grafo.entradas[n];
      const c = p.cap[n];
      const real = c?.real[t] ?? 0;
      const base = c?.base[t] ?? 0;
      const adic = c?.adic[t] ?? 0;
      const disp = (e: string) => (p.mesmoPeriodo ? W[e] : Wini[e]);
      const avail = ins.length === 0 ? Number.POSITIVE_INFINITY : ins.reduce((s, e) => s + disp(e), 0);
      const targetLeft = no.final || no.succ === null ? Math.max(0, (p.Q[n] ?? 0) - B[n]) : Number.POSITIVE_INFINITY;

      const produzir = (alvo: number, ignoraRestante = false) => {
        let disp = avail;
        let left = alvo;
        let bl = ignoraRestante ? Number.POSITIVE_INFINITY : baseLeft[n];
        const xr = Math.min(real, disp, left);
        disp -= xr;
        left -= xr;
        bl = Math.max(0, bl - xr);
        const xb = Math.min(base, disp, bl, left);
        disp -= xb;
        left -= xb;
        const xa = Math.min(adic, disp, left);
        return { xr, xb, xa };
      };
      const { xr, xb, xa } = produzir(targetLeft);
      baseLeft[n] = Math.max(0, baseLeft[n] - xr) - xb;
      const total = xr + xb + xa;
      if (Number.isFinite(targetLeft)) {
        const sem = produzir(Number.POSITIVE_INFINITY, true);
        bloq += sem.xr + sem.xb + sem.xa - total; // produção que o plano queria mas a meta final já não aceita
      }
      desperdicio += Math.max(0, base - xb);
      x[n].push(total);
      B[n] += total;
      // consome das arestas de entrada, proporcional ao disponível
      if (ins.length > 0 && total > EPS_FLUXO) {
        const dispTotal = ins.reduce((s, e) => s + disp(e), 0);
        ins.forEach((e) => {
          const parte = dispTotal > EPS_FLUXO ? (disp(e) / dispTotal) * total : 0;
          const tira = Math.min(W[e], parte);
          W[e] -= tira;
          L[e] = Math.max(0, Math.min(W[e], L[e] - tira));
        });
      }
      if (no.succ !== null) W[n] = (W[n] ?? 0) + total;
    });
    if (p.trajetoria) g.arestas.forEach((e) => traj[e].push(W[e]));
  }
  return { B, W, L, x, traj, baseLeft, bloqueadoPelaMeta: bloq, desperdicioBase: desperdicio };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Capacidades a partir de linhas de alocação
// ---------------------------------------------------------------------------------------------------------------------------------

export function indiceDeSlots(slots: SlotEscala[]): Map<string, number> {
  return new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
}

export function novaCap(n: number): CapNo {
  return { base: new Array(n).fill(0), adic: new Array(n).fill(0), real: new Array(n).fill(0) };
}

/** Soma a capacidade das linhas (com posto) nos slots [de, ate). `ignorar`: chaves "slot|maquina" cobertas por apontamento. */
export function somarCapacidadeDeLinhas(
  caps: Record<string, CapNo>, grafo: Grafo, poolsPorChave: Map<string, PoolEscala>, idxSlot: Map<string, number>, linhas: AlocacaoEscala[],
  fator: Record<string, number>, de: number, ate: number, ignorar?: Set<string>
): void {
  linhas.forEach((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId) return;
    const t = idxSlot.get(`${a.data}|${a.periodoId}`);
    if (t === undefined || t < de || t >= ate) return;
    if (ignorar?.has(`${t}|${a.maquinaId}`)) return;
    const k = chavePool(a.produtoId, a.etapaId);
    const no = grafo.noDoPool[k];
    const pool = poolsPorChave.get(k);
    if (!no || !pool || !caps[no]) return;
    const mu = (pool.metas[a.periodoId] ?? 0) * (fator[k] ?? 1);
    if (mu <= 0) return;
    if ((a.pecasAdicional ?? 0) > 0 && !((a.pecas ?? 0) > 0)) caps[no].adic[t] += Math.min(mu, a.pecasAdicional as number);
    else caps[no].base[t] += mu;
  });
}

export function copiarCaps(caps: Record<string, CapNo>): Record<string, CapNo> {
  const r: Record<string, CapNo> = {};
  Object.entries(caps).forEach(([k, c]) => (r[k] = { base: [...c.base], adic: [...c.adic], real: [...c.real] }));
  return r;
}
