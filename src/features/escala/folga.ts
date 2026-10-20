// Folga dinâmica de um pool (produto, etapa), em PEÇAS.
//
//   folga = capacidade restante possível − demanda restante
//
// - demanda restante   = Rem_P (peças ainda não creditadas);
// - capacidade restante = Σ_{m ∈ M_P} φ(m,P) · Σ_{u ≥ t, m disponível em u} μ_P(π(u))
//   onde μ_P(π) = meta do período π da etapa (peças por máquina no período).
//
// φ(m,P) é a fração da máquina m dedicada ao pool P. Máquina que serve um
// pool só: φ = 1. Máquina compartilhada: φ proporcional às peças restantes
// de cada pool convertidas em períodos-máquina (Rem_P / μ̄_P) — o mesmo
// princípio de divisão proporcional que a Previsão já usa para máquinas
// compartilhadas (calcularHorasPorMaquina), agora em peças.
//
// Para comparar etapas de ritmos diferentes, a ordenação usa
// folgaPeriodos = folga / μ̄_P (folga em períodos-máquina equivalentes).
// folga <= 0  =>  GARGALO dinâmico: o pool precisa rodar em todo slot
// restante em que houver máquina disponível.

import type { PoolEscala, SlotEscala } from "./types";

export const EPS = 1e-9;

export interface FolgaPool {
  folga: number;
  folgaPeriodos: number;
  muBarra: number;
  gargalo: boolean;
}

export function metaNoSlot(pool: PoolEscala, slot: SlotEscala): number {
  const v = pool.metas[slot.periodoId];
  return v !== undefined && v > 0 ? v : 0;
}

export function calcularFolgas(
  t: number,
  slots: SlotEscala[],
  pools: PoolEscala[],
  rem: Map<string, number>,
  chaveDe: (p: PoolEscala) => string,
  maquinaDisponivel: (maquinaId: string, slotIndice: number) => boolean
): Map<string, FolgaPool> {
  const ativos = pools.filter((p) => (rem.get(chaveDe(p)) ?? 0) > EPS);
  const muBarra = new Map<string, number>();
  const peso = new Map<string, number>();
  ativos.forEach((p) => {
    let soma = 0;
    let n = 0;
    for (let u = t; u < slots.length; u++) {
      const mu = metaNoSlot(p, slots[u]);
      if (mu > 0) {
        soma += mu;
        n++;
      }
    }
    const mb = n > 0 ? soma / n : 0;
    muBarra.set(chaveDe(p), mb);
    peso.set(chaveDe(p), mb > 0 ? (rem.get(chaveDe(p)) as number) / mb : 0);
  });

  const somaPesoPorMaquina = new Map<string, number>();
  ativos.forEach((p) => {
    p.maquinasIds.forEach((m) => somaPesoPorMaquina.set(m, (somaPesoPorMaquina.get(m) ?? 0) + (peso.get(chaveDe(p)) as number)));
  });

  const resultado = new Map<string, FolgaPool>();
  ativos.forEach((p) => {
    const chave = chaveDe(p);
    const r = rem.get(chave) as number;
    const mb = muBarra.get(chave) as number;
    let cap = 0;
    p.maquinasIds.forEach((m) => {
      const den = somaPesoPorMaquina.get(m) ?? 0;
      const phi = den > EPS ? (peso.get(chave) as number) / den : 1;
      let s = 0;
      for (let u = t; u < slots.length; u++) {
        if (maquinaDisponivel(m, u)) s += metaNoSlot(p, slots[u]);
      }
      cap += phi * s;
    });
    const folga = cap - r;
    resultado.set(chave, {
      folga,
      folgaPeriodos: mb > 0 ? folga / mb : Number.NEGATIVE_INFINITY,
      muBarra: mb,
      gargalo: folga <= EPS,
    });
  });
  return resultado;
}
