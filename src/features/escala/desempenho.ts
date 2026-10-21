// PERFORMANCE conhecida por etapa (Fase 4c) — correção MODERADA da capacidade futura. Núcleo puro.
//   n < 3                ⇒ f = 1
//   n ≥ 3                ⇒ obs = Σ boas / Σ meta, limitada a [0,30 ; 1,30];  peso = n / (n + 6);  f = 1 + peso × (obs − 1)
// A quantidade restante REAL continua mandando; `f` só multiplica as metas futuras. Usa apenas linhas já visíveis no corte.

import { chavePool, type PoolEscala } from "./types";
import type { ApontamentoReal } from "./producaoReal";

export const PERF_MINIMA = 0.3;
export const PERF_MAXIMA = 1.3;
export const PERF_AMOSTRAS_MINIMAS = 3;
export const PERF_K0 = 6;

export function fatorDesempenho(n: number, somaBoas: number, somaMeta: number): number {
  if (n < PERF_AMOSTRAS_MINIMAS || somaMeta <= 0) return 1;
  const obs = Math.min(PERF_MAXIMA, Math.max(PERF_MINIMA, somaBoas / somaMeta));
  const peso = n / (n + PERF_K0);
  return 1 + peso * (obs - 1);
}

export interface DesempenhoEtapa { n: number; obs: number | null; f: number }

// `apontamentos` já filtrados por `visivelNoCorte`. Só linhas "produzindo" com meta > 0 contam.
export function desempenhoPorEtapa(pools: PoolEscala[], apontamentos: ApontamentoReal[]): Record<string, DesempenhoEtapa> {
  const r: Record<string, DesempenhoEtapa> = {};
  pools.forEach((p) => {
    const k = chavePool(p.produtoId, p.etapaId);
    const v = apontamentos.filter((a) => a.status === "produzindo" && a.meta > 0 && a.produtoId === p.produtoId && a.etapaId === p.etapaId);
    const boas = v.reduce((s, a) => s + a.boas, 0);
    const meta = v.reduce((s, a) => s + a.meta, 0);
    r[k] = { n: v.length, obs: meta > 0 ? boas / meta : null, f: fatorDesempenho(v.length, boas, meta) };
  });
  return r;
}
