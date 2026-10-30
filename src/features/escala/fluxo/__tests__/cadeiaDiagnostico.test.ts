// PLANEJAMENTO DE CADEIA — CAMADA 1 (diagnóstico). Nunca altera o plano; padrão desligado = saída byte-idêntica.
import { describe, it, expect } from "vitest";
import { prepararFluxo } from "../estado";
import { planejarComFluxo } from "../planejar";
import { simularCadeia } from "../cadeia";
import type { ContagemFisicaPar } from "../tipos";
import { apontarPlano, equipe, montar, pool } from "./helpersFluxo";
import { cadeia4 } from "./cadeiaHelpers";
import { CHAVE_PR_CADEIA_DIAGNOSTICO, lerConfigFluxo } from "@/lib/escala/fluxo/parametrosFluxo";

describe("cadeia — camada 1: validação período a período sob lote", () => {
  it("6.000 em estoque e consumo de 3.000/período: dura 2 períodos, a ruptura vem no 3º e o último período seguro para ligar o upstream é o 2º", () => {
    const x = cadeia4({ estoque: [6000, 6000, 60000], cadeia: { diagnostico: true } });
    const sim = simularCadeia(x.ctx, x.m.planoCompleto, { semProximoDia: true });
    const e = sim.violacoes.filter((v) => v.noId === "P|E");
    expect(e.length).toBeGreaterThan(0);
    const w0 = sim.wip["P|Pa"][0]; // o que sobra no 1º período alterável (períodos já em curso consomem 3.000 cada)
    expect(w0 % 3000).toBe(0);
    expect(e[0].slot).toBe(x.ctx.aPartirDe + w0 / 3000); // dura w0/3000 períodos; a ruptura é no seguinte
    expect(e[0].ultimoSeguro).toBe(e[0].slot - 1); // lead time de 1 período
    expect(e[0].deficit).toBeCloseTo(3000, 3);
    expect(sim.wip["P|Pa"].slice(0, 3)).toEqual([w0, Math.max(0, w0 - 3000), Math.max(0, w0 - 6000)]);
  });
  it("estoque que cobre a semana inteira: sem violação (a validação não inventa problema)", () => {
    const x = cadeia4({ estoque: [60000, 60000, 60000], cadeia: { diagnostico: true } });
    expect(simularCadeia(x.ctx, x.m.planoCompleto, { semProximoDia: true }).violacoes).toEqual([]);
  });
  it("o consumo é limitado ao disponível no INÍCIO do período (produção do próprio período não conta)", () => {
    const x = cadeia4({ estoque: [60000, 1000, 60000], cadeia: { diagnostico: true } });
    const sim = simularCadeia(x.ctx, x.m.planoCompleto, { semProximoDia: true });
    const v = sim.violacoes.find((y) => y.noId === "P|E" && y.slot === x.ctx.aPartirDe);
    expect(sim.wip["P|Pa"][0]).toBeLessThanOrEqual(1000);
    expect(v?.disponivel).toBeCloseTo(sim.wip["P|Pa"][0], 3);
    expect((v?.deficit ?? 0) + (v?.disponivel ?? 0)).toBeCloseTo(3000, 3);
  });
  it("período extra do próximo dia: o consumo desejado é limitado pela capacidade E pela demanda futura conhecida (nunca infinito)", () => {
    const livre = cadeia4({ estoque: [0, 0, 0], cadeia: { diagnostico: true, demandaFuturaPorProduto: { P: 500 } } });
    const sim = simularCadeia(livre.ctx, [], {});
    const prox = sim.violacoes.filter((v) => v.proximoDia);
    expect(prox.length).toBeGreaterThan(0);
    prox.forEach((v) => expect(v.desejada).toBeLessThanOrEqual(500 + 1e-6));
    const semDemanda = cadeia4({ estoque: [0, 0, 0], cadeia: { diagnostico: true, demandaFuturaPorProduto: {} } });
    expect(simularCadeia(semDemanda.ctx, [], {}).violacoes.filter((v) => v.proximoDia)).toEqual([]); // produto fora da Previsão da próxima semana ⇒ 0
  });
});

