import { describe, expect, it } from "vitest";
import { buildDrillDownHref, labelDaTool, TOOL_LABELS } from "@/features/intelligence/toolLabels";
import { INTELLIGENCE_TOOLS } from "@/features/intelligence/tools";

describe("toolLabels.ts — nomes amigáveis + drill-down (§14/§15 da instrução)", () => {
  it("as 7 tools reais do registro têm rótulo amigável mapeado (nunca aparece get_xxx pro usuário)", () => {
    INTELLIGENCE_TOOLS.forEach((t) => {
      expect(TOOL_LABELS[t.name]).toBeDefined();
      expect(TOOL_LABELS[t.name]).not.toMatch(/^get_/);
    });
  });

  it("tool desconhecida cai pro próprio nome (nunca quebra a tela)", () => {
    expect(labelDaTool("tool_que_nao_existe")).toBe("tool_que_nao_existe");
  });

  it("sem drillDown, não gera link nenhum", () => {
    expect(buildDrillDownHref({})).toBeUndefined();
  });

  it("rota sem suporte a query params (ex.: desvios) devolve o path puro, sem inventar parâmetro que a tela não lê", () => {
    expect(buildDrillDownHref({ drillDown: "/producao-real/desvios", context: { maquinaId: "abc" } })).toBe("/producao-real/desvios");
  });

  it("Paradas/Indicadores: anexa maquinaId + dataInicial/dataFinal quando presentes", () => {
    const href = buildDrillDownHref({
      drillDown: "/producao-real/paradas",
      context: { maquinaId: "m1" },
      period: { start: "2026-09-01", end: "2026-09-07", label: "Semana atual" },
    });
    expect(href).toBe("/producao-real/paradas?maquinaId=m1&dataInicial=2026-09-01&dataFinal=2026-09-07");
  });

  it("Funcionários: NUNCA anexa data (rota não lê esse param — confirmado no código da própria tela)", () => {
    const href = buildDrillDownHref({
      drillDown: "/producao-real/funcionarios",
      context: { maquinaId: "m1" },
      period: { start: "2026-09-01", end: "2026-09-07", label: "Semana atual" },
    });
    expect(href).toBe("/producao-real/funcionarios?maquinaId=m1");
  });

  it("sem nenhum param disponível, devolve o path puro (sem '?' pendurado)", () => {
    expect(buildDrillDownHref({ drillDown: "/producao-real/paradas" })).toBe("/producao-real/paradas");
  });
});
