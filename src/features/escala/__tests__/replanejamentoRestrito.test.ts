// REPLANEJAMENTO DINÂMICO RESTRITO — comportamento período a período em semanas sintéticas controladas (as semanas reais ficam nos scripts de simulação).
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import { calcularDinamica, evolucaoDoGargalo } from "../gargaloDinamico";
import { desempenhoPorEtapa, fatorDesempenho } from "../desempenho";
import { aplicarTetosDinamicos, TETO_DINAMICO } from "../tetosWip";
import { classificarMudancas, estabilizarPessoas } from "../estabilidade";
import { construirProposta, diagnosticarOciosidade } from "../replanejamentoRestrito";
import { executarCorteSombra } from "../sombraCorte";
import { contarRepeticoes, simularSemanaRestrita, type ResultadoSimulacao } from "../simulacaoRestrita";
import type { ApontamentoReal } from "../producaoReal";
import { chavePool, MOTIVO_REVEZAMENTO, type AlocacaoEscala, type EntradaEscala } from "../types";
import { comWip, produto } from "./adicionalWipHelpers";
import { entrada, equipe } from "./helpers";

const DIAS = ["2026-10-26", "2026-10-27"];
// P: Rosquear (a1,a2) → Embalar (e1, máquina ÚNICA); Q: Montar (q1,q2). Embalar é o gargalo por meta (≈96% do tempo disponível).
function mundo(opc: { qEmbalar?: number; qQ?: number; pessoas?: number; wip?: boolean; tetoP?: number } = {}): EntradaEscala {
  const qE = opc.qEmbalar ?? 1150;
  const pools = [...produto("P", [["a1", "a2"], ["e1"]], { q: qE, mu: 100, valor: 2 }), ...produto("Q", [["q1", "q2"]], { q: opc.qQ ?? 500, mu: 100, valor: 1 })];
  const e = { ...entrada({ funcionarios: equipe(opc.pessoas ?? 6), pools }, DIAS), revezamentoDuro: true };
  return opc.wip === false ? e : comWip(e, { teto: (p) => (p.produtoId === "P" ? opc.tetoP ?? 3000 : 0), dias: 2 });
}
const op = (e: EntradaEscala, pool: { produtoId: string; etapaId: string }) => e.pools.find((p) => p.produtoId === pool.produtoId && p.etapaId === pool.etapaId)?.operacaoId ?? "";
const wipTotal = (rows: AlocacaoEscala[]) => rows.reduce((s, a) => s + (a.maquinaId ? a.pecasAdicional ?? 0 : 0), 0);
const sim = (e: EntradaEscala, rendimento: (opId: string) => number, extra: { aplicar?: boolean } = {}): ResultadoSimulacao => simularSemanaRestrita({ base: e, rendimento: ({ pool }) => rendimento(op(e, pool)), ...extra });
const idx = (e: EntradaEscala, a: { data: string; periodoId: string }) => e.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)!.indice;
const boasAcabado = (r: ResultadoSimulacao, produtoId: string, etapaId: string) => r.apontamentos.filter((a) => a.produtoId === produtoId && a.etapaId === etapaId).reduce((s, a) => s + a.boas, 0);
// primeiro período em que o acumulado de boas da etapa atinge `meta` (Infinity = nunca)
const conclusaoDe = (e: EntradaEscala, r: ResultadoSimulacao, produtoId: string, etapaId: string, meta: number) => {
  let acum = 0;
  for (const s of e.slots) {
    acum += r.apontamentos.filter((a) => a.data === s.data && a.periodoId === s.periodoId && a.produtoId === produtoId && a.etapaId === etapaId).reduce((x, a) => x + a.boas, 0);
    if (acum >= meta) return s.indice;
  }
  return Number.POSITIVE_INFINITY;
};

