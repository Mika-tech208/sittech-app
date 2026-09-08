// Tool 1/7 — wrapper direto de gerarVisaoGeralProducaoReal (Visão Geral
// V1, já publicada). Zero cálculo novo. Janela fixa (semana atual + 14/28
// dias internos, exatamente como a tela já faz) — não aceita parâmetro de
// janela, por desenho (é o "resumo amplo" do §7 da análise, sempre a
// primeira tool de uma investigação em camadas).

import { mondayOf, toISODate } from "@/lib/date";
import { gerarVisaoGeralProducaoReal } from "@/features/producao-real/visao-geral";
import {
  buscarApontamentosEParadas, buscarProdutos, buscarMaquinas, buscarPeriodosEDiasUteis, buscarPrevisaoSemana, buscarOcorrenciasAbertas, ehErroConsulta,
} from "@/features/intelligence/dataFetchers";
import type { IntelligenceTool, IntelligenceToolContext } from "@/features/intelligence/tools/types";
import { erroFalhaConsulta } from "@/features/intelligence/tools/types";
import type { IntelligenceToolResult, IntelligenceEvidence } from "@/features/intelligence/types";

const JANELA_BUSCA_DIAS = 28;

async function handler(ctx: IntelligenceToolContext): Promise<IntelligenceToolResult> {
  const { supabase, agora } = ctx;
  const dataInicial = toISODate(new Date(agora.getTime() - JANELA_BUSCA_DIAS * 24 * 60 * 60 * 1000));
  const semanaInicio = toISODate(mondayOf(agora));

  const [apEParadas, produtos, maquinas, periodos, previsao, ocorrencias] = await Promise.all([
    buscarApontamentosEParadas(supabase, dataInicial, toISODate(agora)),
    buscarProdutos(supabase),
    buscarMaquinas(supabase),
    buscarPeriodosEDiasUteis(supabase),
    buscarPrevisaoSemana(supabase, semanaInicio),
    buscarOcorrenciasAbertas(supabase),
  ]);
  for (const r of [apEParadas, produtos, maquinas, periodos, previsao, ocorrencias]) {
    if (ehErroConsulta(r)) return erroFalhaConsulta("get_factory_overview", r.erro);
  }
  const { apontamentos, paradas } = apEParadas as Exclude<typeof apEParadas, { erro: string }>;

  const resultado = gerarVisaoGeralProducaoReal(
    apontamentos, paradas,
    previsao as Exclude<typeof previsao, { erro: string }>,
    produtos as Exclude<typeof produtos, { erro: string }>,
    maquinas as Exclude<typeof maquinas, { erro: string }>,
    (periodos as Exclude<typeof periodos, { erro: string }>).periodosComDuracao,
    (periodos as Exclude<typeof periodos, { erro: string }>).diasUteisSemana,
    ocorrencias as Exclude<typeof ocorrencias, { erro: string }>,
    agora
  );

  const evidences: IntelligenceEvidence[] = [
    {
      id: "overview-performance", domain: "producao", metric: "performance_pct", value: resultado.factoryHealth.performancePct ?? undefined, unit: "%",
      period: { start: resultado.factoryHealth.janela.dataInicial, end: resultado.factoryHealth.janela.dataFinal, label: resultado.factoryHealth.janela.rotulo },
      confidence: "CALCULADO", source: "calcularResumoIndicadores", drillDown: "/producao-real/indicadores",
    },
    {
      id: "overview-tempo-parado", domain: "paradas", metric: "minutos_parados", value: resultado.factoryHealth.minutosParadosTotais, unit: "min",
      period: { start: resultado.factoryHealth.janela.dataInicial, end: resultado.factoryHealth.janela.dataFinal, label: resultado.factoryHealth.janela.rotulo },
      confidence: "CALCULADO", source: "calcularResumoIndicadores",
    },
  ];
  if (resultado.pressuredResource) {
    evidences.push({
      id: "overview-recurso-pressionado", domain: "previsao", metric: "resource_pressure",
      value: resultado.pressuredResource.pctUso, unit: "%",
      context: { maquinaId: resultado.pressuredResource.maquinaId, maquinaNome: resultado.pressuredResource.maquinaNome },
      confidence: "CALCULADO", source: "gerarValidacaoPrevisao (recursosPressionados)", drillDown: "/producao-real/validacao-previsao",
    });
  }
  resultado.openOccurrences.forEach((o) => {
    evidences.push({
      id: `overview-ocorrencia-${o.id}`, domain: "ocorrencia", metric: "ocorrencia_aberta", value: o.tempoDecorridoRotulo,
      context: { maquinaId: o.maquinaId, maquinaNome: o.maquinaNome },
      confidence: "FATO", source: "ocorrencias_maquina", drillDown: "/producao-real",
    });
  });

  return {
    success: true, tool: "get_factory_overview",
    period: { start: resultado.factoryHealth.janela.dataInicial, end: resultado.factoryHealth.janela.dataFinal, label: resultado.factoryHealth.janela.rotulo },
    data: resultado, evidences,
  };
}

export const getFactoryOverviewTool: IntelligenceTool<Record<string, never>> = {
  name: "get_factory_overview",
  description: "Snapshot executivo da fábrica: saúde da semana (Performance/Disponibilidade/Qualidade/OEE/tempo parado), situação da previsão, ocorrências abertas agora, principais atenções, resumo de paradas e o recurso mais pressionado. Sempre a primeira tool para perguntas amplas tipo 'como está a fábrica'.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  permissoesRequeridas: ["producao_real_historico"],
  handler,
};
