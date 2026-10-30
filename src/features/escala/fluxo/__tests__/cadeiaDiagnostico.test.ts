// CADEIA — DIAGNÓSTICO (producao_real_cadeia_diagnostico). Só OBSERVA: nunca altera o plano; padrão desligado = saída byte-idêntica.
import { describe, it, expect } from "vitest";
import { estadoDaProducao, prepararFluxo } from "../estado";
import { planejarComFluxo } from "../planejar";
import { diagnosticosDeCadeia, simularCadeia, MAX_CADEIA_COBERTURA, MAX_CADEIA_INVALIDA } from "../cadeia";
import type { ContagemFisicaPar } from "../tipos";
import { apontarPlano, equipe, montar, pool } from "./helpersFluxo";
import { cadeia4 } from "./cadeiaHelpers";
import { CHAVE_PR_CADEIA_DIAGNOSTICO, lerConfigFluxo } from "@/lib/escala/fluxo/parametrosFluxo";

describe("cadeia diagnóstico: validação período a período sob lote", () => {
  it("6.000 em estoque e consumo de 3.000/período: dura 2 períodos, a ruptura vem no 3º e o último período seguro para ligar o upstream é o anterior (lead time 1)", () => {
    const x = cadeia4({ estoque: [60000, 6000, 60000], cadeia: { diagnostico: true } });
    const sim = simularCadeia(x.ctx, x.m.planoCompleto);
    const e = sim.violacoes.filter((v) => v.noId === "P|E");
    expect(e.length).toBeGreaterThan(0);
    const w0 = sim.wip["P|Pa"][0]; // o que sobra no 1º período alterável (períodos já em curso consomem 3.000 cada)
    expect(w0 % 3000).toBe(0);
    expect(e[0].slot).toBe(x.ctx.aPartirDe + w0 / 3000);
    expect(e[0].ultimoSeguro).toBe(e[0].slot - 1);
    expect(e[0].deficit).toBeCloseTo(3000, 3);
    expect(sim.wip["P|Pa"].slice(0, 3)).toEqual([w0, Math.max(0, w0 - 3000), Math.max(0, w0 - 6000)]);
  });
  it("estoque que cobre a semana inteira: sem violação (não inventa problema)", () => {
    const x = cadeia4({ estoque: [60000, 60000, 60000], cadeia: { diagnostico: true } });
    expect(simularCadeia(x.ctx, x.m.planoCompleto).violacoes).toEqual([]);
  });
  it("o consumo é limitado ao disponível no INÍCIO do período (produção do próprio período não conta)", () => {
    const x = cadeia4({ estoque: [60000, 1000, 60000], cadeia: { diagnostico: true } });
    const sim = simularCadeia(x.ctx, x.m.planoCompleto);
    const v = sim.violacoes.find((y) => y.noId === "P|E" && y.slot === x.ctx.aPartirDe);
    expect(sim.wip["P|Pa"][0]).toBeLessThanOrEqual(1000);
    expect(v?.disponivel).toBeCloseTo(sim.wip["P|Pa"][0], 3);
    expect((v?.deficit ?? 0) + (v?.disponivel ?? 0)).toBeCloseTo(3000, 3);
  });
  it("cadeia de 4 etapas: a ruptura aparece no nó certo e a simulação não escreve em nada (entrada e plano intactos)", () => {
    const x = cadeia4({ estoque: [3000, 0, 60000], dias: ["2026-10-26"], cadeia: { diagnostico: true } });
    const antes = JSON.stringify([x.m.planoCompleto, x.ctx.iniAPartirDe]);
    const sim = simularCadeia(x.ctx, x.m.planoCompleto);
    expect(sim.violacoes.some((v) => v.noId === "P|E")).toBe(true);
    expect(JSON.stringify([x.m.planoCompleto, x.ctx.iniAPartirDe])).toBe(antes);
  });
});

