import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import UnificarConectorBanner from "../components/UnificarConectorBanner";
import { mensagemErroUnificar, ofertaUnificar } from "../unificarPrevisao";
import { produtosSelecionaveis, produtosVisiveis } from "../guard";
import type { GuardaProdutos } from "../guardaDb";

const CONV = "27c229d7", AUTO = "a027ac97", UNICO = "cb4e664a", OUTRO = "238ca607";
const guarda = (cutover: string | null): GuardaProdutos => ({ canonicos: new Set([UNICO]), legados: new Set([CONV, AUTO]), cutover });
const itens = [
  { id: "1", produtoId: CONV, produtoNome: 'Conector 3/4"', quantidade: 64800 },
  { id: "2", produtoId: AUTO, produtoNome: 'Conector 3/4" - Maquina Automatica', quantidade: 28500 },
  { id: "3", produtoId: OUTRO, produtoNome: "Caixa", quantidade: 10 },
];
const prods = [CONV, AUTO, UNICO, OUTRO].map((id) => ({ id, ativo: true }));

describe("seletor de produtos da Previsão (cutover)", () => {
  it("semana >= cutover: só o produto único (legados escondidos); semana anterior: só os legados", () => {
    const g = guarda("2026-11-09");
    expect(produtosSelecionaveis(prods, g.canonicos, g.legados, "2026-11-09", g.cutover).map((p) => p.id)).toEqual([UNICO, OUTRO]);
    expect(produtosSelecionaveis(prods, g.canonicos, g.legados, "2026-11-02", g.cutover).map((p) => p.id)).toEqual([CONV, AUTO, OUTRO]);
  });
  it("sem cutover: o produto único nunca aparece (comportamento atual)", () => {
    const g = guarda(null);
    expect(produtosSelecionaveis(prods, g.canonicos, g.legados, "2026-11-09", null).map((p) => p.id)).toEqual([CONV, AUTO, OUTRO]);
    expect(produtosVisiveis(prods, g.canonicos, null).map((p) => p.id)).toEqual([CONV, AUTO, OUTRO]);
  });
});

describe("ofertaUnificar (soma só por ação do usuário)", () => {
  it("semana >= cutover com itens legados: oferece 64.800 + 28.500 = 93.300", () => {
    const o = ofertaUnificar(itens, guarda("2026-11-09"), "2026-11-09");
    expect(o?.total).toBe(93300);
    expect(o?.itensLegados).toHaveLength(2);
    expect(o?.jaTemUnico).toBe(false);
  });
  it("não oferece sem cutover, em semana anterior ou sem itens legados", () => {
    expect(ofertaUnificar(itens, guarda(null), "2026-11-09")).toBeNull();
    expect(ofertaUnificar(itens, guarda("2026-11-09"), "2026-11-02")).toBeNull();
    expect(ofertaUnificar([itens[2]], guarda("2026-11-09"), "2026-11-09")).toBeNull();
  });
  it("já existe item único: sinaliza (o botão some)", () => {
    expect(ofertaUnificar([...itens, { id: "9", produtoId: UNICO, produtoNome: "Conector 3/4", quantidade: 1 }], guarda("2026-11-09"), "2026-11-09")?.jaTemUnico).toBe(true);
  });
  it("traduz erros do banco", () => {
    expect(mensagemErroUnificar("F2_ADICIONAL_NAO_SUPORTADO: x")).toContain("carga adicional");
    expect(mensagemErroUnificar("qualquer")).toContain("Nada foi alterado");
  });
});

describe("UnificarConectorBanner", () => {
  const oferta = ofertaUnificar(itens, guarda("2026-11-09"), "2026-11-09")!;
  it("NÃO executa sozinho: só chama onUnificar após o clique E a confirmação", async () => {
    const onUnificar = vi.fn().mockResolvedValue(null);
    render(<UnificarConectorBanner oferta={oferta} onUnificar={onUnificar} />);
    expect(onUnificar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Unificar em Conector 3/4"));
    expect(onUnificar).not.toHaveBeenCalled();
    expect(screen.getByTestId("unificar-confirmacao").textContent).toContain("93.300");
    fireEvent.click(screen.getByText("Sim, unificar"));
    await waitFor(() => expect(onUnificar).toHaveBeenCalledTimes(1));
  });
  it("mostra o erro do banco e não some", async () => {
    render(<UnificarConectorBanner oferta={oferta} onUnificar={async () => "Não foi possível unificar. Nada foi alterado."} />);
    fireEvent.click(screen.getByText("Unificar em Conector 3/4"));
    fireEvent.click(screen.getByText("Sim, unificar"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Nada foi alterado"));
  });
});
