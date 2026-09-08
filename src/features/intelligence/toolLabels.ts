// Sittech Intelligence V1 — UI/UX. Nomes amigáveis pras 7 tools reais
// (§15 da instrução: usuário final nunca vê "get_forecast_status") e
// construção do link de drill-down a partir de `evidence.drillDown` +
// `evidence.context`/`period` (§14). Mapeamento só de apresentação — não
// inventa dado nenhum, só decide como mostrar o que a evidência já trouxe.

import type { IntelligenceEvidence } from "@/features/intelligence/types";

export const TOOL_LABELS: Record<string, string> = {
  get_factory_overview: "Visão geral",
  get_forecast_status: "Previsão",
  get_production_summary: "Produtividade",
  get_downtime_analysis: "Paradas",
  get_deviations: "Desvios",
  get_employee_analysis: "Funcionários",
  get_economic_summary: "Economia",
};

export function labelDaTool(tool: string): string {
  return TOOL_LABELS[tool] || tool;
}

// Só estas 3 rotas leem query params hoje (confirmado em cada page.tsx —
// as demais usam só useState local, então anexar query string ali seria
// só um link mais feio sem efeito nenhum). Nunca chuta um param que a
// rota não lê.
const ROTAS_COM_DEEPLINK: Record<string, { data: boolean; entidade: boolean }> = {
  "/producao-real/paradas": { data: true, entidade: true },
  "/producao-real/indicadores": { data: true, entidade: true },
  "/producao-real/funcionarios": { data: false, entidade: true },
};

// Constrói a URL final do "Ver dados" — path do drillDown (já validado pelo
// core) + query string só quando a rota de destino sabe ler (§6 do
// mapeamento de rotas). Se a rota não estiver na lista, devolve o path puro.
export function buildDrillDownHref(evidence: Pick<IntelligenceEvidence, "drillDown" | "context" | "period">): string | undefined {
  const path = evidence.drillDown;
  if (!path) return undefined;

  const suporte = ROTAS_COM_DEEPLINK[path];
  if (!suporte) return path;

  const params = new URLSearchParams();
  if (suporte.entidade) {
    if (evidence.context?.maquinaId) params.set("maquinaId", evidence.context.maquinaId);
    if (evidence.context?.produtoId) params.set("produtoId", evidence.context.produtoId);
    if (evidence.context?.operacaoId) params.set("operacaoId", evidence.context.operacaoId);
  }
  if (suporte.data && evidence.period?.start && evidence.period?.end) {
    params.set("dataInicial", evidence.period.start);
    params.set("dataFinal", evidence.period.end);
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
