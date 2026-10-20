import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import type { AlocacaoEscala } from "../types";
import { cenariosGolden } from "./cenariosGolden";
import { checarInvariantes, entrada, equipe, pool } from "./helpers";
import { comAdicional, conferirInvariantes, somaPor } from "./adicionalHelpers";

const D1 = "2026-10-19";

describe("carga adicional — o previsto nunca é deslocado", () => {
  it("semanas reais (14/16/18 pessoas) com adicional ilimitado: previsto idêntico, adicional só ocupa ociosos", () => {
    const reais = cenariosGolden().filter((c) => c.nome.startsWith("real ") && !/ausências|recursos|histórico/.test(c.nome));
    expect(reais.length).toBe(15);
    reais.forEach((c) => {
      const erros = conferirInvariantes(c.entrada, comAdicional(c.entrada, () => 1_000_000));
      expect(erros).toEqual([]);
    });
  });

  it("cenários com ausências, recursos indisponíveis e prefixo congelado também preservam o previsto", () => {
    cenariosGolden()
      .filter((c) => /ausências|recursos|congelado|sintético/.test(c.nome))
      .forEach((c) => {
        const erros = conferirInvariantes(c.entrada, comAdicional(c.entrada, () => 50_000));
        expect(erros).toEqual([]);
      });
  });

  it("o adicional realmente absorve ociosidade quando há máquina livre e carga permitida", () => {
    // 4 pessoas, 2 produtos: previsto esgota cedo e as máquinas ficam livres
    const base = entrada({ funcionarios: equipe(4), pools: [pool({ produto: "pA", op: "opA", q: 300, maquinas: ["mA"] }), pool({ produto: "pB", op: "opB", q: 300, maquinas: ["mB"] })] });
    const r0 = gerarEscala(base);
    const ocio0 = r0.alocacoes.filter((a) => !a.maquinaId).length;
    expect(ocio0).toBeGreaterThan(0);
    const adic = comAdicional(base, () => 100_000);
    const r1 = gerarEscala(adic);
    expect(r1.alocacoes.filter((a) => !a.maquinaId).length).toBeLessThan(ocio0);
    expect(Object.keys(r1.adicionalProduzido).length).toBeGreaterThan(0);
  });

  it("teto por pool é respeitado exatamente (250 peças => 250, em lotes parciais)", () => {
    const base = entrada({ funcionarios: equipe(3), pools: [pool({ produto: "pA", op: "opA", q: 100, maquinas: ["mA"], mu: 100 })] });
    const r = gerarEscala(comAdicional(base, () => 250));
    expect(r.adicionalProduzido["pA|pA-e1"]).toBeCloseTo(250, 9);
    const adic = r.alocacoes.filter((a) => (a.pecasAdicional ?? 0) > 0).map((a) => a.pecasAdicional);
    expect(adic.sort((a, b) => (b as number) - (a as number))).toEqual([100, 100, 50]);
  });

  it("o adicional nunca usa máquina fora da Previsão nem ocupa a mesma máquina do previsto no período", () => {
    const base = entrada({
      funcionarios: equipe(5),
      pools: [pool({ produto: "pA", op: "opA", q: 100000, maquinas: ["m1", "m2"] }), pool({ produto: "pB", op: "opB", q: 200, maquinas: ["m3"] })],
    });
    const adic = comAdicional(base, () => 100_000);
    const r = gerarEscala(adic);
    r.alocacoes.filter((a) => a.maquinaId).forEach((a) => expect(["m1", "m2", "m3"]).toContain(a.maquinaId));
    expect(checarInvariantes(adic, r)).toEqual([]); // inclui "máquina com 2 operadores"
  });

  it("prioridade do adicional: maior valor primeiro (depois continuidade/ordem)", () => {
    const base = entrada({
      funcionarios: equipe(1),
      pools: [pool({ produto: "pBarato", op: "opA", q: 100, maquinas: ["mA"], valor: 1 }), pool({ produto: "pCaro", op: "opB", q: 100, maquinas: ["mB"], valor: 50 })],
    });
    // previsto esgota no 1º período; no resto, a única pessoa ociosa vai para o adicional de MAIOR valor
    const r = gerarEscala(comAdicional(base, () => 100_000));
    const adic = r.alocacoes.filter((a) => (a.pecasAdicional ?? 0) > 0);
    expect(adic.length).toBeGreaterThan(0);
    expect(adic[0].produtoId).toBe("pCaro");
  });

  it("determinístico e independente da ordem dos arrays", () => {
    const e = comAdicional(cenariosGolden().find((c) => c.nome === "real 2026-10-19 N=16")!.entrada, () => 40_000);
    const inv = { ...e, funcionarios: [...e.funcionarios].reverse(), pools: [...e.pools].reverse() };
    expect(JSON.stringify(gerarEscala(e).alocacoes)).toBe(JSON.stringify(gerarEscala(e).alocacoes));
    expect(JSON.stringify(gerarEscala(e).alocacoes)).toBe(JSON.stringify(gerarEscala(inv).alocacoes));
  });

  it("regerar a partir de um prefixo congelado (com linhas de adicional) reproduz exatamente o sufixo", () => {
    const e = comAdicional(cenariosGolden().find((c) => c.nome === "real 2026-10-05 N=18")!.entrada, () => 30_000);
    const cheio = gerarEscala(e);
    [7, 13, 22].forEach((corte) => {
      const congeladas = cheio.alocacoes.filter((a) => (e.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? 0) < corte) as AlocacaoEscala[];
      const parcial = gerarEscala({ ...e, aPartirDe: corte, congeladas });
      const sufixo = cheio.alocacoes.filter((a) => (e.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? 0) >= corte);
      expect(JSON.stringify(parcial.alocacoes)).toBe(JSON.stringify(sufixo));
    });
  });
});

describe("carga adicional — 100 cenários aleatórios", () => {
  it("previsto preservado, adicional só em ociosos, tetos respeitados", () => {
    let seed = 777;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const falhas: string[] = [];
    for (let i = 0; i < 100; i++) {
      const nPools = 2 + Math.floor(rnd() * 6);
      const pools = Array.from({ length: nPools }, (_, k) =>
        pool({
          produto: `p${k}`,
          op: `op${Math.floor(rnd() * 4)}`,
          q: Math.round((100 + rnd() * 3000) / 50) * 50,
          maquinas: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => `m${Math.floor(rnd() * 8)}`),
          mu: 50 + Math.floor(rnd() * 100),
          valor: 1 + Math.floor(rnd() * 20),
        })
      );
      const funcs = equipe(2 + Math.floor(rnd() * 12));
      const dias = rnd() < 0.5 ? [D1] : [D1, "2026-10-20"];
      const base = entrada({ funcionarios: funcs, pools, ausencias: rnd() < 0.5 ? [{ funcionarioId: funcs[0].id, data: D1, inicioMin: null, fimMin: null }] : [] }, dias);
      const adic = comAdicional(base, () => (rnd() < 0.3 ? 0 : Math.round(rnd() * 5000)));
      const erros = conferirInvariantes(base, adic);
      if (erros.length) falhas.push(`cenário ${i}: ${erros.slice(0, 2).join("; ")}`);
    }
    expect(falhas).toEqual([]);
  });
});
