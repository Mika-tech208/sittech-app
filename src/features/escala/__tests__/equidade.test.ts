import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import { ContadoresEquidade, agregarHistoricoEquidade } from "../equidade";
import type { AlocacaoEscala, HistoricoEquidadeFuncionario } from "../types";
import { checarInvariantes, doSlot, entrada, equipe, pool } from "./helpers";

const DIAS = (n: number) => Array.from({ length: n }, (_, i) => `2026-11-${String(2 + i).padStart(2, "0")}`);

function hist(id: string, disp: number, ops: Record<string, number> = {}, maqs: Record<string, number> = {}): HistoricoEquidadeFuncionario {
  return { funcionarioId: id, periodosDisponiveis: disp, porOperacao: ops, porMaquina: maqs };
}

function contar(alocs: AlocacaoEscala[], op: string): Map<string, number> {
  const m = new Map<string, number>();
  alocs.filter((a) => a.operacaoId === op).forEach((a) => m.set(a.funcionarioId, (m.get(a.funcionarioId) ?? 0) + 1));
  return m;
}

describe("equidade — fórmula (ContadoresEquidade)", () => {
  it("exposição esperada = total × disponibilidade / Σ disponibilidades (A 100%, B 50%: 30 exposições → 20 e 10)", () => {
    const c = new ContadoresEquidade(["A", "B"], [hist("A", 100, { op: 20 }), hist("B", 50, { op: 10 })]);
    // total = 30; A esperava 30×100/150 = 20; B esperava 10 → desvio 0 para os dois
    expect(c.desvioOperacao("A", "op")).toBeCloseTo(0, 9);
    expect(c.desvioOperacao("B", "op")).toBeCloseTo(0, 9);
  });

  it("quem fez menos que a parcela justa tem desvio negativo; quem fez mais, positivo", () => {
    const c = new ContadoresEquidade(["A", "B"], [hist("A", 100, { op: 10 }), hist("B", 100, { op: 30 })]);
    expect(c.desvioOperacao("A", "op")).toBeCloseTo(-10, 9);
    expect(c.desvioOperacao("B", "op")).toBeCloseTo(10, 9);
  });

  it("quem saiu da equipe não entra nos totais (não dilui a parcela dos atuais)", () => {
    const c = new ContadoresEquidade(["A", "B"], [hist("A", 100, { op: 10 }), hist("B", 100, { op: 10 }), hist("X", 100, { op: 80 })]);
    expect(c.desvioOperacao("A", "op")).toBeCloseTo(0, 9);
  });
});

describe("equidade — histórico derivado da escala gravada", () => {
  it("agrega linhas: sem posto conta como disponibilidade; só posto conta como exposição; ausência (sem linha) não entra", () => {
    const h = agregarHistoricoEquidade([
      { funcionarioId: "b", maquinaId: "m1", operacaoId: "opA" },
      { funcionarioId: "b", maquinaId: null, operacaoId: null },
      { funcionarioId: "a", maquinaId: "m1", operacaoId: "opA" },
      { funcionarioId: "a", maquinaId: "m2", operacaoId: "opA" },
      { funcionarioId: "a", maquinaId: "m3", operacaoId: "opB" },
    ]);
    expect(h.map((x) => x.funcionarioId)).toEqual(["a", "b"]); // ordem estável
    expect(h[0]).toEqual({ funcionarioId: "a", periodosDisponiveis: 3, porOperacao: { opA: 2, opB: 1 }, porMaquina: { m1: 1, m2: 1, m3: 1 } });
    expect(h[1]).toEqual({ funcionarioId: "b", periodosDisponiveis: 2, porOperacao: { opA: 1 }, porMaquina: { m1: 1 } });
  });
});

