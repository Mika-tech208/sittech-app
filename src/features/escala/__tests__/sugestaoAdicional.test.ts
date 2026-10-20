import { describe, it, expect } from "vitest";
import { analisarCobertura } from "../cobertura";
import { gerarEscala } from "../gerarEscala";
import { sugerirAdicional } from "../sugestaoAdicional";
import { chavePool } from "../types";
import { cenariosGolden } from "./cenariosGolden";
import { conferirInvariantes } from "./adicionalHelpers";
import { entrada, equipe, pool } from "./helpers";

function minutosSem(e: ReturnType<typeof entrada>): number {
  return analisarCobertura(e, gerarEscala(e)).cobertura.minutosSemPosto;
}

describe("sugestão de adicional — só produto ACABADO, limitada pela etapa de menor capacidade", () => {
  it("produto de 1 etapa: sugere o que a capacidade ociosa absorve e a conta fecha no motor", () => {
    const base = entrada({ funcionarios: equipe(3), pools: [pool({ produto: "pA", op: "opA", q: 300, maquinas: ["mA"] }), pool({ produto: "pB", op: "opB", q: 300, maquinas: ["mB"] })] });
    const s = sugerirAdicional(base);
    const sugA = s.porProduto.find((p) => p.produtoId === "pA")!;
    const sugB = s.porProduto.find((p) => p.produtoId === "pB")!;
    expect(sugA.adicionalSugerido).toBe(300); // 3 períodos livres × 100 peças
    expect(sugB.adicionalSugerido).toBe(300);
    expect(sugA.valorPotencial).toBe(300 * 1);
    expect(s.totalPecas).toBe(600);
    // verificação pelo MESMO motor: com a sugestão aplicada, o adicional alocado é exatamente o sugerido
    const r = gerarEscala(s.entradaComSugestao);
    expect(r.adicionalProduzido["pA|pA-e1"]).toBeCloseTo(300, 9);
    expect(r.adicionalProduzido["pB|pB-e1"]).toBeCloseTo(300, 9);
    expect(minutosSem(s.entradaComSugestao)).toBeLessThan(minutosSem(base));
  });

  it("produto com 2 etapas: a sugestão é a da etapa MENOR, as duas etapas absorvem exatamente o mesmo (sem estoque intermediário)", () => {
    // e1 tem 2 máquinas (m1,m2); e2 só 1 (m3). O adicional de produto acabado é limitado pela e2.
    const base = entrada({
      funcionarios: equipe(4),
      pools: [
        pool({ produto: "P", etapa: "P-e1", op: "opA", ordem: 1, q: 300, maquinas: ["m1", "m2"] }),
        pool({ produto: "P", etapa: "P-e2", op: "opB", ordem: 2, q: 300, maquinas: ["m3"] }),
      ],
    });
    const s = sugerirAdicional(base);
    const sug = s.porProduto[0];
    const absorveria = Object.fromEntries(sug.porEtapa.map((e) => [e.etapaId, e.absorveria]));
    expect(sug.adicionalSugerido).toBeGreaterThan(0);
    expect(sug.adicionalSugerido).toBeLessThanOrEqual(Math.min(...Object.values(absorveria)));
    expect(sug.etapaLimitanteId).toBe(Object.entries(absorveria).sort((a, b) => a[1] - b[1])[0][0]);
    expect(sug.porEtapa.filter((e) => e.limitante)).toHaveLength(1);

    const r = gerarEscala(s.entradaComSugestao);
    expect(r.adicionalProduzido["P|P-e1"]).toBeCloseTo(sug.adicionalSugerido, 9);
    expect(r.adicionalProduzido["P|P-e2"]).toBeCloseTo(sug.adicionalSugerido, 9); // ponto fixo: etapas iguais
    // nunca ultrapassa o teto automaticamente
    Object.values(r.adicionalProduzido).forEach((v) => expect(v).toBeLessThanOrEqual(sug.adicionalSugerido + 1e-6));
  });

  it("produto com etapa SEM máquina selecionada não recebe sugestão (não fecha produto acabado); os demais recebem", () => {
    const base = entrada({
      funcionarios: equipe(4),
      pools: [pool({ produto: "pA", op: "opA", q: 200, maquinas: ["mA"] }), pool({ produto: "pB", op: "opB", q: 200, maquinas: ["mB"] })],
    });
    const s = sugerirAdicional(base, { produtosIncompletos: new Set(["pA"]) });
    expect(s.porProduto.find((p) => p.produtoId === "pA")).toMatchObject({ adicionalSugerido: 0, motivoSemSugestao: "etapa_sem_maquina" });
    expect(s.porProduto.find((p) => p.produtoId === "pB")!.adicionalSugerido).toBeGreaterThan(0);
  });

  it("sem capacidade ociosa não há sugestão", () => {
    const base = entrada({ funcionarios: equipe(2), pools: [1, 2].map((n) => pool({ produto: `p${n}`, op: `op${n}`, q: 1_000_000, maquinas: [`m${n}`] })) });
    const s = sugerirAdicional(base);
    expect(s.totalPecas).toBe(0);
    s.porProduto.forEach((p) => expect(p.motivoSemSugestao).toBe("sem_capacidade_ociosa"));
  });

  it("a sugestão ignora o adicional que já estava programado (calcula sobre o previsto)", () => {
    const base = entrada({ funcionarios: equipe(3), pools: [pool({ produto: "pA", op: "opA", q: 300, maquinas: ["mA"] })] });
    const a = sugerirAdicional(base);
    const b = sugerirAdicional({ ...base, pools: base.pools.map((p) => ({ ...p, adicionalMax: 123 })) });
    expect(b.porProduto[0].adicionalSugerido).toBe(a.porProduto[0].adicionalSugerido);
  });

  it("determinístico", () => {
    const base = cenariosGolden().find((c) => c.nome === "real 2026-10-05 N=16")!.entrada;
    expect(JSON.stringify(sugerirAdicional(base).porProduto)).toBe(JSON.stringify(sugerirAdicional(base).porProduto));
  });
});

describe("sugestão de adicional — semanas reais (previsto preservado, ponto fixo, cobertura melhora)", () => {
  const reais = cenariosGolden().filter((c) => /^real \d{4}-\d\d-\d\d N=1[468]$/.test(c.nome));

  it("15 casos reais", () => expect(reais).toHaveLength(15));

  reais.forEach((c) => {
    it(`${c.nome}: previsto intacto, etapas iguais por produto, cobertura não piora`, () => {
      const s = sugerirAdicional(c.entrada);
      expect(conferirInvariantes(c.entrada, s.entradaComSugestao)).toEqual([]);
      const r = gerarEscala(s.entradaComSugestao);
      s.porProduto.forEach((p) => {
        const pools = c.entrada.pools.filter((x) => x.produtoId === p.produtoId);
        pools.forEach((x) => {
          const absorvido = r.adicionalProduzido[chavePool(x.produtoId, x.etapaId)] ?? 0;
          expect(Math.abs(absorvido - p.adicionalSugerido)).toBeLessThan(1e-6); // fecha produto acabado: todas as etapas iguais
        });
      });
      expect(minutosSem(s.entradaComSugestao)).toBeLessThanOrEqual(minutosSem(c.entrada));
    });
  });
});
