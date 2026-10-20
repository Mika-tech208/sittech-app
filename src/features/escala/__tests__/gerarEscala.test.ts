import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import { epochMsNoFuso } from "../tempo";
import { AVISO_PRIMEIRA_GERACAO, MOTIVO_DEMANDA_ESGOTADA, MOTIVO_JA_COBERTA, MOTIVO_POSTOS_OCUPADOS, MOTIVO_RECURSOS_INDISPONIVEIS } from "../types";
import { checarInvariantes, dePessoa, doSlot, entrada, equipe, metasUniformes, pool, slotsDe } from "./helpers";

const D1 = "2026-10-19";
const D2 = "2026-10-20";

describe("A/B/C — compactação e prioridade", () => {
  it("A: 4 funcionários, 4 postos: todos escalados em todos os slots, sem exceção", () => {
    const e = entrada({
      funcionarios: equipe(4),
      pools: [1, 2, 3, 4].map((n) => pool({ produto: `p${n}`, op: `op${n}`, q: 100000, maquinas: [`m${n}`] })),
    });
    const r = gerarEscala(e);
    expect(r.alocacoes).toHaveLength(24);
    expect(r.alocacoes.every((a) => a.maquinaId !== null)).toBe(true);
    expect(r.alocacoes.some((a) => a.excecaoRevezamento)).toBe(false);
    expect(checarInvariantes(e, r)).toEqual([]);
  });

  it("B: 6 funcionários, 4 postos: 2 sem posto por slot, com motivo explícito e alerta de subcarga", () => {
    const e = entrada({
      funcionarios: equipe(6),
      pools: [1, 2, 3, 4].map((n) => pool({ produto: `p${n}`, op: `op${n}`, q: 100000, maquinas: [`m${n}`] })),
    });
    const r = gerarEscala(e);
    const semPosto = r.alocacoes.filter((a) => a.maquinaId === null);
    expect(semPosto).toHaveLength(12);
    expect(semPosto.every((a) => a.motivoSemPosto === MOTIVO_POSTOS_OCUPADOS)).toBe(true);
    expect(r.alertas.filter((a) => a.tipo === "subcarga_previsao")).toHaveLength(6);
    expect(checarInvariantes(e, r)).toEqual([]);
  });

  it("C: 3 funcionários, 5 postos: gargalo primeiro, depois menor folga", () => {
    // capacidade por pool = 600 (6 slots × 100). folga = 600 − Q.
    const qs: Record<string, number> = { G: 600, A: 300, B: 400, C: 500, D: 550 };
    const e = entrada({
      funcionarios: equipe(3),
      pools: Object.entries(qs).map(([n, q], i) => pool({ produto: `p${n}`, op: `op${i}`, q, maquinas: [`m${n}`] })),
    });
    const r = gerarEscala(e);
    const s1 = doSlot(r.alocacoes, D1, "m1").map((a) => a.maquinaId).sort();
    expect(s1).toEqual(["mC", "mD", "mG"]);
    expect(checarInvariantes(e, r)).toEqual([]);
  });

  it("gargalo (folga<=0) vence maior valor", () => {
    const e = entrada({
      funcionarios: equipe(1),
      pools: [
        pool({ produto: "pG", op: "A", q: 600, maquinas: ["mG"], valor: 1 }),
        pool({ produto: "pV", op: "B", q: 100, maquinas: ["mV"], valor: 1000 }),
      ],
    });
    const r = gerarEscala(e);
    expect(doSlot(r.alocacoes, D1, "m1")[0].maquinaId).toBe("mG");
  });

  it("valor desempata quando a folga é igual", () => {
    const e = entrada({
      funcionarios: equipe(1),
      pools: [
        pool({ produto: "pA", op: "A", q: 300, maquinas: ["mA"], valor: 1 }),
        pool({ produto: "pB", op: "B", q: 300, maquinas: ["mB"], valor: 5 }),
      ],
    });
    expect(doSlot(gerarEscala(e).alocacoes, D1, "m1")[0].maquinaId).toBe("mB");
  });

  it("ordem da etapa desempata depois de folga, valor e continuidade", () => {
    const e = entrada({
      funcionarios: equipe(1),
      pools: [
        pool({ produto: "p", etapa: "p-e2", ordem: 2, op: "B", q: 300, maquinas: ["m2"] }),
        pool({ produto: "p", etapa: "p-e1", ordem: 1, op: "A", q: 300, maquinas: ["m1"] }),
      ],
    });
    expect(doSlot(gerarEscala(e).alocacoes, D1, "m1")[0].maquinaId).toBe("m1");
  });

  it("continuidade do produto na máquina é preferida", () => {
    const base = {
      funcionarios: equipe(1),
      pools: [
        pool({ produto: "a", etapa: "a-e1", op: "A", q: 600, maquinas: ["m1"] }),
        pool({ produto: "b", etapa: "b-e1", op: "B", q: 600, maquinas: ["m1"] }),
      ],
    };
    const sem = gerarEscala(entrada(base));
    expect(doSlot(sem.alocacoes, D1, "m1")[0].produtoId).toBe("a"); // sem histórico: ordem por id
    const congelada = [{
      data: D1, periodoId: "m1", funcionarioId: "f01", maquinaId: "m1", produtoId: "b", etapaId: "b-e1", operacaoId: "B", pecas: 0, // 0: não altera a folga, isola o efeito da continuidade
      motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null,
    }];
    const com = gerarEscala(entrada({ ...base, aPartirDe: 1, congeladas: congelada }));
    expect(doSlot(com.alocacoes, D1, "m2")[0].produtoId).toBe("b");
  });
});

