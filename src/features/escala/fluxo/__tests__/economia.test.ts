// Capacidade física, saturação, valor marginal, custo de oportunidade, provedores (produtividade/margem) e limite econômico — regra geral, sem `if produto`.
import { describe, it, expect } from "vitest";
import { planejarComFluxo } from "../planejar";
import { verificarRestricoesDuras } from "../restricoes";
import { equipe, montar, pool } from "./helpersFluxo";
import type { OpcoesFluxo } from "../tipos";
import type { PoolEscala } from "../../types";

const DIAS = ["2026-10-26", "2026-10-27"];
function rodar(pools: PoolEscala[], pessoas: number, opcoes: OpcoesFluxo, extra: object = {}) {
  const m = montar({ pools, funcionarios: equipe(pessoas), c: 1, extra: { revezamentoDuro: false, ...extra }, dias: DIAS });
  const r = planejarComFluxo(m.entrada, m.dados, { objetivo: "financeiro", ...opcoes });
  const cap = (etapa: string, slotRel = 0) => r.diagnostico.economia!.capacidade.find((c) => c.etapaId === etapa && c.slot === m.entrada.aPartirDe + slotRel)!;
  return { m, r, cap };
}

describe("capacidade física e saturação", () => {
  it("posto SATURADO: todos os postos ocupados ⇒ valor marginal de outra pessoa ali = 0 (SATURADO_POR_POSTO)", () => {
    const pools = [
      pool({ produto: "A", etapa: "A1", op: "opA", ordem: 1, q: 900000, maquinas: ["a1", "a2"], mu: 1000, valor: 0.5 }),
      pool({ produto: "B", etapa: "B1", op: "opB", ordem: 1, q: 900000, maquinas: ["b1", "b2"], mu: 100, valor: 0.1 }),
    ];
    const { r, cap } = rodar(pools, 6, {});
    const a = cap("A1");
    expect(a.postosOcupados).toBe(a.postosMaximos);
    expect(a.postosDisponiveis).toBe(0);
    expect(a.valorMarginalAdicionar).toBe(0);
    expect(a.diagnostico).toBe("SATURADO_POR_POSTO");
    expect(r.diagnostico.diagnosticos.some((d) => d.codigo === "SATURADO_POR_POSTO")).toBe(true);
  });

  it("só 2 pessoas elegíveis com 4 postos ⇒ capacidade humana = 2 postos (mesmo com 4 máquinas)", () => {
    const pools = [pool({ produto: "A", etapa: "A1", op: "opA", ordem: 1, q: 900000, maquinas: ["a1", "a2", "a3", "a4"], mu: 1000, valor: 0.5 })];
    const { cap } = rodar(pools, 2, {});
    const a = cap("A1");
    expect(a.postosMaximos).toBe(4);
    expect(a.pessoasElegiveis).toBe(2);
    expect(a.capMaquinas).toBe(4000);
    expect(a.capHumana).toBe(2000);
    expect(a.capEtapa).toBeLessThanOrEqual(2000);
    expect(a.postosOcupados).toBe(2);
  });

  it("máquina com pessoa livre mas SEM material: GARGALO_WIP_MATERIAL, valor marginal 0 (não premia WIP)", () => {
    const pools = [
      pool({ produto: "A", etapa: "A1", op: "opA1", ordem: 1, q: 900000, maquinas: ["a1"], mu: 100, valor: 0.5 }), // upstream lento
      pool({ produto: "A", etapa: "A2", op: "opA2", ordem: 2, q: 900000, maquinas: ["a2", "a3", "a4"], mu: 2000, valor: 0.5 }), // downstream rápido, sem WIP
    ];
    const { cap } = rodar(pools, 2, {});
    const a2 = cap("A2");
    expect(a2.postosDisponiveis).toBeGreaterThan(0);
    expect(a2.valorMarginalAdicionar).toBe(0);
    expect(a2.diagnostico).toBe("GARGALO_WIP_MATERIAL");
  });

  it("upstream que o downstream NÃO absorve: produzir acima da etapa limitante vale 0 (GARGALO_DOWNSTREAM) — 3.000/período com consumo de 1.000 conta só 1.000", () => {
    const pools = [
      pool({ produto: "A", etapa: "A1", op: "opA1", ordem: 1, q: 900000, maquinas: ["a1", "a2", "a3"], mu: 3000, valor: 0.5 }),
      pool({ produto: "A", etapa: "A2", op: "opA2", ordem: 2, q: 900000, maquinas: ["a4"], mu: 1000, valor: 0.5 }), // 1 máquina: absorve só 1.000/período
    ];
    const { cap, r } = rodar(pools, 2, {});
    const a1 = cap("A1");
    expect(a1.valorMarginalAdicionar).toBe(0);
    expect(["GARGALO_DOWNSTREAM", "SATURADO_POR_POSTO", "FOLGA_FUTURA"]).toContain(a1.diagnostico); // nunca "OK" com valor 0
    const fin = r.diagnostico.avaliacaoFluxo.financeiro!.produtos[0];
    expect(fin.finalProjetado).toBeLessThanOrEqual(1000 * 10 + 1); // o final é limitado pela etapa 2 em todos os períodos
  });

  it("máquina NÃO selecionada na Previsão nunca é usada (valor sem posto = 0)", () => {
    const pools = [pool({ produto: "A", etapa: "A1", op: "opA", ordem: 1, q: 900000, maquinas: ["a1", "a2"], mu: 1000, valor: 0.5 })];
    const { r } = rodar(pools, 6, {});
    r.resultado.alocacoes.filter((a) => a.maquinaId).forEach((a) => expect(["a1", "a2"]).toContain(a.maquinaId));
    expect(verificarRestricoesDuras(r.entradaFluxo, r.resultado.alocacoes)).toEqual([]);
  });
});

