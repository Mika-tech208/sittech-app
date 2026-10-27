// Casos de borda: nada lança, nada viola, tudo explicado.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../../gerarEscala";
import { estadoDaProducao } from "../estado";
import { planejarComFluxo } from "../planejar";
import { verificarRestricoesDuras } from "../restricoes";
import { ap, apontarPlano, checarFluxo, equipe, montar, pool, rodar } from "./helpersFluxo";

const pools = [
  pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 3000, maquinas: ["a1"], mu: 300 }),
  pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 3000, maquinas: ["b1", "b2"], mu: 200 }),
];

describe("bordas", () => {
  it("semana encerrada (aPartirDe = nº de slots): nada a planejar, plano base, sem exceção", () => {
    const m = montar({ pools, funcionarios: equipe(3), c: 11 });
    expect(m.entrada.aPartirDe).toBe(m.entrada.slots.length);
    const r = planejarComFluxo(m.entrada, m.dados);
    expect(r.resultado.alocacoes).toEqual([]);
    expect(r.diagnostico.planoEscolhido).toBe("base");
  });
  it("nada fechado ainda (início da semana): sem células e rem = Q", () => {
    const m = montar({ pools, funcionarios: equipe(3), c: 0, aposFimMin: -200 });
    const e = estadoDaProducao(m.entrada, { ...m.dados, apontamentos: [] });
    expect(e.ultimoFechado).toBe(-1);
    expect(e.celulas.filter((c) => c.estado !== "futuro")).toEqual([]);
    expect(e.produtos[0].demandaFinalRestante).toBe(3000);
  });
  it("sem funcionários: sem alocação, sem violação", () => {
    const x = rodar({ pools, funcionarios: [], c: 1 });
    expect(x.r.resultado.alocacoes).toEqual([]);
    expect(checarFluxo(x)).toEqual([]);
  });
  it("Q = 0 e pool sem máquinas não quebram", () => {
    const ps = [pool({ produto: "Z", etapa: "Z1", op: "opZ", ordem: 1, q: 0, maquinas: ["z1"], mu: 100 }), pool({ produto: "Y", etapa: "Y1", op: "opY", ordem: 1, q: 500, maquinas: [], mu: 100 })];
    const x = rodar({ pools: ps, funcionarios: equipe(2), c: 1 });
    expect(checarFluxo(x)).toEqual([]);
  });
  it("apontamentos fora do plano, de pool/máquina desconhecidos, duplicados e com boas negativas", () => {
    const m = montar({ pools, funcionarios: equipe(3), c: 1 });
    const s0 = m.entrada.slots[0];
    const linhas = [
      ap({ data: s0.data, periodoId: s0.periodoId, maquinaId: "a1", produtoId: "P", etapaId: "P1", boas: 100, lancadoEmMs: 1 }),
      ap({ data: s0.data, periodoId: s0.periodoId, maquinaId: "a1", produtoId: "P", etapaId: "P1", boas: 150, lancadoEmMs: 1 }), // 2ª linha da mesma máquina: soma
      ap({ data: s0.data, periodoId: s0.periodoId, maquinaId: "b1", produtoId: "P", etapaId: "P2", boas: -40, lancadoEmMs: 1 }), // nunca negativa
      ap({ data: s0.data, periodoId: s0.periodoId, maquinaId: "q9", produtoId: "DESCONHECIDO", etapaId: "X", boas: 999, lancadoEmMs: 1 }), // pool inexistente: ignorado
      ap({ data: "2030-01-01", periodoId: "m1", maquinaId: "a1", produtoId: "P", etapaId: "P1", boas: 999, lancadoEmMs: 1 }), // fora da semana
    ];
    const e = estadoDaProducao(m.entrada, { ...m.dados, apontamentos: linhas });
    expect(e.etapas.find((x) => x.etapaId === "P1")!.boas.lo).toBe(250);
    expect(e.etapas.find((x) => x.etapaId === "P2")!.boas.lo).toBe(0);
  });
  it("maxIteracoes = 0 devolve base ou P0; maxIteracoes grande não passa de 4+2 candidatos por convergência", () => {
    const m = montar({ pools, funcionarios: equipe(3), c: 1 });
    const r0 = planejarComFluxo(m.entrada, m.dados, { maxIteracoes: 0 });
    expect(r0.diagnostico.iteracoes.length).toBeGreaterThanOrEqual(2); // base + P0 (+ o plano vigente, candidato desde a v2)
    expect(r0.diagnostico.iteracoes.length).toBeLessThanOrEqual(3);
    const r9 = planejarComFluxo(m.entrada, m.dados, { maxIteracoes: 9 });
    expect(r9.diagnostico.iteracoes.length).toBeLessThanOrEqual(12);
    expect(verificarRestricoesDuras(r9.entradaFluxo, r9.resultado.alocacoes)).toEqual([]);
  });
  it("ponderarPorValor usa o valor unitário da etapa final sem quebrar o critério de não-piora", () => {
    const ps = [
      pool({ produto: "A", etapa: "A1", op: "opA", ordem: 1, q: 6000, maquinas: ["a1", "a2"], mu: 300, valor: 5 }),
      pool({ produto: "B", etapa: "B1", op: "opB", ordem: 1, q: 6000, maquinas: ["b1", "b2"], mu: 300, valor: 1 }),
    ];
    const x = rodar({ pools: ps, funcionarios: equipe(2), c: 1, opcoes: { ponderarPorValor: true } });
    expect(checarFluxo(x)).toEqual([]);
  });
  it("plano vigente vazio: churn zero e estabilidade sem bônus", () => {
    const m = montar({ pools, funcionarios: equipe(3), c: 1 });
    const r = planejarComFluxo(m.entrada, { ...m.dados, planoVigente: [] });
    expect(r.diagnostico.churn.linhasAlteradas).toBe(0);
    expect(r.diagnostico.estado.celulas.filter((c) => c.estado === "nao_confirmado")).toEqual([]); // sem plano não há "não confirmado"
  });
  it("tudo apontado e entregue: plano de fluxo não aloca nada do previsto", () => {
    const m = montar({ pools, funcionarios: equipe(3), c: 1 });
    const ap1 = apontarPlano(m.planoCompleto, pools, 1, m.entrada.slots, () => 3000);
    const r = planejarComFluxo(m.entrada, { ...m.dados, apontamentos: ap1.map((a) => ({ ...a, lancadoEmMs: 1 })) });
    expect(r.resultado.alocacoes.filter((a) => a.maquinaId && a.pecas > 0)).toHaveLength(0);
    expect(gerarEscala(m.entrada).alocacoes.filter((a) => a.maquinaId).length).toBeGreaterThan(0);
  });
});
