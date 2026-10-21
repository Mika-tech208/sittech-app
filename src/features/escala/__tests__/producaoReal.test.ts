// FASE 4c — Produção Real como sinal: corte sem futuro, restante real, performance f, exposição ergonômica (sem_producao conservador).
import { describe, it, expect } from "vitest";
import { avaliarCompromisso } from "../compromisso";
import { desempenhoPorEtapa, fatorDesempenho } from "../desempenho";
import { boasPorPool, exposicoesDoPeriodo, linhasExecutadas, restantePorPool, visivelNoCorte, type ApontamentoReal } from "../producaoReal";
import type { AlocacaoEscala, EntradaEscala } from "../types";
import { entrada, equipe, pool } from "./helpers";

const pools = () => [
  pool({ produto: "A", etapa: "A-e1", op: "opX", q: 900, maquinas: ["m1", "m2"], mu: 100 }),
  pool({ produto: "B", etapa: "B-e1", op: "opY", q: 900, maquinas: ["m3", "m4"], mu: 100 }),
  pool({ produto: "C", etapa: "C-e1", op: "opZ", q: 900, maquinas: ["m5", "m3"], mu: 100 }), // m3 serve opY e opZ
];
const e: EntradaEscala = { ...entrada({ funcionarios: equipe(4), pools: pools() }, ["2026-10-19", "2026-10-20"]), revezamentoDuro: true };
const S = e.slots;
const ap = (slot: number, f: string | null, m: string | null, produto: string | null, op: string | null, extra: Partial<ApontamentoReal> = {}): ApontamentoReal => ({
  data: S[slot].data, periodoId: S[slot].periodoId, funcionarioId: f, maquinaId: m, produtoId: produto, etapaId: produto ? `${produto}-e1` : null, operacaoId: op,
  boas: 90, refugo: 0, meta: 100, status: produto ? "produzindo" : "sem_producao", motivo: produto ? null : "falta_material", lancadoEmMs: S[slot].fimMs + 5 * 60_000, ...extra,
});
const oficial = (slot: number, f: string, m: string, produto: string, op: string): AlocacaoEscala => ({ data: S[slot].data, periodoId: S[slot].periodoId, funcionarioId: f, maquinaId: m, produtoId: produto, etapaId: `${produto}-e1`, operacaoId: op, pecas: 100, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null });

describe("corte sem informação futura", () => {
  it("só entram períodos ≤ c lançados até o corte", () => {
    const todos = [ap(0, "f01", "m1", "A", "opX"), ap(1, "f01", "m3", "B", "opY"), ap(2, "f01", "m5", "C", "opZ"), ap(1, "f02", "m1", "A", "opX", { lancadoEmMs: S[1].fimMs + 3 * 3_600_000 })];
    const v = visivelNoCorte(todos, S, 1, S[1].fimMs + 10 * 60_000);
    expect(v).toHaveLength(2); // M3 (futuro) e o lançamento tardio ficam de fora
    expect(v.every((a) => a.periodoId !== "m3")).toBe(true);
  });
  it("restante real = previsto − boas (sem negativos); sem_producao não soma", () => {
    const v = [ap(0, "f01", "m1", "A", "opX", { boas: 300 }), ap(1, "f02", "m1", "A", "opX", { boas: 700 }), ap(0, null, "m3", null, null, { boas: 0 })];
    const b = boasPorPool(v);
    expect(b["A|A-e1"]).toBe(1000);
    const r = restantePorPool(e.pools, b);
    expect(r["A|A-e1"]).toBe(0);
    expect(r["B|B-e1"]).toBe(900);
  });
});

describe("performance conhecida por etapa", () => {
  it("n < 3 => f = 1", () => {
    expect(fatorDesempenho(2, 100, 400)).toBe(1);
    expect(fatorDesempenho(0, 0, 0)).toBe(1);
  });
  it("n ≥ 3 => f = 1 + n/(n+6)·(obs − 1); obs limitada a [0,30; 1,30]", () => {
    expect(fatorDesempenho(3, 360, 300)).toBeCloseTo(1 + (3 / 9) * 0.2, 10); // obs 1,2
    expect(fatorDesempenho(12, 1000, 100)).toBeCloseTo(1 + (12 / 18) * 0.3, 10); // obs 10 => 1,30
    expect(fatorDesempenho(6, 1, 100)).toBeCloseTo(1 + (6 / 12) * (0.3 - 1), 10); // obs 0,01 => 0,30
    expect(fatorDesempenho(30, 100, 100)).toBe(1);
  });
  it("por etapa, ignora sem_producao e linhas sem meta", () => {
    const v = [ap(0, "f01", "m1", "A", "opX", { boas: 80 }), ap(0, "f02", "m2", "A", "opX", { boas: 80 }), ap(1, "f01", "m1", "A", "opX", { boas: 80 }), ap(1, null, "m1", null, null), ap(1, "f03", "m2", "A", "opX", { meta: 0, boas: 5 })];
    const d = desempenhoPorEtapa(e.pools, v);
    expect(d["A|A-e1"].n).toBe(3);
    expect(d["A|A-e1"].f).toBeCloseTo(1 + (3 / 9) * (0.8 - 1), 10);
    expect(d["B|B-e1"]).toEqual({ n: 0, obs: null, f: 1 });
  });
});

