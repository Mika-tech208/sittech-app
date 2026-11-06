import { describe, expect, it } from "vitest";
import { modoProdutoUnicoDaSemana, produtoUnicoOperacional, produtoUnicoPlanejavel } from "../cutover";

const P = (planejamento: unknown, cutover: unknown) => [{ chave: "produto_unico_planejamento_desde", valor: planejamento }, { chave: "produto_unico_cutover", valor: cutover }];
describe("modo do produto único por semana (planejamento × cutover operacional)", () => {
  it("só planejamento desde 09/11: 02/11 legado; 09/11 e 16/11 PLANEJAMENTO (não operacional)", () => {
    const l = P("2026-11-09", null);
    expect(modoProdutoUnicoDaSemana(l, "2026-11-02")).toBe("LEGADO");
    expect(modoProdutoUnicoDaSemana(l, "2026-11-09")).toBe("PLANEJAMENTO");
    expect(modoProdutoUnicoDaSemana(l, "2026-11-12")).toBe("PLANEJAMENTO");   // qualquer dia da semana
    const m = modoProdutoUnicoDaSemana(l, "2026-11-16");
    expect(produtoUnicoPlanejavel(m)).toBe(true);
    expect(produtoUnicoOperacional(m)).toBe(false);
  });
  it("cutover 09/11 ⇒ OPERACIONAL a partir da semana; planejamento ausente não impede (cutover implica planejamento)", () => {
    expect(modoProdutoUnicoDaSemana(P(null, "2026-11-09"), "2026-11-09")).toBe("OPERACIONAL");
    expect(modoProdutoUnicoDaSemana(P(null, "2026-11-09"), "2026-11-02")).toBe("LEGADO");
    expect(modoProdutoUnicoDaSemana(P("2026-11-09", "2026-11-16"), "2026-11-09")).toBe("PLANEJAMENTO");
    expect(modoProdutoUnicoDaSemana(P("2026-11-09", "2026-11-16"), "2026-11-16")).toBe("OPERACIONAL");
  });
  it("sem parâmetros / valores inválidos ⇒ LEGADO (comportamento de hoje)", () => {
    expect(modoProdutoUnicoDaSemana([], "2026-11-09")).toBe("LEGADO");
    expect(modoProdutoUnicoDaSemana(null, "2026-11-09")).toBe("LEGADO");
    expect(modoProdutoUnicoDaSemana(P("2026-11-10", "lixo"), "2026-11-09")).toBe("LEGADO");   // não é segunda-feira
  });
});