describe("D/E/F/G — rotação por operacao_id da etapa", () => {
  it("D: pessoa não repete a operação em períodos consecutivos quando há alternativa", () => {
    const e = entrada({
      funcionarios: equipe(2),
      pools: [pool({ produto: "pa", op: "A", q: 100000, maquinas: ["mA"] }), pool({ produto: "pb", op: "B", q: 100000, maquinas: ["mB"] })],
    });
    const r = gerarEscala(e);
    ["f01", "f02"].forEach((f) => {
      const ops = dePessoa(r.alocacoes, f).map((a) => a.operacaoId);
      for (let i = 1; i < ops.length; i++) expect(ops[i]).not.toBe(ops[i - 1]);
    });
    expect(r.alocacoes.some((a) => a.excecaoRevezamento)).toBe(false);
  });

  it("E: repetição inevitável vira exceção registrada com motivo", () => {
    const e = entrada({
      funcionarios: equipe(2),
      pools: [pool({ produto: "p1", op: "A", q: 100000, maquinas: ["m1"] }), pool({ produto: "p2", op: "A", q: 100000, maquinas: ["m2"] })],
      nomesOperacao: { A: "Rosquear" },
    });
    const r = gerarEscala(e);
    const excecoes = r.alocacoes.filter((a) => a.excecaoRevezamento);
    expect(excecoes).toHaveLength(10); // 5 slots × 2 pessoas (todos menos o primeiro)
    expect(doSlot(r.alocacoes, D1, "m1").some((a) => a.excecaoRevezamento)).toBe(false);
    expect(excecoes[0].motivoExcecao).toMatch(/Repetição inevitável da operação "Rosquear"/);
  });

  it("F: M3 -> T1 continua valendo (exceção em T1) e T3 -> M1 do dia seguinte reseta", () => {
    const e = entrada({
      funcionarios: equipe(1),
      pools: [pool({ produto: "p1", op: "A", q: 100000, maquinas: ["m1"] })],
    }, [D1, D2]);
    const r = gerarEscala(e);
    const exc = (d: string, p: string) => doSlot(r.alocacoes, d, p)[0].excecaoRevezamento;
    expect(exc(D1, "m1")).toBe(false);
    expect(exc(D1, "m2")).toBe(true);
    expect(exc(D1, "t1")).toBe(true); // M3 -> T1 conta
    expect(exc(D1, "t3")).toBe(true);
    expect(exc(D2, "m1")).toBe(false); // reset
    expect(exc(D2, "m2")).toBe(true);
  });

  it("G: Rosquear e Rosquear + Parafusar são operações diferentes e podem ser consecutivas", () => {
    const e = entrada({
      funcionarios: equipe(1),
      pools: [
        pool({ produto: "px", op: "rosquear", q: 100, maquinas: ["mx"], valor: 10 }),
        pool({ produto: "py", op: "rosquear_parafusar", q: 100, maquinas: ["my"], valor: 1 }),
      ],
    });
    const r = gerarEscala(e);
    expect(doSlot(r.alocacoes, D1, "m1")[0].maquinaId).toBe("mx");
    expect(doSlot(r.alocacoes, D1, "m2")[0].maquinaId).toBe("my");
    expect(r.alocacoes.some((a) => a.excecaoRevezamento)).toBe(false);
  });

  it("H: gargalo vence revezamento — cobre o gargalo e registra a exceção", () => {
    const e = entrada({
      funcionarios: equipe(2),
      pools: [
        pool({ produto: "g1", op: "A", q: 600, maquinas: ["mg1"] }),
        pool({ produto: "g2", op: "A", q: 600, maquinas: ["mg2"] }),
        pool({ produto: "b", op: "B", q: 100, maquinas: ["mb"] }),
      ],
    });
    const r = gerarEscala(e);
    expect(r.alocacoes.some((a) => a.maquinaId === "mb")).toBe(false);
    const s2 = doSlot(r.alocacoes, D1, "m2");
    expect(s2.every((a) => a.excecaoRevezamento)).toBe(true);
    expect(s2[0].motivoExcecao).toMatch(/gargalo vence revezamento/);
  });
});

