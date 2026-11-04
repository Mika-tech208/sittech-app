import { describe, expect, it } from "vitest";
import { textoApontamentosCompletos } from "../textos";

describe("aviso de apontamentos completos", () => {
  it("fechamento físico ATIVO sem confirmação: NUNCA diz 'Período fechado'; pede o fechamento físico", () => {
    for (const estado of [null, "RECALCULANDO", "ERRO_RECALCULO"]) {
      const t = textoApontamentosCompletos("ativo", estado);
      expect(t).not.toMatch(/Período fechado/);
      expect(t).toMatch(/FALTA o fechamento físico/);
    }
  });
  it("ativo + CONFIRMADO: confirma o estoque físico", () => expect(textoApontamentosCompletos("ativo", "CONFIRMADO")).toMatch(/estoque físico confirmado/));
  it("desligado/sombra: comportamento anterior", () => {
    expect(textoApontamentosCompletos("desligado", null)).toBe("✓ Período fechado — todas as máquinas apontadas");
    expect(textoApontamentosCompletos("sombra", null)).toBe("✓ Período fechado — todas as máquinas apontadas");
  });
});
