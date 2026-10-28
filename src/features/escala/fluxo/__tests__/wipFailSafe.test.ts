// FAIL-SAFE de estoque inicial DESCONHECIDO + CONTAGEM FÍSICA confirmada (docs/escala-fluxo-contagem-fisica.md).
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../../gerarEscala";
import { estadoDaProducao } from "../estado";
import { avaliarPlano } from "../avaliar";
import { planejarComFluxo } from "../planejar";
import { acharAresta, acumuladoDesde, validarContagens } from "../contagem";
import { construirGrafo } from "../grafo";
import type { ContagemFisicaPar } from "../tipos";
import { apontarPlano, checarFluxo, equipe, MIN, montar, pool, rodar, jsonSerializavel } from "./helpersFluxo";

const dois = () => [
  pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 6000, maquinas: ["a1"], mu: 500 }),
  pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 6000, maquinas: ["b1", "b2", "b3"], mu: 200 }),
];
// P1 produziu pouco, P2 (a jusante) produziu MAIS do que P1 entregou ⇒ saldo bruto negativo = estoque inicial desconhecido
const apontarNegativo = (m: ReturnType<typeof montar>, pools: ReturnType<typeof dois>) =>
  apontarPlano(m.planoCompleto, pools, 1, m.entrada.slots, (a) => (a.etapaId === "P1" ? 100 : 200));

function cenario(opcoes = {}, extraDados: Record<string, unknown> = {}) {
  const pools = dois();
  const funcionarios = equipe(4);
  const m0 = montar({ pools, funcionarios, c: 1 });
  const apontamentos = apontarNegativo(m0, pools);
  const m = montar({ pools, funcionarios, c: 1, apontamentos });
  return { pools, m, dados: { ...m.dados, ...extraDados }, opcoes };
}
const par = (e: ReturnType<typeof estadoDaProducao>) => e.pares.find((p) => p.etapaOrigemId === "P1")!;

