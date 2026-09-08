// Sittech Intelligence V1 — registro das 7 tools (§4 da instrução: exatamente
// estas, get_machine_analysis/get_product_analysis ficam fora desta V1).

import { getFactoryOverviewTool } from "@/features/intelligence/tools/getFactoryOverview";
import { getForecastStatusTool } from "@/features/intelligence/tools/getForecastStatus";
import { getProductionSummaryTool } from "@/features/intelligence/tools/getProductionSummary";
import { getDowntimeAnalysisTool } from "@/features/intelligence/tools/getDowntimeAnalysis";
import { getDeviationsTool } from "@/features/intelligence/tools/getDeviations";
import { getEmployeeAnalysisTool } from "@/features/intelligence/tools/getEmployeeAnalysis";
import { getEconomicSummaryTool } from "@/features/intelligence/tools/getEconomicSummary";
import { usuarioTemTodasPermissoes } from "@/features/intelligence/auth";
import { erroSemPermissao } from "@/features/intelligence/tools/types";
import type { IntelligenceTool, IntelligenceToolContext } from "@/features/intelligence/tools/types";
import type { IntelligenceToolResult } from "@/features/intelligence/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const INTELLIGENCE_TOOLS: IntelligenceTool<any>[] = [
  getFactoryOverviewTool,
  getForecastStatusTool,
  getProductionSummaryTool,
  getDowntimeAnalysisTool,
  getDeviationsTool,
  getEmployeeAnalysisTool,
  getEconomicSummaryTool,
];

export function encontrarTool(nome: string): IntelligenceTool | undefined {
  return INTELLIGENCE_TOOLS.find((t) => t.name === nome);
}

// Dispatch único — valida permissão server-side ANTES de rodar o handler
// (defesa em profundidade: mesmo que o provider tente chamar uma tool
// sem o usuário ter a permissão, isso nunca executa a consulta real).
export async function executarTool(nome: string, params: Record<string, unknown>, ctx: IntelligenceToolContext): Promise<IntelligenceToolResult> {
  const tool = encontrarTool(nome);
  if (!tool) return { success: false, tool: nome, code: "parametro_invalido", message: `Tool desconhecida: ${nome}.` };

  if (!usuarioTemTodasPermissoes(ctx.usuario, tool.permissoesRequeridas)) {
    return erroSemPermissao(nome, tool.permissoesRequeridas);
  }

  try {
    return await tool.handler(ctx, params);
  } catch (e) {
    return { success: false, tool: nome, code: "falha_consulta", message: "Não consegui consultar esse dado agora." };
  }
}
