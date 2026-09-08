import { describe, expect, it } from "vitest";
import { CONFIDENCE_LABEL, confidenceEhIncerta, formatEvidenceContextLine, formatEvidenceValue } from "@/features/intelligence/format";

describe("format.ts — camada de apresentação da Intelligence (§9 da instrução)", () => {
  it("percentual bruto vira 1 casa decimal em pt-BR, sem alterar o valor original", () => {
    expect(formatEvidenceValue({ value: 940.5941872710622, unit: "%" })).toBe("940,6%");
    expect(formatEvidenceValue({ value: 82.4, unit: "%" })).toBe("82,4%");
    expect(formatEvidenceValue({ value: 0, unit: "%" })).toBe("0,0%");
  });

  it("R$ usa formatBRL existente (2 casas, moeda pt-BR)", () => {
    expect(formatEvidenceValue({ value: 1234.5, unit: "R$" })).toContain("1.234,50");
  });

  it("peças: inteiro, sem casas decimais", () => {
    expect(formatEvidenceValue({ value: 1500.7, unit: "peças" })).toBe("1.501 peças");
  });

  it("minutos: humanizado — abaixo de 60 mostra só minutos, acima mostra Xh Ymin", () => {
    expect(formatEvidenceValue({ value: 45, unit: "min" })).toBe("45 min");
    expect(formatEvidenceValue({ value: 125, unit: "min" })).toBe("2h 5min");
    expect(formatEvidenceValue({ value: 120, unit: "min" })).toBe("2h");
  });

  it("horas: 1 casa decimal só quando não é inteiro", () => {
    expect(formatEvidenceValue({ value: 3, unit: "h" })).toBe("3 h");
    expect(formatEvidenceValue({ value: 3.25, unit: "h" })).toBe("3,3 h");
  });

  it("value string passa direto (nunca reformula texto vindo do core)", () => {
    expect(formatEvidenceValue({ value: "indisponível", unit: null })).toBe("indisponível");
  });

  it("value ausente vira travessão, nunca 'undefined' na tela", () => {
    expect(formatEvidenceValue({ value: undefined, unit: "%" })).toBe("—");
  });

  it("confidenceEhIncerta só é true para ESTIMATIVA/APROXIMACAO — nunca promove FATO/CALCULADO", () => {
    expect(confidenceEhIncerta("FATO")).toBe(false);
    expect(confidenceEhIncerta("CALCULADO")).toBe(false);
    expect(confidenceEhIncerta("ESTIMATIVA")).toBe(true);
    expect(confidenceEhIncerta("APROXIMACAO")).toBe(true);
  });

  it("todo valor de IntelligenceConfidence tem rótulo em CONFIDENCE_LABEL", () => {
    (["FATO", "CALCULADO", "ESTIMATIVA", "APROXIMACAO"] as const).forEach((c) => {
      expect(CONFIDENCE_LABEL[c].length).toBeGreaterThan(0);
    });
  });

  it("linha de contexto junta entidade + período na ordem certa, e nunca quebra sem nenhum dos dois", () => {
    expect(formatEvidenceContextLine({ context: { maquinaNome: "Embalagem 17" }, period: { start: "", end: "", label: "Semana atual" } })).toBe(
      "Embalagem 17 · Semana atual"
    );
    expect(formatEvidenceContextLine({})).toBe("");
  });
});
