// Desvios V1 — orquestrador. Único ponto que junta janelas + detecção +
// deduplicação + prioridade. Recebe os dados JÁ buscados (uma única
// chamada de obter_indicadores_producao/obter_paradas_producao cobrindo
// toda a janela estrutural, mesmo padrão de useParadasProducao) e fatia
// tudo client-side — nenhuma chamada nova ao banco é feita aqui.

import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import type { ParadaComContexto } from "@/features/producao-real/paradas/calculations";
import { calcularJanelaOperacional, calcularJanelaEstrutural, alinharPeriodosDoUltimoDia } from "@/features/producao-real/desvios/janelas";
import {
  detectarDesviosProdutividade, detectarDesviosParadas, detectarDesviosQualidade,
  detectarDesviosEconomia, detectarDesviosSemProducao, detectarDesviosFluxo,
} from "@/features/producao-real/desvios/deteccao";
import { deduplicarDesvios } from "@/features/producao-real/desvios/deduplicacao";
import { priorizarIncidentes } from "@/features/producao-real/desvios/prioridade";
import type { IncidenteDesvio, Janela, ParDeJanelas } from "@/features/producao-real/desvios/types";
import { JANELA_ESTRUTURAL_DIAS } from "@/features/producao-real/desvios/thresholds";

export * from "@/features/producao-real/desvios/types";
export * from "@/features/producao-real/desvios/janelas";
export * from "@/features/producao-real/desvios/amostra";
export * from "@/features/producao-real/desvios/severidade";
export * from "@/features/producao-real/desvios/contexto";

function filtrarPorJanela<T extends { data: string }>(itens: T[], janela: Janela): T[] {
  return itens.filter((i) => i.data >= janela.dataInicial && i.data <= janela.dataFinal);
}

function fatiar(
  apontamentos: ApontamentoIndicador[], paradas: ParadaComContexto[], janelas: ParDeJanelas
): { apAtual: ApontamentoIndicador[]; apReferencia: ApontamentoIndicador[]; pAtual: ParadaComContexto[]; pReferencia: ParadaComContexto[] } {
  const apAtualBruto = filtrarPorJanela(apontamentos, janelas.atual);
  const apReferenciaBruto = filtrarPorJanela(apontamentos, janelas.referencia);
  const apReferencia = alinharPeriodosDoUltimoDia(apAtualBruto, apReferenciaBruto, janelas.atual.dataFinal, janelas.referencia.dataFinal);

  const pAtualBruto = filtrarPorJanela(paradas, janelas.atual);
  const pReferenciaBruto = filtrarPorJanela(paradas, janelas.referencia);
  const pReferencia = alinharPeriodosDoUltimoDia(pAtualBruto, pReferenciaBruto, janelas.atual.dataFinal, janelas.referencia.dataFinal);

  return { apAtual: apAtualBruto, apReferencia, pAtual: pAtualBruto, pReferencia };
}

function gerarParaJanelas(
  apontamentos: ApontamentoIndicador[], paradas: ParadaComContexto[], janelas: ParDeJanelas, origem: "operacional" | "estrutural"
) {
  const { apAtual, apReferencia, pAtual, pReferencia } = fatiar(apontamentos, paradas, janelas);
  return [
    ...detectarDesviosProdutividade(apAtual, apReferencia, pAtual, pReferencia, janelas, origem),
    ...detectarDesviosParadas(apAtual, apReferencia, pAtual, pReferencia, janelas, origem),
    ...detectarDesviosQualidade(apAtual, apReferencia, pAtual, pReferencia, janelas, origem),
    ...detectarDesviosEconomia(apAtual, apReferencia, pAtual, pReferencia, janelas, origem),
    ...detectarDesviosSemProducao(apAtual, janelas, origem),
    ...detectarDesviosFluxo(apAtual, janelas, origem),
  ];
}

export interface ResultadoDesvios {
  incidentes: IncidenteDesvio[];
  janelaOperacional: ParDeJanelas;
  janelaEstrutural: ParDeJanelas;
}

export function gerarFilaDesvios(
  apontamentos: ApontamentoIndicador[], paradas: ParadaComContexto[], hoje: Date = new Date()
): ResultadoDesvios {
  const janelaOperacional = calcularJanelaOperacional(hoje);
  const janelaEstrutural = calcularJanelaEstrutural(hoje, JANELA_ESTRUTURAL_DIAS);

  const todos = [
    ...gerarParaJanelas(apontamentos, paradas, janelaOperacional, "operacional"),
    ...gerarParaJanelas(apontamentos, paradas, janelaEstrutural, "estrutural"),
  ];

  const incidentes = priorizarIncidentes(deduplicarDesvios(todos));
  return { incidentes, janelaOperacional, janelaEstrutural };
}