describe("Ausência, congelamento e indisponibilidade", () => {
  it("I: qualquer sobreposição torna o funcionário indisponível no período inteiro (T2 14:20–15:40, saída 15:00)", () => {
    const e = entrada({
      funcionarios: equipe(3),
      pools: [1, 2, 3].map((n) => pool({ produto: `p${n}`, op: `op${n}`, q: 100000, maquinas: [`m${n}`] })),
      ausencias: [
        { funcionarioId: "f01", data: D1, inicioMin: 15 * 60, fimMin: 17 * 60 },
        { funcionarioId: "f02", data: D1, inicioMin: 15 * 60 + 40, fimMin: 17 * 60 }, // só encosta no fim do T2
        { funcionarioId: "f03", data: D2, inicioMin: null, fimMin: null },
      ],
    }, [D1, D2]);
    const r = gerarEscala(e);
    const t = (f: string) => dePessoa(r.alocacoes, f).filter((a) => a.data === D1).map((a) => a.periodoId);
    expect(t("f01")).toEqual(["m1", "m2", "m3", "t1"]); // sai do T2 inteiro e do T3
    expect(t("f02")).toEqual(["m1", "m2", "m3", "t1", "t2"]); // T2 mantido (encostar não é sobrepor)
    expect(dePessoa(r.alocacoes, "f03").filter((a) => a.data === D2)).toHaveLength(0);
    expect(checarInvariantes(e, r)).toEqual([]);
  });

  it("J: regerar a partir de um prefixo congelado reproduz exatamente o sufixo e só altera períodos futuros", () => {
    const base = {
      funcionarios: equipe(5),
      pools: [
        pool({ produto: "p1", op: "A", q: 900, maquinas: ["m1", "m2"], valor: 3 }),
        pool({ produto: "p2", op: "B", q: 700, maquinas: ["m3"], valor: 2 }),
        pool({ produto: "p3", op: "A", q: 2000, maquinas: ["m4", "m5"], valor: 1 }),
        pool({ produto: "p4", op: "C", q: 800, maquinas: ["m6"], valor: 4 }),
      ],
      ausencias: [{ funcionarioId: "f02", data: D1, inicioMin: 10 * 60, fimMin: 12 * 60 }],
      indisponibilidades: [{ maquinaId: "m6", desdeMs: epochMsNoFuso(D1, "13:00"), liberadaEmMs: epochMsNoFuso(D2, "08:00") }],
    };
    const completa = gerarEscala(entrada(base, [D1, D2]));
    for (const corte of [1, 3, 6, 8]) {
      const e2 = entrada({ ...base, aPartirDe: corte, congeladas: completa.alocacoes.filter((a) => slotsDe([D1, D2]).findIndex((s) => s.data === a.data && s.periodoId === a.periodoId) < corte) }, [D1, D2]);
      const parcial = gerarEscala(e2);
      const sufixo = completa.alocacoes.filter((a) => slotsDe([D1, D2]).findIndex((s) => s.data === a.data && s.periodoId === a.periodoId) >= corte);
      expect(parcial.alocacoes).toEqual(sufixo);
    }
  });

  it("K: bloqueio vale para os períodos futuros e a liberação volta no próximo período não iniciado", () => {
    const e = entrada({
      funcionarios: equipe(2),
      pools: [pool({ produto: "p", op: "A", q: 100000, maquinas: ["m1", "m2"] })],
      indisponibilidades: [{ maquinaId: "m1", desdeMs: epochMsNoFuso(D1, "13:00"), liberadaEmMs: epochMsNoFuso(D1, "15:40") }],
    });
    const r = gerarEscala(e);
    const usa = (p: string) => doSlot(r.alocacoes, D1, p).map((a) => a.maquinaId).filter(Boolean);
    expect(usa("m3")).toContain("m1");
    expect(usa("t1")).not.toContain("m1");
    expect(usa("t2")).not.toContain("m1");
    expect(usa("t3")).toContain("m1"); // liberada exatamente no início do T3: volta nele
  });

  it("indisponibilidade da Previsão (semana inteira) nunca recebe operador", () => {
    const e = entrada({
      funcionarios: equipe(2),
      pools: [pool({ produto: "p", op: "A", q: 100000, maquinas: ["m1", "m2"] })],
      maquinasIndisponiveisPrevisao: ["m2"],
    });
    const r = gerarEscala(e);
    expect(r.alocacoes.some((a) => a.maquinaId === "m2")).toBe(false);
    expect(r.alocacoes.filter((a) => a.maquinaId === null).every((a) => a.motivoSemPosto === MOTIVO_POSTOS_OCUPADOS)).toBe(true);
  });

  it("todas as máquinas do pool indisponíveis: sem posto com motivo equivalente", () => {
    const e = entrada({
      funcionarios: equipe(1),
      pools: [pool({ produto: "p", op: "A", q: 1000, maquinas: ["m1"] })],
      maquinasIndisponiveisPrevisao: ["m1"],
    });
    const r = gerarEscala(e);
    expect(r.alocacoes.every((a) => a.maquinaId === null && a.motivoSemPosto === MOTIVO_RECURSOS_INDISPONIVEIS)).toBe(true);
    expect(r.alertas.some((a) => a.tipo === "demanda_nao_atendida")).toBe(true);
  });

  it("R: sem funcionários disponíveis gera alerta e nenhuma linha", () => {
    const e = entrada({
      funcionarios: equipe(1),
      pools: [pool({ produto: "p", op: "A", q: 1000, maquinas: ["m1"] })],
      ausencias: [{ funcionarioId: "f01", data: D1, inicioMin: null, fimMin: null }],
    });
    const r = gerarEscala(e);
    expect(r.alocacoes).toHaveLength(0);
    expect(r.alertas.filter((a) => a.tipo === "sem_funcionarios")).toHaveLength(6);
  });
});

