// Cenários sintéticos do fluxo (spec §10): linear, multietapa, WIP, material, produção abaixo/acima, sem_producao, sem apontamento, atrasado,
// refugo, máquina parada, ausência, retorno, revezamento, máquina compartilhada. Todos conferem as restrições duras com o verificador
// independente e que a falta final prevista nunca é pior que a do plano base (mesmo simulador).
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../../gerarEscala";
import { estadoDaProducao } from "../estado";
import { avaliarPlano } from "../avaliar";
import { epochMsNoFuso } from "../../tempo";
import { verificarRestricoesDuras } from "../restricoes";
import { ap, apontarPlano, checarFluxo, equipe, MIN, montar, pool, realComoPlano, rodar } from "./helpersFluxo";

const dois = () => [
  pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 6000, maquinas: ["a1"], mu: 500 }),
  pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 6000, maquinas: ["b1", "b2", "b3"], mu: 200 }),
];
const tres = () => [
  pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 6000, maquinas: ["a1"], mu: 500 }),
  pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 6000, maquinas: ["b1", "b2"], mu: 300 }),
  pool({ produto: "P", etapa: "P3", op: "opC", ordem: 3, q: 6000, maquinas: ["c1", "c2"], mu: 250 }),
];
const demanda = (x: ReturnType<typeof estadoDaProducao>, etapa: string) => x.demanda.find((d) => d.etapaId === etapa)!;
const caps = (e: ReturnType<typeof montar>["entrada"]) => e.slots.length;

describe("linear — 1 etapa", () => {
  const pools = [pool({ produto: "U", etapa: "U1", op: "opA", ordem: 1, q: 3000, maquinas: ["m1", "m2"], mu: 400 })];
  it("rem de fluxo = Q − boas confirmadas; plano idêntico ao base quando o real é o planejado", () => {
    const m0 = montar({ pools, funcionarios: equipe(2), c: 2 });
    const real = realComoPlano(m0.planoCompleto, pools, 2, m0.entrada.slots);
    const x = rodar({ pools, funcionarios: equipe(2), c: 2, apontamentos: real });
    const boas = real.reduce((s, a) => s + a.boas, 0);
    expect(demanda(x.r.diagnostico.estado, "U1").remFluxo).toBe(Math.round((3000 - boas) * 1000) / 1000);
    expect(checarFluxo(x)).toEqual([]);
    expect(x.r.diagnostico.depois.faltaPrevista.lo).toBeLessThanOrEqual(x.r.diagnostico.depoisBase.faltaPrevista.lo);
  });
  it("demanda final atendida ⇒ rem 0 e diagnóstico", () => {
    const m0 = montar({ pools, funcionarios: equipe(2), c: 2 });
    const real = [ap({ data: "2026-10-26", periodoId: "m1", maquinaId: "m1", produtoId: "U", etapaId: "U1", boas: 3000 })];
    const x = rodar({ pools, funcionarios: equipe(2), c: 2, apontamentos: real });
    expect(demanda(x.r.diagnostico.estado, "U1").remFluxo).toBe(0);
    expect(x.r.diagnostico.estado.diagnosticos.some((d) => d.codigo === "DEMANDA_FINAL_ATENDIDA")).toBe(true);
    expect(x.r.resultado.alocacoes.filter((a) => a.maquinaId && a.pecas > 0)).toHaveLength(0);
    expect(x.r.diagnostico.planoEscolhido).toBe("fluxo"); // o base ainda produziria o que já foi entregue
    void m0;
  });
});

describe("linear — multietapa", () => {
  it("3 etapas: D_k = R_f − pipeline; o final nunca é limitado pelo teto de utilidade", () => {
    const pools = tres();
    const m0 = montar({ pools, funcionarios: equipe(5), c: 3 });
    const real = realComoPlano(m0.planoCompleto, pools, 3, m0.entrada.slots);
    const x = rodar({ pools, funcionarios: equipe(5), c: 3, apontamentos: real });
    const e = x.r.diagnostico.estado;
    const Rf = demanda(e, "P3").demandaFluxo;
    expect(demanda(e, "P3").tetoUtilidade).toBeNull();
    const w1 = e.pares.find((p) => p.etapaOrigemId === "P1")!.wip.lo;
    const w2 = e.pares.find((p) => p.etapaOrigemId === "P2")!.wip.lo;
    expect(demanda(e, "P2").demandaFluxo).toBeCloseTo(Math.max(0, Rf - w2), 1);
    expect(demanda(e, "P1").demandaFluxo).toBeCloseTo(Math.max(0, Rf - w2 - w1), 1);
    expect(checarFluxo(x)).toEqual([]);
  });
});

