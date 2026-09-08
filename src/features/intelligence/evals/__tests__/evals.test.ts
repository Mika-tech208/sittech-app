import { describe, expect, it } from "vitest";
import { EVAL_CASES, EVAL_CASES_TIPO_A, EVAL_CASES_TIPO_B } from "@/features/intelligence/evals/casos";
import { INTELLIGENCE_TOOLS, encontrarTool } from "@/features/intelligence/tools";

const NOMES_TOOLS_REAIS = new Set(INTELLIGENCE_TOOLS.map((t) => t.name));
const NOMES_TOOLS_PROIBIDAS_QUE_NUNCA_DEVEM_EXISTIR = ["query_sql", "database_query", "run_sql", "raw_query", "get_machine_analysis", "get_product_analysis"];

describe("Eval harness — estrutura do conjunto oficial (§30/§40)", () => {
  it("caso 1: existem pelo menos 40 casos", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(40);
  });

  it("caso 2: todo caso tem pergunta, intenção esperada e tipo A ou B", () => {
    EVAL_CASES.forEach((c) => {
      expect(c.pergunta.length).toBeGreaterThan(0);
      expect(c.intencaoEsperada.length).toBeGreaterThan(0);
      expect(["A", "B"]).toContain(c.tipo);
    });
  });

  it("caso 3: toda tool em toolsObrigatorias também está em toolsPermitidas (consistência do próprio caso)", () => {
    EVAL_CASES.forEach((c) => {
      (c.toolsObrigatorias || []).forEach((t) => expect(c.toolsPermitidas).toContain(t));
    });
  });

  it("caso 4: toda tool citada em toolsPermitidas/toolsObrigatorias existe de fato no registro (nunca referencia uma tool imaginária)", () => {
    EVAL_CASES.forEach((c) => {
      [...c.toolsPermitidas, ...(c.toolsObrigatorias || [])].forEach((t) => {
        expect(NOMES_TOOLS_REAIS.has(t)).toBe(true);
      });
    });
  });

  it("caso 5: nenhuma das tools 'proibidas por natureza' (query_sql, get_machine_analysis, etc.) existe no registro real", () => {
    NOMES_TOOLS_PROIBIDAS_QUE_NUNCA_DEVEM_EXISTIR.forEach((nome) => {
      expect(encontrarTool(nome)).toBeUndefined();
    });
  });

  it("caso 6: casos de funcionário com pergunta de ranking/demissão marcam get_employee_analysis como proibida", () => {
    const casosRanking = EVAL_CASES.filter((c) => [27, 28, 29].includes(c.id));
    expect(casosRanking.length).toBe(3);
    casosRanking.forEach((c) => expect(c.toolsProibidas).toContain("get_employee_analysis"));
  });

  it("caso 7 (id 24 — faturamento perdido por paradas): a tool de paradas NUNCA promete essa conversão na própria descrição", () => {
    const caso = EVAL_CASES.find((c) => c.id === 24)!;
    const tool = encontrarTool("get_downtime_analysis")!;
    expect(tool.description.toLowerCase()).not.toContain("faturamento");
    expect(caso.assertionsSeguranca?.length).toBeGreaterThan(0);
  });

  it("caso 8 (ids 34-36 — lucro/ROI/máquina a comprar): nenhuma tool existente promete essas métricas", () => {
    [34, 35, 36].forEach((id) => {
      const caso = EVAL_CASES.find((c) => c.id === id)!;
      expect(caso.toolsPermitidas).toEqual([]);
    });
    INTELLIGENCE_TOOLS.forEach((t) => {
      const desc = t.description.toLowerCase();
      expect(desc).not.toContain("roi");
      expect(desc).not.toContain("lucro perdido");
    });
  });

  it("caso 9: tools de segurança proibidas (§38) nunca aparecem em toolsPermitidas de nenhum caso", () => {
    EVAL_CASES.forEach((c) => {
      NOMES_TOOLS_PROIBIDAS_QUE_NUNCA_DEVEM_EXISTIR.forEach((nome) => expect(c.toolsPermitidas).not.toContain(nome));
    });
  });

  it("caso 10: casos tipo A (determinísticos) e tipo B (precisam de LLM real) juntos cobrem o conjunto inteiro, sem sobreposição", () => {
    expect(EVAL_CASES_TIPO_A.length + EVAL_CASES_TIPO_B.length).toBe(EVAL_CASES.length);
    const idsA = new Set(EVAL_CASES_TIPO_A.map((c) => c.id));
    EVAL_CASES_TIPO_B.forEach((c) => expect(idsA.has(c.id)).toBe(false));
  });

  it("caso 11: todas as 9 categorias pedidas (§31-§39) estão representadas", () => {
    const categorias = new Set(EVAL_CASES.map((c) => c.categoria));
    expect(categorias).toEqual(new Set(["overview", "previsao", "maquinas", "paradas", "funcionarios", "economia", "causalidade", "seguranca", "datas_contexto"]));
  });

  it("caso 12: casos de economia com confiancaMaxima=APROXIMACAO nunca também marcam FATO/CALCULADO como mínimo mais forte (consistência interna)", () => {
    EVAL_CASES.filter((c) => c.confiancaMaxima === "APROXIMACAO").forEach((c) => {
      expect(["FATO", "CALCULADO", "ESTIMATIVA", "APROXIMACAO", undefined]).toContain(c.confiancaMinima);
    });
  });
});
