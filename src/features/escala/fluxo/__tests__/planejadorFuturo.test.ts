import { describe, expect, it } from "vitest";
import { planejarFuturo, simularCongelado, type EntradaPlanejador } from "../planejadorFuturo";
import type { ProdutoRev, RecursoRev } from "../planoReverso";
import type { SlotEscala } from "../../types";

const ids = ["m1", "m2", "m3", "t1", "t2", "t3"];
const slots: SlotEscala[] = ids.map((p, i) => ({ data: "2026-11-03", periodoId: p, indice: i, primeiroDoDia: i === 0, inicioMin: 420 + i * 90, fimMin: 510 + i * 90, inicioMs: (420 + i * 90) * 60000, fimMs: (510 + i * 90) * 60000 }));
const H = 6;
const rec = (id: string): RecursoRev => ({ id, rotulo: id, unidades: new Array(H).fill(1) });
const alt = (r: string, v: number) => ({ recursoId: r, pecasPorPosto: new Array(H).fill(v) });
const A: ProdutoRev = { id: "A", rotulo: "A", etapas: [0, 1, 2].map((k) => ({ id: `A${k}`, rotulo: `A${k}`, alternativas: [alt(`a${k}`, 1000)] })), demandaFinal: 5000, wipInicial: [0, 0], valorUnitario: 1 };
const B: ProdutoRev = { id: "B", rotulo: "B", etapas: [{ id: "B0", rotulo: "B0", alternativas: [alt("b0", 1000)] }], demandaFinal: 6000, wipInicial: [], valorUnitario: 1 };
const base = (extra: Partial<EntradaPlanejador> = {}): EntradaPlanejador => ({
  slots, aPartirDe: 0, recursos: ["a0", "a1", "a2", "b0"].map(rec), produtos: [A, B], equipe: ["p1", "p2", "p3", "p4"].map((id) => ({ id })), linhasCongeladas: [], producaoCongelada: {},
  operacaoDe: (p, e) => `op-${e}`, objetivo: "MAX_PECAS_FINAIS", busca: { iter: 60000, reinicios: 1 }, ...extra,
});

describe("planejadorFuturo — API pura", () => {
  it("plano válido: cadeia fecha, ≤ pessoas, revezamento ok, corte reportado", () => {
    const s = planejarFuturo(base());
    expect(s.validacao.cadeiaValida).toBe(true);
    expect(s.validacao.maxPostosSimultaneos).toBeLessThanOrEqual(4);
    expect(s.validacao.atribuicaoOk).toBe(true);
    const total = s.porProduto.reduce((a, p) => a + p.programado, 0);
    expect(total).toBeGreaterThan(0);
    s.porProduto.forEach((p) => expect(p.programado).toBeLessThanOrEqual(p.demanda + 1e-6));
    // 1 pessoa por posto e 1 posto por pessoa
    const k = new Set<string>();
    s.linhas.filter((l) => l.maquinaId).forEach((l) => { const a = `${l.periodoId}|${l.maquinaId}`, b = `${l.periodoId}|${l.funcionarioId}`; expect(k.has(a)).toBe(false); expect(k.has(b)).toBe(false); k.add(a); k.add(b); });
  });
  it("ausência a partir do slot 2: 11→ menos pessoas, passado intocado, cadeia válida, corte não diminui", () => {
    const s0 = planejarFuturo(base());
    const congelado = s0.linhas.filter((l) => slots.findIndex((x) => x.periodoId === l.periodoId) < 2);
    const prodC: Record<string, Record<string, number[]>> = {};
    for (const p of [A, B]) { prodC[p.id] = {}; p.etapas.forEach((e) => (prodC[p.id][e.id] = s0.producao[p.id][e.id].map((v, t) => (t < 2 ? v : 0)))); }
    const s1 = planejarFuturo(base({ aPartirDe: 2, linhasCongeladas: congelado, producaoCongelada: prodC, ausentes: { 2: ["p1"], 3: ["p1"], 4: ["p1"], 5: ["p1"] }, linhasIniciais: s0.linhasPostos }));
    expect(s1.validacao.cadeiaValida).toBe(true);
    expect(s1.validacao.maxPostosSimultaneos).toBeLessThanOrEqual(3);
    expect(s1.linhas.every((l) => l.funcionarioId !== "p1")).toBe(true);
    expect(s1.linhas.every((l) => slots.findIndex((x) => x.periodoId === l.periodoId) >= 2)).toBe(true);
    const t0 = s0.porProduto.reduce((a, p) => a + p.programado, 0), t1 = s1.porProduto.reduce((a, p) => a + p.programado, 0);
    expect(t1).toBeLessThanOrEqual(t0 + 1e-6);
  });
  it("simularCongelado: estoque = entradas − consumo da etapa seguinte", () => {
    const st = simularCongelado([A], { A: { A0: [1000, 1000, 0, 0, 0, 0], A1: [0, 1000, 0, 0, 0, 0], A2: [0, 0, 0, 0, 0, 0] } }, 3);
    expect(st.A[0]).toEqual([0, 1000, 1000, 1000]);
    expect(st.A[1]).toEqual([0, 0, 1000, 1000]);
  });
});