describe("upstream sem / com WIP", () => {
  it("sem WIP (etapas em dia): upstream precisa produzir todo o R_f", () => {
    const pools = dois();
    const m0 = montar({ pools, funcionarios: equipe(4), c: 2 });
    const real = realComoPlano(m0.planoCompleto, pools, 2, m0.entrada.slots).filter((a) => a.etapaId === "P1" || a.etapaId === "P2");
    const e = estadoDaProducao(m0.entrada, { ...m0.dados, apontamentos: real.map((a) => ({ ...a, lancadoEmMs: a.lancadoEmMs || 1 })) });
    const d1 = demanda(e, "P1");
    expect(d1.demandaFluxo).toBeLessThanOrEqual(demanda(e, "P2").demandaFluxo + 1e-6);
  });
  it("com WIP real (upstream adiantado): D_1 cai exatamente o WIP", () => {
    const pools = dois();
    const m0 = montar({ pools, funcionarios: equipe(4), c: 2 });
    // etapa 1 produz a capacidade cheia; etapa 2 só 100 por linha: o resto vira estoque
    const apontamentos = apontarPlano(m0.planoCompleto, pools, 2, m0.entrada.slots, (a, cap) => (a.etapaId === "P1" ? cap : 100));
    const e = estadoDaProducao(m0.entrada, { ...m0.dados, apontamentos: apontamentos.map((x) => ({ ...x, lancadoEmMs: 1 })) });
    const par = e.pares[0];
    const b1 = apontamentos.filter((x) => x.etapaId === "P1").reduce((s, x) => s + x.boas, 0);
    const b2 = apontamentos.filter((x) => x.etapaId === "P2").reduce((s, x) => s + x.boas, 0);
    expect(par.wip.lo).toBe(b1 - b2);
    expect(par.wip.hi).toBe(b1 - b2);
    expect(demanda(e, "P1").demandaFluxo).toBeCloseTo(demanda(e, "P2").demandaFluxo - par.wip.lo, 1);
    expect(par.origem).toBe("estimado");
  });
});

describe("downstream sem / com material", () => {
  it("com material: a etapa seguinte é priorizada quando há WIP e a pessoa é escassa", () => {
    const pools = dois();
    const funcionarios = equipe(3);
    const m0 = montar({ pools, funcionarios, c: 1 });
    // etapa 1 produziu muito acima do planejado; a etapa 2 não produziu nada (zero confirmado): sobra WIP
    const apontamentos = apontarPlano(m0.planoCompleto, pools, 1, m0.entrada.slots, (a) => (a.etapaId === "P1" ? 800 : null));
    const x = rodar({ pools, funcionarios, c: 1, apontamentos });
    const b1 = apontamentos.filter((a) => a.etapaId === "P1").reduce((s, a) => s + a.boas, 0);
    expect(x.r.diagnostico.estado.pares[0].wip.lo).toBe(b1);
    const futuro = x.r.resultado.alocacoes.filter((al) => al.maquinaId && al.pecas > 0);
    const etapa2 = futuro.filter((al) => al.etapaId === "P2").length;
    const etapa1 = futuro.filter((al) => al.etapaId === "P1").length;
    expect(etapa2).toBeGreaterThan(etapa1);
    expect(checarFluxo(x)).toEqual([]);
  });
  it("sem material (WIP 0) e etapa 1 PARADA: a falta é reconhecida e nenhuma restrição dura é violada", () => {
    const pools = dois();
    const x = rodar({
      pools, funcionarios: equipe(4), c: 1,
      extra: { indisponibilidades: [{ maquinaId: "a1", desdeMs: epochMsNoFuso("2026-10-26", "00:00"), liberadaEmMs: null }] },
    });
    expect(x.r.diagnostico.depois.produtoFinalPrevisto.lo).toBeLessThanOrEqual(1);
    expect(checarFluxo(x)).toEqual([]);
  });
});

