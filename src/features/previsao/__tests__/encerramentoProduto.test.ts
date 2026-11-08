// PRODUTO ENCERRADO NA SEMANA: meta original preservada, produção real contada, saldo cancelado NÃO é falta, sem "+acima", % operacional.
import { describe, it, expect } from "vitest";
import type { Previsao, PrevisaoItem } from "@/types/domain";
import { calcularHistoricoSemanal, calcularProdutosProgramados, calcularResumoProgramacaoPecas, type ApontadoPorProduto } from "../progressoSemana";
import { aplicarEncerramentosAosItens, lerEncerramentos, previstoOperacionalDoItem } from "../encerramento";

const item = (id: string, produtoId: string, quantidade: number, valor = 0.217): PrevisaoItem => ({ id, produtoId, produtoNome: `Produto ${produtoId}`, valorUnitario: valor, quantidade });
const apontado = (o: Record<string, number>): ApontadoPorProduto => new Map(Object.entries(o).map(([k, v]) => [k, { apontadoReal: v, ambiguoPecas: 0 }]));
const ENC = (produtoId: string, original: number) => ({ produtoId, quantidadeOriginal: original, adicionalOriginal: 0, encerradoEm: "2026-11-06T15:30:00Z", motivo: "encerrada" });

describe("cenário pedido: meta original 56.400, produzido 27.930, produto encerrado", () => {
  const itens = aplicarEncerramentosAosItens([item("a", "4x2", 0), item("b", "4x4", 10000, 0.31)], [ENC("4x2", 56400)]);
  const produtos = calcularProdutosProgramados(itens, [], apontado({ "4x2": 27930, "4x4": 5350 }));
  const p = produtos.find((x) => x.produtoId === "4x2")!;
  const r = calcularResumoProgramacaoPecas(produtos);

  it("histórico previsto = 56.400 e produção real = 27.930", () => { expect(p.previsto).toBe(56400); expect(p.apontadoReal).toBe(27930); });
  it("falta operacional = 0 e status ENCERRADO", () => { expect(p.falta).toBe(0); expect(p.encerrado).toBe(true); });
  it("NÃO aparece \"+27.930 acima\" (excedente 0) nem % distorcido", () => { expect(p.excedente).toBe(0); expect(p.concluidoPct).toBeNull(); });
  it("o saldo cancelado (28.470) NÃO é falta e fica informativo", () => { expect(p.cancelado).toBe(28470); expect(r.totalFalta).toBe(4650); /* só a 4x4 */ expect(r.totalCancelado).toBe(28470); });
  it("a produção real do encerrado ENTRA no total Apontado real", () => { expect(r.totalApontadoReal).toBe(27930 + 5350); expect(r.totalApontadoEncerrados).toBe(27930); });
  it("Previsto total = original (56.400 + 10.000); previsto operacional = produzido do encerrado + previsto do ativo", () => { expect(r.totalPrevisto).toBe(66400); expect(r.totalPrevistoOperacional).toBe(27930 + 10000); });
  it("% = apontado real ÷ previsto operacional (o cancelado não pesa)", () => { expect(r.concluidoPct).toBeCloseTo(((27930 + 5350) / (27930 + 10000)) * 100, 6); });
  it("o item encerrado fica com a quantidade operacional do banco em 0 (o motor lê 0): o app não a altera", () => { expect(itens[0].quantidade).toBe(0); });
});