describe("Demanda em peças", () => {
  it("L: demanda esgotada — crédito exato, sem excedente e motivo 'Demanda da Previsão esgotada'", () => {
    const e = entrada({
      funcionarios: equipe(2),
      pools: [pool({ produto: "p", op: "A", q: 250, maquinas: ["m1"] })],
    });
    const r = gerarEscala(e);
    const pecas = r.alocacoes.filter((a) => a.maquinaId).map((a) => a.pecas);
    expect(pecas).toEqual([100, 100, 50]);
    expect(r.alocacoes.filter((a) => a.periodoId === "t1").every((a) => a.motivoSemPosto === MOTIVO_DEMANDA_ESGOTADA)).toBe(true);
    expect(Object.keys(r.pecasRestantes)).toHaveLength(0);
    expect(checarInvariantes(e, r)).toEqual([]);
  });

  it("M: crédito usa a meta do período específico (M e T diferentes)", () => {
    const metas = { m1: 100, m2: 100, m3: 90, t1: 80, t2: 80, t3: 80 };
    const e = entrada({ funcionarios: equipe(1), pools: [pool({ produto: "p", op: "A", q: 100000, maquinas: ["m1"], metas })] });
    const r = gerarEscala(e);
    expect(r.alocacoes.map((a) => a.pecas)).toEqual([100, 100, 90, 80, 80, 80]);
  });

  it("N: guarda do pool — não escala máquinas além do necessário (sem excedente)", () => {
    const e = entrada({
      funcionarios: equipe(3),
      pools: [pool({ produto: "p", op: "A", q: 150, maquinas: ["m1", "m2", "m3"] })],
    });
    const r = gerarEscala(e);
    const s1 = doSlot(r.alocacoes, D1, "m1");
    expect(s1.filter((a) => a.maquinaId)).toHaveLength(2);
    expect(s1.filter((a) => a.maquinaId).map((a) => a.pecas).sort((x, y) => x - y)).toEqual([50, 100]);
    expect(s1.find((a) => !a.maquinaId)?.motivoSemPosto).toBe(MOTIVO_JA_COBERTA);
    expect(checarInvariantes(e, r)).toEqual([]);
  });

  it("capacidade menor que a demanda: sobra reportada como demanda não atendida", () => {
    const e = entrada({ funcionarios: equipe(1), pools: [pool({ produto: "p", op: "A", q: 1000, maquinas: ["m1"] })] });
    const r = gerarEscala(e);
    expect(r.pecasRestantes["p|p-e1"]).toBe(400);
    expect(r.alertas.find((a) => a.tipo === "demanda_nao_atendida")?.pecas).toBe(400);
  });

  it("W: F1 — etapa seguinte mais rápida gera alerta de risco de falta de material (sem bloquear)", () => {
    const e = entrada({
      funcionarios: equipe(2),
      pools: [
        pool({ produto: "p", etapa: "p-e1", ordem: 1, op: "A", q: 1000, maquinas: ["m1"], mu: 100 }),
        pool({ produto: "p", etapa: "p-e2", ordem: 2, op: "B", q: 1000, maquinas: ["m2"], mu: 500 }),
      ],
    });
    const r = gerarEscala(e);
    const alerta = r.alertas.find((a) => a.tipo === "risco_falta_material");
    expect(alerta?.periodoId).toBe("m1");
    expect(doSlot(r.alocacoes, D1, "m1").every((a) => a.maquinaId !== null)).toBe(true);
  });
});