describe("meta × produtividade real: capacidade futura suavizada", () => {
  it("meta 100 pç/h e real 120: f > 1 (capacidade futura acima de 100) mas NÃO 1,20 — e não fica presa na meta", () => {
    expect(fatorDesempenho(2, 240, 200)).toBe(1); // poucas amostras: nada muda
    const f6 = fatorDesempenho(6, 720, 600);
    expect(f6).toBeGreaterThan(1);
    expect(f6).toBeLessThan(1.2);
    expect(f6).toBeCloseTo(1 + (6 / 12) * 0.2, 6);
    expect(fatorDesempenho(30, 3600, 3000)).toBeGreaterThan(f6); // mais amostras => confiança maior
    const e = mundo({ wip: false });
    const embalar = e.pools.find((p) => p.produtoId === "P" && p.ordemEtapa === 2)!;
    const aps: ApontamentoReal[] = Array.from({ length: 6 }, (_, i) => ({ data: DIAS[0], periodoId: "m1", funcionarioId: `f0${i}`, maquinaId: "e1", produtoId: "P", etapaId: embalar.etapaId, operacaoId: embalar.operacaoId, boas: 120, refugo: 0, meta: 100, status: "produzindo" as const, motivo: null, lancadoEmMs: 0 }));
    const d = desempenhoPorEtapa(e.pools, aps)[chavePool("P", embalar.etapaId)];
    expect(d.n).toBe(6);
    expect(d.f).toBeCloseTo(1.1, 6);
    const din = calcularDinamica({ entrada: e, originais: e.pools, restante: { [chavePool("P", embalar.etapaId)]: 500 }, desempenho: { [chavePool("P", embalar.etapaId)]: d }, c: 0 });
    const linha = din.capacidade.find((x) => x.poolKey === chavePool("P", embalar.etapaId))!;
    expect(linha.metaOriginalMedia).toBe(100);
    expect(linha.produtividadeObservada).toBeCloseTo(1.2, 6);
    expect(linha.f).toBeCloseTo(1.1, 6);
    expect(linha.capacidadeFuturaAjustada).toBeCloseTo(linha.capacidadeFuturaOriginal * 1.1, 6);
    expect(linha.capacidadeFuturaAjustada).toBeGreaterThan(linha.capacidadeFuturaOriginal);
    expect(linha.capacidadeFuturaAjustada).toBeLessThan(linha.capacidadeFuturaOriginal * 1.2);
  });
});

describe("tetos dinâmicos de WIP", () => {
  it("só os produtos que já têm WIP programado; a última etapa (acabado) mantém o teto programado", () => {
    const e = mundo({ tetoP: 3000 });
    const t = aplicarTetosDinamicos(e.pools);
    const P1 = t.find((p) => p.produtoId === "P" && p.ordemEtapa === 1)!, P2 = t.find((p) => p.produtoId === "P" && p.ordemEtapa === 2)!, Q = t.find((p) => p.produtoId === "Q")!;
    expect(P1.adicionalMax).toBe(TETO_DINAMICO);
    expect(P2.adicionalMax).toBe(3000);
    expect(Q.adicionalMax).toBe(0); // produto sem WIP programado nunca entra
  });
});