describe("fail-safe: par sem saldo confirmado, confiança baixa e bruto.lo < 0", () => {
  it("marca o par como desconhecido, com diagnóstico WIP_INICIAL_DESCONHECIDO (aviso, par, bruto e motivo)", () => {
    const { m, dados } = cenario();
    const e = estadoDaProducao(m.entrada, dados);
    const p = par(e);
    expect(p.bruto.lo).toBeLessThan(0);
    expect(p.confianca).toBe("baixa");
    expect(p.desconhecido).toBe(true);
    expect(p.wip.lo).toBe(0); // o piso 0 continua sendo o WIP derivado; o que muda é o que ele significa
    const d = e.diagnosticos.find((x) => x.codigo === "WIP_INICIAL_DESCONHECIDO")!;
    expect(d.severidade).toBe("aviso");
    expect(d.produtoId).toBe("P");
    expect(d.detalhes?.brutoLo).toBe(p.bruto.lo);
    expect(String(d.detalhes?.motivo)).toContain("bruto.lo < 0");
  });
  it("com failSafeWipDesconhecido=false não marca nada (comportamento anterior)", () => {
    const { m, dados } = cenario();
    const e = estadoDaProducao(m.entrada, dados, { failSafeWipDesconhecido: false });
    expect(par(e).desconhecido).toBeUndefined();
    expect(e.diagnosticos.some((x) => x.codigo === "WIP_INICIAL_DESCONHECIDO")).toBe(false);
  });
  it("o consumo downstream NÃO fica limitado pelo WIP 0: com o upstream parado a produção final prevista só existe com o fail-safe, e o downstream do plano base é mantido", () => {
    const pools = dois();
    const funcionarios = equipe(4);
    const m0 = montar({ pools, funcionarios, c: 1 });
    const apontamentos = apontarNegativo(m0, pools);
    // upstream (a1) fora desde o início da semana: sem fail-safe nada alimenta o downstream além do WIP 0 derivado
    const extra = { indisponibilidades: [{ maquinaId: "a1", desdeMs: m0.entrada.slots[0].inicioMs, liberadaEmMs: null }] };
    const m = montar({ pools, funcionarios, c: 1, apontamentos, extra });
    const base = gerarEscala(m.entrada).alocacoes;
    const antes = avaliarPlano(m.entrada, m.dados, [...m.entrada.congeladas, ...base], { failSafeWipDesconhecido: false });
    const depois = avaliarPlano(m.entrada, m.dados, [...m.entrada.congeladas, ...base], {});
    expect(antes.totais.finalEntregueLo).toBeLessThanOrEqual(1);
    expect(depois.totais.finalEntregueLo).toBeGreaterThan(1000);
    const r = planejarComFluxo(m.entrada, m.dados, {});
    const p2 = (l: { etapaId: string | null; maquinaId: string | null }[]) => l.filter((a) => a.maquinaId && a.etapaId === "P2").length;
    const fut = (l: typeof base) => l.filter((a) => (m.entrada.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? -1) >= m.entrada.aPartirDe);
    expect(p2(r.resultado.alocacoes)).toBeGreaterThanOrEqual(p2(fut(base))); // nenhum posto downstream do base é retirado por causa do WIP desconhecido
    // o plano ATUAL (fail-safe desligado) abandona o downstream; o novo não
    const r0 = planejarComFluxo(m.entrada, m.dados, { failSafeWipDesconhecido: false });
    expect(p2(r.resultado.alocacoes)).toBeGreaterThan(p2(r0.resultado.alocacoes));
    expect(checarFluxo({ r, entrada: m.entrada })).toEqual([]);
    expect(jsonSerializavel(r.diagnostico)).toBe(true);
  });
  it("o teto de utilidade do UPSTREAM segue o mesmo de antes (Allowed_k inalterado pelo fail-safe)", () => {
    const { m, dados } = cenario();
    const on = estadoDaProducao(m.entrada, dados).demanda.find((d) => d.etapaId === "P1")!;
    const off = estadoDaProducao(m.entrada, dados, { failSafeWipDesconhecido: false }).demanda.find((d) => d.etapaId === "P1")!;
    expect(on.tetoUtilidade).toBe(off.tetoUtilidade);
    expect(on.demandaFluxo).toBe(off.demandaFluxo);
  });
  it("par com bruto positivo e confiança média (tipo Caixa Amarela) NÃO muda", () => {
    const pools = dois();
    const m0 = montar({ pools, funcionarios: equipe(4), c: 1 });
    const ok = apontarPlano(m0.planoCompleto, pools, 1, m0.entrada.slots, (a) => (a.etapaId === "P1" ? 400 : 100));
    const m = montar({ pools, funcionarios: equipe(4), c: 1, apontamentos: ok });
    const a = estadoDaProducao(m.entrada, m.dados);
    const b = estadoDaProducao(m.entrada, m.dados, { failSafeWipDesconhecido: false });
    expect(par(a).bruto.lo).toBeGreaterThan(0);
    expect(par(a).confianca).toBe("media");
    expect(par(a).desconhecido).toBeUndefined();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const ra = planejarComFluxo(m.entrada, m.dados, {});
    const rb = planejarComFluxo(m.entrada, m.dados, { failSafeWipDesconhecido: false });
    expect(JSON.stringify(ra.resultado.alocacoes)).toBe(JSON.stringify(rb.resultado.alocacoes));
  });
  it("determinismo: duas execuções dão o mesmo JSON", () => {
    const { m, dados } = cenario();
    expect(JSON.stringify(planejarComFluxo(m.entrada, dados, {}))).toBe(JSON.stringify(planejarComFluxo(m.entrada, dados, {})));
  });
});

// ---- contagem física ---------------------------------------------------------------------------------------------------------
const instante = (m: ReturnType<typeof montar>, i: number, deslocMin = 0) => m.entrada.slots[i].inicioMs + deslocMin * MIN;
const contagem = (m: ReturnType<typeof montar>, saldo: number, ms: number, extra: Partial<ContagemFisicaPar> = {}): ContagemFisicaPar => ({ produtoId: "P", etapaOrigemId: "P1", etapaSeguinteId: "P2", saldo, contadoEmMs: ms, ...extra });

