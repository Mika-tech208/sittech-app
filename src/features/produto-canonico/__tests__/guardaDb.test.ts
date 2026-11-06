import { describe, expect, it } from "vitest";
import { lerGuardaProdutos, type ClienteGuarda } from "../guardaDb";
import { produtosSelecionaveis, produtosVisiveis } from "../guard";
import { AUTO, CAN, CAIXA, CONV } from "./fixture";

const cli = (tabelas: Record<string, unknown[] | "erro">, cutover: unknown = null, rpcErro = false): ClienteGuarda => ({
  from: (t) => ({ select: async () => (tabelas[t] === "erro" || !(t in tabelas) ? { data: null, error: { message: "x" } } : { data: tabelas[t] as unknown[], error: null }) }),
  rpc: async () => (rpcErro ? { data: null, error: { message: "x" } } : { data: cutover, error: null }),
});

describe("guarda de produtos (leitura tolerante + seleção por data)", () => {
  it("sem canônico, com erro ou exceção => guarda vazia (nada é filtrado: lista de hoje)", async () => {
    for (const c of [cli({ produto_canonico: [] }), cli({}), cli({ produto_canonico: "erro" }), { from: () => { throw new Error("rede"); }, rpc: async () => ({ data: null, error: null }) } as unknown as ClienteGuarda]) {
      const g = await lerGuardaProdutos(c);
      expect(g.canonicos.size).toBe(0);
      expect(g.cutover).toBeNull();
    }
  });
  it("com canônico e cutover 09/11: apontamento de 10/11 vê só o canônico; de 06/11 (retroativo) só os legados; antes do cutover ser definido, nunca o canônico", async () => {
    const lista = [{ id: CONV, ativo: true }, { id: AUTO, ativo: true }, { id: CAN, ativo: true }, { id: CAIXA, ativo: true }];
    const g = await lerGuardaProdutos(cli({ produto_canonico: [{ produto_id: CAN }], produto_legado_mapa: [{ produto_legado_id: CONV }, { produto_legado_id: AUTO }] }, "2026-11-09"));
    expect(produtosSelecionaveis(lista, g.canonicos, g.legados, "2026-11-10", g.cutover).map((p) => p.id)).toEqual([CAN, CAIXA]);
    expect(produtosSelecionaveis(lista, g.canonicos, g.legados, "2026-11-06", g.cutover).map((p) => p.id)).toEqual([CONV, AUTO, CAIXA]);
    const sem = await lerGuardaProdutos(cli({ produto_canonico: [{ produto_id: CAN }], produto_legado_mapa: [{ produto_legado_id: CONV }, { produto_legado_id: AUTO }] }, null));
    expect(produtosSelecionaveis(lista, sem.canonicos, sem.legados, "2026-11-10", sem.cutover).map((p) => p.id)).toEqual([CONV, AUTO, CAIXA]);
    expect(produtosVisiveis(lista, sem.canonicos, sem.cutover).map((p) => p.id)).toEqual([CONV, AUTO, CAIXA]);
  });
  it("erro ao ler o cutover (RPC) => tratado como sem cutover (esconde o canônico, mantém os legados)", async () => {
    const g = await lerGuardaProdutos(cli({ produto_canonico: [{ produto_id: CAN }], produto_legado_mapa: [] }, "2026-11-09", true));
    expect(g.canonicos.has(CAN)).toBe(true);
    expect(g.cutover).toBeNull();
  });
});