describe("gargalo dinâmico: persiste, diminui, desaparece, muda", () => {
  it("Embalar começa como gargalo por meta; produzindo >100% a capacidade sobe, a pressão cai e o gargalo desaparece", () => {
    const e = mundo({ wip: false, qQ: 300 });
    const r = sim(e, (o) => (o === "P-op2" ? 1.25 : 1));
    const primeiro = r.cortes[0], ultimo = r.cortes[r.cortes.length - 1];
    expect(primeiro.gargalo?.situacao).not.toBe("sem_gargalo");
    expect(primeiro.gargalo?.maquinas).toEqual(["e1"]);
    const pressoes = r.cortes.map((c) => c.gargalo?.pressaoAjustada ?? 0);
    expect(pressoes[pressoes.length - 4]).toBeLessThan(pressoes[0]); // pressão ajustada cai
    expect(r.cortes.some((c) => c.evolucaoGargalo === "desapareceu")).toBe(true);
    expect(ultimo.gargalo === null || ultimo.gargalo.situacao === "sem_gargalo").toBe(true);
    // a capacidade ajustada passou a ser MAIOR que a original (mas sem exceder a observada)
    const meio = r.cortes[Math.floor(r.cortes.length / 2)].ritmo.find((x) => x.poolKey.startsWith("P|") && x.n >= 3 && x.f > 1);
    expect(meio).toBeTruthy();
    expect(meio!.capacidadeAjustada).toBeGreaterThan(meio!.capacidadeOriginal);
    expect(meio!.capacidadeAjustada).toBeLessThan(meio!.capacidadeOriginal * 1.25);
  });
  it("o inverso: uma operação segura que passa a render abaixo da meta vira o novo gargalo", () => {
    const e = mundo({ wip: false, qQ: 2000 }); // Embalar a ~96% (gargalo por meta); Montar (Q) seguro, a ~83%
    const r = sim(e, (o) => (o === "Q-op1" ? 0.6 : 1));
    expect(r.cortes[0].gargalo?.maquinas).toEqual(["e1"]);
    expect(r.cortes.some((c) => c.evolucaoGargalo === "mudou")).toBe(true);
    const ult = r.cortes[Math.floor(r.cortes.length * 0.6)];
    expect(ult.gargalo?.maquinas).toEqual(["q1", "q2"]);
    expect(ult.gargalo?.situacao).toBe("saturado");
    expect(ult.gargalo?.pressaoAjustada ?? 0).toBeGreaterThan(ult.gargalo?.pressaoOriginal ?? 99);
  });
  it("evolução entre cortes", () => {
    const g = (situacao: "saturado" | "sob_pressao" | "sem_gargalo", maquinas: string[], p: number) => ({ situacao, principal: situacao === "sem_gargalo" ? null : { maquinas, produtos: [], necessarioOriginal: 1, necessarioAjustado: 1, disponivel: 1, pressaoOriginal: p, pressaoAjustada: p, deficitAjustado: 0 }, recursos: [] });
    expect(evolucaoDoGargalo(null, g("saturado", ["a"], 1.5))).toBe("inicio");
    expect(evolucaoDoGargalo(g("saturado", ["a"], 1.5), g("saturado", ["a"], 1.5))).toBe("persistiu");
    expect(evolucaoDoGargalo(g("saturado", ["a"], 1.5), g("saturado", ["a"], 1.2))).toBe("diminuiu");
    expect(evolucaoDoGargalo(g("saturado", ["a"], 1.2), g("saturado", ["a"], 1.5))).toBe("aumentou");
    expect(evolucaoDoGargalo(g("saturado", ["a"], 1.5), g("sem_gargalo", [], 0.5))).toBe("desapareceu");
    expect(evolucaoDoGargalo(g("sem_gargalo", [], 0.5), g("saturado", ["a"], 1.5))).toBe("surgiu");
    expect(evolucaoDoGargalo(g("saturado", ["a"], 1.5), g("sob_pressao", ["b"], 0.95))).toBe("mudou");
  });
});

describe("escrita restrita: invariantes em todos os cenários", () => {
  const cenarios: [string, (o: string) => number][] = [
    ["realizado = planejado", () => 1],
    ["Embalar +18%", (o) => (o === "P-op2" ? 1.18 : 1)],
    ["Embalar −20%", (o) => (o === "P-op2" ? 0.8 : 1)],
    ["Montar −30%", (o) => (o === "Q-op1" ? 0.7 : 1)],
    ["produção geral +15%", () => 1.15],
    ["produção geral −15%", () => 0.85],
  ];
  for (const [nome, rend] of cenarios) {
    it(`${nome}: passado e comprometido intactos, rotação = 0, nenhuma violação, nada fora da Previsão`, () => {
      const e = mundo();
      const r = sim(e, rend);
      expect(r.repeticoes).toBe(0);
      r.cortes.forEach((c) => {
        expect(c.violacoes.filter((v) => !v.startsWith("previsto piora") && !v.startsWith("WIP prejudica"))).toEqual([]); // recusas por piora são esperadas; violações físicas nunca
        expect(c.congeladoIntacto).toBe(true);
        if (!c.reparo) expect(c.comprometidoIntacto).toBe(true);
      });
      // WIP só ocupa quem ficaria ocioso; churn consistente
      r.cortes.forEach((c) => { expect(c.wipSemOciosidade).toBe(0); expect(c.produtivas + c.trocasEquivalentes).toBe(c.mudancas); });
      expect(r.planoFinal.every((a) => !a.excecaoRevezamento)).toBe(true);
      r.planoFinal.filter((a) => a.maquinaId).forEach((a) => {
        const p = e.pools.find((x) => x.produtoId === a.produtoId && x.etapaId === a.etapaId);
        expect(p?.maquinasIds).toContain(a.maquinaId);
      });
    });
  }
  it("a proposta só regrava de c+2 em diante (e o comprometido apenas no reparo)", () => {
    const e = mundo();
    const plano = gerarEscala(e).alocacoes;
    const aps: ApontamentoReal[] = plano.filter((a) => a.maquinaId && idx(e, a) <= 3).map((a) => ({ data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId, boas: Math.round((a.pecas + (a.pecasAdicional ?? 0)) * 0.7), refugo: 0, meta: a.pecas, status: "produzindo" as const, motivo: null, lancadoEmMs: e.slots[idx(e, a)].fimMs + 60_000 }));
    const par = { base: e, ausencias: [], indisponibilidades: [], apontamentos: aps, planoOficial: plano, c: 3, corteMs: e.slots[3].fimMs + 300_000, restrito: true };
    const dec = executarCorteSombra(par);
    const prop = construirProposta(par, dec);
    expect(prop.aPartirSlot).toBe(5); // c = 3 => comprometido 4 => alterável a partir de 5
    expect(prop.linhas.every((a) => idx(e, a) >= 5)).toBe(true);
    expect(prop.reparoDoComprometido).toBe(false);
  });
});