describe("variações", () => {
  it("produzido ACIMA da meta original antes de encerrar: excedente real, nada cancelado, operacional = original", () => {
    const itens = aplicarEncerramentosAosItens([item("a", "X", 0)], [ENC("X", 1000)]);
    const [p] = calcularProdutosProgramados(itens, [], apontado({ X: 1300 }));
    expect(p.excedente).toBe(300);
    expect(p.cancelado).toBe(0);
    expect(p.previstoOperacional).toBe(1000);
    expect(p.falta).toBe(0);
  });
  it("encerrado sem produção nenhuma: operacional 0, cancelado = meta inteira, falta 0", () => {
    const itens = aplicarEncerramentosAosItens([item("a", "X", 0)], [ENC("X", 5000)]);
    const [p] = calcularProdutosProgramados(itens, [], apontado({}));
    expect(p.apontadoReal).toBe(0);
    expect(p.previstoOperacional).toBe(0);
    expect(p.cancelado).toBe(5000);
    expect(p.falta).toBe(0);
  });
  it("dois itens do mesmo produto: a meta original NÃO duplica (fica no primeiro) e o apontado é distribuído uma única vez", () => {
    const itens = aplicarEncerramentosAosItens([item("a", "X", 0), item("b", "X", 0)], [ENC("X", 800)]);
    const produtos = calcularProdutosProgramados(itens, [], apontado({ X: 500 }));
    expect(produtos.reduce((s, p) => s + p.previsto, 0)).toBe(800);
    expect(produtos.reduce((s, p) => s + (p.apontadoReal ?? 0), 0)).toBe(500);
  });
  it("item ATIVO não muda: continua previsto, falta, excedente e % como antes", () => {
    const [p] = calcularProdutosProgramados([item("a", "A", 1000)], [], apontado({ A: 600 }));
    expect(p).toMatchObject({ previsto: 1000, apontadoReal: 600, falta: 400, excedente: 0, encerrado: false, cancelado: 0, previstoOperacional: 1000 });
    expect(p.concluidoPct).toBeCloseTo(60, 6);
    const [q] = calcularProdutosProgramados([item("a", "A", 1000)], [], apontado({ A: 1200 }));
    expect(q).toMatchObject({ falta: 0, excedente: 200 });
  });
  it("apontado indisponível (null): nada inventado para o encerrado", () => {
    const itens = aplicarEncerramentosAosItens([item("a", "X", 0)], [ENC("X", 1000)]);
    const [p] = calcularProdutosProgramados(itens, [], null);
    expect(p.apontadoReal).toBeNull();
    expect(p.falta).toBeNull();
    expect(p.previstoOperacional).toBeNull();
    expect(p.cancelado).toBeNull();
    expect(previstoOperacionalDoItem(itens[0], null)).toBeNull();
  });
  it("reabertos são ignorados ao ler os encerramentos", () => {
    expect(lerEncerramentos([{ produto_id: "X", quantidade_original: "1000", encerrado_em: "2026-11-06", reaberto_em: "2026-11-07" }, { produto_id: "Y", quantidade_original: 5, adicional_original: 0, encerrado_em: "2026-11-06", motivo: null }])).toHaveLength(1);
  });
});

describe("histórico semanal (R$)", () => {
  const prev = (itens: PrevisaoItem[]): Previsao => ({ semanaInicio: "2026-11-02", itens, itensRealizados: [] });
  it("previsto = ORIGINAL (R$), realizado inclui o encerrado, % sobre o previsto operacional", () => {
    const itens = aplicarEncerramentosAosItens([item("a", "4x2", 0, 0.217), item("b", "4x4", 10000, 0.31)], [ENC("4x2", 56400)]);
    const [h] = calcularHistoricoSemanal([prev(itens)], new Map([["2026-11-02", apontado({ "4x2": 27930, "4x4": 5350 })]]));
    expect(h.previsto).toBeCloseTo(56400 * 0.217 + 10000 * 0.31, 6);
    expect(h.realizado).toBeCloseTo(27930 * 0.217 + 5350 * 0.31, 6);
    expect(h.pct).toBeCloseTo(((27930 * 0.217 + 5350 * 0.31) / (27930 * 0.217 + 10000 * 0.31)) * 100, 6);
  });
  it("semana SEM encerrado: idêntica à regra anterior", () => {
    const [h] = calcularHistoricoSemanal([prev([item("a", "A", 1000, 2)])], new Map([["2026-11-02", apontado({ A: 500 })]]));
    expect(h.previsto).toBe(2000);
    expect(h.realizado).toBe(1000);
    expect(h.pct).toBeCloseTo(50, 6);
  });
});

