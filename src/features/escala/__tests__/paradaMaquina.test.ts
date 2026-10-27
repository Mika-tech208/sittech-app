// HOTFIX — Parada de máquina (ocorrencias_maquina) torna a máquina INDISPONÍVEL para a Escala: regra de interseção + cenário real da Máquina 8.
// A Parada chega ao motor como indisponibilidade (espelho por trigger, testado em supabase/tests/escala_parada_maquina.test.sql);
// aqui se prova o que o motor/horizonte fazem com ela. 27/10/2026, America/Sao_Paulo; períodos reais M1..T3.
import { describe, it, expect } from "vitest";
import { causaAfetaIntervalo, maquinaDisponivelNoSlot } from "../disponibilidade";
import { gerarEscala } from "../gerarEscala";
import { replanejarComHorizonte } from "../horizonte";
import { epochMsNoFuso } from "../tempo";
import type { AlocacaoEscala, EntradaEscala, IndisponibilidadeRecursoEscala } from "../types";
import { entrada, equipe, pool } from "./helpers";

const DIA = "2026-10-27";
const M8 = "m8";
const OUTRA = "m9";
const t = (hhmm: string) => epochMsNoFuso(DIA, hhmm);
const IDX = { m1: 0, m2: 1, m3: 2, t1: 3, t2: 4, t3: 5 };
const parada = (desde: string, ate: string | null, maquinaId = M8): IndisponibilidadeRecursoEscala => ({ maquinaId, desdeMs: t(desde), liberadaEmMs: ate ? t(ate) : null });

// agora = 10:30 (M3 em andamento): aPartirDe = T1; os períodos já iniciados entram como congelados
function cenario(extra: Partial<EntradaEscala> = {}, maquinas = [M8, OUTRA], n = 2): EntradaEscala {
  return entrada({ funcionarios: equipe(n), pools: [pool({ produto: "A", etapa: "A-e1", op: "opX", q: 99999, maquinas, mu: 100 })], aPartirDe: IDX.t1, ...extra }, [DIA]);
}
const usadosM8 = (e: EntradaEscala, rows: AlocacaoEscala[]) => rows.filter((a) => a.maquinaId === M8).map((a) => e.slots.findIndex((s) => s.periodoId === a.periodoId && s.data === a.data)).sort((a, b) => a - b);

describe("regra de interseção [início, fim) — causa x período", () => {
  const e = cenario();
  const m2 = e.slots[IDX.m2]; // 08:48–10:24
  const casos: [string, IndisponibilidadeRecursoEscala, boolean][] = [
    ["A) começa exatamente no início do período", { maquinaId: M8, desdeMs: m2.inicioMs, liberadaEmMs: null }, true],
    ["B) começa no meio do período (a regra antiga deixava passar)", { maquinaId: M8, desdeMs: t("09:34"), liberadaEmMs: null }, true],
    ["C) começa exatamente no fim do período", { maquinaId: M8, desdeMs: m2.fimMs, liberadaEmMs: null }, false],
    ["D) termina exatamente no início do período", { maquinaId: M8, desdeMs: t("07:00"), liberadaEmMs: m2.inicioMs }, false],
    ["E) termina no meio do período", { maquinaId: M8, desdeMs: t("07:00"), liberadaEmMs: t("09:34") }, true],
    ["F) termina exatamente no fim do período", { maquinaId: M8, desdeMs: t("07:00"), liberadaEmMs: m2.fimMs }, true],
    ["aberta (fim NULL) começando antes", { maquinaId: M8, desdeMs: t("07:00"), liberadaEmMs: null }, true],
  ];
  casos.forEach(([nome, causa, afeta]) => {
    it(nome, () => {
      expect(causaAfetaIntervalo(causa, m2.inicioMs, m2.fimMs)).toBe(afeta);
      expect(maquinaDisponivelNoSlot({ ...e, indisponibilidades: [causa] }, M8, m2)).toBe(!afeta);
    });
  });
  it("outra máquina nunca é afetada", () => {
    expect(maquinaDisponivelNoSlot({ ...e, indisponibilidades: [parada("07:00", null)] }, OUTRA, m2)).toBe(true);
  });
  it("timezone: 09:34 America/Sao_Paulo é 12:34Z (sem horário de verão)", () => {
    expect(new Date(t("09:34")).toISOString()).toBe("2026-10-27T12:34:00.000Z");
  });
});

describe("caso real — Máquina Automática 8: Parada aberta 27/10 09:34", () => {
  it("M2 (08:48–10:24) é afetado pela Parada (diagnóstico); M1 não; M3 e os futuros sim", () => {
    const e = cenario({ indisponibilidades: [parada("09:34", null)] });
    expect([0, 1, 2, 3, 4, 5].map((i) => maquinaDisponivelNoSlot(e, M8, e.slots[i]))).toEqual([true, false, false, false, false, false]);
  });
  it("Parada aberta: nenhuma alocação na M8 em T1..T3 (e a outra máquina segue sendo usada)", () => {
    const e = cenario({ indisponibilidades: [parada("09:34", null)] });
    const r = gerarEscala(e);
    expect(usadosM8(e, r.alocacoes)).toEqual([]);
    expect(r.alocacoes.filter((a) => a.maquinaId === OUTRA).length).toBeGreaterThan(0);
  });
  it("sem Parada a M8 é usada nos períodos futuros (premissa do cenário)", () => {
    const e = cenario();
    expect(usadosM8(e, gerarEscala(e).alocacoes)).toContain(IDX.t1);
  });
  it("Parada encerrada ANTES de T1 (12:40): a M8 volta elegível já em T1 — e é usada", () => {
    const e = cenario({ indisponibilidades: [parada("09:34", "12:40")] });
    expect(maquinaDisponivelNoSlot(e, M8, e.slots[IDX.t1])).toBe(true);
    expect(usadosM8(e, gerarEscala(e).alocacoes)).toContain(IDX.t1);
  });
  it("Parada encerrada NO MEIO de T1 (13:35): T1 não é reescrito; a M8 só volta elegível em T2", () => {
    const e = cenario({ indisponibilidades: [parada("09:34", "13:35")] });
    const usados = usadosM8(e, gerarEscala(e).alocacoes);
    expect(usados).not.toContain(IDX.t1);
    expect(usados).toContain(IDX.t2);
  });
  it("Parada 09:34–14:00: afeta M2,M3,T1,T2? (T2 começa 14:20 > 14:00) => volta em T2", () => {
    const e = cenario({ indisponibilidades: [parada("09:34", "14:00")] });
    expect([1, 2, 3, 4].map((i) => maquinaDisponivelNoSlot(e, M8, e.slots[i]))).toEqual([false, false, false, true]);
  });
});

