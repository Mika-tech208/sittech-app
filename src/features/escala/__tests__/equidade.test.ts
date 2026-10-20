import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import { ContadoresEquidade, agregarHistoricoEquidade } from "../equidade";
import type { AlocacaoEscala, HistoricoEquidadeFuncionario } from "../types";
import { PERIODOS_REAIS, checarInvariantes, doSlot, entrada, equipe, pool } from "./helpers";

const DIAS = (n: number) => Array.from({ length: n }, (_, i) => `2026-11-${String(2 + i).padStart(2, "0")}`);

// Durações reais dos períodos (minutos): M1/M2 96, M3 91, T1/T2/T3 80
const DURACAO: Record<string, number> = { m1: 96, m2: 96, m3: 91, t1: 80, t2: 80, t3: 80 };
const MIN_DIA = Object.values(DURACAO).reduce((a, b) => a + b, 0); // 523
const MEDIO = 90; // "período de 90 min": só para escrever cenários com contagens redondas

// histórico em MINUTOS. Os números dos cenários são escritos em "períodos de 90 min" (k).
function hist(id: string, disp: number, ops: Record<string, number> = {}, maqs: Record<string, number> = {}, k = MEDIO): HistoricoEquidadeFuncionario {
  const x = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([a, b]) => [a, b * k]));
  return { funcionarioId: id, minutosDisponiveis: disp * k, porOperacao: x(ops), porMaquina: x(maqs) };
}
// histórico já em minutos exatos
function histMin(id: string, minDisp: number, ops: Record<string, number> = {}, maqs: Record<string, number> = {}): HistoricoEquidadeFuncionario {
  return { funcionarioId: id, minutosDisponiveis: minDisp, porOperacao: ops, porMaquina: maqs };
}

function minutosPorPessoa(alocs: AlocacaoEscala[], op: string): Map<string, number> {
  const m = new Map<string, number>();
  alocs.filter((a) => a.operacaoId === op).forEach((a) => m.set(a.funcionarioId, (m.get(a.funcionarioId) ?? 0) + DURACAO[a.periodoId]));
  return m;
}
function contar(alocs: AlocacaoEscala[], op: string): Map<string, number> {
  const m = new Map<string, number>();
  alocs.filter((a) => a.operacaoId === op).forEach((a) => m.set(a.funcionarioId, (m.get(a.funcionarioId) ?? 0) + 1));
  return m;
}

describe("equidade — fórmula em minutos (ContadoresEquidade)", () => {
  it("exposição esperada = total × minutos disponíveis / Σ minutos disponíveis (A 100%, B 50%: 3000 min → 2000 e 1000)", () => {
    const c = new ContadoresEquidade(["A", "B"], [histMin("A", 10000, { op: 2000 }), histMin("B", 5000, { op: 1000 })]);
    expect(c.desvioOperacao("A", "op")).toBeCloseTo(0, 9);
    expect(c.desvioOperacao("B", "op")).toBeCloseTo(0, 9);
  });

  it("quem fez menos que a parcela justa tem desvio negativo; quem fez mais, positivo", () => {
    const c = new ContadoresEquidade(["A", "B"], [histMin("A", 10000, { op: 1000 }), histMin("B", 10000, { op: 3000 })]);
    expect(c.desvioOperacao("A", "op")).toBeCloseTo(-1000, 9);
    expect(c.desvioOperacao("B", "op")).toBeCloseTo(1000, 9);
  });

  it("quem saiu da equipe não entra nos totais (não dilui a parcela dos atuais)", () => {
    const c = new ContadoresEquidade(["A", "B"], [histMin("A", 10000, { op: 1000 }), histMin("B", 10000, { op: 1000 }), histMin("X", 10000, { op: 8000 })]);
    expect(c.desvioOperacao("A", "op")).toBeCloseTo(0, 9);
  });

  it("registrarPeriodo soma MINUTOS: um M1 (96) pesa mais que um T1 (80)", () => {
    const c = new ContadoresEquidade(["A", "B"]);
    // A fez 1 M1 de opX; B fez 1 T1 de opX; ambos estavam disponíveis nos dois períodos
    c.registrarPeriodo(["A", "B"], [{ funcionarioId: "A", operacaoId: "opX", maquinaId: "m1" }], 96);
    c.registrarPeriodo(["A", "B"], [{ funcionarioId: "B", operacaoId: "opX", maquinaId: "m1" }], 80);
    // total opX = 176; disponibilidade igual (176 cada) → esperado 88 cada
    expect(c.desvioOperacao("A", "opX")).toBeCloseTo(96 - 88, 9); // +8
    expect(c.desvioOperacao("B", "opX")).toBeCloseTo(80 - 88, 9); // −8
  });
});