describe("produção abaixo / acima do planejado", () => {
  it("abaixo: R_f cresce acima do rem legado (o plano não finge que o planejado aconteceu)", () => {
    const pools = dois();
    const m0 = montar({ pools, funcionarios: equipe(4), c: 3 });
    const real = realComoPlano(m0.planoCompleto, pools, 3, m0.entrada.slots).map((a) => ({ ...a, boas: a.boas * 0.5 }));
    const x = rodar({ pools, funcionarios: equipe(4), c: 3, apontamentos: real });
    const d2 = demanda(x.r.diagnostico.estado, "P2");
    expect(d2.demandaFluxo).toBeGreaterThan(d2.remLegado);
    expect(checarFluxo(x)).toEqual([]);
  });
  it("acima: R_f menor que o rem legado", () => {
    const pools = dois();
    const m0 = montar({ pools, funcionarios: equipe(4), c: 3 });
    const real = realComoPlano(m0.planoCompleto, pools, 3, m0.entrada.slots).map((a) => ({ ...a, boas: a.boas * 1.5 }));
    const x = rodar({ pools, funcionarios: equipe(4), c: 3, apontamentos: real });
    const d2 = demanda(x.r.diagnostico.estado, "P2");
    expect(d2.demandaFluxo).toBeLessThan(d2.remLegado);
    expect(checarFluxo(x)).toEqual([]);
  });
});