describe("cadeia diagnóstico: NUNCA altera o plano", () => {
  it("com a flag ligada o plano e todos os campos de decisão são idênticos ao da flag desligada; só entram diagnósticos novos", () => {
    const off = cadeia4({ estoque: [6000, 6000, 3600] });
    const on = cadeia4({ estoque: [6000, 6000, 3600], cadeia: { diagnostico: true } });
    const rOff = planejarComFluxo(off.m.entrada, off.dados, off.opcoes);
    const rOn = planejarComFluxo(on.m.entrada, on.dados, on.opcoes);
    expect(JSON.stringify(rOn.resultado.alocacoes)).toBe(JSON.stringify(rOff.resultado.alocacoes));
    const { diagnosticos: dOn, ...restoOn } = rOn.diagnostico;
    const { diagnosticos: dOff, ...restoOff } = rOff.diagnostico;
    expect(JSON.stringify(restoOn)).toBe(JSON.stringify(restoOff));
    expect(dOff.some((d) => /^CADEIA_|CONSUMO_REAL|ESTADO_FISICO/.test(d.codigo))).toBe(false);
    expect(dOn.filter((d) => !/^CADEIA_/.test(d.codigo))).toEqual(dOff);
    expect(dOn.some((d) => d.codigo === "CADEIA_COBERTURA")).toBe(true);
  });
  it("CADEIA_INVALIDA: nó, período, produção planejada, material, déficit, último período seguro, ação sugerida e CONFIANÇA explícita; severidade aviso; planoAlterado=false", () => {
    const x = cadeia4({ estoque: [60000, 6000, 60000], cadeia: { diagnostico: true } });
    const r = planejarComFluxo(x.m.entrada, x.dados, x.opcoes);
    const sim = simularCadeia(x.ctx, r.resultado.alocacoes);
    const inv = r.diagnostico.diagnosticos.filter((d) => d.codigo === "CADEIA_INVALIDA");
    expect(inv.length).toBe(Math.min(MAX_CADEIA_INVALIDA, sim.violacoes.length));
    inv.forEach((d) => {
      expect(d.severidade).toBe("aviso");
      expect(d.detalhes?.deficit).toBeGreaterThan(0);
      expect(d.detalhes?.ultimoSeguro).toBe((d.slot as number) - 1);
      expect(d.detalhes?.confiancaWip).toBe("contagem_fisica"); // WIP ancorado em contagem
      expect(d.detalhes?.planoAlterado).toBe(false);
      expect(d.mensagem).toMatch(/produção planejada \d+, material disponível \d+, déficit \d+\. Ação sugerida: o upstream precisava ter sido ligado até/);
    });
  });
  it("confiança explícita: sem contagem o WIP é 'estimada'/'incerta' (nunca promovida a verdade física); com contagem 'contagem_fisica'", () => {
    const x = cadeia4({ estoque: [6000, 6000, 3600], cadeia: { diagnostico: true } });
    const comContagem = diagnosticosDeCadeia(x.ctx, simularCadeia(x.ctx, x.m.planoCompleto), x.m.planoCompleto).filter((d) => d.codigo === "CADEIA_COBERTURA");
    comContagem.forEach((d) => expect(d.detalhes?.confiancaWip).toBe("contagem_fisica"));
    const semContagem = prepararFluxo(x.m.entrada, { ...x.m.dados }, x.opcoes);
    const diag = diagnosticosDeCadeia(semContagem, simularCadeia(semContagem, x.m.planoCompleto), x.m.planoCompleto);
    expect(diag.length).toBeGreaterThan(0);
    diag.forEach((d) => expect(["estimada", "incerta"]).toContain(d.detalhes?.confiancaWip));
  });
  it("payload limitado: no máximo 12 CADEIA_INVALIDA e 20 CADEIA_COBERTURA por recálculo", () => {
    const x = cadeia4({ estoque: [0, 0, 0], cadeia: { diagnostico: true } });
    const d = diagnosticosDeCadeia(x.ctx, simularCadeia(x.ctx, x.m.planoCompleto), x.m.planoCompleto);
    expect(d.filter((i) => i.codigo === "CADEIA_INVALIDA").length).toBeLessThanOrEqual(MAX_CADEIA_INVALIDA);
    expect(d.filter((i) => i.codigo === "CADEIA_COBERTURA").length).toBeLessThanOrEqual(MAX_CADEIA_COBERTURA);
    expect(JSON.stringify(d).length).toBeLessThan(40_000);
  });
});

