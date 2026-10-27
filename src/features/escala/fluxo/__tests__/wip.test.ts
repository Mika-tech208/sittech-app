// WIP por par: estimado (lo/hi, confiança), negativo (piso 0 + diagnóstico) e saldo confirmado (piso do par, confiança alta).
import { describe, it, expect } from "vitest";
import { estadoDaProducao } from "../estado";
import { apontarPlano, ap, equipe, montar, pool } from "./helpersFluxo";

const pools = [
  pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 9000, maquinas: ["a1"], mu: 500 }),
  pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 9000, maquinas: ["b1", "b2"], mu: 300 }),
];
const todasConfirmadas = (m: ReturnType<typeof montar>, fn: Parameters<typeof apontarPlano>[4], ate = 2) =>
  apontarPlano(m.planoCompleto, pools, ate, m.entrada.slots, fn).map((a) => ({ ...a, lancadoEmMs: 1 }));

describe("WIP estimado", () => {
  it("tudo confirmado: lo = hi, origem estimado, confiança média", () => {
    const m = montar({ pools, funcionarios: equipe(3), c: 2 });
    const e = estadoDaProducao(m.entrada, { ...m.dados, apontamentos: todasConfirmadas(m, (a, cap) => (a.etapaId === "P1" ? cap : cap / 2)) });
    const p = e.pares[0];
    expect(p.origem).toBe("estimado");
    expect(p.confianca).toBe("media");
    expect(p.wip.lo).toBe(p.wip.hi);
    expect(p.wip.lo).toBeGreaterThan(0);
    expect(p.negativo).toBe(false);
  });
  it("com períodos não confirmados: faixa [W_lo, W_hi] e confiança baixa; W_lo = max(0, B_k,lo − B_k+1,hi), W_hi = max(0, B_k,hi − B_k+1,lo)", () => {
    const m = montar({ pools, funcionarios: equipe(3), c: 2 });
    const e = estadoDaProducao(m.entrada, { ...m.dados, apontamentos: [] });
    const [b1, b2] = ["P1", "P2"].map((et) => e.etapas.find((x) => x.etapaId === et)!.boas);
    const p = e.pares[0];
    expect(p.confianca).toBe("baixa");
    expect(p.bruto).toEqual({ lo: b1.lo - b2.hi, hi: b1.hi - b2.lo });
    expect(p.wip.lo).toBe(Math.max(0, b1.lo - b2.hi));
    expect(p.wip.hi).toBe(Math.max(0, b1.hi - b2.lo));
    expect(p.wip.hi).toBeGreaterThan(p.wip.lo);
  });
});

describe("WIP negativo", () => {
  it("a etapa seguinte produziu mais que a anterior: piso 0 + WIP_NEGATIVO_ESTIMADO (nunca inventa estoque)", () => {
    const m = montar({ pools, funcionarios: equipe(3), c: 2 });
    const e = estadoDaProducao(m.entrada, { ...m.dados, apontamentos: todasConfirmadas(m, (a, cap) => (a.etapaId === "P1" ? cap / 4 : cap)) });
    const p = e.pares[0];
    expect(p.negativo).toBe(true);
    expect(p.bruto.hi).toBeLessThan(0);
    expect(p.wip).toEqual({ lo: 0, hi: 0 });
    expect(e.diagnosticos.filter((d) => d.codigo === "WIP_NEGATIVO_ESTIMADO")).toHaveLength(1);
    // demanda do upstream = R_f inteiro (não conta estoque inexistente)
    const d1 = e.demanda.find((d) => d.etapaId === "P1")!;
    const d2 = e.demanda.find((d) => d.etapaId === "P2")!;
    expect(d1.demandaFluxo).toBe(d2.demandaFluxo);
  });
  it("incerteza só no limite inferior NÃO é diagnosticada como negativo", () => {
    const m = montar({ pools, funcionarios: equipe(3), c: 2 });
    const e = estadoDaProducao(m.entrada, { ...m.dados, apontamentos: [] });
    expect(e.pares[0].negativo).toBe(false);
    expect(e.diagnosticos.some((d) => d.codigo === "WIP_NEGATIVO_ESTIMADO")).toBe(false);
  });
});

describe("saldo confirmado", () => {
  it("vira o piso do par (origem confirmado, confiança alta) e reduz a demanda do upstream", () => {
    const m = montar({ pools, funcionarios: equipe(3), c: 2 });
    const apontamentos = todasConfirmadas(m, (a, cap) => cap);
    const sem = estadoDaProducao(m.entrada, { ...m.dados, apontamentos });
    const com = estadoDaProducao(m.entrada, { ...m.dados, apontamentos, wipConfirmado: [{ produtoId: "P", etapaOrigemId: "P1", etapaSeguinteId: "P2", saldo: 3000 }] });
    const p = com.pares[0];
    expect(p.origem).toBe("confirmado");
    expect(p.confianca).toBe("alta");
    expect(p.wip.lo).toBe(3000);
    expect(p.wip.hi).toBeGreaterThanOrEqual(3000);
    expect(com.diagnosticos.some((d) => d.codigo === "WIP_CONFIRMADO_USADO")).toBe(true);
    const d1 = (e: typeof com) => e.demanda.find((d) => d.etapaId === "P1")!.demandaFluxo;
    expect(d1(com)).toBeLessThan(d1(sem));
    expect(d1(sem) - d1(com)).toBeCloseTo(3000 - sem.pares[0].wip.lo, 1);
  });
  it("saldo confirmado de outro par não vaza para este; saldo negativo vira 0", () => {
    const m = montar({ pools, funcionarios: equipe(3), c: 2 });
    const e = estadoDaProducao(m.entrada, { ...m.dados, apontamentos: [], wipConfirmado: [{ produtoId: "X", etapaOrigemId: "P1", etapaSeguinteId: "P2", saldo: 999 }] });
    expect(e.pares[0].origem).toBe("estimado");
    const e2 = estadoDaProducao(m.entrada, { ...m.dados, apontamentos: [], wipConfirmado: [{ produtoId: "P", etapaOrigemId: "P1", etapaSeguinteId: "P2", saldo: -50 }] });
    expect(e2.pares[0].wip.lo).toBe(0);
    void ap;
  });
});