describe("sem_producao / sem apontamento / atrasado / refugo", () => {
  it("sem_producao: zero_confirmado, não vira não-confirmado nem produção; falta_material gera diagnóstico", () => {
    const pools = dois();
    const apontamentos = [
      ap({ data: "2026-10-26", periodoId: "m1", maquinaId: "b1", produtoId: "P", etapaId: "P2", boas: 0, status: "sem_producao", motivo: "falta_material" }),
      ap({ data: "2026-10-26", periodoId: "m1", maquinaId: "a1", produtoId: "P", etapaId: "P1", boas: 500 }),
    ];
    const m0 = montar({ pools, funcionarios: equipe(4), c: 0, apontamentos });
    const e = estadoDaProducao(m0.entrada, m0.dados);
    const cel = e.celulas.find((c) => c.maquinaId === "b1" && c.slot === 0)!;
    expect(cel.estado).toBe("zero_confirmado");
    expect(cel.boas).toEqual({ lo: 0, hi: 0 });
    expect(cel.motivo).toBe("falta_material");
    expect(e.diagnosticos.some((d) => d.codigo === "SEM_PRODUCAO_FALTA_MATERIAL")).toBe(true);
    // as outras máquinas planejadas e sem linha viram nao_confirmado
    expect(e.celulas.filter((c) => c.slot === 0 && c.estado === "nao_confirmado").every((c) => c.maquinaId !== "b1" && c.maquinaId !== "a1")).toBe(true);
  });
  it("sem apontamento: período fechado com máquina planejada vira [0, planejado] + PRODUCAO_NAO_CONFIRMADA; nunca assume o planejado", () => {
    const pools = dois();
    const m0 = montar({ pools, funcionarios: equipe(4), c: 1, apontamentos: [] });
    const e = estadoDaProducao(m0.entrada, m0.dados);
    const nc = e.celulas.filter((c) => c.estado === "nao_confirmado");
    expect(nc.length).toBeGreaterThan(0);
    expect(nc.every((c) => c.boas.lo === 0 && c.boas.hi === c.planejado && c.planejado > 0)).toBe(true);
    expect(e.diagnosticos.some((d) => d.codigo === "PRODUCAO_NAO_CONFIRMADA")).toBe(true);
    const etapa = e.etapas.find((x) => x.etapaId === "P1")!;
    expect(etapa.boas.lo).toBe(0);
    expect(etapa.boas.hi).toBeGreaterThan(0);
    // R_f usa o limite inferior: nada confirmado ⇒ demanda final restante = Q
    expect(e.produtos[0].demandaFinalRestante).toBe(6000);
    expect(e.produtos[0].demandaFinalRestanteMin).toBeLessThan(6000);
    expect(e.produtos[0].restanteEmAPartirDe).toBeLessThan(6000); // o que as linhas congeladas ainda produzem é descontado para o motor
    const x = rodar({ pools, funcionarios: equipe(4), c: 1, apontamentos: [] });
    expect(checarFluxo(x)).toEqual([]);
  });
  it("período em andamento NÃO é fechado: sem linha vira futuro, linha parcial conta como real", () => {
    const pools = dois();
    const base = montar({ pools, funcionarios: equipe(4), c: 1 });
    const m0 = montar({ pools, funcionarios: equipe(4), c: 1, aposFimMin: 3 }); // fim + 3 min < 10: ainda não fechado
    expect(m0.dados.agoraMs).toBe(base.dados.agoraMs - 8 * MIN);
    const e = estadoDaProducao(m0.entrada, m0.dados);
    expect(e.ultimoFechado).toBe(0);
    expect(e.celulas.filter((c) => c.slot === 1).every((c) => c.estado === "futuro")).toBe(true);
  });
  it("apontamento atrasado: entra no estado e é marcado AJUSTE_TARDIO; não reescreve o fechamento", () => {
    const pools = dois();
    const m0 = montar({ pools, funcionarios: equipe(4), c: 2, apontamentos: [] });
    const slot0 = m0.entrada.slots[0];
    const tardio = ap({ data: slot0.data, periodoId: slot0.periodoId, maquinaId: "a1", produtoId: "P", etapaId: "P1", boas: 400, lancadoEmMs: slot0.fimMs + 60 * MIN });
    const e = estadoDaProducao(m0.entrada, { ...m0.dados, apontamentos: [tardio] });
    const cel = e.celulas.find((c) => c.slot === 0 && c.maquinaId === "a1")!;
    expect(cel.estado).toBe("confirmado");
    expect(cel.tardio).toBe(true);
    expect(e.diagnosticos.some((d) => d.codigo === "AJUSTE_TARDIO")).toBe(true);
    // lançado DEPOIS de agora: invisível
    const futuro = ap({ data: slot0.data, periodoId: slot0.periodoId, maquinaId: "a1", produtoId: "P", etapaId: "P1", boas: 400, lancadoEmMs: m0.dados.agoraMs + MIN });
    const e2 = estadoDaProducao(m0.entrada, { ...m0.dados, apontamentos: [futuro] });
    expect(e2.celulas.find((c) => c.slot === 0 && c.maquinaId === "a1")!.estado).toBe("nao_confirmado");
  });
  it("refugo: só boas contam; refugo intermediário não vira WIP; refugo final não reduz a meta final", () => {
    const pools = dois();
    const m0 = montar({ pools, funcionarios: equipe(4), c: 0, apontamentos: [] });
    const zeros = apontarPlano(m0.planoCompleto, pools, 0, m0.entrada.slots, () => null).filter((a) => !(a.periodoId === "m1" && (a.maquinaId === "a1" || a.maquinaId === "b1")));
    const mk = (periodo: string, maq: string, et: string, boas: number, refugo: number) => ({ ...ap({ data: "2026-10-26", periodoId: periodo, maquinaId: maq, produtoId: "P", etapaId: et, boas, refugo }), lancadoEmMs: 1 });
    const e = estadoDaProducao(m0.entrada, { ...m0.dados, apontamentos: [...zeros.map((z) => ({ ...z, lancadoEmMs: 1 })), mk("m1", "a1", "P1", 400, 100), mk("m1", "b1", "P2", 150, 50)] });
    const e1 = e.etapas.find((x) => x.etapaId === "P1")!;
    const e2 = e.etapas.find((x) => x.etapaId === "P2")!;
    expect(e1.boas.lo).toBe(400);
    expect(e1.refugo).toBe(100);
    expect(e2.boas.lo).toBe(150);
    expect(e.pares[0].wip.lo).toBe(250); // 400 boas − 150 boas (nunca 500 − 200)
    expect(e.produtos[0].demandaFinalRestante).toBe(6000 - 150); // o refugo (50) não reduz a meta final
  });
});

