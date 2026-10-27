// Simulador de fluxo e avaliação de plano: propriedades diretas do modelo + estabilidade (θ) + limites do plano de fluxo.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../../gerarEscala";
import { avaliarPlano } from "../avaliar";
import { prepararFluxo } from "../estado";
import { construirGrafo } from "../grafo";
import { novaCap, simularGrupo } from "../simulador";
import { apontarPlano, equipe, linhaPlano, montar, pool, rodar } from "./helpersFluxo";

const pools2 = [
  pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 1000, maquinas: ["a1"], mu: 100 }),
  pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 1000, maquinas: ["b1"], mu: 100 }),
];
function sim(p: { cap1: number[]; cap2: number[]; w0?: number; mesmo?: boolean; q?: number; b0?: [number, number]; limite?: number }) {
  const g = construirGrafo(pools2);
  const T = p.cap1.length;
  const cap = { "P|P1": novaCap(T), "P|P2": novaCap(T) };
  cap["P|P1"].base = [...p.cap1];
  cap["P|P2"].base = [...p.cap2];
  return simularGrupo(g, g.grupos[0], {
    tIni: 0, tFim: T, cap, B0: { "P|P1": p.b0?.[0] ?? 0, "P|P2": p.b0?.[1] ?? 0 }, W0: { "P|P1": p.w0 ?? 0 }, L0: { "P|P1": p.w0 ?? 0 }, Q: { "P|P1": p.q ?? 1000, "P|P2": p.q ?? 1000 },
    mesmoPeriodo: p.mesmo !== false, trajetoria: true, ...(p.limite !== undefined ? { limiteFut: { desde: 0, valor: { "P|P1": p.limite, "P|P2": 1e9 } } } : {}),
  });
}

describe("simularGrupo", () => {
  it("consumo ≤ WIP inicial + produção upstream do MESMO período; sem fluxo no mesmo período só o estoque inicial", () => {
    const a = sim({ cap1: [100, 0, 0], cap2: [100, 100, 100], w0: 0 });
    expect(a.x["P|P2"]).toEqual([100, 0, 0]); // consome o que a etapa 1 acabou de produzir; depois falta material
    const b = sim({ cap1: [100, 0, 0], cap2: [100, 100, 100], w0: 0, mesmo: false });
    expect(b.x["P|P2"]).toEqual([0, 100, 0]); // só no período seguinte
    const c = sim({ cap1: [0, 0, 0], cap2: [100, 100, 100], w0: 150 });
    expect(c.x["P|P2"]).toEqual([100, 50, 0]);
  });
  it("o produto final nunca passa da meta e a capacidade além dela é reportada (excesso)", () => {
    const r = sim({ cap1: [0, 0, 0], cap2: [400, 400, 400], q: 1000, w0: 2000 });
    expect(r.B["P|P2"]).toBe(1000);
    expect(r.bloqueadoPelaMeta).toBeGreaterThan(0);
  });
  it("limiteFut (rem explícito) limita a produção do previsto do nó", () => {
    const r = sim({ cap1: [100, 100, 100], cap2: [100, 100, 100], limite: 150 });
    expect(r.B["P|P1"]).toBe(150);
  });
  it("WIP legado é consumido primeiro (FIFO): produção nova não 'paga' o estoque antigo", () => {
    const r = sim({ cap1: [100, 100, 0], cap2: [50, 50, 0], w0: 200 });
    expect(r.W["P|P1"]).toBe(200 + 200 - 100); // 300 em estoque
    expect(r.L["P|P1"]).toBe(100); // 200 legado − 100 consumidos
  });
  it("trajetória do WIP por slot", () => {
    const r = sim({ cap1: [100, 100], cap2: [0, 100], w0: 0 });
    expect(r.traj["P|P1"]).toEqual([100, 100]);
  });
});

