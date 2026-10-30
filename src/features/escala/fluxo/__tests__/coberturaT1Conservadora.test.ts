// Regra CONSERVADORA de material (producao_real_fluxo_mesmo_periodo = false): o downstream de um período só usa o estoque que existia no INÍCIO dele.
// A produção da etapa anterior no próprio período NÃO é assumida como disponível (o tempo físico de transferência não é modelado).
import { describe, it, expect } from "vitest";
import { construirGrafo } from "../grafo";
import { novaCap, simularGrupo } from "../simulador";
import { pool } from "./helpersFluxo";
import { CONFIG_FLUXO_PADRAO, CHAVE_PR_MESMO_PERIODO, lerConfigFluxo } from "@/lib/escala/fluxo/parametrosFluxo";

const pools2 = [
  pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 100000, maquinas: ["a1"], mu: 100 }),
  pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 100000, maquinas: ["b1"], mu: 100 }),
];
/** Um período (T1): upstream com capacidade `up`, downstream com capacidade `down`, estoque confirmado `w0`. */
function t1(p: { up: number; down: number; w0: number; mesmo: boolean }) {
  const g = construirGrafo(pools2);
  const cap = { "P|P1": novaCap(1), "P|P2": novaCap(1) };
  cap["P|P1"].base = [p.up];
  cap["P|P2"].base = [p.down];
  return simularGrupo(g, g.grupos[0], {
    tIni: 0, tFim: 1, cap, B0: { "P|P1": 0, "P|P2": 0 }, W0: { "P|P1": p.w0 }, L0: { "P|P1": p.w0 }, Q: { "P|P1": 100000, "P|P2": 100000 }, mesmoPeriodo: p.mesmo, trajetoria: true,
  });
}

describe("cobertura de material no T1 — regra conservadora (mesmoPeriodo = false)", () => {
  it("A) o estoque confirmado no início sustenta o período inteiro: o posto produz a capacidade toda", () => {
    expect(t1({ up: 0, down: 100, w0: 150, mesmo: false }).x["P|P2"]).toEqual([100]);
  });
  it("B) o estoque confirmado não sustenta: o downstream só rende o que o estoque cobre (não o da meta)", () => {
    const r = t1({ up: 0, down: 100, w0: 60, mesmo: false });
    expect(r.x["P|P2"]).toEqual([60]); // ex.: 3.600 etiquetadas para uma Embalagem com meta 4.600
  });
  it("C) produção do upstream apenas PREVISTA para o próprio T1 não é assumida como disponível", () => {
    const conservador = t1({ up: 100, down: 100, w0: 0, mesmo: false });
    expect(conservador.x["P|P2"]).toEqual([0]); // o upstream produz, mas só chega ao downstream no período seguinte
    expect(conservador.x["P|P1"]).toEqual([100]);
    const atual = t1({ up: 100, down: 100, w0: 0, mesmo: true });
    expect(atual.x["P|P2"]).toEqual([100]); // comportamento ATUAL (padrão) — não muda sem o parâmetro
  });
  it("D) produção upstream já REALIZADA/confirmada entra no estoque inicial e sustenta o downstream", () => {
    // upstream de períodos fechados (apontamento real) = parte do W0 do período seguinte
    expect(t1({ up: 0, down: 100, w0: 100, mesmo: false }).x["P|P2"]).toEqual([100]);
  });
  it("Caixa 4x2: 2.300 etiquetadas sustentam 3 postos de Montagem (meta 700) o período inteiro, não os 4º/5º", () => {
    const g = construirGrafo([
      pool({ produto: "C", etapa: "E", op: "opA", ordem: 1, q: 100000, maquinas: ["e1"], mu: 3000 }),
      pool({ produto: "C", etapa: "M", op: "opB", ordem: 2, q: 100000, maquinas: ["m1", "m2", "m3", "m4", "m5"], mu: 700 }),
    ]);
    const rodar = (postos: number) => {
      const cap = { "C|E": novaCap(1), "C|M": novaCap(1) };
      cap["C|E"].base = [3000];
      cap["C|M"].base = [700 * postos];
      return simularGrupo(g, g.grupos[0], { tIni: 0, tFim: 1, cap, B0: { "C|E": 0, "C|M": 0 }, W0: { "C|E": 2300 }, L0: { "C|E": 2300 }, Q: { "C|E": 100000, "C|M": 100000 }, mesmoPeriodo: false, trajetoria: true }).x["C|M"][0];
    };
    expect(rodar(3)).toBe(2100); // 3 postos: coberto
    expect(rodar(4)).toBe(2300); // o 4º posto só rende 200 (estoque acaba): não sustenta o período
    expect(rodar(5)).toBe(2300); // o 5º não rende nada
  });
});

describe("parâmetro producao_real_fluxo_mesmo_periodo", () => {
  it("padrão/ausente/valor inválido = comportamento atual; só o JSON false liga a regra conservadora", () => {
    expect(lerConfigFluxo([])).toEqual(CONFIG_FLUXO_PADRAO); // chave ausente: leitura byte-idêntica ao padrão
    expect(lerConfigFluxo([{ chave: CHAVE_PR_MESMO_PERIODO, valor: true }])).toEqual(CONFIG_FLUXO_PADRAO);
    expect(lerConfigFluxo([{ chave: CHAVE_PR_MESMO_PERIODO, valor: "false" }])).toEqual(CONFIG_FLUXO_PADRAO);
    expect(lerConfigFluxo([{ chave: CHAVE_PR_MESMO_PERIODO, valor: false }]).mesmoPeriodo).toBe(false);
  });
});