describe("máquina parada / ausência / retorno / revezamento / compartilhada", () => {
  it("máquina parada na etapa 2: capacidade cai, teto de utilidade acompanha e nada viola", () => {
    const pools = dois();
    const parada = { maquinaId: "b1", desdeMs: epochMsNoFuso("2026-10-26", "00:00"), liberadaEmMs: null };
    const x = rodar({ pools, funcionarios: equipe(4), c: 2, extra: { indisponibilidades: [parada] } });
    expect(x.r.resultado.alocacoes.some((a) => a.maquinaId === "b1")).toBe(false);
    expect(checarFluxo(x)).toEqual([]);
    const sem = rodar({ pools, funcionarios: equipe(4), c: 2 });
    expect(demanda(x.r.diagnostico.estado, "P1").consumoDownstream!).toBeLessThan(demanda(sem.r.diagnostico.estado, "P1").consumoDownstream!);
  });
  it("funcionário ausente o dia inteiro: nunca alocado; nenhuma violação", () => {
    const pools = dois();
    const ausencias = [{ funcionarioId: "f01", data: "2026-10-27", inicioMin: null, fimMin: null }];
    const x = rodar({ pools, funcionarios: equipe(4), c: 2, extra: { ausencias } });
    expect(x.r.resultado.alocacoes.filter((a) => a.funcionarioId === "f01" && a.data === "2026-10-27" && a.maquinaId)).toHaveLength(0);
    expect(checarFluxo(x)).toEqual([]);
  });
  it("retorno: máquina liberada na terça volta a ser usada a partir de então", () => {
    const pools = dois();
    const lib = epochMsNoFuso("2026-10-27", "00:00");
    const x = rodar({ pools, funcionarios: equipe(4), c: 2, extra: { indisponibilidades: [{ maquinaId: "a1", desdeMs: epochMsNoFuso("2026-10-26", "00:00"), liberadaEmMs: lib }] } });
    const usos = x.r.resultado.alocacoes.filter((a) => a.maquinaId === "a1");
    expect(usos.every((a) => a.data >= "2026-10-27")).toBe(true);
    expect(usos.length).toBeGreaterThan(0);
    expect(checarFluxo(x)).toEqual([]);
  });
  it("revezamento: a mesma operação nunca se repete em períodos consecutivos (verificador independente)", () => {
    const pools = tres();
    const x = rodar({ pools, funcionarios: equipe(5), c: 2 });
    expect(verificarRestricoesDuras(x.r.entradaFluxo, x.r.resultado.alocacoes).filter((v) => v.tipo === "revezamento")).toHaveLength(0);
    expect(checarFluxo(x)).toEqual([]);
  });
  it("máquina compartilhada entre dois produtos: nunca duas pessoas na mesma máquina/período", () => {
    const pools = [
      pool({ produto: "X", etapa: "X1", op: "opA", ordem: 1, q: 4000, maquinas: ["s1", "x1"], mu: 400 }),
      pool({ produto: "X", etapa: "X2", op: "opB", ordem: 2, q: 4000, maquinas: ["x2"], mu: 300 }),
      pool({ produto: "Y", etapa: "Y1", op: "opA", ordem: 1, q: 4000, maquinas: ["s1", "y1"], mu: 400 }),
      pool({ produto: "Y", etapa: "Y2", op: "opC", ordem: 2, q: 4000, maquinas: ["y2"], mu: 300 }),
    ];
    const x = rodar({ pools, funcionarios: equipe(6), c: 2 });
    expect(verificarRestricoesDuras(x.r.entradaFluxo, x.r.resultado.alocacoes)).toEqual([]);
    expect(checarFluxo(x)).toEqual([]);
  });
});

describe("determinismo e serialização", () => {
  it("mesmas entradas ⇒ mesmo resultado, byte a byte; diagnóstico é JSON puro", () => {
    const pools = tres();
    const a = rodar({ pools, funcionarios: equipe(5), c: 3, apontamentos: [] });
    const b = rodar({ pools, funcionarios: equipe(5), c: 3, apontamentos: [] });
    expect(JSON.stringify(a.r)).toBe(JSON.stringify(b.r));
    const s = JSON.stringify(a.r.diagnostico);
    const volta = JSON.parse(s);
    expect(JSON.stringify(volta)).toBe(s);
    const procurarInvalidos = (v: unknown, caminho: string): string[] => {
      if (typeof v === "number") return Number.isFinite(v) ? [] : [caminho];
      if (v && typeof v === "object") return Object.entries(v as object).flatMap(([k, x]) => procurarInvalidos(x, `${caminho}.${k}`));
      return [];
    };
    expect(procurarInvalidos(a.r.diagnostico, "diag")).toEqual([]);
  });
  it("avaliarPlano é a mesma régua para o plano base e para o de fluxo", () => {
    const pools = dois();
    const x = rodar({ pools, funcionarios: equipe(4), c: 2 });
    const m = montar({ pools, funcionarios: equipe(4), c: 2 });
    const base = gerarEscala(m.entrada);
    const av = avaliarPlano(m.entrada, m.dados, base.alocacoes);
    expect(av.totais.faltaFinalLo).toBe(x.r.diagnostico.avaliacaoBase.totais.faltaFinalLo);
    void caps;
  });
});
