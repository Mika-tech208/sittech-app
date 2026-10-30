import { describe, it, expect } from "vitest";
import { PERIODOS_REAIS } from "@/features/escala/__tests__/helpers";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { EstadoBruto } from "../estado";
import { calcularFuncionariosNecessariosDaSemana, estadoDaProgramacao } from "../funcionariosNecessarios";
import { calcularMaquinasEnvolvidas } from "@/features/capacidade/calculations";

// Motor REAL da Escala (sem mocks), fixtures mínimas: 2 dias x 6 períodos = 12 slots; cada máquina rende 100 peças/período => 1200 peças em 2 dias.
const D1 = "2026-10-26";
const D2 = "2026-10-27";
const AGORA = epochMsNoFuso(D1, "05:00");
const CAP = 1200;
const METAS = { m1: 100, m2: 100, m3: 100, t1: 100, t2: 100, t3: 100 };

interface Prod { id: string; q: number; maquinas: string[]; op?: string }

/** Um produto = uma etapa (operação própria) com as máquinas dadas. */
function estado(prods: Prod[], extra: Partial<EstadoBruto> = {}): EstadoBruto {
  const maqs = [...new Set(prods.flatMap((p) => p.maquinas))];
  return {
    previsaoId: "prev1", semanaInicio: D1, diasProdutivos: [D1, D2], periodosAtuais: PERIODOS_REAIS, diasExistentes: [],
    equipeProdutiva: [{ funcionarioId: "real1", ativo: true }, { funcionarioId: "real2", ativo: true }],
    itens: prods.map((p) => ({ produtoId: p.id, quantidade: p.q, quantidadeAdicional: 0, valorUnitario: 1, maquinasPorEtapa: { [`${p.id}-e1`]: p.maquinas } })),
    etapas: prods.map((p) => ({ id: `${p.id}-e1`, produtoId: p.id, operacaoId: p.op ?? `op-${p.id}`, ordem: 1, metas: METAS, maquinasCompativeis: p.maquinas })),
    maquinasIndisponiveisPrevisao: [], maquinasInativas: [], ausencias: [], indisponibilidades: [], alocacoes: [],
    nomesOperacao: Object.fromEntries(prods.map((p) => [p.op ?? `op-${p.id}`, `Op ${p.id}`])),
    nomesMaquinas: Object.fromEntries(maqs.map((m) => [m, `Maq ${m}`])),
    nomesProdutos: Object.fromEntries(prods.map((p) => [p.id, `Produto ${p.id}`])),
    ...extra,
  };
}
const nec = (e: EstadoBruto) => calcularFuncionariosNecessariosDaSemana(e, AGORA);

