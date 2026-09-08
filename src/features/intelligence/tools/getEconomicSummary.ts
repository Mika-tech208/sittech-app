// Tool 7/7 — wrapper direto de calcularResumoEconomico +
// calcularCustoIndustrialAproximado + calcularMargemProcessamento (Motor
// Econômico). Exige `financeiro` EXPLICITAMENTE além de
// producao_real_historico — mesmo a RPC subjacente só checando a
// segunda (§12 da instrução: "mesmo que a RPC atual permita acesso
// através de producao_real_historico, a TOOL econômica deve exigir
// também financeiro"). Nunca calcula faturamento/lucro/ROI — isso não
// existe em nenhum motor.

import { calcularResumoEconomico, calcularCustoIndustrialAproximado, calcularMargemProcessamento } from "@/features/producao-real/indicadores/economico";
import { buscarApontamentosEParadas, buscarProdutos, ehErroConsulta } from "@/features/intelligence/dataFetchers";
import { resolverJanela, JanelaInvalidaError, JANELAS_VALIDAS } from "@/features/intelligence/dates";
import { resolverEntidade } from "@/features/intelligence/entities";
import type { IntelligenceTool, IntelligenceToolContext } from "@/features/intelligence/tools/types";
import { erroFalhaConsulta, erroParametroInvalido } from "@/features/intelligence/tools/types";
import type { IntelligenceToolResult, IntelligenceEvidence, JanelaChave } from "@/features/intelligence/types";

interface Params {
  janela: JanelaChave;
  dataInicialCustom?: string;
  dataFinalCustom?: string;
  produtoNome?: string;
}

async function handler(ctx: IntelligenceToolContext, params: Params): Promise<IntelligenceToolResult> {
  const { supabase, agora } = ctx;
  let janelaResolvida;
  try {
    janelaResolvida = resolverJanela({ janela: params.janela, dataInicialCustom: params.dataInicialCustom, dataFinalCustom: params.dataFinalCustom }, agora);
  } catch (e) {
    if (e instanceof JanelaInvalidaError) return erroParametroInvalido("get_economic_summary", e.message);
    throw e;
  }

  const [apEParadas, produtos] = await Promise.all([
    buscarApontamentosEParadas(supabase, janelaResolvida.dataInicial, janelaResolvida.dataFinal),
    buscarProdutos(supabase),
  ]);
  for (const r of [apEParadas, produtos]) if (ehErroConsulta(r)) return erroFalhaConsulta("get_economic_summary", r.erro);
  let { apontamentos } = apEParadas as Exclude<typeof apEParadas, { erro: string }>;

  let contexto: { produtoId: string; produtoNome: string } | undefined;
  if (params.produtoNome) {
    const lista = (produtos as Exclude<typeof produtos, { erro: string }>).map((p) => ({ id: p.id, nome: p.nome }));
    const r = resolverEntidade(params.produtoNome, lista);
    if (r.status === "nao_encontrado") return { success: false, tool: "get_economic_summary", code: "entidade_nao_encontrada", message: `Nenhum produto corresponde a "${params.produtoNome}".` };
    if (r.status === "ambiguo") return { success: false, tool: "get_economic_summary", code: "entidade_ambigua", message: `Mais de um produto corresponde a "${params.produtoNome}".`, candidatos: r.candidatos };
    apontamentos = apontamentos.filter((a) => a.produtoId === r.id);
    contexto = { produtoId: r.id, produtoNome: r.nome };
  }

  if (apontamentos.length === 0) return { success: false, tool: "get_economic_summary", code: "sem_dados", message: "Não há dados no período." };

  const resumo = calcularResumoEconomico(apontamentos);
  const evidences: IntelligenceEvidence[] = [
    { id: "econ-custo-operacional", domain: "economia", metric: "custo_operacional_total", value: resumo.custoOperacionalTotal ?? undefined, unit: "R$", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, confidence: "CALCULADO", source: "calcularResumoEconomico", drillDown: "/producao-real/indicadores" },
    { id: "econ-custo-peca", domain: "economia", metric: "custo_medio_por_peca_boa", value: resumo.custoMedioPorPecaBoa ?? undefined, unit: "R$", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, confidence: "CALCULADO", source: "calcularResumoEconomico" },
    { id: "econ-custo-ocioso", domain: "economia", metric: "custo_tempo_parado_total", value: resumo.custoTempoParadoTotal ?? undefined, unit: "R$", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, confidence: "CALCULADO", source: "calcularResumoEconomico" },
  ];

  let custoIndustrial, margem;
  if (contexto) {
    custoIndustrial = calcularCustoIndustrialAproximado(apontamentos);
    margem = calcularMargemProcessamento(apontamentos);
    evidences.push(
      { id: "econ-custo-industrial", domain: "economia", metric: "custo_industrial_por_peca_acabada", value: custoIndustrial.custoIndustrialPorPecaAcabada ?? undefined, unit: "R$", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, confidence: "APROXIMACAO", source: "calcularCustoIndustrialAproximado" },
      { id: "econ-margem", domain: "economia", metric: "margem_pct", value: margem.margemPct ?? undefined, unit: "%", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, confidence: "APROXIMACAO", source: "calcularMargemProcessamento (preço atual, não snapshot)" }
    );
  }

  return { success: true, tool: "get_economic_summary", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, data: { resumo, custoIndustrial, margem }, evidences };
}

export const getEconomicSummaryTool: IntelligenceTool<Params> = {
  name: "get_economic_summary",
  description: "Custo operacional observado, custo por peça, custo de tempo ocioso (sempre CALCULADO) e, quando filtrado por um produto, custo industrial aproximado e margem de processamento (sempre APROXIMACAO, preço atual não é snapshot histórico). NUNCA suporta faturamento perdido, lucro perdido, ROI ou margem recuperável — não pergunte por essas métricas, elas não existem.",
  parameters: {
    type: "object",
    properties: {
      janela: { type: "string", enum: JANELAS_VALIDAS },
      dataInicialCustom: { type: "string" },
      dataFinalCustom: { type: "string" },
      produtoNome: { type: "string", description: "Necessário para custo industrial/margem (são calculados por produto). Opcional para o resumo geral." },
    },
    required: ["janela"],
    additionalProperties: false,
  },
  permissoesRequeridas: ["financeiro", "producao_real_historico"],
  handler,
};