describe("várias causas simultâneas na mesma máquina", () => {
  const manual = (desde: string, ate: string | null) => parada(desde, ate);
  it("Parada encerrada mas bloqueio manual aberto: continua indisponível", () => {
    const e = cenario({ indisponibilidades: [parada("09:34", "12:00"), manual("10:00", null)] });
    expect(usadosM8(e, gerarEscala(e).alocacoes)).toEqual([]);
  });
  it("bloqueio manual liberado mas Parada aberta: continua indisponível", () => {
    const e = cenario({ indisponibilidades: [parada("09:34", null), manual("10:00", "11:00")] });
    expect(usadosM8(e, gerarEscala(e).alocacoes)).toEqual([]);
  });
  it("só volta quando TODAS as causas terminaram", () => {
    const e = cenario({ indisponibilidades: [parada("09:34", "12:00"), manual("10:00", "12:30")] });
    expect(usadosM8(e, gerarEscala(e).alocacoes)).toContain(IDX.t1);
  });
});

describe("máquina volta, mas o motor continua decidindo (disponibilidade não é obrigação de uso)", () => {
  it("sem operador: volta elegível e não é usada", () => {
    const e = cenario({ indisponibilidades: [parada("09:34", "12:40")], ausencias: [{ funcionarioId: "f01", data: DIA, inicioMin: null, fimMin: null }, { funcionarioId: "f02", data: DIA, inicioMin: null, fimMin: null }] });
    expect(maquinaDisponivelNoSlot(e, M8, e.slots[IDX.t1])).toBe(true);
    expect(gerarEscala(e).alocacoes.filter((a) => a.maquinaId).length).toBe(0);
  });
  it("sem demanda: volta elegível e não é usada", () => {
    const e = { ...cenario({ indisponibilidades: [parada("09:34", "12:40")] }), pools: [pool({ produto: "A", etapa: "A-e1", op: "opX", q: 0, maquinas: [M8, OUTRA], mu: 100 })] };
    expect(gerarEscala(e).alocacoes.filter((a) => a.maquinaId).length).toBe(0);
  });
  it("revezamento duro: o único operador acabou de fazer a mesma operação — a M8 volta e mesmo assim T1 fica sem posto", () => {
    const base = cenario({ indisponibilidades: [parada("09:34", "12:40")] }, [M8], 1);
    const congelada: AlocacaoEscala = { data: DIA, periodoId: "m3", funcionarioId: "f01", maquinaId: OUTRA, produtoId: "A", etapaId: "A-e1", operacaoId: "opX", pecas: 100, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null };
    const e = { ...base, revezamentoDuro: true, congeladas: [congelada] };
    expect(maquinaDisponivelNoSlot(e, M8, e.slots[IDX.t1])).toBe(true);
    const t1 = gerarEscala(e).alocacoes.filter((a) => a.periodoId === "t1");
    expect(t1.every((a) => !a.maquinaId)).toBe(true);
  });
  it("máquina compartilhada (mesma máquina em duas etapas): no máximo 1 uso por período", () => {
    const e = entrada({
      funcionarios: equipe(3),
      pools: [pool({ produto: "A", etapa: "A-e1", op: "opX", q: 99999, maquinas: [M8], mu: 100 }), pool({ produto: "B", etapa: "B-e1", op: "opY", q: 99999, maquinas: [M8], mu: 100 })],
      aPartirDe: IDX.t1, indisponibilidades: [parada("09:34", "12:40")],
    }, [DIA]);
    const r = gerarEscala(e);
    e.slots.forEach((s) => expect(r.alocacoes.filter((a) => a.periodoId === s.periodoId && a.maquinaId === M8).length).toBeLessThanOrEqual(1));
  });
});

describe("horizonte: a indisponibilidade física vence a estabilidade do plano vigente", () => {
  it("plano vigente usa a M8 no futuro; ao receber a Parada, o alterável sai da M8 e o próximo período comprometido é reparado", () => {
    const e0 = cenario({ aPartirDe: 0 });
    const plano = gerarEscala(e0).alocacoes;
    expect(usadosM8(e0, plano).filter((i) => i >= 3).length).toBeGreaterThan(0);
    const e = cenario({ aPartirDe: 0, indisponibilidades: [parada("09:34", null)] });
    const r = replanejarComHorizonte(e, plano, IDX.m3);
    expect(usadosM8(e, r.alteravel)).toEqual([]);
    expect(usadosM8(e, r.comprometidas)).toEqual([]);
  });
});