describe("equidade — o tempo conta, não a contagem de períodos", () => {
  it("10 períodos M1 NÃO são equivalentes a 10 períodos T1 (960 min ≠ 800 min)", () => {
    // f01: 10×M1 = 960 min de opA ; f02: 10×T1 = 800 min ; f03/f04: 880 min. Mesma disponibilidade (2000 min).
    const historico = [
      histMin("f01", 2000, { opA: 10 * 96 }),
      histMin("f02", 2000, { opA: 10 * 80 }),
      histMin("f03", 2000, { opA: 880 }),
      histMin("f04", 2000, { opA: 880 }),
    ];
    const c = new ContadoresEquidade(["f01", "f02", "f03", "f04"], historico);
    // total = 3520 → esperado 880 para cada um
    expect(c.desvioOperacao("f01", "opA")).toBeCloseTo(80, 9);
    expect(c.desvioOperacao("f02", "opA")).toBeCloseTo(-80, 9);

    // Contando períodos os dois teriam 10 e empatariam (e f01 venceria pelo desempate por id);
    // medindo minutos f02 está ABAIXO da parcela e é o favorecido.
    const e = entrada(
      { funcionarios: equipe(4), pools: [pool({ produto: "p", op: "opA", q: 100000, maquinas: ["m1"] })], historicoEquidade: historico },
      DIAS(1)
    );
    const r = gerarEscala(e);
    expect(doSlot(r.alocacoes, "2026-11-02", "m1").find((a) => a.operacaoId === "opA")?.funcionarioId).toBe("f02");
  });

  it("6 períodos T1 (480 min) equivalem a 5 períodos M1 (480 min): disponibilidade e exposição em minutos", () => {
    const c = new ContadoresEquidade(["A", "B"], [
      histMin("A", 5 * 96, { op: 5 * 96 }), // 5 M1
      histMin("B", 6 * 80, { op: 6 * 80 }), // 6 T1
    ]);
    expect(c.desvioOperacao("A", "op")).toBeCloseTo(0, 9);
    expect(c.desvioOperacao("B", "op")).toBeCloseTo(0, 9);
  });

  it("agregação do histórico: cada linha vale os minutos do período; sem posto conta como disponibilidade; ausência (sem linha) não entra", () => {
    const h = agregarHistoricoEquidade([
      { funcionarioId: "b", maquinaId: "m1", operacaoId: "opA", minutos: 96 }, // M1
      { funcionarioId: "b", maquinaId: null, operacaoId: null, minutos: 80 }, // T1 sem posto
      { funcionarioId: "a", maquinaId: "m1", operacaoId: "opA", minutos: 96 },
      { funcionarioId: "a", maquinaId: "m2", operacaoId: "opA", minutos: 91 }, // M3
      { funcionarioId: "a", maquinaId: "m3", operacaoId: "opB", minutos: 80 },
    ]);
    expect(h.map((x) => x.funcionarioId)).toEqual(["a", "b"]); // ordem estável
    expect(h[0]).toEqual({ funcionarioId: "a", minutosDisponiveis: 267, porOperacao: { opA: 187, opB: 80 }, porMaquina: { m1: 96, m2: 91, m3: 80 } });
    expect(h[1]).toEqual({ funcionarioId: "b", minutosDisponiveis: 176, porOperacao: { opA: 96 }, porMaquina: { m1: 96 } });
  });

  it("na geração, a exposição acumulada é medida em minutos (um dia: duas pessoas dividem 523 min com diferença ≤ 16 min)", () => {
    const e = entrada({ funcionarios: equipe(2), pools: [pool({ produto: "p", op: "opA", q: 100000, maquinas: ["m1"] }), pool({ produto: "q", op: "opB", q: 100000, maquinas: ["m2"] })] }, DIAS(1));
    const r = gerarEscala(e);
    const a = minutosPorPessoa(r.alocacoes, "opA");
    expect(Math.abs((a.get("f01") ?? 0) - (a.get("f02") ?? 0))).toBeLessThanOrEqual(16);
    expect((a.get("f01") ?? 0) + (a.get("f02") ?? 0)).toBe(MIN_DIA);
  });
});