describe("funcionários necessários — motor real, fixtures mínimas", () => {
  it("1) duas máquinas simultâneas E necessárias => mínimo 2", () => {
    // cada produto enche uma máquina nos 12 períodos: não dá para uma pessoa só
    const r = nec(estado([{ id: "A", q: CAP, maquinas: ["m1"] }, { id: "B", q: CAP, maquinas: ["m2"] }]));
    expect(r.funcionariosNecessarios).toBe(2);
    expect(r.maquinasEnvolvidas.total).toBe(2);
  });

  it("2) duas máquinas, mas a programação cabe em uma: mínimo 1 (a pessoa troca de máquina em períodos diferentes)", () => {
    // 600 peças em cada produto; produtos DIFERENTES em máquinas diferentes, mas 6 períodos de uma + 6 da outra cabem em 1 pessoa
    const r = nec(estado([{ id: "A", q: 600, maquinas: ["m1"] }, { id: "B", q: 600, maquinas: ["m2"] }]));
    expect(r.maquinasEnvolvidas.total).toBe(2);
    expect(r.funcionariosNecessarios).toBe(1);
    expect(r.comparacao.find((c) => c.rotulo === "N")?.igualReferencia).toBe(true);
  });

  it("3) máquina compartilhada entre produtos não duplica recurso: 2 produtos na mesma máquina => 1 posto", () => {
    const r = nec(estado([{ id: "A", q: 500, maquinas: ["m1"] }, { id: "B", q: 500, maquinas: ["m1"] }]));
    expect(r.maquinasEnvolvidas.total).toBe(1);
    expect(r.funcionariosNecessarios).toBe(1);
    expect(r.faltaPorLimiteDeMaquina.total).toBe(0);
  });

  it("3b) compartilhada saturada: a máquina é um recurso só — continua 1 pessoa (a falta é de máquina, não de gente)", () => {
    const r = nec(estado([{ id: "A", q: CAP, maquinas: ["m1"] }, { id: "B", q: CAP, maquinas: ["m1"] }]));
    expect(r.funcionariosNecessarios).toBe(1);
    expect(r.faltaPorLimiteDeMaquina.total).toBeCloseTo(CAP, 6);
    expect(r.faltaPorEquipe.total).toBe(0);
  });

  it("4) três produtos na mesma máquina => 1 posto físico", () => {
    const r = nec(estado([{ id: "A", q: 300, maquinas: ["m1"] }, { id: "B", q: 300, maquinas: ["m1"] }, { id: "C", q: 300, maquinas: ["m1"] }]));
    expect(r.maquinasEnvolvidas.total).toBe(1);
    expect(r.funcionariosNecessarios).toBe(1);
  });

  it("5) 15 máquinas envolvidas e mínimo 14 => 14 (e 13 perde produção; 14 iguala a equipe ilimitada)", () => {
    // 13 máquinas saturadas (12 períodos cada) + 2 com 6 períodos: 13*12 + 12 = 168 = 14 pessoas x 12 períodos
    const prods: Prod[] = [
      ...Array.from({ length: 13 }, (_, i) => ({ id: `S${i}`, q: CAP, maquinas: [`s${i}`] })),
      { id: "P1", q: 600, maquinas: ["p1"] },
      { id: "P2", q: 600, maquinas: ["p2"] },
    ];
    const e = estado(prods);
    const r = nec(e);
    expect(calcularMaquinasEnvolvidas(e.itens.map((i) => ({ maquinasPorEtapa: i.maquinasPorEtapa })))).toBe(15);
    expect(r.maquinasEnvolvidas.total).toBe(15);
    expect(r.funcionariosNecessarios).toBe(14);
    const por = Object.fromEntries(r.comparacao.map((c) => [c.rotulo, c]));
    expect(por["N-1"].n).toBe(13);
    expect(por["N-1"].igualReferencia).toBe(false); // 13 perde produção
    expect(por["N-1"].perdaVsReferencia).toBeGreaterThan(0);
    expect(por["N"].igualReferencia).toBe(true); // 14 iguala a equipe ilimitada
    expect(por["N"].creditoTotal).toBeCloseTo(por["equipe de referência"].creditoTotal, 6);
    expect(r.faltaPorEquipe.total).toBeGreaterThan(0); // o que 13 pessoas deixam de produzir é falta de EQUIPE
    expect(r.faltaPorLimiteDeMaquina.total).toBe(0);
  });

  it("6) quando as 15 máquinas realmente precisam rodar juntas, 15 pessoas aumentam a produção frente a 14 => 15", () => {
    const prods: Prod[] = Array.from({ length: 15 }, (_, i) => ({ id: `S${i}`, q: CAP, maquinas: [`s${i}`] }));
    const r = nec(estado(prods));
    expect(r.funcionariosNecessarios).toBe(15);
    expect(r.comparacao.find((c) => c.rotulo === "N-1")?.perdaVsReferencia).toBeGreaterThan(0);
  });

  it("7) capacidade limitada por máquina (carga > 100%) não aumenta o headcount artificialmente", () => {
    // m1 recebe 2x o que cabe em 2 dias: a falta é de máquina; com 1 pessoa (e com 30) o resultado é o mesmo
    const r = nec(estado([{ id: "A", q: 2 * CAP, maquinas: ["m1"] }]));
    expect(r.funcionariosNecessarios).toBe(1);
    expect(r.faltaPorLimiteDeMaquina.total).toBeCloseTo(CAP, 6);
    expect(r.faltaPorEquipe.total).toBe(0);
    expect(r.producaoReferencia.creditoTotal).toBeCloseTo(CAP, 6);
  });

  it("revezamento duro por bloco é regra do motor e entra no número: 1 máquina sempre ligada exige 3 pessoas por manhã/tarde (ninguém repete a operação no bloco)", () => {
    const parametros = { wipModo: "desligado" as const, wipDiasLimite: 1, revezamentoModo: "duro" as const, revezamentoEscopo: "bloco" as const };
    const r = nec(estado([{ id: "A", q: CAP, maquinas: ["m1"] }], { parametros }));
    expect(r.maquinasEnvolvidas.total).toBe(1);
    expect(r.funcionariosNecessarios).toBe(3);
    expect(nec(estado([{ id: "A", q: CAP, maquinas: ["m1"] }])).funcionariosNecessarios).toBe(1); // sem o revezamento duro
  });

  it("não usa a equipe real, ausências nem a carga adicional (o número é da programação)", () => {
    const base = estado([{ id: "A", q: CAP, maquinas: ["m1"] }, { id: "B", q: CAP, maquinas: ["m2"] }, { id: "C", q: CAP, maquinas: ["m3"] }]);
    const sem = nec(base).funcionariosNecessarios;
    const outro = estado([{ id: "A", q: CAP, maquinas: ["m1"] }, { id: "B", q: CAP, maquinas: ["m2"] }, { id: "C", q: CAP, maquinas: ["m3"] }], {
      equipeProdutiva: [{ funcionarioId: "real1", ativo: true }],
      ausencias: [{ funcionarioId: "real1", data: D1, horarioInicio: null, horarioFim: null }],
    });
    outro.itens = outro.itens.map((i) => ({ ...i, quantidadeAdicional: 5000 }));
    expect(sem).toBe(3);
    expect(nec(outro).funcionariosNecessarios).toBe(3);
  });

  it("sem máquinas selecionadas / sem demanda => 0 e nada de erro", () => {
    expect(nec(estado([{ id: "A", q: 100, maquinas: [] }])).funcionariosNecessarios).toBe(0);
    expect(nec(estado([])).funcionariosNecessarios).toBe(0);
  });

  it("metadados e estadoDaProgramacao: períodos analisados, referência e sem adicional", () => {
    const r = nec(estado([{ id: "A", q: 600, maquinas: ["m1", "m2"] }]));
    expect(r.periodosAnalisados.total).toBe(12);
    expect(r.periodosAnalisados.dias).toEqual([D1, D2]);
    expect(r.equipeReferencia).toBe(r.busca.equipeVirtualMax);
    expect(r.busca.monotonico).toBe(true);
    const e = estado([{ id: "A", q: 600, maquinas: ["m1"] }]);
    e.itens[0].quantidadeAdicional = 99;
    e.itens[0].adicionalPorEtapa = { "A-e1": 99 };
    const p = estadoDaProgramacao(e);
    expect(p.itens[0].quantidadeAdicional).toBe(0);
    expect(p.itens[0].adicionalPorEtapa).toBeUndefined();
    expect(p.ausencias).toEqual([]);
  });
});
