// SERVER-ONLY. Limite de estoque e WIP adicional planejado por par de etapas, para a tela do estoque intermediário.
// Usa a MESMA montagem de entrada do motor (montarEntradaEscala), então o limite mostrado é o que o motor aplica.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpcoesResumoWip } from "@/features/escala/wipSaldo";
import { montarEntradaEscala } from "./montarEntrada";
import { criarEscalaIO, resolverPrevisaoPorSemana } from "./supabaseIO";

export async function limitesDaSemana(admin: SupabaseClient, semanaInicio: string, agoraMs: number): Promise<OpcoesResumoWip> {
  try {
    const previsaoId = await resolverPrevisaoPorSemana(admin, semanaInicio);
    if (!previsaoId) return {};
    const estado = await criarEscalaIO(admin, previsaoId).carregarEstado(agoraMs);
    const limites = montarEntradaEscala(estado, agoraMs).entrada.wip?.limites ?? {};
    // WIP adicional já programado na Previsão, por par: A_origem − A_seguinte (soma dos itens do produto)
    const etapasPorProduto = new Map<string, { id: string; ordem: number }[]>();
    estado.etapas.forEach((e) => (etapasPorProduto.get(e.produtoId) ?? etapasPorProduto.set(e.produtoId, []).get(e.produtoId)!).push({ id: e.id, ordem: e.ordem }));
    const adicionalPlanejado: Record<string, number> = {};
    estado.itens.forEach((it) => {
      const et = (etapasPorProduto.get(it.produtoId) ?? []).sort((a, b) => a.ordem - b.ordem || (a.id < b.id ? -1 : 1));
      for (let k = 0; k + 1 < et.length; k++) {
        const cap = (id: string) => (it.adicionalPorEtapa ? it.adicionalPorEtapa[id] ?? 0 : it.quantidadeAdicional ?? 0);
        const stock = Math.max(0, cap(et[k].id) - cap(et[k + 1].id));
        if (stock > 0) adicionalPlanejado[`${it.produtoId}|${et[k].id}`] = (adicionalPlanejado[`${it.produtoId}|${et[k].id}`] ?? 0) + stock;
      }
    });
    return { limites, adicionalPlanejado };
  } catch {
    return {}; // melhor esforço: sem limite, a tela mostra o resto
  }
}