describe("cadeia — camada 1: o diagnóstico NUNCA altera o plano", () => {
  it("com a flag ligada o plano é idêntico ao de flag desligada; só entram diagnósticos novos", () => {
    const off = cadeia4({ estoque: [6000, 6000, 3600] });
    const on = cadeia4({ estoque: [6000, 6000, 3600], cadeia: { diagnostico: true } });
    const rOff = planejarComFluxo(off.m.entrada, off.dados, off.opcoes);
    const rOn = planejarComFluxo(on.m.entrada, on.dados, on.opcoes);
    expect(JSON.stringify(rOn.resultado.alocacoes)).toBe(JSON.stringify(rOff.resultado.alocacoes));
    expect(rOn.diagnostico.planoEscolhido).toBe(rOff.diagnostico.planoEscolhido);
    expect(rOff.diagnostico.diagnosticos.some((d) => d.codigo === "CADEIA_INVALIDA" || d.codigo === "CADEIA_COBERTURA")).toBe(false);
    expect(rOn.diagnostico.diagnosticos.some((d) => d.codigo === "CADEIA_COBERTURA")).toBe(true);
  });
  it("plano com ruptura prevista: CADEIA_INVALIDA com nó, período, déficit e último período seguro", () => {
    const x = cadeia4({ estoque: [6000, 6000, 60000], cadeia: { diagnostico: true } });
    const r = planejarComFluxo(x.m.entrada, x.dados, x.opcoes);
    const sim = simularCadeia(x.ctx, r.resultado.alocacoes);
    // se o motor não repôs o upstream, o diagnóstico acusa (lote ⇒ último seguro = período anterior)
    const inv = r.diagnostico.diagnosticos.filter((d) => d.codigo === "CADEIA_INVALIDA");
    expect(inv.length).toBe(Math.min(12, sim.violacoes.length));
    inv.forEach((d) => { expect(d.detalhes?.deficit).toBeGreaterThan(0); expect((d.detalhes?.ultimoSeguro as number)).toBe((d.slot as number) - 1); });
  });
});

describe("cadeia — camada 1: estado físico", () => {
  it("consumo real maior que o disponível: CONSUMO_REAL_MAIOR_QUE_DISPONIVEL + ESTADO_FISICO_INCONSISTENTE, WIP = 0 (estoque NÃO é inventado); desligado não emite", () => {
    const pools = [pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 6000, maquinas: ["a1"], mu: 500 }), pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 6000, maquinas: ["b1", "b2", "b3"], mu: 200 })];
    const m0 = montar({ pools, funcionarios: equipe(4), c: 1 });
    const apontamentos = apontarPlano(m0.planoCompleto, pools, 1, m0.entrada.slots, (a) => (a.etapaId === "P1" ? 100 : 200));
    const m = montar({ pools, funcionarios: equipe(4), c: 1, apontamentos });
    const contagens: ContagemFisicaPar[] = [{ produtoId: "P", etapaOrigemId: "P1", etapaSeguinteId: "P2", saldo: 100, contadoEmMs: m.entrada.slots[0].inicioMs }];
    const on = planejarComFluxo(m.entrada, { ...m.dados, contagensFisicas: contagens }, { cadeia: { diagnostico: true } });
    const off = planejarComFluxo(m.entrada, { ...m.dados, contagensFisicas: contagens }, {});
    const cods = on.diagnostico.diagnosticos.map((d) => d.codigo);
    expect(cods).toContain("CONSUMO_REAL_MAIOR_QUE_DISPONIVEL");
    expect(cods).toContain("ESTADO_FISICO_INCONSISTENTE");
    expect(on.diagnostico.estado.pares[0].wip).toEqual({ lo: 0, hi: 0 });
    expect(off.diagnostico.diagnosticos.map((d) => d.codigo)).not.toContain("CONSUMO_REAL_MAIOR_QUE_DISPONIVEL");
  });
  it("contagem física: WIP(timestamp) = contagem; só movimentos POSTERIORES entram (apontamentos anteriores não são reaplicados)", () => {
    const pools = [pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 6000, maquinas: ["a1"], mu: 500 }), pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 6000, maquinas: ["b1"], mu: 200 })];
    const m0 = montar({ pools, funcionarios: equipe(3), c: 2 });
    const apontamentos = apontarPlano(m0.planoCompleto, pools, 2, m0.entrada.slots, (a, cap) => cap);
    const m = montar({ pools, funcionarios: equipe(3), c: 2, apontamentos });
    // contagem no INÍCIO do slot 2: o que veio dos slots 0–1 já está dentro do saldo; só o slot 2 em diante soma/subtrai
    const instante = m.entrada.slots[2].inicioMs;
    const ctx = prepararFluxo(m.entrada, { ...m.dados, contagensFisicas: [{ produtoId: "P", etapaOrigemId: "P1", etapaSeguinteId: "P2", saldo: 1234, contadoEmMs: instante }] }, {});
    const par = ctx.pares[0];
    const so2 = apontamentos.filter((a) => a.periodoId === m.entrada.slots[2].periodoId && a.data === m.entrada.slots[2].data);
    const up = so2.filter((a) => a.etapaId === "P1").reduce((s, a) => s + a.boas, 0);
    const dn = so2.filter((a) => a.etapaId === "P2").reduce((s, a) => s + a.boas, 0);
    expect(par.wip.lo).toBeCloseTo(Math.max(0, 1234 + up - dn), 0);
  });
});

describe("cadeia — parâmetros (camada 1)", () => {
  it("só o JSON \"ativo\" liga; ausente/qualquer outro valor = desligado (chave omitida)", () => {
    expect(lerConfigFluxo([{ chave: CHAVE_PR_CADEIA_DIAGNOSTICO, valor: "ativo" }]).cadeia).toEqual({ diagnostico: true });
    for (const v of ["desligado", true, 1, null, "Ativo", undefined]) expect("cadeia" in lerConfigFluxo([{ chave: CHAVE_PR_CADEIA_DIAGNOSTICO, valor: v }])).toBe(false);
    expect("cadeia" in lerConfigFluxo([])).toBe(false);
  });
});
