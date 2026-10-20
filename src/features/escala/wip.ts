// Adicional por ETAPA e estoque intermediário (WIP) planejado — regras puras.
//
//  A_k = adicional (peças) processado na etapa k. Produto ACABADO adicional = A da última etapa.
//  Estoque intermediário entre k e k+1 = A_k − A_(k+1) (nunca negativo: a etapa seguinte não consome
//  o que ainda não existe).
//
// LIMITE de estoque entre k e k+1 (teto do que a etapa k pode empurrar para a etapa k+1):
//   (A) a próxima semana JÁ tem Previsão salva: a necessidade real dela do produto
//       (produto que não está lá => 0: nunca produzir estoque do que não está previsto);
//   (B) senão: `wipDiasLimite` dias produtivos de consumo da etapa seguinte
//       (todas as máquinas selecionadas dela × metas do primeiro dia produtivo da semana).

import { metaNoSlot } from "./folga";
import { chavePool, type PoolEscala, type SlotEscala } from "./types";

export interface ProximaSemana {
  /** Necessidade (peças) da próxima semana por produto — só existe quando a Previsão dela está salva. */
  quantidadePorProduto: Record<string, number>;
}

export function etapasPorProduto(pools: PoolEscala[]): Map<string, PoolEscala[]> {
  const mapa = new Map<string, PoolEscala[]>();
  pools.forEach((p) => {
    if (!mapa.has(p.produtoId)) mapa.set(p.produtoId, []);
    mapa.get(p.produtoId)!.push(p);
  });
  mapa.forEach((l) => l.sort((a, b) => a.ordemEtapa - b.ordemEtapa || (a.etapaId < b.etapaId ? -1 : 1)));
  return mapa;
}

// Capacidade de UM dia produtivo da etapa (todas as máquinas selecionadas, metas do 1º dia da semana).
export function capacidadeDiaria(pool: PoolEscala, slots: SlotEscala[]): number {
  if (slots.length === 0) return 0;
  const dia = slots[0].data;
  const porMaquina = slots.filter((s) => s.data === dia).reduce((soma, s) => soma + metaNoSlot(pool, s), 0);
  return porMaquina * new Set(pool.maquinasIds).size;
}

export function calcularLimitesWip(
  pools: PoolEscala[],
  slots: SlotEscala[],
  parametros: { wipDiasLimite: number },
  proxima: ProximaSemana | null
): Record<string, number> {
  const limites: Record<string, number> = {};
  etapasPorProduto(pools).forEach((etapas, produtoId) => {
    for (let k = 0; k + 1 < etapas.length; k++) {
      const chave = chavePool(etapas[k].produtoId, etapas[k].etapaId);
      limites[chave] = proxima ? Math.max(0, proxima.quantidadePorProduto[produtoId] ?? 0) : parametros.wipDiasLimite * capacidadeDiaria(etapas[k + 1], slots);
    }
  });
  return limites;
}