describe("exposição ergonômica — sem_producao CONSERVADOR", () => {
  it("produzindo => operação da própria linha", () => {
    const r = exposicoesDoPeriodo(S[0], [ap(0, "f01", "m1", "A", "opX")], [], e.pools);
    expect(r.exposicoes).toEqual([{ funcionarioId: "f01", slot: 0, maquinaId: "m1", operacoes: ["opX"], origem: "apontamento", incerta: false }]);
  });
  it("sem_producao com funcionário + máquina e alocação oficial INEQUÍVOCA => usa a operacao_id oficial (0 peças ≠ 0 exposição)", () => {
    const sp = ap(0, "f01", "m1", null, null, { motivo: "falta_material" });
    const r = exposicoesDoPeriodo(S[0], [sp], [oficial(0, "f01", "m1", "A", "opX")], e.pools);
    expect(r.exposicoes[0]).toMatchObject({ funcionarioId: "f01", operacoes: ["opX"], origem: "sem_producao_vinculada", incerta: false });
    expect(r.incertezas.filter((i) => i.tipo === "sem_producao_sem_vinculo")).toEqual([]);
  });
  it("sem_producao com funcionário e SEM vínculo => operação desconhecida: proíbe todas as operações que a máquina pode executar e registra a incerteza", () => {
    const sp = ap(0, "f01", "m3", null, null);
    const r = exposicoesDoPeriodo(S[0], [sp], [], e.pools); // m3 serve opY (B) e opZ (C)
    expect(r.exposicoes[0]).toMatchObject({ operacoes: ["opY", "opZ"], origem: "sem_producao_desconhecida", incerta: true });
    expect(r.incertezas[0]).toMatchObject({ tipo: "sem_producao_sem_vinculo", funcionarioId: "f01", candidatas: ["opY", "opZ"] });
  });
  it("vínculo ambíguo (duas alocações oficiais da mesma pessoa na máquina) => desconhecida, não adivinha", () => {
    const sp = ap(0, "f01", "m3", null, null);
    const r = exposicoesDoPeriodo(S[0], [sp], [oficial(0, "f01", "m3", "B", "opY"), oficial(0, "f01", "m3", "C", "opZ")], e.pools);
    expect(r.exposicoes[0].origem).toBe("sem_producao_desconhecida");
  });
  it("sem funcionário (caso real): falta_operador não expõe ninguém; falta_material/outro presume a única alocação oficial sem apontamento próprio", () => {
    const op = ap(0, null, "m1", null, null, { motivo: "falta_operador" });
    const mat = ap(0, null, "m2", null, null, { motivo: "falta_material" });
    const r = exposicoesDoPeriodo(S[0], [op, mat], [oficial(0, "f01", "m1", "A", "opX"), oficial(0, "f02", "m2", "A", "opX")], e.pools);
    expect(r.exposicoes.map((x) => x.funcionarioId)).toEqual(["f02"]); // f01: o lançamento diz que não havia operador
    expect(r.exposicoes[0]).toMatchObject({ origem: "sem_producao_presumida", incerta: true });
    expect(r.incertezas.some((i) => i.funcionarioId === "f01")).toBe(false);
  });
  it("incerteza nunca LIBERA repetição: com operação desconhecida, o posto compatível com qualquer candidata é conflito", () => {
    const sp = ap(0, "f01", "m3", null, null);
    const ex = exposicoesDoPeriodo(S[0], [sp], [], e.pools);
    const comp = (m: string, produto: string, op: string): AlocacaoEscala[] => [{ ...oficial(1, "f01", m, produto, op) }];
    const arrisca = avaliarCompromisso(e, comp("m5", "C", "opZ"), 1, { exposicaoAnterior: ex.exposicoes });
    expect(arrisca.conflitos).toHaveLength(1);
    expect(arrisca.conflitos[0].exposicaoIncerta).toBe(true);
    const seguro = avaliarCompromisso(e, comp("m1", "A", "opX"), 1, { exposicaoAnterior: ex.exposicoes });
    expect(seguro.conflitos).toEqual([]);
  });
  it("linhasExecutadas: quem não apontou fica sem posto; sem_producao desconhecida vira linha com máquina e sem operação inventada", () => {
    const v = [ap(0, "f01", "m1", "A", "opX"), ap(0, "f02", "m3", null, null)];
    const r = linhasExecutadas(S, 0, ["f01", "f02", "f03"], v, [], e.pools);
    expect(r.linhas.find((a) => a.funcionarioId === "f01")).toMatchObject({ maquinaId: "m1", operacaoId: "opX", produtoId: "A" });
    expect(r.linhas.find((a) => a.funcionarioId === "f02")).toMatchObject({ maquinaId: "m3", operacaoId: null, produtoId: null, etapaId: null });
    expect(r.linhas.find((a) => a.funcionarioId === "f03")?.maquinaId).toBeNull();
    expect(r.linhas.every((a) => a.pecas === 0)).toBe(true);
  });
});