describe("valor marginal, custo de oportunidade e log por decisão", () => {
  it("cada pessoa-posto traz receita marginal, alternativa, ganho líquido e texto; Σ das receitas marginais ≈ R$ finais projetados", () => {
    const pools = [
      pool({ produto: "A", etapa: "A1", op: "opA", ordem: 1, q: 900000, maquinas: ["a1", "a2", "a3", "a4"], mu: 1000, valor: 0.05 }),
      pool({ produto: "B", etapa: "B1", op: "opB", ordem: 1, q: 900000, maquinas: ["b1", "b2", "b3", "b4"], mu: 600, valor: 0.2 }),
    ];
    const { r } = rodar(pools, 3, {});
    const dec = r.diagnostico.economia!.decisoes;
    expect(dec.length).toBeGreaterThan(0);
    dec.forEach((d) => {
      expect(d.texto).toContain("receita marginal R$");
      expect(d.texto).toContain("ganho líquido R$");
      expect(d.ganhoLiquido).toBeCloseTo(d.receitaMarginal - d.alternativa.valor, 1);
    });
    // B rende R$ 120/posto × 1 período; A R$ 50: o primeiro período põe todos em B e o custo de oportunidade (A) é menor que a receita marginal
    const d0 = dec.filter((d) => d.slot === r.diagnostico.economia!.capacidade[0].slot);
    expect(d0.every((d) => d.no.startsWith("B"))).toBe(true);
    expect(d0.every((d) => d.ganhoLiquido >= 0)).toBe(true);
  });
});

describe("provedores injetáveis", () => {
  const pools = [
    pool({ produto: "A", etapa: "A1", op: "opA", ordem: 1, q: 900000, maquinas: ["a1", "a2", "a3", "a4"], mu: 1000, valor: 0.1 }),
    pool({ produto: "B", etapa: "B1", op: "opB", ordem: 1, q: 900000, maquinas: ["b1", "b2", "b3", "b4"], mu: 1000, valor: 0.1 }),
  ];
  it("ProdutividadeProvider: a produtividade esperada REAL (não a nominal) decide onde a pessoa gera mais receita/hora", () => {
    const base = rodar(pools, 3, {});
    const real = rodar(pools, 3, { produtividade: (a) => ({ pecasPorPeriodo: a.produtoId === "A" ? a.metaNominal * 0.4 : a.metaNominal, fator: 1, fonte: "teste", amostra: 20 }) });
    const postos = (x: ReturnType<typeof rodar>, p: string) => x.r.resultado.alocacoes.filter((a) => a.maquinaId && a.produtoId === p).length;
    expect(real.cap("A1").produtividadeEsperada).toBeCloseTo(400, 0);
    expect(real.cap("A1").produtividadeNominal).toBeCloseTo(1000, 0);
    expect(postos(real, "B")).toBeGreaterThan(postos(real, "A"));
    void base;
  });
  it("MargemProvider indisponível ⇒ cai para RECEITA (diagnóstico MARGEM_INDISPONIVEL, nunca 'lucro'); confiável ⇒ nível margem", () => {
    const sem = rodar(pools, 3, { objetivo: "margem", semanaInicio: "2026-10-26", margem: () => ({ valor: null, fonte: "sem dados", confiavel: false }) });
    expect(sem.r.diagnostico.economia!.nivel).toBe("receita");
    expect(sem.r.diagnostico.diagnosticos.some((d) => d.codigo === "MARGEM_INDISPONIVEL")).toBe(true);
    const com = rodar(pools, 3, { objetivo: "margem", semanaInicio: "2026-10-26", margem: (p) => ({ valor: p === "A" ? 0.01 : 0.09, natureza: "contribuicao", fonte: "TESTE-FICTICIO", confiavel: true }) });
    expect(com.r.diagnostico.economia!.nivel).toBe("margem");
    const post = (p: string) => com.r.resultado.alocacoes.filter((a) => a.maquinaId && a.produtoId === p).length;
    expect(post("B")).toBeGreaterThan(post("A"));
  });
  it("produtividadeBase nominal × real: a base muda a ordem (f embutido nas metas)", () => {
    const f = { "A|A-e1": 0.5, "B|B-e1": 1 };
    const pl = [
      pool({ produto: "A", etapa: "A-e1", op: "opA", ordem: 1, q: 900000, maquinas: ["a1", "a2", "a3", "a4"], mu: 500, valor: 0.1 }), // 1000 nominal × f 0,5
      pool({ produto: "B", etapa: "B-e1", op: "opB", ordem: 1, q: 900000, maquinas: ["b1", "b2", "b3", "b4"], mu: 700, valor: 0.1 }),
    ];
    const real = rodar(pl, 3, { fatoresEmbutidos: f });
    const nom = rodar(pl, 3, { fatoresEmbutidos: f, produtividadeBase: "nominal" });
    expect(real.cap("A-e1").produtividadeEsperada).toBeCloseTo(500, 0);
    expect(nom.cap("A-e1").produtividadeEsperada).toBeCloseTo(1000, 0);
  });
});

