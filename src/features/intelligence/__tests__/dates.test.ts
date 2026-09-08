import { describe, expect, it } from "vitest";
import { resolverJanela, JanelaInvalidaError, JANELAS_VALIDAS } from "@/features/intelligence/dates";

const AGORA = new Date(2026, 8, 3, 10, 0); // quinta-feira, 03/09/2026

describe("Normalização determinística de janelas (§9/§14)", () => {
  it("caso 1: 'hoje' resolve pra data de hoje, inicial=final", () => {
    const r = resolverJanela({ janela: "hoje" }, AGORA);
    expect(r.dataInicial).toBe("2026-09-03");
    expect(r.dataFinal).toBe("2026-09-03");
  });

  it("caso 2: 'semana_atual' usa calcularJanelaOperacional.atual (segunda até hoje)", () => {
    const r = resolverJanela({ janela: "semana_atual" }, AGORA);
    expect(r.dataInicial).toBe("2026-08-31"); // segunda-feira daquela semana
    expect(r.dataFinal).toBe("2026-09-03");
  });

  it("caso 3: 'semana_passada' usa o MESMO trecho da semana anterior, nunca a semana anterior completa", () => {
    const r = resolverJanela({ janela: "semana_passada" }, AGORA);
    // mesma quantidade de dias decorridos (seg-qui = 4 dias) na semana anterior.
    expect(r.dataInicial).toBe("2026-08-24");
    expect(r.dataFinal).toBe("2026-08-27");
  });

  it("caso 4: 'ultimos_14_dias' são dias corridos a partir de agora, nunca segunda-feira", () => {
    const r = resolverJanela({ janela: "ultimos_14_dias" }, AGORA);
    expect(r.dataInicial).toBe("2026-08-20");
    expect(r.dataFinal).toBe("2026-09-03");
  });

  it("caso 5: 'ultimos_28_dias' são dias corridos a partir de agora", () => {
    const r = resolverJanela({ janela: "ultimos_28_dias" }, AGORA);
    expect(r.dataInicial).toBe("2026-08-06");
    expect(r.dataFinal).toBe("2026-09-03");
  });

  it("caso 6: 'custom' válido é aceito", () => {
    const r = resolverJanela({ janela: "custom", dataInicialCustom: "2026-08-01", dataFinalCustom: "2026-08-15" }, AGORA);
    expect(r.dataInicial).toBe("2026-08-01");
    expect(r.dataFinal).toBe("2026-08-15");
  });

  it("caso 7: 'custom' sem datas -> erro determinístico, nunca aceita string livre", () => {
    expect(() => resolverJanela({ janela: "custom" }, AGORA)).toThrow(JanelaInvalidaError);
  });

  it("caso 8: 'custom' com formato inválido (não ISO) -> erro", () => {
    expect(() => resolverJanela({ janela: "custom", dataInicialCustom: "01/08/2026", dataFinalCustom: "2026-08-15" }, AGORA)).toThrow(JanelaInvalidaError);
  });

  it("caso 9: 'custom' com dataInicial depois de dataFinal -> erro", () => {
    expect(() => resolverJanela({ janela: "custom", dataInicialCustom: "2026-08-20", dataFinalCustom: "2026-08-15" }, AGORA)).toThrow(JanelaInvalidaError);
  });

  it("caso 10: toda janela resolvida tem um rótulo legível não-vazio", () => {
    JANELAS_VALIDAS.filter((j) => j !== "custom").forEach((janela) => {
      const r = resolverJanela({ janela }, AGORA);
      expect(r.rotulo.length).toBeGreaterThan(0);
    });
  });

  it("caso 11: nunca mistura janelas sem rótulo — cada resolução carrega sua própria chave/rótulo", () => {
    const semanaAtual = resolverJanela({ janela: "semana_atual" }, AGORA);
    const dias14 = resolverJanela({ janela: "ultimos_14_dias" }, AGORA);
    expect(semanaAtual.chave).not.toBe(dias14.chave);
    expect(semanaAtual.rotulo).not.toBe(dias14.rotulo);
  });
});