describe("pessoa SEM apontamento — abordagem conservadora (4d)", () => {
  const of = [oficial(0, "f01", "m1", "A", "opX"), oficial(0, "f02", "m2", "A", "opX"), oficial(0, "f03", "m3", "B", "opY")];
  it("alocação oficial inequívoca e nenhuma evidência de que não operou => EXPOSTA à operação oficial (sem apontamento ≠ sem exposição)", () => {
    const r = exposicoesDoPeriodo(S[0], [ap(0, "f02", "m2", "A", "opX")], of, e.pools, { funcionarios: ["f01", "f02", "f03", "f04"] });
    expect(r.exposicoes.map((x) => [x.funcionarioId, x.operacoes[0], x.origem, x.incerta])).toEqual([["f01", "opX", "alocacao_oficial_sem_apontamento", true], ["f02", "opX", "apontamento", false], ["f03", "opY", "alocacao_oficial_sem_apontamento", true]]);
    expect(r.incertezas.filter((i) => i.tipo === "sem_apontamento_presumida").map((i) => i.funcionarioId)).toEqual(["f01", "f03"]);
  });
  it("ausência CONHECIDA não conta como exposição", () => {
    const aus = [{ funcionarioId: "f01", data: S[0].data, inicioMin: null, fimMin: null }];
    const r = exposicoesDoPeriodo(S[0], [], of, e.pools, { ausencias: aus, funcionarios: ["f01", "f02", "f03"] });
    expect(r.exposicoes.map((x) => x.funcionarioId)).toEqual(["f02", "f03"]);
    // ausência parcial que NÃO cobre o período também não conta como evidência
    const fora = [{ funcionarioId: "f01", data: S[0].data, inicioMin: S[0].fimMin, fimMin: S[0].fimMin + 30 }];
    expect(exposicoesDoPeriodo(S[0], [], of, e.pools, { ausencias: fora }).exposicoes.map((x) => x.funcionarioId)).toContain("f01");
  });
  it("evidência de que não operou: falta_operador na máquina dela, ou outro operador produzindo nela", () => {
    const faltaOp = ap(0, null, "m1", null, null, { motivo: "falta_operador" });
    const outro = ap(0, "f09", "m3", "B", "opY");
    const r = exposicoesDoPeriodo(S[0], [faltaOp, outro], of, e.pools, {});
    expect(r.exposicoes.map((x) => x.funcionarioId).sort()).toEqual(["f02", "f09"]); // f01 e f03 têm evidência; f02 sem apontamento: exposta
  });
  it("sem NENHUMA linha oficial e sem apontamento: operação DESCONHECIDA registrada — nada inventado, nenhuma restrição fabricada", () => {
    const r = exposicoesDoPeriodo(S[0], [], [oficial(0, "f01", "m1", "A", "opX")], e.pools, { funcionarios: ["f01", "f07"] });
    expect(r.incertezas.find((i) => i.funcionarioId === "f07")).toMatchObject({ tipo: "operacao_desconhecida", candidatas: [] });
    expect(r.exposicoes.find((x) => x.funcionarioId === "f07")).toBeUndefined();
  });
  it("a exposição presumida PROÍBE a repetição no período seguinte (conflito marcado como incerto)", () => {
    const ex = exposicoesDoPeriodo(S[0], [], of, e.pools, {});
    const comp = [{ ...oficial(1, "f01", "m1", "A", "opX") }];
    const r = avaliarCompromisso(e, comp, 1, { exposicaoAnterior: ex.exposicoes });
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0].exposicaoIncerta).toBe(true);
  });
  it("linhasExecutadas: quem tem oficial e não apontou vira linha COM posto (conservador); ausente/evidência vira sem posto", () => {
    const aus = [{ funcionarioId: "f03", data: S[0].data, inicioMin: null, fimMin: null }];
    const r = linhasExecutadas(S, 0, ["f01", "f02", "f03"], [ap(0, "f02", "m2", "A", "opX")], of, e.pools, aus);
    expect(r.linhas.find((a) => a.funcionarioId === "f01")).toMatchObject({ maquinaId: "m1", operacaoId: "opX", produtoId: "A" });
    expect(r.linhas.find((a) => a.funcionarioId === "f03")?.maquinaId).toBeNull();
  });
});
