import { describe, expect, it } from "vitest";
import { avaliarAlvos, otimizarAlvos, excessoOperacaoBloco, coberturaUniformeMaxima } from "../propostaCorte";
import { validarPlanoCadeia, type EntradaReverso, type ProdutoRev, type RecursoRev } from "../planoReverso";

const H = 12;
const per = Array.from({ length: H }, (_, i) => ({ rotulo: `P${i}`, duracaoMin: 90 }));
const rec = (id: string): RecursoRev => ({ id, rotulo: id, unidades: new Array(H).fill(1) });
const alt = (recursoId: string, v: number) => ({ recursoId, pecasPorPosto: new Array(H).fill(v) });
/** produto de n etapas, uma máquina por etapa (ids opacos); valor por peça `v` */
function prod(id: string, taxas: number[], demanda: number, v: number, maqs?: string[]): { p: ProdutoRev; recs: RecursoRev[] } {
  const ids = maqs ?? taxas.map((_, k) => `${id}-m${k}`);
  return { recs: ids.map(rec), p: { id, rotulo: id, etapas: taxas.map((t, k) => ({ id: `${id}-e${k}`, rotulo: `E${k}`, alternativas: [alt(ids[k], t)] })), demandaFinal: demanda, wipInicial: new Array(taxas.length - 1).fill(0), recorrentePorPeriodo: 0, valorUnitario: v } };
}
const juntar = (xs: { p: ProdutoRev; recs: RecursoRev[] }[], pessoas: number): EntradaReverso => ({ periodos: per, recursos: [...new Map(xs.flatMap((x) => x.recs).map((r) => [r.id, r])).values()], produtos: xs.map((x) => x.p), pessoas: new Array(H).fill(pessoas), extensaoPeriodos: 0 });

describe("propostaCorte — alvos, headcount e corte", () => {
  it("cabe: alvo = demanda, viável, cadeia válida, headcount ≤ pessoas", () => {
    const a = prod("A", [1000, 1000], 4000, 1);
    const e = juntar([a], 4);
    const r = avaliarAlvos(e, { A: 4000 }, ["A"], { semAntecipacao: true });
    expect(r.viavel).toBe(true);
    expect(r.entregue.A).toBe(4000);
    expect(validarPlanoCadeia({ etapas: a.p.etapas.map((x) => ({ id: x.id, rotulo: x.rotulo })), wipInicial: a.p.wipInicial, periodos: per }, r.res.produtos[0].plano).valido).toBe(true);
  });
  it("não cabe nas pessoas ⇒ inviável; o otimizador CORTA e respeita o limite em todo período", () => {
    const a = prod("A", [1000, 1000, 1000], 9000, 1), b = prod("B", [1000, 1000, 1000], 9000, 1);
    const e = juntar([a, b], 3);
    const cheio = avaliarAlvos(e, { A: 9000, B: 9000 }, ["A", "B"], { semAntecipacao: true });
    expect(cheio.viavel).toBe(false);
    const o = otimizarAlvos({ base: e, pesos: { A: 1, B: 1 }, opAval: { semAntecipacao: true } });
    expect(o.melhor.viavel).toBe(true);
    o.melhor.res.headcount.forEach((h) => expect(h.postosObrigatorios).toBeLessThanOrEqual(3));
    expect(o.melhor.entregue.A + o.melhor.entregue.B).toBeLessThan(18000);
    expect(o.melhor.entregue.A + o.melhor.entregue.B).toBeGreaterThan(0);
  });
  it("o corte NÃO é por quantidade: com peso (R$) maior o produto caro é preservado e o barato é cortado", () => {
    const a = prod("A", [1000, 1000], 8000, 5), b = prod("B", [1000, 1000], 8000, 1);
    const e = juntar([a, b], 2);
    const o = otimizarAlvos({ base: e, pesos: { A: 5, B: 1 }, opAval: { semAntecipacao: true } });
    expect(o.melhor.entregue.A).toBeGreaterThan(o.melhor.entregue.B);
    const peca = otimizarAlvos({ base: e, pesos: { A: 1, B: 1 }, opAval: { semAntecipacao: true } });
    expect(peca.melhor.entregue.A + peca.melhor.entregue.B).toBeGreaterThanOrEqual(o.melhor.entregue.A + o.melhor.entregue.B - 1);
  });
  it("recurso compartilhado tem UMA capacidade: dois produtos na mesma máquina não passam do total", () => {
    const a = prod("A", [1000], 9000, 1, ["X"]), b = prod("B", [1000], 9000, 1, ["X"]);
    const e = juntar([a, b], 5);
    const o = otimizarAlvos({ base: e, pesos: { A: 1, B: 1 }, grupos: [["A", "B"]], opAval: { semAntecipacao: true } });
    expect(o.melhor.entregue.A + o.melhor.entregue.B).toBeLessThanOrEqual(12000 + 1);
  });
  it("limite de postos da mesma operação por bloco (revezamento) entra na viabilidade", () => {
    const a = prod("A", [1000], 12000, 1, ["M1", "M2", "M3"].slice(0, 1));
    const e = juntar([a], 5);
    const r = avaliarAlvos(e, { A: 12000 }, ["A"], { semAntecipacao: true });
    expect(excessoOperacaoBloco(r.res, { blocos: [[0, 1, 2]], operacaoDe: () => "op", limite: 2 })).toBeGreaterThan(0);
    expect(excessoOperacaoBloco(r.res, { blocos: [[0, 1, 2]], operacaoDe: () => "op", limite: 3 })).toBe(0);
  });
  it("cobertura uniforme máxima fica em [0,1] e é viável", () => {
    const a = prod("A", [1000, 1000, 1000], 9000, 1), b = prod("B", [1000, 1000, 1000], 9000, 1);
    const e = juntar([a, b], 3);
    const c = coberturaUniformeMaxima(e, ["A", "B"], { semAntecipacao: true });
    expect(c.c).toBeGreaterThan(0);
    expect(c.c).toBeLessThanOrEqual(1);
    expect(c.av.viavel).toBe(true);
  });
});