describe("equidade — comportamento do motor", () => {
  it("1: 4 funcionários igualmente disponíveis, ~40 exposições: distribuição em minutos aproximadamente igual", () => {
    const e = entrada(
      { funcionarios: equipe(4), pools: [pool({ produto: "p", op: "opA", q: 1_000_000, maquinas: ["m1"] })] },
      DIAS(7) // 42 períodos, 1 posto por período
    );
    const r = gerarEscala(e);
    expect(checarInvariantes(e, r)).toEqual([]);
    const min = minutosPorPessoa(r.alocacoes, "opA");
    const valores = e.funcionarios.map((f) => min.get(f.id) ?? 0);
    expect(valores.reduce((a, b) => a + b, 0)).toBe(7 * MIN_DIA);
    expect(Math.max(...valores) - Math.min(...valores)).toBeLessThanOrEqual(96); // no máximo um período M1
  });

  it("2: funcionário ausente metade do período recebe exposição proporcional aos MINUTOS disponíveis", () => {
    const dias = DIAS(8);
    const ausencias = dias.slice(0, 4).map((data) => ({ funcionarioId: "f04", data, inicioMin: null, fimMin: null }));
    const e = entrada(
      { funcionarios: equipe(4), ausencias, pools: [pool({ produto: "p", op: "opA", q: 1_000_000, maquinas: ["m1"] })] },
      dias // f04 disponível em 4 dias (2092 min), os demais em 8 (4184 min)
    );
    const r = gerarEscala(e);
    const min = minutosPorPessoa(r.alocacoes, "opA");
    const total = 8 * MIN_DIA;
    const esperadoF04 = (total * 4 * MIN_DIA) / (3 * 8 * MIN_DIA + 4 * MIN_DIA);
    const esperadoOutro = (total * 8 * MIN_DIA) / (3 * 8 * MIN_DIA + 4 * MIN_DIA);
    expect(Math.abs((min.get("f04") ?? 0) - esperadoF04)).toBeLessThanOrEqual(96);
    ["f01", "f02", "f03"].forEach((f) => expect(Math.abs((min.get(f) ?? 0) - esperadoOutro)).toBeLessThanOrEqual(96));
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
    // f01 foi (manualmente) 12× em opA contra 4× dos demais (períodos de 90 min)
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
    const porPeriodo = new Map<string, AlocacaoEscala[]>();
    r.alocacoes.forEach((a) => {
      const k = `${a.data}|${a.periodoId}`;
      porPeriodo.set(k, [...(porPeriodo.get(k) ?? []), a]);
    });
    porPeriodo.forEach((linhas) =>
      depois.registrarPeriodo(
        linhas.map((a) => a.funcionarioId),
        linhas.filter((a) => a.maquinaId).map((a) => ({ funcionarioId: a.funcionarioId, operacaoId: a.operacaoId as string, maquinaId: a.maquinaId as string })),
        DURACAO[linhas[0].periodoId]
      )
    );
    expect(desvioDe(depois)).toBeLessThan(antes);
  });

  it("9: ausência não cria dívida — quem voltou de ausência não é favorecido; quem ficou disponível e ocioso é", () => {
    const base = { funcionarios: equipe(4), pools: [pool({ produto: "p", op: "opA", q: 100000, maquinas: ["m1"] })] };
    // f04 ficou AUSENTE: 0 minutos disponíveis, 0 exposição (dívida zero)
    const ausente = entrada({ ...base, historicoEquidade: [hist("f01", 100, { opA: 25 }), hist("f02", 100, { opA: 25 }), hist("f03", 100, { opA: 25 }), hist("f04", 0)] }, DIAS(1));
    expect(new ContadoresEquidade(["f01", "f02", "f03", "f04"], ausente.historicoEquidade).desvioOperacao("f04", "opA")).toBeCloseTo(0, 9);
    const r1 = gerarEscala(ausente);
    expect(doSlot(r1.alocacoes, "2026-11-02", "m1").find((a) => a.operacaoId === "opA")?.funcionarioId).toBe("f01"); // desempate neutro por id

    // f04 estava DISPONÍVEL (sem posto) mas nunca pegou opA: está abaixo da parcela → favorecido
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

// guarda: os horários de teste são os reais da fábrica
describe("durações usadas nos testes", () => {
  it("M1/M2 = 96, M3 = 91, T1/T2/T3 = 80 minutos", () => {
    const dur = Object.fromEntries(PERIODOS_REAIS.map((p) => {
      const [h1, m1] = p.inicio.split(":").map(Number);
      const [h2, m2] = p.fim.split(":").map(Number);
      return [p.id, h2 * 60 + m2 - (h1 * 60 + m1)];
    }));
    expect(dur).toEqual(DURACAO);
  });
});