describe("compatibilidade", () => {
  it("peso comercial default 1: sem `pesoComercial`, as métricas e a decisão independem dele", () => {
    const pools = [
      pool({ produto: "A", etapa: "A1", op: "opA", ordem: 1, q: 900000, maquinas: ["a1", "a2"], mu: 1000, valor: 0.1 }),
      pool({ produto: "B", etapa: "B1", op: "opB", ordem: 1, q: 900000, maquinas: ["b1", "b2"], mu: 1000, valor: 0.1 }),
    ];
    const a = rodar(pools, 2, {});
    const b = rodar(pools, 2, { pesoComercial: { A: 1, B: 1 } });
    expect(JSON.stringify(a.r.resultado.alocacoes)).toBe(JSON.stringify(b.r.resultado.alocacoes));
    expect(a.r.diagnostico.avaliacaoFluxo.financeiro!.produtos.every((p) => p.pesoComercial === 1)).toBe(true);
  });
});

describe("lucro/hora = tela Produtos (calcularMargemProduto reaproveitado)", () => {
  const A = [
    pool({ produto: "A", etapa: "A1", op: "opA1", ordem: 1, q: 900000, maquinas: ["a1"], mu: 1000, valor: 0.2 }),
    pool({ produto: "A", etapa: "A2", op: "opA2", ordem: 2, q: 900000, maquinas: ["a2"], mu: 500, valor: 0.2 }),
  ];
  it("fórmula da tela: margem = valor − Σ(tempo/peça × custo/hora); lucro/h = margem ÷ Σ tempo/peça; = receita/h − k quando o custo/hora é único", async () => {
    const { lucroHoraDaTela } = await import("../economiaProduto");
    const m = montar({ pools: A, funcionarios: equipe(2), c: 1, extra: { revezamentoDuro: false }, dias: DIAS });
    const k = 30;
    const r = lucroHoraDaTela(m.entrada, { custoHoraEmpresa: k })("A", "")!;
    const horasTot = [...new Map(m.entrada.slots.map((s) => [s.periodoId, (s.fimMin - s.inicioMin) / 60])).values()].reduce((a, b) => a + b, 0); // Σ horas dos 6 períodos
    const T = horasTot / (6 * 1000) + horasTot / (6 * 500); // tempo/peça = Σ horas ÷ Σ metas, por etapa
    expect(T).toBeGreaterThan(0);
    expect(r.tempoTotalHoras).toBeCloseTo(T, 9);
    expect(r.custoUnitario).toBeCloseTo(T * k, 9);
    expect(r.margemUnitaria).toBeCloseTo(0.2 - T * k, 9);
    expect(r.lucroHora).toBeCloseTo((0.2 - T * k) / T, 9);
    expect(r.lucroHora).toBeCloseTo(r.receitaHora - k, 9);
  });
  it("objetivo lucro_hora: usa a margem da tela por peça final (nível margem, fonte 'tela Produtos'); sem provedor próprio o núcleo constrói o da tela", () => {
    const { r } = rodar(A, 2, { objetivo: "lucro_hora" });
    expect(r.diagnostico.economia!.nivel).toBe("margem");
    const p = r.diagnostico.avaliacaoFluxo.financeiro!.produtos[0];
    expect(p.fonteValor).toContain("tela Produtos");
    expect(p.valorEconomicoUnitario).toBeLessThan(0.2); // margem < valor
    expect(p.rsMeta).toBeCloseTo(p.meta * (p.valorEconomicoUnitario as number), 1);
  });
  it("lucro/h nominal × real: base nominal remove o f embutido da produtividade e da margem", async () => {
    const { lucroHoraDaTela } = await import("../economiaProduto");
    const m = montar({ pools: A, funcionarios: equipe(2), c: 1, extra: { revezamentoDuro: false }, dias: DIAS });
    const lento = { ...m.entrada, pools: m.entrada.pools.map((p) => ({ ...p, metas: Object.fromEntries(Object.entries(p.metas).map(([k, v]) => [k, v * 0.5])) })) };
    expect(lucroHoraDaTela(lento)("A", "")!.lucroHora).toBeLessThan(lucroHoraDaTela(m.entrada)("A", "")!.lucroHora);
  });
});