describe("Estado, determinismo e desempenho", () => {
  it("Q: aviso de primeira geração com a semana em andamento", () => {
    const base = { funcionarios: equipe(1), pools: [pool({ produto: "p", op: "A", q: 1000, maquinas: ["m1"] })] };
    expect(gerarEscala(entrada({ ...base, aPartirDe: 3 })).primeiraGeracaoComSemanaEmAndamento).toBe(true);
    expect(gerarEscala(entrada({ ...base, aPartirDe: 0 })).primeiraGeracaoComSemanaEmAndamento).toBe(false);
    expect(AVISO_PRIMEIRA_GERACAO).toMatch(/não desconta produção realizada/);
  });

  it("a demanda semanal é tratada como restante na primeira geração no meio da semana", () => {
    const base = { funcionarios: equipe(1), pools: [pool({ produto: "p", op: "A", q: 250, maquinas: ["m1"] })] };
    const r = gerarEscala(entrada({ ...base, aPartirDe: 3 }));
    expect(r.alocacoes.filter((a) => a.maquinaId).map((a) => a.pecas)).toEqual([100, 100, 50]);
  });

  it("P: determinístico e independente da ordem dos arrays de entrada", () => {
    const pools = [
      pool({ produto: "p1", op: "A", q: 900, maquinas: ["m1", "m2"], valor: 3 }),
      pool({ produto: "p2", op: "B", q: 700, maquinas: ["m3"], valor: 2 }),
      pool({ produto: "p3", op: "A", q: 2000, maquinas: ["m4", "m5"], valor: 1 }),
    ];
    const func = equipe(4);
    const a = gerarEscala(entrada({ pools, funcionarios: func }, [D1, D2]));
    const b = gerarEscala(entrada({ pools: [...pools].reverse().map((p) => ({ ...p, maquinasIds: [...p.maquinasIds].reverse() })), funcionarios: [...func].reverse() }, [D1, D2]));
    expect(b.alocacoes).toEqual(a.alocacoes);
    expect(gerarEscala(entrada({ pools, funcionarios: func }, [D1, D2])).alocacoes).toEqual(a.alocacoes);
  });

  it("trocas manuais só influenciam o desempate (preferência suave) — nunca a cobertura", () => {
    const base = {
      funcionarios: equipe(2),
      pools: [pool({ produto: "pa", op: "A", q: 100000, maquinas: ["mA"] }), pool({ produto: "pb", op: "B", q: 100000, maquinas: ["mB"] })],
    };
    const livre = gerarEscala(entrada(base));
    const atuais = livre.alocacoes.map((a) => ({ ...a }));
    const refeita = gerarEscala(entrada({ ...base, trocasManuais: atuais }));
    expect(refeita.alocacoes).toEqual(livre.alocacoes);
  });

  it("Y: desempenho — 18 funcionários, 21 máquinas, 29 pools, semana de 5 dias", () => {
    const maquinas = Array.from({ length: 21 }, (_, i) => `m${String(i + 1).padStart(2, "0")}`);
    const pools = Array.from({ length: 29 }, (_, i) =>
      pool({ produto: `p${Math.floor(i / 3)}`, etapa: `e${i}`, ordem: (i % 3) + 1, op: `op${i % 7}`, q: 1500 + i * 120, maquinas: [maquinas[i % 21], maquinas[(i + 5) % 21]], mu: 70 + (i % 5) * 10, valor: 0.2 + (i % 4) * 0.3 })
    );
    const dias = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
    const e = entrada({ pools, funcionarios: equipe(18) }, dias);
    const t0 = Date.now();
    const r = gerarEscala(e);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(500);
    expect(r.alocacoes).toHaveLength(18 * 30);
    expect(checarInvariantes(e, r)).toEqual([]);
  });
});

