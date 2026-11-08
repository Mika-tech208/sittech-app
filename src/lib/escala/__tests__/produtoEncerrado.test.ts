// PRODUTO ENCERRADO NA SEMANA: o BANCO mantém quantidade = 0 e adicional = 0; o motor lê isso e NÃO programa o produto (não ocupa máquina nem pessoa, não gera WIP).
// Prova com o mesmo mundo de testes (4 produtos, 8 máquinas, 10 pessoas): zerar um produto = zero peças dele em qualquer slot; os demais continuam sendo programados e
// o plano do encerrado é igual ao plano de uma semana em que ele nunca foi previsto.
import { describe, it, expect } from "vitest";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { Mundo, estadoDeTeste } from "./bancoMemoria";

const SEMANA = "2026-10-19";
const DIAS = ["2026-10-19", "2026-10-20", "2026-10-21"];
const GERA = epochMsNoFuso("2026-10-19", "05:00");

function mundo(zerar: string | null, remover = false) {
  const m = new Mundo(estadoDeTeste(SEMANA, DIAS, { pessoas: 10 }));
  m.editar((e) => {
    if (zerar) e.itens = remover ? e.itens.filter((i) => i.produtoId !== zerar) : e.itens.map((i) => (i.produtoId === zerar ? { ...i, quantidade: 0, quantidadeAdicional: 0 } : i));
  });
  return m;
}
const pecasDo = (m: Mundo, produtoId: string) => m.alocacoes.filter((a) => a.produtoId === produtoId).reduce((s, a) => s + a.pecas + (a.pecasAdicional ?? 0), 0);

describe("produto encerrado (demanda 0, adicional 0) no motor", () => {
  it("referência: com demanda o produto é programado", async () => {
    const m = mundo(null);
    await m.recalcular(GERA, true);
    expect(pecasDo(m, "pC")).toBeGreaterThan(0);
  });
  it("encerrado: ZERO peças e nenhuma linha de posto para o produto; os demais seguem programados", async () => {
    const m = mundo("pC");
    const r = await m.recalcular(GERA, true);
    expect(r.status).toBe("processado");
    expect(pecasDo(m, "pC")).toBe(0);
    expect(m.alocacoes.some((a) => a.produtoId === "pC" && a.maquinaId)).toBe(false);
    expect(pecasDo(m, "pA")).toBeGreaterThan(0);
    expect(pecasDo(m, "pB")).toBeGreaterThan(0);
  });
  it("encerrado com demanda 0 = mesma programação de uma semana em que o produto nunca foi previsto (não ocupa pessoas)", async () => {
    const a = mundo("pC"); await a.recalcular(GERA, true);
    const b = mundo("pC", true); await b.recalcular(GERA, true);
    expect(hashAlocacoes(a.alocacoes.filter((x) => x.produtoId !== "pC"))).toBe(hashAlocacoes(b.alocacoes.filter((x) => x.produtoId !== "pC")));
  });
  it("recalcular depois (ausência) continua sem programar o encerrado", async () => {
    const m = mundo("pC");
    await m.recalcular(GERA, true);
    m.editar((e) => { e.ausencias = [{ funcionarioId: "f01", data: "2026-10-20", horarioInicio: null, horarioFim: null }]; });
    await m.recalcular(epochMsNoFuso("2026-10-20", "06:00"));
    expect(pecasDo(m, "pC")).toBe(0);
  });
});
