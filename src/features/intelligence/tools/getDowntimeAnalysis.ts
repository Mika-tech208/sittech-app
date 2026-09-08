// Tool 4/7 — wrapper direto de calcularResumoParadas +
// calcularParetoParadasPorMetrica + calcularRecorrenciaParadas +
// agruparParadasPorMaquina (Paradas V1). Nunca soma minutos/R$/peças no
// mesmo número — cada métrica do Pareto fica em seu próprio campo.

import { calcularResumoParadas, calcularParetoParadasPorMetrica, calcularRecorrenciaParadas, agruparParadasPorMaquina, type MetricaParetoParadas } from "@/features/producao-real/paradas/calculations";
import { buscarApontamentosEParadas, buscarMaquinas, ehErroConsulta } from "@/features/intelligence/dataFetchers";
import { resolverJanela, JanelaInvalidaError, JANELAS_VALIDAS } from "@/features/intelligence/dates";
import { resolverEntidade } from "@/features/intelligence/entities";
import type { IntelligenceTool, IntelligenceToolContext } from "@/features/intelligence/tools/types";
import { erroFalhaConsulta, erroParametroInvalido } from "@/features/intelligence/tools/types";
import type { IntelligenceToolResult, IntelligenceEvidence, JanelaChave } from "@/features/intelligence/types";

interface Params {
  janela: JanelaChave;
  dataInicialCustom?: string;
  dataFinalCustom?: string;
  maquinaNome?: string;
  metrica?: MetricaParetoParadas;
}

async function handler(ctx: IntelligenceToolContext, params: Params): Promise<IntelligenceToolResult> {
  const { supabase, agora } = ctx;
  let janelaResolvida;
  try {
    janelaResolvida = resolverJanela({ janela: params.janela, dataInicialCustom: params.dataInicialCustom, dataFinalCustom: params.dataFinalCustom }, agora);
  } catch (e) {
    if (e instanceof JanelaInvalidaError) return erroParametroInvalido("get_downtime_analysis", e.message);
    throw e;
  }

  const [apEParadas, maquinas] = await Promise.all([
    buscarApontamentosEParadas(supabase, janelaResolvida.dataInicial, janelaResolvida.dataFinal),
    buscarMaquinas(supabase),
  ]);
  for (const r of [apEParadas, maquinas]) if (ehErroConsulta(r)) return erroFalhaConsulta("get_downtime_analysis", r.erro);
  let { apontamentos, paradas } = apEParadas as Exclude<typeof apEParadas, { erro: string }>;

  let contexto: { maquinaId: string; maquinaNome: string } | undefined;
  if (params.maquinaNome) {
    const lista = (maquinas as Exclude<typeof maquinas, { erro: string }>).map((m) => ({ id: m.id, nome: m.nome }));
    const r = resolverEntidade(params.maquinaNome, lista);
    if (r.status === "nao_encontrado") return { success: false, tool: "get_downtime_analysis", code: "entidade_nao_encontrada", message: `Nenhuma máquina corresponde a "${params.maquinaNome}".` };
    if (r.status === "ambiguo") return { success: false, tool: "get_downtime_analysis", code: "entidade_ambigua", message: `Mais de uma máquina corresponde a "${params.maquinaNome}".`, candidatos: r.candidatos };
    apontamentos = apontamentos.filter((a) => a.maquinaId === r.id);
    paradas = paradas.filter((p) => p.maquinaId === r.id);
    contexto = { maquinaId: r.id, maquinaNome: r.nome };
  }

  const resumo = calcularResumoParadas(paradas, apontamentos);
  const metrica = params.metrica || "minutos";
  const pareto = calcularParetoParadasPorMetrica(paradas, metrica);
  const recorrencia = calcularRecorrenciaParadas(paradas, apontamentos);
  const porMaquina = agruparParadasPorMaquina(paradas, apontamentos);

  const evidences: IntelligenceEvidence[] = [
    { id: "downtime-minutos", domain: "paradas", metric: "minutos_parados_total", value: resumo.minutosParadosTotal, unit: "min", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, confidence: "FATO", source: "calcularResumoParadas", drillDown: "/producao-real/paradas" },
    { id: "downtime-capacidade-perdida", domain: "paradas", metric: "capacidade_perdida_total", value: resumo.capacidadePerdidaTotal ?? undefined, unit: "peças", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, confidence: "CALCULADO", source: "calcularResumoParadas" },
    { id: "downtime-custo-ocioso", domain: "paradas", metric: "custo_tempo_ocioso_total", value: resumo.custoTempoOciosoTotal ?? undefined, unit: "R$", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, confidence: "CALCULADO", source: "calcularResumoParadas" },
  ];
  if (pareto.length > 0) {
    evidences.push({ id: "downtime-principal-motivo", domain: "paradas", metric: `principal_motivo_${metrica}`, value: pareto[0].motivoNome, period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, confidence: "CALCULADO", source: "calcularParetoParadasPorMetrica", drillDown: "/producao-real/paradas" });
  }
  if (porMaquina.length > 0 && !contexto) {
    evidences.push({ id: "downtime-maquina-mais-afetada", domain: "paradas", metric: "maquina_mais_afetada", value: porMaquina[0].rotulo, unit: "min", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, confidence: "CALCULADO", source: "agruparParadasPorMaquina" });
  }

  return {
    success: true, tool: "get_downtime_analysis",
    period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto,
    data: { resumo, pareto: pareto.slice(0, 10), recorrencia: recorrencia.slice(0, 10), porMaquina: porMaquina.slice(0, 10).map((g) => ({ rotulo: g.rotulo, resumo: g.resumo })) },
    evidences,
  };
}

export const getDowntimeAnalysisTool: IntelligenceTool<Params> = {
  name: "get_downtime_analysis",
  description: "Resumo de paradas: minutos totais, principal motivo (Pareto por minutos/quantidade/custo/capacidade), máquina mais afetada, capacidade local perdida, custo de tempo ocioso, recorrência por máquina+motivo. Nunca converte capacidade perdida em faturamento — isso não é suportado.",
  parameters: {
    type: "object",
    properties: {
      janela: { type: "string", enum: JANELAS_VALIDAS },
      dataInicialCustom: { type: "string" },
      dataFinalCustom: { type: "string" },
      maquinaNome: { type: "string", description: "Nome (ou parte) de uma máquina específica. Opcional." },
      metrica: { type: "string", enum: ["minutos", "quantidade", "custo", "capacidade"], description: "Métrica do Pareto de motivos. Default: minutos." },
    },
    required: ["janela"],
    additionalProperties: false,
  },
  permissoesRequeridas: ["producao_real_historico"],
  handler,
};
