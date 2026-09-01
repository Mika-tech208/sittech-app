import { describe, it, expect } from "vitest";
import { calcularMetaFaturamento } from "@/lib/calculations/metaFaturamento";

describe("calcularMetaFaturamento", () => {
  it("calcula faturamento mensal/semanal necessário pra margem desejada, com 9% de imposto", () => {
    // custo=10000, margem=20% -> divisor = 1 - 0.09 - 0.20 = 0.71
    const resultado = calcularMetaFaturamento(10000, 20);
    expect(resultado.metaInvalida).toBe(false);
    expect(resultado.faturamentoMensalNecessario).toBeCloseTo(10000 / 0.71, 5);
    expect(resultado.faturamentoSemanalNecessario).toBeCloseTo(resultado.faturamentoMensalNecessario / (52 / 12), 5);
    expect(resultado.impostoMeta).toBeCloseTo(resultado.faturamentoMensalNecessario * 0.09, 5);
    expect(resultado.lucroMeta).toBeCloseTo(resultado.faturamentoMensalNecessario - resultado.impostoMeta - 10000, 5);
  });

  it("margem + imposto >= 100%: meta inválida, tudo zerado", () => {
    const resultado = calcularMetaFaturamento(10000, 95); // 0.09 + 0.95 > 1
    expect(resultado.metaInvalida).toBe(true);
    expect(resultado.faturamentoMensalNecessario).toBe(0);
    expect(resultado.faturamentoSemanalNecessario).toBe(0);
  });
});