describe("equidade — comportamento do motor", () => {
  it("1: 4 funcionários igualmente disponíveis, ~40 exposições: distribuição aproximadamente igual", () => {
    const e = entrada(
      { funcionarios: equipe(4), pools: [pool({ produto: "p", op: "opA", q: 1_000_000, maquinas: ["m1"] })] },
      DIAS(7) // 42 períodos, 1 posto por período
    );
    const r = gerarEscala(e);
    expect(checarInvariantes(e, r)).toEqual([]);
    const c = contar(r.alocacoes, "opA");
    const valores = e.funcionarios.map((f) => c.get(f.id) ?? 0);
    expect(valores.reduce((a, b) => a + b, 0)).toBe(42);
    expect(Math.max(...valores) - Math.min(...valores)).toBeLessThanOrEqual(1);
  });

  it("2: funcionário ausente metade do período recebe exposição proporcional à disponibilidade", () => {
    const dias = DIAS(8);
    const ausencias = dias.slice(0, 4).map((data) => ({ funcionarioId: "f04", data, inicioMin: null, fimMin: null }));
    const e = entrada(
      { funcionarios: equipe(4), ausencias, pools: [pool({ produto: "p", op: "opA", q: 1_000_000, maquinas: ["m1"] })] },
      dias // 48 períodos; f04 disponível em 24, os demais em 48
    );
    const r = gerarEscala(e);
    const c = contar(r.alocacoes, "opA");
    const f04 = c.get("f04") ?? 0;
    const outros = ["f01", "f02", "f03"].map((f) => c.get(f) ?? 0);
    // esperado: f04 = 48×24/168 ≈ 6,9 ; demais ≈ 13,7
    expect(f04).toBeGreaterThanOrEqual(6);
    expect(f04).toBeLessThanOrEqual(8);
    outros.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(13);
      expect(v).toBeLessThanOrEqual(15);
    });
    // exposição por período disponível é parecida
    expect(Math.abs(f04 / 24 - outros[0] / 48)).toBeLessThan(0.1);
  });

  it("3: abaixo da exposição esperada => favorecido na próxima atribuição", () => {
    const e = entrada(
      {
        funcionarios: equipe(4),
        pools: [pool({ produto: "p", op: "opA", q: 100000, maquinas: ["m1"] })],
        historicoEquidade: [hist("f01", 100, { opA: 0 }), hist("f02", 100, { opA: 30 }), hist("f03", 100, { opA: 30 }), hist("f04", 100, { opA: 30 })],
      },
      DIAS(1)
    );
    const r = gerarEscala(e);
    expect(doSlot(r.alocacoes, "2026-11-02", "m1").find((a) => a.operacaoId === "opA")?.funcionarioId).toBe("f01");
  });

  it("4: acima da exposição esperada => evitado quando há alternativa equivalente", () => {
    const e = entrada(
      {
        funcionarios: equipe(4),
        pools: [pool({ produto: "p", op: "opA", q: 100000, maquinas: ["m1"] })],
        // sem equidade f01 (desempate por id) seria o escolhido
        historicoEquidade: [hist("f01", 100, { opA: 60 }), hist("f02", 100, { opA: 10 }), hist("f03", 100, { opA: 10 }), hist("f04", 100, { opA: 10 })],
      },
      DIAS(1)
    );
    const r = gerarEscala(e);
    const escolhido = doSlot(r.alocacoes, "2026-11-02", "m1").find((a) => a.operacaoId === "opA")?.funcionarioId;
    expect(escolhido).not.toBe("f01");
    // e f01 segue evitado nos períodos seguintes enquanto estiver acima
    expect(contar(r.alocacoes, "opA").get("f01") ?? 0).toBeLessThan((contar(r.alocacoes, "opA").get("f02") ?? 0) + 1);
  });

  it("5: gargalo vence equidade — o posto crítico é coberto mesmo por quem está acima da parcela", () => {
    const e = entrada(
      {
        funcionarios: equipe(1),
        pools: [
          pool({ produto: "pG", op: "opG", q: 600, maquinas: ["mG"] }), // folga 0 => gargalo
          pool({ produto: "pV", op: "opV", q: 1, maquinas: ["mV"], valor: 1000 }), // sempre com folga: nunca é gargalo
        ],
        // f01 está MUITO acima em opG e MUITO abaixo em opV: a equidade pediria opV
        historicoEquidade: [hist("f01", 100, { opG: 90, opV: 0 })],
      },
      DIAS(1)
    );
    const r = gerarEscala(e);
    r.alocacoes.forEach((a) => expect(a.maquinaId).toBe("mG"));
    expect(r.alocacoes).toHaveLength(6);
  });

  it("6: revezamento vence equidade — ninguém repete a operação em períodos consecutivos havendo alternativa", () => {
    const e = entrada(
      {
        funcionarios: equipe(2),
        pools: [pool({ produto: "pA", op: "opA", q: 100000, maquinas: ["mA"] }), pool({ produto: "pB", op: "opB", q: 100000, maquinas: ["mB"] })],
        // f01 muito abaixo em opA: a equidade o quer em opA TODOS os períodos
        historicoEquidade: [hist("f01", 100, { opA: 0, opB: 50 }), hist("f02", 100, { opA: 50, opB: 0 })],
      },
      DIAS(1)
    );
    const r = gerarEscala(e);
    expect(r.alocacoes.some((a) => a.excecaoRevezamento)).toBe(false);
    ["f01", "f02"].forEach((f) => {
      const ops = ["m1", "m2", "m3", "t1", "t2", "t3"].map((p) => doSlot(r.alocacoes, "2026-11-02", p).find((a) => a.funcionarioId === f)?.operacaoId);
      for (let i = 1; i < ops.length; i++) expect(ops[i]).not.toBe(ops[i - 1]);
    });
  });

  it("7: operação equilibrada, máquina desequilibrada => equidade de máquina desempata", () => {
    const e = entrada(
      {
        funcionarios: equipe(2),
        pools: [pool({ produto: "p", op: "opA", q: 100000, maquinas: ["mA1", "mA2"] })],
        // mesma operação (30 e 30), mas f01 só fez mA1 e f02 só mA2
        historicoEquidade: [hist("f01", 100, { opA: 30 }, { mA1: 30 }), hist("f02", 100, { opA: 30 }, { mA2: 30 })],
      },
      DIAS(1)
    );
    const r = gerarEscala(e);
    const s1 = doSlot(r.alocacoes, "2026-11-02", "m1");
    expect(s1.find((a) => a.funcionarioId === "f01")?.maquinaId).toBe("mA2");
    expect(s1.find((a) => a.funcionarioId === "f02")?.maquinaId).toBe("mA1");
  });

  it("8: alteração manual cria desequilíbrio => as próximas escalas compensam progressivamente", () => {
    // f01 foi (manualmente) 12× em opA contra 4× dos demais
    const historico = [hist("f01", 60, { opA: 12 }), hist("f02", 60, { opA: 4 }), hist("f03", 60, { opA: 4 }), hist("f04", 60, { opA: 4 })];
    const desvioDe = (c: ContadoresEquidade) => Math.abs(c.desvioOperacao("f01", "opA"));
    const antes = desvioDe(new ContadoresEquidade(["f01", "f02", "f03", "f04"], historico));

    const e = entrada(
      {
        funcionarios: equipe(4),
        pools: [pool({ produto: "p", op: "opA", q: 1_000_000, maquinas: ["m1"] }), pool({ produto: "q", op: "opB", q: 1_000_000, maquinas: ["m2"] })],
        historicoEquidade: historico,
      },
      DIAS(2)
    );
    const r = gerarEscala(e);
    const c = contar(r.alocacoes, "opA");
    // nesta escala f01 pega MENOS opA que qualquer outro
    expect(c.get("f01") ?? 0).toBeLessThan(Math.min(c.get("f02") ?? 0, c.get("f03") ?? 0, c.get("f04") ?? 0));

    // e o desvio de f01 encolhe depois dessa escala
    const depois = new ContadoresEquidade(["f01", "f02", "f03", "f04"], historico);
    ["f01", "f02", "f03", "f04"].forEach((f) => {
      depois.registrarPeriodo([], []);
      void f;
    });
    const porPeriodo = new Map<string, AlocacaoEscala[]>();
    r.alocacoes.forEach((a) => {
      const k = `${a.data}|${a.periodoId}`;
      porPeriodo.set(k, [...(porPeriodo.get(k) ?? []), a]);
    });
    porPeriodo.forEach((linhas) =>
      depois.registrarPeriodo(
        linhas.map((a) => a.funcionarioId),
        linhas.filter((a) => a.maquinaId).map((a) => ({ funcionarioId: a.funcionarioId, operacaoId: a.operacaoId as string, maquinaId: a.maquinaId as string }))
      )
    );
    expect(desvioDe(depois)).toBeLessThan(antes);
  });

  it("9: ausência não cria dívida — quem voltou de ausência não é favorecido; quem ficou disponível e ocioso é", () => {
    const base = { funcionarios: equipe(4), pools: [pool({ produto: "p", op: "opA", q: 100000, maquinas: ["m1"] })] };
    // f04 ficou AUSENTE: 0 períodos disponíveis, 0 exposições (dívida zero)
    const ausente = entrada({ ...base, historicoEquidade: [hist("f01", 100, { opA: 25 }), hist("f02", 100, { opA: 25 }), hist("f03", 100, { opA: 25 }), hist("f04", 0)] }, DIAS(1));
    expect(new ContadoresEquidade(["f01", "f02", "f03", "f04"], ausente.historicoEquidade).desvioOperacao("f04", "opA")).toBeCloseTo(0, 9);
    const r1 = gerarEscala(ausente);
    expect(doSlot(r1.alocacoes, "2026-11-02", "m1").find((a) => a.operacaoId === "opA")?.funcionarioId).toBe("f01"); // desempate neutro por id

    // f04 estava DISPONÍVEL mas nunca pegou opA: está abaixo da parcela → favorecido
    const ocioso = entrada({ ...base, historicoEquidade: [hist("f01", 100, { opA: 25 }), hist("f02", 100, { opA: 25 }), hist("f03", 100, { opA: 25 }), hist("f04", 100, { opA: 0 })] }, DIAS(1));
    const r2 = gerarEscala(ocioso);
    expect(doSlot(r2.alocacoes, "2026-11-02", "m1").find((a) => a.operacaoId === "opA")?.funcionarioId).toBe("f04");
  });

  it("10: determinístico — mesma entrada gera a mesma escala (e independe da ordem dos arrays)", () => {
    const mk = (inverter: boolean) => {
      const funcs = equipe(5);
      const historico = [hist("f01", 80, { opA: 9, opB: 2 }, { m1: 5, m2: 4 }), hist("f02", 60, { opA: 3, opB: 8 }), hist("f03", 80, { opA: 5, opB: 5 }), hist("f05", 40, { opB: 1 })];
      const pools = [pool({ produto: "p", op: "opA", q: 100000, maquinas: ["m1", "m2"] }), pool({ produto: "q", op: "opB", q: 100000, maquinas: ["m3"] })];
      return entrada(
        { funcionarios: inverter ? [...funcs].reverse() : funcs, pools: inverter ? [...pools].reverse() : pools, historicoEquidade: inverter ? [...historico].reverse() : historico },
        DIAS(3)
      );
    };
    const a = gerarEscala(mk(false));
    const b = gerarEscala(mk(false));
    const c = gerarEscala(mk(true));
    expect(JSON.stringify(a.alocacoes)).toBe(JSON.stringify(b.alocacoes));
    expect(JSON.stringify(a.alocacoes)).toBe(JSON.stringify(c.alocacoes));
  });
});