describe("contagem física confirmada", () => {
  it("substitui o estimado: origem confirmado/contagem_fisica, confiança alta, SEM fail-safe", () => {
    const { m, dados } = cenario();
    // contagem no início do slot 0 (antes de toda a produção da semana): saldo 6000
    const e = estadoDaProducao(m.entrada, { ...dados, contagensFisicas: [contagem(m, 6000, instante(m, 0))] });
    const p = par(e);
    expect(p.origem).toBe("confirmado");
    expect(p.fonteConfirmacao).toBe("contagem_fisica");
    expect(p.confianca).toBe("alta");
    expect(p.desconhecido).toBeUndefined();
    expect(p.wip.lo).toBeGreaterThan(5000);
    expect(e.diagnosticos.some((x) => x.codigo === "CONTAGEM_FISICA_USADA")).toBe(true);
    expect(e.diagnosticos.some((x) => x.codigo === "WIP_INICIAL_DESCONHECIDO")).toBe(false);
  });
  it("contagem + produção posterior: WIP = saldo + boas origem − boas seguinte DEPOIS da contagem (períodos anteriores não entram)", () => {
    const { m, dados } = cenario();
    // slot 0 produziu P1 100×n e P2 200×n; contagem exatamente no início do slot 1: só o slot 1 entra
    const T = instante(m, 1);
    const e = estadoDaProducao(m.entrada, { ...dados, contagensFisicas: [contagem(m, 1000, T)] });
    const aptos = dados.apontamentos.filter((a) => a.periodoId === m.entrada.slots[1].periodoId && a.data === m.entrada.slots[1].data);
    const up = aptos.filter((a) => a.etapaId === "P1").reduce((s, a) => s + a.boas, 0);
    const dn = aptos.filter((a) => a.etapaId === "P2").reduce((s, a) => s + a.boas, 0);
    expect(par(e).bruto.lo).toBeCloseTo(1000 + up - dn, 3);
    expect(par(e).bruto.hi).toBeCloseTo(1000 + up - dn, 3);
  });
  it("piso 0 + WIP_NEGATIVO_ESTIMADO quando a contagem ainda deixa o saldo negativo", () => {
    const { m, dados } = cenario();
    const e = estadoDaProducao(m.entrada, { ...dados, contagensFisicas: [contagem(m, 0, instante(m, 0))] });
    const p = par(e);
    expect(p.bruto.hi).toBeLessThan(0);
    expect(p.wip).toEqual({ lo: 0, hi: 0 });
    expect(p.negativo).toBe(true);
    expect(e.diagnosticos.some((x) => x.codigo === "WIP_NEGATIVO_ESTIMADO")).toBe(true);
    expect(p.desconhecido).toBeUndefined(); // contagem confirma: o fallback não se aplica
  });
  it("período em andamento na contagem: só entra o lançado DEPOIS; período já encerrado (mesmo lançado tarde) nunca entra", () => {
    const { m, dados } = cenario();
    const grafo = construirGrafo(m.entrada.pools);
    const s0 = m.entrada.slots[0];
    const T = s0.inicioMs + 10 * MIN; // slot 0 em andamento
    const regs = [{ t: 0, no: "P|P1", estado: "confirmado" as const, planejado: 0, linhas: [{ boas: 40, lancadoEmMs: T - MIN }, { boas: 60, lancadoEmMs: T + MIN }] }];
    expect(acumuladoDesde(regs, m.entrada.slots, T, "P|P1")).toEqual({ lo: 60, hi: 60 });
    expect(acumuladoDesde(regs, m.entrada.slots, s0.fimMs + MIN, "P|P1")).toEqual({ lo: 0, hi: 0 }); // período encerrado antes da contagem
    const nc = [{ t: 0, no: "P|P1", estado: "nao_confirmado" as const, planejado: 100, linhas: [] }];
    const f = (s0.fimMs - T) / (s0.fimMs - s0.inicioMs);
    expect(acumuladoDesde(nc, m.entrada.slots, T, "P|P1").hi).toBeCloseTo(100 * f, 6);
    expect(acharAresta(grafo, { produtoId: "P", etapaOrigemId: "P1", etapaSeguinteId: "P2" })?.id).toBe("P|P1");
    void dados;
  });
  it("duas contagens do mesmo par: vale a mais recente (a outra é ignorada com diagnóstico)", () => {
    const { m, dados } = cenario();
    const lista = [contagem(m, 111, instante(m, 0)), contagem(m, 5000, instante(m, 1))];
    const e = estadoDaProducao(m.entrada, { ...dados, contagensFisicas: lista });
    expect(par(e).contagem?.saldo).toBe(5000);
    expect(e.diagnosticos.filter((x) => x.codigo === "CONTAGEM_FISICA_IGNORADA")).toHaveLength(1);
    const invertida = estadoDaProducao(m.entrada, { ...dados, contagensFisicas: [lista[1], lista[0]] });
    expect(par(invertida).contagem?.saldo).toBe(5000);
  });
  it("itens inválidos são IGNORADOS com diagnóstico e nunca derrubam o cálculo (saldo negativo, par inexistente, futuro, NaN, malformado)", () => {
    const { m, dados } = cenario();
    const bons = instante(m, 0);
    const ruins = [
      contagem(m, -5, bons),
      contagem(m, 10, bons, { etapaSeguinteId: "XX" }),
      contagem(m, 10, dados.agoraMs + 5 * 3_600_000),
      contagem(m, Number.NaN, bons),
      contagem(m, 10, Number.NaN),
      null as unknown as ContagemFisicaPar,
      { produtoId: 1 } as unknown as ContagemFisicaPar,
    ];
    const e = estadoDaProducao(m.entrada, { ...dados, contagensFisicas: ruins });
    expect(e.diagnosticos.filter((x) => x.codigo === "CONTAGEM_FISICA_IGNORADA")).toHaveLength(ruins.length);
    expect(par(e).desconhecido).toBe(true); // sem contagem válida o fail-safe segue valendo
    expect(() => planejarComFluxo(m.entrada, { ...dados, contagensFisicas: ruins }, {})).not.toThrow();
  });
  it("chave ausente / lista vazia = nenhuma contagem: resultado idêntico ao sem o campo", () => {
    const { m, dados } = cenario();
    const a = JSON.stringify(planejarComFluxo(m.entrada, dados, {}));
    expect(JSON.stringify(planejarComFluxo(m.entrada, { ...dados, contagensFisicas: [] }, {}))).toBe(a);
    expect(JSON.stringify(planejarComFluxo(m.entrada, { ...dados, contagensFisicas: undefined }, {}))).toBe(a);
  });
  it("confiança decai de alta para média conforme passam períodos fechados", () => {
    const pools = dois();
    const m0 = montar({ pools, funcionarios: equipe(4), c: 1 });
    const mk = (c: number) => {
      const ap = apontarPlano(m0.planoCompleto, pools, c, m0.entrada.slots, (a) => (a.etapaId === "P1" ? 100 : 200));
      return montar({ pools, funcionarios: equipe(4), c, apontamentos: ap });
    };
    const cedo = mk(1);
    const tarde = mk(9);
    const conf = (m: ReturnType<typeof montar>) => par(estadoDaProducao(m.entrada, { ...m.dados, contagensFisicas: [contagem(m, 3000, m.entrada.slots[0].inicioMs)] })).confianca;
    expect(conf(cedo)).toBe("alta");
    expect(conf(tarde)).toBe("media");
  });
  it("com contagem, a demanda upstream cai (usa o estoque informado) e o plano continua sem violação", () => {
    const { m, dados } = cenario();
    const sem = estadoDaProducao(m.entrada, dados).demanda.find((d) => d.etapaId === "P1")!.demandaFluxo;
    const com = estadoDaProducao(m.entrada, { ...dados, contagensFisicas: [contagem(m, 4000, instante(m, 0))] }).demanda.find((d) => d.etapaId === "P1")!.demandaFluxo;
    expect(com).toBeLessThan(sem);
    const r = planejarComFluxo(m.entrada, { ...dados, contagensFisicas: [contagem(m, 4000, instante(m, 0))] }, {});
    expect(checarFluxo({ r, entrada: m.entrada })).toEqual([]);
  });
  it("validarContagens: contagem em até 30 min à frente de agora é aceita (tratada como agora)", () => {
    const { m, dados } = cenario();
    const grafo = construirGrafo(m.entrada.pools);
    const v = validarContagens(grafo, { ...dados, contagensFisicas: [contagem(m, 10, dados.agoraMs + 10 * MIN)] }, m.entrada.slots);
    expect(v.validas.get("P|P1")?.instanteMs).toBe(dados.agoraMs);
  });
  it("rodar() com contagem não altera o histórico: apontamentos e plano vigente intactos", () => {
    const { m, dados } = cenario();
    const antes = JSON.stringify([dados.apontamentos, dados.planoVigente]);
    rodar({ pools: m.entrada.pools, funcionarios: equipe(4), c: 1, apontamentos: dados.apontamentos, opcoes: {} });
    planejarComFluxo(m.entrada, { ...dados, contagensFisicas: [contagem(m, 500, instante(m, 0))] }, {});
    expect(JSON.stringify([dados.apontamentos, dados.planoVigente])).toBe(antes);
  });
});
