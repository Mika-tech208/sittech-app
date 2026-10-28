// OBJETIVO FINANCEIRO (Camada 2): R$ de produto final pelo preço CONGELADO; peças absolutas não comparam produtos. Regra geral, sem `if produto`.
import { describe, it, expect } from "vitest";
import { planejarComFluxo } from "../planejar";
import { avaliarPlano } from "../avaliar";
import { verificarRestricoesDuras } from "../restricoes";
import { equipe, montar, pool } from "./helpersFluxo";
import type { OpcoesFluxo } from "../tipos";
import type { PoolEscala } from "../../types";

const DIAS = ["2026-10-26", "2026-10-27"];
function rodarObj(pools: PoolEscala[], pessoas: number, opcoes: OpcoesFluxo) {
  const m = montar({ pools, funcionarios: equipe(pessoas), c: 1, extra: { revezamentoDuro: false }, dias: DIAS });
  const r = planejarComFluxo(m.entrada, m.dados, opcoes);
  const postos = (produto: string, etapa?: string) => r.resultado.alocacoes.filter((a) => a.maquinaId && a.produtoId === produto && (!etapa || a.etapaId === etapa) && (m.entrada.slots.findIndex((s) => s.data === a.data && s.periodoId === a.periodoId) >= m.entrada.aPartirDe)).length;
  const av = avaliarPlano(m.entrada, m.dados, [...m.entrada.congeladas, ...r.resultado.alocacoes.filter((a) => (m.entrada.slots.findIndex((s) => s.data === a.data && s.periodoId === a.periodoId)) >= m.entrada.aPartirDe)], { objetivo: "financeiro", atingibilidadeModo: "sombra", ...opcoes });
  return { m, r, postos, av };
}
const ESCASSO = (v: { precoA: number; precoB: number }) => [
  pool({ produto: "A", etapa: "A1", op: "opA", ordem: 1, q: 900000, maquinas: ["a1", "a2", "a3", "a4"], mu: 1000, valor: v.precoA }),
  pool({ produto: "B", etapa: "B1", op: "opB", ordem: 1, q: 900000, maquinas: ["b1", "b2", "b3", "b4"], mu: 600, valor: v.precoB }),
];

