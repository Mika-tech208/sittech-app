// TETOS DINÂMICOS DE WIP (replanejamento restrito) — núcleo PURO.
//
// O "limite de 2 dias" da semana é um TETO de estoque, não uma meta: o motor pode programar 0, 8.000 ou 25.000 peças de WIP, nunca acima do
// limite. Para que o replanejamento possa AUMENTAR o WIP quando a produção real libera capacidade (e REDUZI-LO quando o previsto precisa dela),
// as etapas intermediárias dos produtos que já têm WIP programado deixam de ter um teto fixo em peças: o que as limita é o estoque entre etapas
// (`wip.limites`), aplicado pelo próprio motor. O previsto continua tendo prioridade absoluta (camada 1); o WIP só ocupa quem sobra (camada 2).
//
// Escopo restrito: SÓ produtos que já têm adicional programado na Previsão (a carga flexível inicial) — nenhum produto novo entra; a última etapa
// (produto acabado adicional) mantém o teto programado.

import { chavePool, type PoolEscala } from "./types";

export const TETO_DINAMICO = 1_000_000_000;

export function aplicarTetosDinamicos(pools: PoolEscala[]): PoolEscala[] {
  const porProduto = new Map<string, PoolEscala[]>();
  pools.forEach((p) => porProduto.set(p.produtoId, [...(porProduto.get(p.produtoId) ?? []), p]));
  const flexiveis = new Set<string>();
  porProduto.forEach((etapas, produtoId) => {
    if (etapas.some((e) => (e.adicionalMax ?? 0) > 0)) flexiveis.add(produtoId);
  });
  const ultima = new Map<string, string>(); // produto -> chave da última etapa do roteiro
  porProduto.forEach((etapas, produtoId) => {
    const o = [...etapas].sort((a, b) => b.ordemEtapa - a.ordemEtapa)[0];
    ultima.set(produtoId, chavePool(o.produtoId, o.etapaId));
  });
  return pools.map((p) => (flexiveis.has(p.produtoId) && ultima.get(p.produtoId) !== chavePool(p.produtoId, p.etapaId) ? { ...p, adicionalMax: Math.max(p.adicionalMax ?? 0, TETO_DINAMICO) } : p));
}