describe("Propriedades (cenários aleatórios com semente)", () => {
  function rng(seed: number) {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  }

  it("100 cenários: invariantes duras sempre válidas e regeração a partir de qualquer corte reproduz o sufixo", () => {
    const rand = rng(2026);
    const pick = (n: number) => Math.floor(rand() * n);
    for (let k = 0; k < 100; k++) {
      const nMaq = 3 + pick(8);
      const maquinas = Array.from({ length: nMaq }, (_, i) => `m${i}`);
      const nPools = 2 + pick(6);
      const pools = Array.from({ length: nPools }, (_, i) => {
        const ms = [...new Set([maquinas[pick(nMaq)], maquinas[pick(nMaq)]])];
        return pool({ produto: `p${i}`, op: `op${pick(4)}`, q: 100 + pick(1800), maquinas: ms, mu: 50 + pick(100), valor: 0.5 + rand() * 3 });
      });
      const nFunc = 1 + pick(9);
      const dias = pick(2) === 0 ? [D1] : [D1, D2];
      const ausencias = Array.from({ length: pick(3) }, () => {
        const ini = (7 + pick(9)) * 60;
        return { funcionarioId: `f${String(1 + pick(nFunc)).padStart(2, "0")}`, data: dias[pick(dias.length)], inicioMin: ini, fimMin: ini + 30 + pick(240) };
      });
      const indisp = pick(2) === 0 ? [] : [{ maquinaId: maquinas[pick(nMaq)], desdeMs: epochMsNoFuso(D1, "10:00"), liberadaEmMs: pick(2) === 0 ? null : epochMsNoFuso(D1, "15:00") }];
      const base = { pools, funcionarios: equipe(nFunc), ausencias, indisponibilidades: indisp, maquinasIndisponiveisPrevisao: pick(3) === 0 ? [maquinas[pick(nMaq)]] : [] };
      const e = entrada(base, dias);
      const completa = gerarEscala(e);
      expect(checarInvariantes(e, completa)).toEqual([]);

      const slots = slotsDe(dias);
      const idx = (a: { data: string; periodoId: string }) => slots.findIndex((s) => s.data === a.data && s.periodoId === a.periodoId);
      const corte = pick(slots.length);
      const parcial = gerarEscala(entrada({ ...base, aPartirDe: corte, congeladas: completa.alocacoes.filter((a) => idx(a) < corte) }, dias));
      expect(parcial.alocacoes).toEqual(completa.alocacoes.filter((a) => idx(a) >= corte));
      expect(checarInvariantes(entrada({ ...base, aPartirDe: corte, congeladas: completa.alocacoes.filter((a) => idx(a) < corte) }, dias), parcial)).toEqual([]);
    }
  });
});