describe("os 5 comportamentos pedidos", () => {
  it("1) realizado = planejado: o plano é essencialmente mantido (sem oscilação depois do ajuste inicial)", () => {
    const e = mundo();
    const r = sim(e, () => 1);
    const aplicados = r.cortes.filter((c) => c.aplicado);
    expect(aplicados.length).toBeLessThanOrEqual(2);
    expect(r.cortes.slice(3).every((c) => !c.aplicado)).toBe(true);
    expect(boasAcabado(r, "P", e.pools.find((p) => p.produtoId === "P" && p.ordemEtapa === 2)!.etapaId)).toBeGreaterThan(0);
  });
  it("2) Embalar acima do plano: capacidade projetada sobe, falta cai e o WIP é recalculado (pode aumentar com a capacidade livre)", () => {
    const e = mundo();
    const base = sim(e, (o) => (o === "P-op2" ? 1.2 : 1), { aplicar: false });
    const din = sim(e, (o) => (o === "P-op2" ? 1.2 : 1));
    const emb = e.pools.find((p) => p.produtoId === "P" && p.ordemEtapa === 2)!.etapaId;
    const prev = e.pools.find((p) => p.etapaId === emb)!.quantidade;
    expect(boasAcabado(din, "P", emb)).toBeGreaterThanOrEqual(prev); // o previsto fecha
    expect(conclusaoDe(e, din, "P", emb, prev)).toBeLessThanOrEqual(conclusaoDe(e, base, "P", emb, prev)); // e não depois do plano estático
    const meio = din.cortes[Math.floor(din.cortes.length / 2)];
    expect(meio.ritmo.find((x) => x.poolKey === chavePool("P", emb))!.f).toBeGreaterThan(1);
    expect(din.cortes.every((c) => c.faltaSombra <= c.faltaOficial + 1 || c.veredito !== "aplicar")).toBe(true);
  });
  it("3) Embalar abaixo do plano: o WIP futuro é retirado para dar capacidade ao previsto e o previsto nunca perde para o WIP", () => {
    const e = mundo({ qEmbalar: 1000, qQ: 800, pessoas: 5 });
    const r = sim(e, (o) => (o === "P-op1" ? 0.6 : 1)); // Rosquear (etapa 1 do P) rende 60%: o previsto precisa dos postos que o WIP ocupava
    const wipInicial = wipTotal(gerarEscala(e).alocacoes);
    expect(r.cortes.every((c) => c.violacoes.every((v) => !v.startsWith("WIP prejudica")))).toBe(true);
    expect(wipTotal(r.planoFinal)).toBeLessThanOrEqual(wipInicial + 1);
    expect(r.cortes.some((c) => c.aplicado && c.wipRemovido > 0)).toBe(true);
  });
  it("4) outra operação vira gargalo: a prioridade migra para ela (previsto dela é protegido)", () => {
    const e = mundo({ wip: false, qQ: 2000 });
    const r = sim(e, (o) => (o === "Q-op1" ? 0.65 : 1));
    const estatico = sim(e, (o) => (o === "Q-op1" ? 0.65 : 1), { aplicar: false });
    const qEtapa = e.pools.find((p) => p.produtoId === "Q")!.etapaId;
    expect(boasAcabado(r, "Q", qEtapa)).toBeGreaterThanOrEqual(boasAcabado(estatico, "Q", qEtapa));
    expect(r.cortes[Math.floor(r.cortes.length / 2)].gargalo?.maquinas).toEqual(["q1", "q2"]);
  });
  it("5) produção geral acima do plano: o previsto conclui mais cedo e a capacidade liberada é preenchida com WIP válido (dentro do limite)", () => {
    const e = mundo({ pessoas: 7 });
    const r = sim(e, () => 1.2);
    const estatico = sim(e, () => 1.2, { aplicar: false });
    expect(wipTotal(r.planoFinal)).toBeGreaterThanOrEqual(wipTotal(estatico.planoFinal));
    expect(r.cortes.every((c) => c.violacoes.filter((v) => v.startsWith("WIP acima")).length === 0)).toBe(true);
  });
});