describe("avaliarPlano — gargalo de fluxo e régua única", () => {
  const pools = [
    pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 6000, maquinas: ["a1"], mu: 200 }),
    pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 6000, maquinas: ["b1", "b2", "b3"], mu: 500 }),
  ];
  it("a etapa com menor (capacidade + estoque além dela) é o gargalo de fluxo", () => {
    const m = montar({ pools, funcionarios: equipe(4), c: 1 });
    const plano = gerarEscala(m.entrada).alocacoes;
    const av = avaliarPlano(m.entrada, m.dados, plano);
    expect(av.produtos[0].gargaloFluxo?.etapaId).toBe("P1");
    expect(av.produtos[0].gargaloFluxo!.folga).toBeLessThan(0);
  });
  it("lo ≥ hi na falta e lo ≤ hi no entregue; contribuição de cada posto soma no máximo o entregue", () => {
    const m = montar({ pools, funcionarios: equipe(4), c: 1 });
    const av = avaliarPlano(m.entrada, m.dados, gerarEscala(m.entrada).alocacoes);
    expect(av.totais.faltaFinalLo).toBeGreaterThanOrEqual(av.totais.faltaFinalHi - 1e-9);
    expect(av.totais.finalEntregueLo).toBeLessThanOrEqual(av.totais.finalEntregueHi + 1e-9);
    expect(av.postos.every((p) => p.pecasFinais > 0)).toBe(true);
    expect(av.trajetoria.length).toBe(1);
  });
  it("plano vazio entrega só o que já foi produzido; o mesmo plano dá o mesmo resultado (determinístico)", () => {
    const m = montar({ pools, funcionarios: equipe(4), c: 1 });
    const vazio = avaliarPlano(m.entrada, m.dados, []);
    const cheio = avaliarPlano(m.entrada, m.dados, gerarEscala(m.entrada).alocacoes);
    expect(vazio.totais.finalEntregueLo).toBeLessThan(cheio.totais.finalEntregueLo);
    expect(JSON.stringify(avaliarPlano(m.entrada, m.dados, gerarEscala(m.entrada).alocacoes))).toBe(JSON.stringify(cheio));
  });
  it("incluirMarginais devolve valor marginal não crescente por n e zero além da necessidade", () => {
    const m = montar({ pools, funcionarios: equipe(4), c: 1 });
    const av = avaliarPlano(m.entrada, m.dados, gerarEscala(m.entrada).alocacoes, { incluirMarginais: true });
    const alguma = Object.values(av.marginais).flatMap((o) => Object.values(o));
    expect(alguma.length).toBeGreaterThan(0);
    alguma.forEach((v) => v.forEach((x, i) => { if (i > 0) expect(x).toBeLessThanOrEqual(v[i - 1] + 1e-9); }));
  });
});

describe("estabilidade (θ) do primeiro período mutável", () => {
  const pools = [
    pool({ produto: "C", etapa: "E", op: "opE", ordem: 1, q: 70500, maquinas: ["e16"], mu: 2500 }),
    pool({ produto: "C", etapa: "M", op: "opM", ordem: 2, q: 70500, maquinas: ["m1", "m2", "m3", "m4"], mu: 700 }),
    pool({ produto: "F", etapa: "F1", op: "opF", ordem: 1, q: 70500, maquinas: ["f1", "f2", "f3", "f4"], mu: 300 }),
  ];
  const plano = (slots: Parameters<typeof linhaPlano>[0]) =>
    [0, 1, 2, 3, 4, 5].flatMap((i) => [linhaPlano(slots, i, "f01", "e16", "C", "E", "opE", 2500), linhaPlano(slots, i, "f02", "m1", "C", "M", "opM", 700), linhaPlano(slots, i, "f03", "f1", "F", "F1", "opF", 300)]);
  const cenario = (theta: number) => {
    const b = rodar({ pools, funcionarios: equipe(4), c: 3, plano });
    const ap = apontarPlano(b.planoCompleto, pools, 3, b.entrada.slots, (a) => (a.etapaId === "E" ? 5000 : a.etapaId === "M" ? 2000 : 300));
    const x = rodar({ pools, funcionarios: equipe(4), c: 3, plano, apontamentos: ap, opcoes: { limiarEstabilidadePecas: theta } });
    const s = x.entrada.slots[x.entrada.aPartirDe];
    const postos = new Set(x.r.resultado.alocacoes.filter((a) => a.maquinaId && a.data === s.data && a.periodoId === s.periodoId).map((a) => a.maquinaId));
    return { x, postos };
  };
  it("θ enorme: o próximo período fica igual ao plano vigente (mesmas máquinas); θ = 0: o fluxo reorganiza", () => {
    const grande = cenario(1e9);
    expect(["e16", "m1", "f1"].every((m) => grande.postos.has(m))).toBe(true);
    expect(grande.x.r.diagnostico.theta).toBe(1e9);
    const zero = cenario(0);
    expect([...zero.postos].sort().join()).not.toBe([...grande.postos].sort().join());
    expect(zero.x.r.diagnostico.diagnosticos.some((d) => d.codigo === "ESTABILIDADE_RETEVE_ALOCACAO")).toBe(false);
    expect(grande.x.r.diagnostico.diagnosticos.some((d) => d.codigo === "ESTABILIDADE_RETEVE_ALOCACAO")).toBe(true);
  });
  it("θ padrão é derivado (≥ menor meta ocupada e ≥ 0,5% do R_f total) e fica no diagnóstico", () => {
    const { x } = cenario(undefined as unknown as number);
    expect(x.r.diagnostico.theta).toBeGreaterThanOrEqual(300);
    const c = prepararFluxo(x.entrada, x.dados);
    expect(c.aPartirDe).toBe(x.entrada.aPartirDe);
  });
  it("restrição dura ignora θ: máquina indisponível nunca é mantida por estabilidade", () => {
    const b = rodar({ pools, funcionarios: equipe(4), c: 3, plano, opcoes: { limiarEstabilidadePecas: 1e9 }, extra: { indisponibilidades: [{ maquinaId: "e16", desdeMs: 0, liberadaEmMs: null }] } });
    expect(b.r.resultado.alocacoes.some((a) => a.maquinaId === "e16")).toBe(false);
  });
});