describe("cadeia diagnóstico: estado físico (consumo real > disponível) — só registra", () => {
  const pools = () => [pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 60000, maquinas: ["a1"], mu: 3000 }), pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 60000, maquinas: ["b1"], mu: 5400 })];
  function cenario(saldo: number, boasP1: number, boasP2: number) {
    const ps = pools();
    const m0 = montar({ pools: ps, funcionarios: equipe(3), c: 1 });
    const apontamentos = apontarPlano(m0.planoCompleto, ps, 1, m0.entrada.slots, (a) => (a.etapaId === "P1" ? boasP1 : boasP2));
    const m = montar({ pools: ps, funcionarios: equipe(3), c: 1, apontamentos });
    const contagens: ContagemFisicaPar[] = [{ produtoId: "P", etapaOrigemId: "P1", etapaSeguinteId: "P2", saldo, contadoEmMs: m.entrada.slots[0].inicioMs }];
    return { m, dados: { ...m.dados, contagensFisicas: contagens } };
  }
  it("CASO REAL (30/10): Embalagem apontou 5.400 em T1 contra 3.600 contados ⇒ CONSUMO_REAL_MAIOR_QUE_DISPONIVEL + ESTADO_FISICO_INCONSISTENTE; WIP, estoque e plano idênticos ao da flag desligada", () => {
    const { m, dados } = cenario(3600, 2000, 5400); // upstream produziu 2.000 no MESMO período: sob lote só os 3.600 do início valem
    const opts = { fluxoMesmoPeriodo: false };
    const on = estadoDaProducao(m.entrada, dados, { ...opts, cadeia: { diagnostico: true } });
    const off = estadoDaProducao(m.entrada, dados, opts);
    const consumo = on.diagnosticos.filter((d) => d.codigo === "CONSUMO_REAL_MAIOR_QUE_DISPONIVEL");
    expect(consumo.length).toBeGreaterThan(0);
    const lote = consumo.find((d) => d.detalhes?.periodo)!; // checagem sob lote: o 1º período fechado após a contagem
    expect(lote.detalhes?.excesso).toBeCloseTo(1800, 0); // 5.400 consumidos − 3.600 do início (a produção de 2.000 do próprio período NÃO conta)
    consumo.forEach((d) => { expect(d.detalhes?.confiancaDado).toBe("contagem_fisica"); expect(d.detalhes?.wipAlteradoPeloDiagnostico).toBe(false); expect(d.severidade).toBe("aviso"); });
    expect(on.diagnosticos.some((d) => d.codigo === "ESTADO_FISICO_INCONSISTENTE")).toBe(true);
    // NADA do estado mudou: pares (WIP lo/hi/bruto), projeção, demanda, rem — iguais; só os diagnósticos têm itens a mais
    const { diagnosticos: _a, ...restoOn } = on;
    const { diagnosticos: _b, ...restoOff } = off;
    void _a; void _b;
    expect(JSON.stringify(restoOn)).toBe(JSON.stringify(restoOff));
    expect(off.diagnosticos.some((d) => /CONSUMO_REAL|ESTADO_FISICO/.test(d.codigo))).toBe(false);
  });
  it("sem excesso: nenhum diagnóstico de inconsistência (a checagem não gera falso alarme)", () => {
    const { m, dados } = cenario(20000, 1000, 5400);
    const on = estadoDaProducao(m.entrada, dados, { fluxoMesmoPeriodo: false, cadeia: { diagnostico: true } });
    expect(on.diagnosticos.some((d) => /CONSUMO_REAL|ESTADO_FISICO/.test(d.codigo))).toBe(false);
  });
  it("tolerância de arredondamento da contagem: excesso de 100 peças (< max(250, 5%)) NÃO gera diagnóstico", () => {
    const { m, dados } = cenario(3600, 3700, 3700);
    const on = estadoDaProducao(m.entrada, dados, { fluxoMesmoPeriodo: false, cadeia: { diagnostico: true } });
    expect(on.diagnosticos.some((d) => /CONSUMO_REAL|ESTADO_FISICO/.test(d.codigo))).toBe(false);
  });
  it("estimativa contínua: consumo > contagem + produção da origem ⇒ diagnóstico (WIP segue piso 0, sem inventar estoque)", () => {
    const { m, dados } = cenario(100, 100, 400);
    const on = estadoDaProducao(m.entrada, dados, { cadeia: { diagnostico: true } });
    expect(on.diagnosticos.map((d) => d.codigo)).toContain("CONSUMO_REAL_MAIOR_QUE_DISPONIVEL");
    on.pares.forEach((p) => expect(p.wip.lo).toBeGreaterThanOrEqual(0));
    expect(on.pares[0].wip).toEqual({ lo: 0, hi: 0 });
  });
  it("contagem física continua a verdade: WIP(timestamp) = contagem; só movimentos POSTERIORES entram (apontamentos anteriores não são reaplicados)", () => {
    const ps = [pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 6000, maquinas: ["a1"], mu: 500 }), pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 6000, maquinas: ["b1"], mu: 200 })];
    const m0 = montar({ pools: ps, funcionarios: equipe(3), c: 2 });
    const apontamentos = apontarPlano(m0.planoCompleto, ps, 2, m0.entrada.slots, (_a, cap) => cap);
    const m = montar({ pools: ps, funcionarios: equipe(3), c: 2, apontamentos });
    const instante = m.entrada.slots[2].inicioMs;
    const dados = { ...m.dados, contagensFisicas: [{ produtoId: "P", etapaOrigemId: "P1", etapaSeguinteId: "P2", saldo: 1234, contadoEmMs: instante }] };
    const so2 = apontamentos.filter((a) => a.periodoId === m.entrada.slots[2].periodoId && a.data === m.entrada.slots[2].data);
    const up = so2.filter((a) => a.etapaId === "P1").reduce((s, a) => s + a.boas, 0);
    const dn = so2.filter((a) => a.etapaId === "P2").reduce((s, a) => s + a.boas, 0);
    for (const cadeia of [undefined, { diagnostico: true }]) {
      const par = prepararFluxo(m.entrada, dados, cadeia ? { cadeia } : {}).pares[0];
      expect(par.wip.lo).toBeCloseTo(Math.max(0, 1234 + up - dn), 0);
    }
  });
});

describe("cadeia diagnóstico: parâmetros", () => {
  it("só o JSON \"ativo\" liga; ausente/qualquer outro valor = desligado (chave omitida); nenhuma outra camada é lida", () => {
    expect(lerConfigFluxo([{ chave: CHAVE_PR_CADEIA_DIAGNOSTICO, valor: "ativo" }]).cadeia).toEqual({ diagnostico: true });
    for (const v of ["desligado", true, 1, null, "Ativo", undefined]) expect("cadeia" in lerConfigFluxo([{ chave: CHAVE_PR_CADEIA_DIAGNOSTICO, valor: v }])).toBe(false);
    expect("cadeia" in lerConfigFluxo([])).toBe(false);
    for (const chave of ["producao_real_cadeia_allowed", "producao_real_cadeia_reparo", "producao_real_cadeia_saida"]) expect("cadeia" in lerConfigFluxo([{ chave, valor: "ativo" }])).toBe(false);
  });
});