// FATURAMENTO REALIZADO (R$): nasce do APONTADO REAL × preço, nunca do Forecast ativo. Produto encerrado continua contribuindo; previsto FUTURO dele é 0.
describe("faturamento realizado (R$) de produto encerrado", () => {
  // semana real de 02/11 em PROD (preços congelados nos itens; apontado real por produto)
  const itens = aplicarEncerramentosAosItens([
    item("a", "4x2", 0, 0.217), item("b", "plug", 26400, 0.099), item("c", "pino", 43200, 0.07),
    item("d", "c34a", 28500, 0.182), item("e", "c34", 64800, 0.1825), item("f", "c114", 6120, 0.365), item("g", "4x4", 10000, 0.27),
  ], [ENC("4x2", 56400)]);
  const ap = apontado({ "4x2": 27930, plug: 21300, pino: 51780, c34a: 0, c34: 44250, c114: 7820, "4x4": 5350 });
  const produtos = calcularProdutosProgramados(itens, [], ap);
  const r = calcularResumoProgramacaoPecas(produtos);
  const p4x2 = produtos.find((x) => x.produtoId === "4x2")!;

  it("4x2: 27.930 × 0,217 = R$ 6.060,81 de realizado", () => { expect(p4x2.valorRealizado).toBeCloseTo(27930 * 0.217, 6); expect(p4x2.valorRealizado).toBeCloseTo(6060.81, 2); });
  it("faturamento futuro da 4x2 = 0 (falta R$ 0 e previsto operacional = o produzido)", () => { expect(p4x2.valorFalta).toBe(0); expect(p4x2.valorPrevistoOperacional).toBeCloseTo(6060.81, 2); });
  it("o total realizado da semana INCLUI a 4x2, uma única vez (24.168,535)", () => {
    expect(r.valorRealizado).toBeCloseTo(24168.535, 3);
    const sem4x2 = calcularResumoProgramacaoPecas(calcularProdutosProgramados(itens.filter((i) => i.produtoId !== "4x2"), [], ap));
    expect((r.valorRealizado ?? 0) - (sem4x2.valorRealizado ?? 0)).toBeCloseTo(6060.81, 2);
  });
  it("realizado NÃO depende do produto estar ativo na Previsão: mesmo valor com o item ativo, encerrado ou com meta zerada sem registro de encerramento", () => {
    const encerrado = calcularResumoProgramacaoPecas(calcularProdutosProgramados([item("a", "4x2", 0)].map((i) => aplicarEncerramentosAosItens([i], [ENC("4x2", 56400)])[0]), [], ap)).valorRealizado;
    const ativo = calcularResumoProgramacaoPecas(calcularProdutosProgramados([item("a", "4x2", 56400)], [], ap)).valorRealizado;
    const zerado = calcularResumoProgramacaoPecas(calcularProdutosProgramados([item("a", "4x2", 0)], [], ap)).valorRealizado;
    expect(encerrado).toBeCloseTo(6060.81, 2); expect(ativo).toBeCloseTo(6060.81, 2); expect(zerado).toBeCloseTo(6060.81, 2);
  });
  it("preço é o CONGELADO no item (mudar o cadastro depois não reescreve o histórico)", () => {
    const [q] = calcularProdutosProgramados(aplicarEncerramentosAosItens([item("a", "4x2", 0, 0.217)], [ENC("4x2", 56400)]), [], ap);
    expect(q.valorUnitario).toBe(0.217);
    expect(q.valorRealizado).toBeCloseTo(27930 * 0.217, 6);
  });
  it("histórico semanal: realizado em R$ idem ao card (24.168,53/54) e previsto original em R$", () => {
    const prev: Previsao = { semanaInicio: "2026-11-02", itens, itensRealizados: [] };
    const [h] = calcularHistoricoSemanal([prev], new Map([["2026-11-02", ap]]));
    expect(h.realizado).toBeCloseTo(r.valorRealizado ?? -1, 6);
    expect(h.previsto).toBeCloseTo(r.valorPrevisto, 6);
  });
  it("valor previsto ORIGINAL (39.823,20) continua separado do futuro: o operacional não conta o cancelado", () => {
    expect(r.valorPrevisto).toBeCloseTo(39823.2, 2);
    expect(r.valorPrevistoOperacional).toBeCloseTo(33645.21, 2);
  });
});