describe("diagnóstico exato de ociosidade", () => {
  it("cada pessoa-período ociosa no futuro recebe UMA causa da lista fechada", () => {
    const e = mundo({ pessoas: 8 });
    const plano = gerarEscala(e).alocacoes;
    const par = { base: e, ausencias: [], indisponibilidades: [], apontamentos: [], planoOficial: plano, c: 1, corteMs: e.slots[1].fimMs + 300_000, restrito: true };
    const dec = executarCorteSombra(par);
    const oc = diagnosticarOciosidade(par, dec);
    const validas = new Set(["sem_trabalho_valido", "revezamento_duro", "maquina_indisponivel", "limite_wip", "material", "nenhuma_maquina_compativel", "outro"]);
    expect(oc.length).toBeGreaterThan(0);
    oc.forEach((o) => { expect(validas.has(o.causa)).toBe(true); expect(o.detalhe.length).toBeGreaterThan(5); });
    const futurosOciosos = [...dec.horizonte.comprometidas, ...dec.horizonte.alteravel].filter((a) => !a.maquinaId).length;
    expect(oc.length).toBe(futurosOciosos);
  });
  it("revezamento duro vira a causa quando o motor marca o posto vazio por rotação", () => {
    const e = mundo({ pessoas: 3 });
    const plano = gerarEscala(e).alocacoes;
    const par = { base: e, ausencias: [], indisponibilidades: [], apontamentos: [], planoOficial: plano, c: 0, corteMs: e.slots[0].fimMs + 300_000, restrito: true };
    const dec = executarCorteSombra(par);
    const oc = diagnosticarOciosidade(par, dec);
    const porRot = [...dec.horizonte.comprometidas, ...dec.horizonte.alteravel].filter((a) => !a.maquinaId && a.motivoSemPosto === MOTIVO_REVEZAMENTO).length;
    expect(oc.filter((o) => o.causa === "revezamento_duro").length).toBeGreaterThanOrEqual(porRot);
  });
});

describe("contarRepeticoes", () => {
  it("detecta repetição consecutiva e respeita o reinício do dia", () => {
    const e = mundo();
    const l = (periodoId: string, data = DIAS[0], opId = "X"): AlocacaoEscala => ({ data, periodoId, funcionarioId: "f1", maquinaId: "m", produtoId: "P", etapaId: "e", operacaoId: opId, pecas: 1, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null });
    expect(contarRepeticoes([l("m1"), l("m2")], e.slots)).toBe(1);
    expect(contarRepeticoes([l("m1"), l("m2", DIAS[0], "Y")], e.slots)).toBe(0);
    expect(contarRepeticoes([l("t3"), l("m1", DIAS[1])], e.slots)).toBe(0); // dia novo zera
    expect(contarRepeticoes([l("m3"), l("t1")], e.slots)).toBe(1); // M3→T1 conta
  });
});