describe("financeiro — R$ pelo preço congelado, não peças absolutas", () => {
  it("MAIS peças com MENOR R$ × MENOS peças com MAIOR R$: o objetivo peças escolhe A; o financeiro escolhe B (e rende mais R$)", () => {
    const pools = ESCASSO({ precoA: 0.05, precoB: 0.2 }); // A: 1.000 pç × 0,05 = R$ 50/posto; B: 600 pç × 0,20 = R$ 120/posto
    const pecas = rodarObj(pools, 3, {});
    const fin = rodarObj(pools, 3, { objetivo: "financeiro" });
    expect(pecas.postos("A")).toBeGreaterThan(pecas.postos("B"));
    expect(fin.postos("B")).toBeGreaterThan(fin.postos("A"));
    expect(fin.av.financeiro!.total.rsProjetadoFechamento).toBeGreaterThan(pecas.av.financeiro!.total.rsProjetadoFechamento);
    expect(verificarRestricoesDuras(fin.r.entradaFluxo, fin.r.resultado.alocacoes)).toEqual([]);
  });

  it("preço invertido ⇒ decisão invertida (a regra depende do preço congelado do item, não do produto)", () => {
    const fin = rodarObj(ESCASSO({ precoA: 0.2, precoB: 0.05 }), 3, { objetivo: "financeiro" }); // A: R$ 200/posto; B: R$ 30/posto
    expect(fin.postos("A")).toBeGreaterThan(fin.postos("B"));
  });

  it("peso comercial manual (default 1) só desloca a DECISÃO; as métricas em R$ seguem o preço puro", () => {
    const pools = ESCASSO({ precoA: 0.1, precoB: 0.12 }); // R$ 100 × 72 por posto
    const base = rodarObj(pools, 3, { objetivo: "financeiro" });
    const pesado = rodarObj(pools, 3, { objetivo: "financeiro", pesoComercial: { A: 3 } });
    expect(pesado.postos("A")).toBeGreaterThanOrEqual(base.postos("A"));
    expect(pesado.postos("A")).toBeGreaterThan(pesado.postos("B"));
    const pa = pesado.av.financeiro!.produtos.find((p) => p.produtoId === "A")!;
    expect(pa.precoCongelado).toBe(0.1);
    expect(pa.pesoComercial).toBe(3);
    expect(pa.rsProjetadoFechamento).toBeCloseTo(pa.finalProjetado * 0.1, 1);
  });

  it("mesma atingibilidade: com a meta de A atingível, o financeiro NÃO a sacrifica para B (Camada 1 antes da 2)", () => {
    const pools = [
      pool({ produto: "A", etapa: "A1", op: "opA", ordem: 1, q: 4 * 1000 * 9, maquinas: ["a1", "a2", "a3", "a4"], mu: 1000, valor: 0.01 }), // barato, mas a meta cabe
      pool({ produto: "B", etapa: "B1", op: "opB", ordem: 1, q: 900000, maquinas: ["b1", "b2", "b3", "b4"], mu: 600, valor: 0.5 }), // caro
    ];
    const sem = rodarObj(pools, 4, { objetivo: "financeiro" });
    const com = rodarObj(pools, 4, { objetivo: "financeiro", atingibilidadeModo: "ativo" });
    const gA = com.av.atingibilidade!.grupos.find((g) => g.produtos[0].produtoId === "A")!;
    expect(gA.atingivel).toBe(true);
    expect(gA.status).toBe("META_ATINGIDA_PELO_PLANO");
    expect(com.postos("A")).toBe(36);
    expect(sem.postos("A")).toBeLessThan(36); // sem a Camada 1 o R$ sacrifica A
  });

  it("produto de alto R$ SEM WIP: não gasta pessoa na etapa final sem material (nada de capacidade inventada)", () => {
    const pools = [
      pool({ produto: "A", etapa: "A1", op: "opA1", ordem: 1, q: 900000, maquinas: ["a1"], mu: 100, valor: 0.9 }), // etapa 1 lenta
      pool({ produto: "A", etapa: "A2", op: "opA2", ordem: 2, q: 900000, maquinas: ["a2", "a3", "a4"], mu: 2000, valor: 0.9 }), // etapa 2 rápida, sem WIP
      pool({ produto: "B", etapa: "B1", op: "opB", ordem: 1, q: 900000, maquinas: ["b1", "b2", "b3"], mu: 500, valor: 0.1 }),
    ];
    const fin = rodarObj(pools, 4, { objetivo: "financeiro" });
    // a etapa 2 só consome o que a etapa 1 produz (100/período): 1 posto basta em qualquer período; B (R$ 50/posto) fica com o resto
    for (let t = fin.m.entrada.aPartirDe; t < fin.m.entrada.slots.length; t++) {
      const s = fin.m.entrada.slots[t];
      const n2 = fin.r.resultado.alocacoes.filter((a) => a.maquinaId && a.etapaId === "A2" && a.data === s.data && a.periodoId === s.periodoId).length;
      expect(n2).toBeLessThanOrEqual(1);
    }
    expect(fin.postos("B")).toBeGreaterThan(fin.postos("A", "A2"));
  });

  it("produto de alto R$ JÁ IMPOSSÍVEL (máximo < meta): META_NAO_ATINGIVEL com máximo e falta inevitável em peças e R$, sem reservar postos", () => {
    const pools = [
      pool({ produto: "A", etapa: "A1", op: "opA", ordem: 1, q: 900000, maquinas: ["a1"], mu: 1000, valor: 0.9 }), // alto R$, 1 máquina: meta de 900k impossível
      pool({ produto: "B", etapa: "B1", op: "opB", ordem: 1, q: 900000, maquinas: ["b1", "b2", "b3"], mu: 500, valor: 0.1 }),
    ];
    const fin = rodarObj(pools, 4, { objetivo: "financeiro", atingibilidadeModo: "ativo" });
    const pa = fin.av.financeiro!.produtos.find((p) => p.produtoId === "A")!;
    expect(pa.metaAtingivel).toBe(false);
    expect(pa.faltaInevitavel).toBeGreaterThan(0);
    expect(pa.rsFaltaInevitavel).toBeCloseTo(pa.faltaInevitavel * 0.9, 1);
    expect(fin.r.diagnostico.diagnosticos.some((d) => d.codigo === "META_NAO_ATINGIVEL" && d.detalhes?.status === "META_NAO_ATINGIVEL")).toBe(true);
    expect(fin.postos("A")).toBe(9); // o R$ põe 1 pessoa em A em todo período (R$ 900/posto)
  });

  it("SEM dupla contagem: R$ só da etapa final (as intermediárias geram WIP, não R$)", () => {
    const pools = [
      pool({ produto: "A", etapa: "A1", op: "opA1", ordem: 1, q: 5000, maquinas: ["a1", "a2"], mu: 1000, valor: 0.3 }),
      pool({ produto: "A", etapa: "A2", op: "opA2", ordem: 2, q: 5000, maquinas: ["a3", "a4"], mu: 1000, valor: 0.3 }),
    ];
    const fin = rodarObj(pools, 4, { objetivo: "financeiro" });
    const f = fin.av.financeiro!;
    const pr = f.produtos[0];
    expect(f.produtos).toHaveLength(1); // um produto, uma etapa final
    expect(pr.rsMeta).toBeCloseTo(5000 * 0.3, 2); // meta × preço, não × nº de etapas
    expect(pr.rsProjetadoFechamento).toBeCloseTo(pr.finalProjetado * 0.3, 1);
    expect(f.total.rsProjetadoFechamento).toBeLessThanOrEqual(5000 * 0.3 + 1e-6);
    expect(f.total.rsRealizado + f.total.rsFaltante).toBeCloseTo(f.total.rsMeta, 1);
  });

  it("sacrifício nunca silencioso: produto com menos peças que na referência aparece em `variacao` e em PRODUTO_SACRIFICADO", () => {
    const fin = rodarObj(ESCASSO({ precoA: 0.05, precoB: 0.2 }), 3, { objetivo: "financeiro" });
    const d = fin.r.diagnostico;
    expect(d.financeiro).toBeDefined();
    const sac = d.financeiro!.variacao.filter((v) => v.pecas < -0.5);
    expect(d.diagnosticos.filter((x) => x.codigo === "PRODUTO_SACRIFICADO")).toHaveLength(sac.length);
    sac.forEach((v) => expect(v.rs).toBeDefined());
  });

  it("padrão desligado: sem objetivo/atingibilidade nenhum campo novo, tupla de 7 componentes", () => {
    const fin = rodarObj(ESCASSO({ precoA: 0.05, precoB: 0.2 }), 3, {});
    // (avaliarPlano de medição usa financeiro; o diagnóstico do planejamento com opções vazias não)
    expect(fin.r.diagnostico.financeiro).toBeUndefined();
    expect(fin.r.diagnostico.avaliacaoFluxo.financeiro).toBeUndefined();
    expect(fin.r.diagnostico.iteracoes[0].tupla).toHaveLength(7);
  });

  it("atingibilidade em SOMBRA: mede e reporta (R$ e metas) mas o plano é idêntico ao da atingibilidade desligada", () => {
    const pools = ESCASSO({ precoA: 0.05, precoB: 0.2 });
    const off = rodarObj(pools, 3, {});
    const sombra = rodarObj(pools, 3, { atingibilidadeModo: "sombra" });
    expect(JSON.stringify(sombra.r.resultado.alocacoes)).toBe(JSON.stringify(off.r.resultado.alocacoes));
    expect(sombra.r.diagnostico.atingibilidade).toBeDefined();
    expect(sombra.r.diagnostico.financeiro).toBeDefined();
    expect(sombra.r.diagnostico.iteracoes[0].tupla).toHaveLength(7); // sombra não altera J
  });

  it("financeiro nunca fica abaixo do R$ que a heurística de peças já alcança (candidato de peças incluído)", () => {
    for (const [pa, pb] of [[0.05, 0.2], [0.2, 0.05], [0.1, 0.1]]) {
      const pools = ESCASSO({ precoA: pa, precoB: pb });
      const pecas = rodarObj(pools, 3, {});
      const fin = rodarObj(pools, 3, { objetivo: "financeiro" });
      expect(fin.av.financeiro!.total.rsProjetadoFechamento).toBeGreaterThanOrEqual(pecas.av.financeiro!.total.rsProjetadoFechamento - 1e-6);
    }
  });

  it("Camada 3: excesso de WIP acima de 2 períodos de capacidade da origem é só PENALIDADE (campo próprio, nunca hard limit) e só existe no objetivo financeiro", () => {
    const pools = [
      pool({ produto: "A", etapa: "A1", op: "opA1", ordem: 1, q: 90000, maquinas: ["a1", "a2"], mu: 1000, valor: 0.2 }),
      pool({ produto: "A", etapa: "A2", op: "opA2", ordem: 2, q: 90000, maquinas: ["a3"], mu: 100, valor: 0.2 }), // consumo lento: o WIP da etapa 1 cresce
    ];
    const fin = rodarObj(pools, 3, { objetivo: "financeiro" });
    const pec = rodarObj(pools, 3, {});
    expect(fin.r.diagnostico.avaliacaoFluxo.totais.excessoWip2p).toBeGreaterThanOrEqual(0);
    expect(pec.r.diagnostico.avaliacaoFluxo.totais.excessoWip2p).toBeUndefined();
    expect(verificarRestricoesDuras(fin.r.entradaFluxo, fin.r.resultado.alocacoes)).toEqual([]); // penalidade, não bloqueio
  });
});
