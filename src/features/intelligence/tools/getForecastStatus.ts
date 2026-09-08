// Tool 2/7 — wrapper direto de gerarValidacaoPrevisao (Validação da
// Previsão V1). Zero cálculo novo, zero teto em Performance/recursos,
// máquinas paralelas somam / etapas sequenciais MIN já preservados
// dentro do motor reaproveitado.

import { mondayOf, toISODate } from "@/lib/date";
import { gerarValidacaoPrevisao, JANELA_HISTORICA_DIAS } from "@/features/producao-real/validacao-previsao";
import {
  buscarApontamentosEParadas, buscarProdutos, buscarMaquinas, buscarPeriodosEDiasUteis, buscarPrevisaoSemana, ehErroConsulta,
} from "@/features/intelligence/dataFetchers";
import { resolverEntidade, type CandidatoEntidade } from "@/features/intelligence/entities";
import type { IntelligenceTool, IntelligenceToolContext } from "@/features/intelligence/tools/types";
import { erroFalhaConsulta } from "@/features/intelligence/tools/types";
import type { IntelligenceToolResult, IntelligenceEvidence } from "@/features/intelligence/types";

interface Params {
  produtoNome?: string;
}

async function handler(ctx: IntelligenceToolContext, params: Params): Promise<IntelligenceToolResult> {
  const { supabase, agora } = ctx;
  const semanaInicio = toISODate(mondayOf(agora));
  const dataInicial14 = toISODate(new Date(agora.getTime() - JANELA_HISTORICA_DIAS * 24 * 60 * 60 * 1000));

  const [apEParadas, produtos, maquinas, periodos, previsao] = await Promise.all([
    buscarApontamentosEParadas(supabase, dataInicial14, toISODate(agora)),
    buscarProdutos(supabase),
    buscarMaquinas(supabase),
    buscarPeriodosEDiasUteis(supabase),
    buscarPrevisaoSemana(supabase, semanaInicio),
  ]);
  for (const r of [apEParadas, produtos, maquinas, periodos, previsao]) {
    if (ehErroConsulta(r)) return erroFalhaConsulta("get_forecast_status", r.erro);
  }
  const { apontamentos, paradas } = apEParadas as Exclude<typeof apEParadas, { erro: string }>;
  const previsaoResolvida = previsao as Exclude<typeof previsao, { erro: string }>;

  if (!previsaoResolvida || previsaoResolvida.itens.length === 0) {
    return { success: false, tool: "get_forecast_status", code: "sem_dados", message: "Nenhuma previsão lançada para esta semana." };
  }

  const resultado = gerarValidacaoPrevisao(
    previsaoResolvida,
    produtos as Exclude<typeof produtos, { erro: string }>,
    maquinas as Exclude<typeof maquinas, { erro: string }>,
    (periodos as Exclude<typeof periodos, { erro: string }>).periodosComDuracao,
    (periodos as Exclude<typeof periodos, { erro: string }>).diasUteisSemana,
    apontamentos, paradas, agora
  );

  let itens = resultado.itens;
  if (params.produtoNome) {
    const candidatos: CandidatoEntidade[] = itens.map((i) => ({ id: i.produtoId, nome: i.produtoNome }));
    const r = resolverEntidade(params.produtoNome, candidatos);
    if (r.status === "nao_encontrado") return { success: false, tool: "get_forecast_status", code: "entidade_nao_encontrada", message: `Nenhum produto na previsão desta semana corresponde a "${params.produtoNome}".` };
    if (r.status === "ambiguo") return { success: false, tool: "get_forecast_status", code: "entidade_ambigua", message: `Mais de um produto corresponde a "${params.produtoNome}".`, candidatos: r.candidatos };
    itens = itens.filter((i) => i.produtoId === r.id);
  }

  const evidences: IntelligenceEvidence[] = itens.map((it) => ({
    id: `forecast-${it.itemId}`, domain: "previsao", metric: "estado_previsao", value: it.estado,
    context: { produtoId: it.produtoId, produtoNome: it.produtoNome },
    confidence: "CALCULADO", source: "gerarValidacaoPrevisao", drillDown: "/producao-real/validacao-previsao",
  }));
  itens.forEach((it) => {
    if (it.deficitProjetado !== null) {
      evidences.push({
        id: `forecast-deficit-${it.itemId}`, domain: "previsao", metric: "deficit_projetado", value: it.deficitProjetado, unit: "peças",
        context: { produtoId: it.produtoId, produtoNome: it.produtoNome },
        confidence: "ESTIMATIVA", source: "gerarValidacaoPrevisao (projeção)", drillDown: "/producao-real/validacao-previsao",
      });
    }
    evidences.push({
      id: `forecast-provavel-${it.itemId}`, domain: "previsao", metric: "capacidade_provavel_restante",
      value: it.capacidadeProvavelRestante ?? "indisponível", unit: it.capacidadeProvavelRestante === null ? undefined : "peças",
      context: { produtoId: it.produtoId, produtoNome: it.produtoNome },
      confidence: it.capacidadeProvavelRestante === null ? "ESTIMATIVA" : "ESTIMATIVA", source: "gerarValidacaoPrevisao (capacidade provável)",
    });
  });

  return {
    success: true, tool: "get_forecast_status",
    period: { start: previsaoResolvida.semanaInicio, end: toISODate(agora), label: "Semana atual (previsão)" },
    data: { itens, recursosPressionados: resultado.recursosPressionados, produtosForaDaPrevisao: resultado.produtosForaDaPrevisao, evidenciasSemProducao: resultado.evidenciasSemProducao },
    evidences,
  };
}

export const getForecastStatusTool: IntelligenceTool<Params> = {
  name: "get_forecast_status",
  description: "Situação da previsão da semana atual: estado de cada produto (concluído/no ritmo/atenção/inviável teoricamente/sem estimativa), déficit projetado, capacidade teórica/provável restante, recursos pressionados. Use para 'estamos no caminho de cumprir a semana', 'qual produto está em risco', 'qual máquina está mais pressionada'.",
  parameters: {
    type: "object",
    properties: { produtoNome: { type: "string", description: "Nome (ou parte do nome) de um produto específico da previsão, ex.: 'Luva 3/4'. Omitir para ver todos os produtos." } },
    additionalProperties: false,
  },
  permissoesRequeridas: ["previsao", "producao_real_historico"],
  handler,
};