describe("WIP não é objetivo: só ocupa capacidade que ficaria ociosa", () => {
  it("todo aumento de WIP vem acompanhado de pessoa-períodos ociosos evitados, com o motivo registrado", () => {
    const e = mundo({ pessoas: 7 });
    const plano = gerarEscala(e).alocacoes;
    const aps: ApontamentoReal[] = plano.filter((a) => a.maquinaId && idx(e, a) <= 1).map((a) => ({ data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId, boas: Math.round((a.pecas + (a.pecasAdicional ?? 0)) * 1.3), refugo: 0, meta: a.pecas + (a.pecasAdicional ?? 0), status: "produzindo" as const, motivo: null, lancadoEmMs: e.slots[idx(e, a)].fimMs + 60_000 }));
    const par = { base: e, ausencias: [], indisponibilidades: [], apontamentos: aps, planoOficial: plano, c: 1, corteMs: e.slots[1].fimMs + 300_000, restrito: true };
    const dec = executarCorteSombra(par);
    const prop = construirProposta(par, dec);
    expect(prop.wip.semOciosidade).toEqual([]);
    expect(prop.wip.pessoaPeriodosWip).toBeGreaterThan(0);
    expect(prop.wip.ociososEvitados).toBeGreaterThan(0);
    expect(prop.wip.ociososEvitados).toBeLessThanOrEqual(prop.wip.ociososSemWip);
    expect(prop.wip.delta).toBe(prop.wip.depois - prop.wip.antes);
    prop.wip.aumentos.forEach((a) => { expect(a.para).toBeGreaterThan(a.de); expect(a.motivo).toMatch(/ociosas/); expect(a.motivo).not.toMatch(/SEM OCIOSIDADE/); });
    // postos de WIP nunca excedem as pessoas que ficariam ociosas sem o WIP, período a período
    (dec.wipPreenchimento?.periodos ?? []).forEach((p) => expect(p.wipPostos).toBeLessThanOrEqual(p.ociososSemWip));
  });
  it("sem capacidade ociosa o WIP não cresce (equipe saturada)", () => {
    const e = mundo({ pessoas: 4, qEmbalar: 1150, qQ: 1500 });
    const r = sim(e, () => 1);
    r.cortes.forEach((c) => { expect(c.wipSemOciosidade).toBe(0); expect(c.wipDelta).toBeLessThanOrEqual(0); });
    expect(wipTotal(r.planoFinal)).toBeLessThanOrEqual(wipTotal(gerarEscala(e).alocacoes) + 1);
  });
});

describe("estabilidade como desempate", () => {
  const l = (periodoId: string, f: string, maq: string | null, op: string | null, extra: Partial<AlocacaoEscala> = {}): AlocacaoEscala => ({ data: DIAS[0], periodoId, funcionarioId: f, maquinaId: maq, produtoId: maq ? "P" : null, etapaId: maq ? "P-e1" : null, operacaoId: op, pecas: maq ? 100 : 0, motivoSemPosto: maq ? null : "sem carga", excecaoRevezamento: false, motivoExcecao: null, ...extra });
  const e = mundo({ wip: false });
  it("mesmos postos com pessoas trocadas => volta a alocação vigente (resultado produtivo idêntico)", () => {
    const oficial = [l("m3", "f1", "a1", "X"), l("m3", "f2", "a2", "Y"), l("m3", "f3", null, null)];
    const proposta = [l("m3", "f2", "a1", "X"), l("m3", "f1", "a2", "Y"), l("m3", "f3", null, null)];
    const r = estabilizarPessoas(proposta, oficial, [], e.slots);
    expect(r.estabilizou).toBe(true);
    const por = Object.fromEntries(r.linhas.map((a) => [a.funcionarioId, a.maquinaId]));
    expect(por).toEqual({ f1: "a1", f2: "a2", f3: null });
    const mud = classificarMudancas(oficial, proposta, e.slots, 2);
    expect(mud).toEqual({ produtivas: 0, trocasEquivalentes: 2 });
  });
  it("não viola o revezamento: quem fez a operação X no período anterior não volta a ela, mesmo que fosse a alocação vigente", () => {
    const oficial = [l("m3", "f1", "a1", "X"), l("m3", "f2", "a2", "Y")];
    const proposta = [l("m3", "f2", "a1", "X"), l("m3", "f1", "a2", "Y")];
    const antes = [l("m2", "f1", "a1", "X"), l("m2", "f2", "a2", "Y")];
    const r = estabilizarPessoas(proposta, oficial, antes, e.slots);
    const por = Object.fromEntries(r.linhas.map((a) => [a.funcionarioId, a.operacaoId]));
    expect(por).toEqual({ f1: "Y", f2: "X" }); // f1 não pode repetir X
  });
  it("troca manual fica com a mesma pessoa", () => {
    const oficial = [l("m3", "f1", "a1", "X"), l("m3", "f2", "a2", "Y")];
    const proposta = [l("m3", "f2", "a1", "X", { origem: "manual" }), l("m3", "f1", "a2", "Y")];
    const r = estabilizarPessoas(proposta, oficial, [], e.slots);
    expect(r.linhas.find((a) => a.maquinaId === "a1")?.funcionarioId).toBe("f2");
  });
  it("mudança produtiva real é contada como produtiva", () => {
    const oficial = [l("m3", "f1", "a1", "X"), l("m3", "f2", null, null)];
    const novo = [l("m3", "f1", "a1", "X"), l("m3", "f2", "a2", "Y")];
    expect(classificarMudancas(oficial, novo, e.slots, 1)).toEqual({ produtivas: 1, trocasEquivalentes: 0 });
  });
});
