// FASE 4d (WIP → sombra): a sombra enxerga o adicional por etapa / WIP planejado / limites / confirmado EXATAMENTE como a Escala oficial.
import { describe, it, expect } from "vitest";
import { analisarAtingibilidade } from "@/features/escala/atingibilidade";
import { lerParametros, wipDiasLimiteDaSemana } from "@/features/escala/parametros";
import { empacotarLinha } from "@/features/escala/snapshotSombra";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { AlocacaoEscala } from "@/features/escala/types";
import type { EntradaWip } from "@/features/escala/wipSaldo";
import type { EstadoBruto } from "../estado";
import { montarEntradaEscala } from "../montarEntrada";
import type { VersaoPlanoOficial } from "../planoVersionado";
import { prepararDecisao, type ApontamentoBanco } from "../sombraServico";
import { estadoDeTeste, Mundo } from "./bancoMemoria";

void analisarAtingibilidade;
const SEMANA = "2026-11-02";
const DIAS = [SEMANA, "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const AGORA = epochMsNoFuso("2026-10-30", "10:00");
const MIN = 60_000;
const ORD = ["m1", "m2", "m3", "t1", "t2", "t3"];

// semana com FOLGA no fim (previsto acaba antes) e adicional por etapa programado: é onde o WIP ocupa os vazios
function estado(opc: { wip?: boolean; dias?: number; caps?: boolean; wipControle?: Omit<EntradaWip, "hoje"> } = {}): EstadoBruto {
  const e = estadoDeTeste(SEMANA, DIAS, { pessoas: 14 });
  e.itens[0].quantidade = 2600;
  e.itens[1].quantidade = 2200;
  e.itens[2].quantidade = 1500;
  e.itens[3].quantidade = 1800;
  e.parametros = { wipModo: opc.wip === false ? "desligado" : "ativo", wipDiasLimite: opc.dias ?? 2 };
  if (opc.caps !== false) {
    e.itens[0].adicionalPorEtapa = { eA1: 4000, eA2: 0 };
    e.itens[1].adicionalPorEtapa = { eB1: 3000, eB2: 0 };
    e.itens[3].adicionalPorEtapa = { eD1: 2500, eD2: 0 };
  }
  if (opc.wipControle) e.wipControle = opc.wipControle;
  return e;
}
const estadoDe = (m: Mundo): EstadoBruto => ({ ...m.entradas, diasExistentes: [...m.dias].map(([data, d]) => ({ data, versao: d.versao, periodosSnapshot: d.snapshot })), alocacoes: m.alocacoes.map((a) => ({ ...a })) });
const versaoDe = (m: Mundo, validoDesdeMs: number): VersaoPlanoOficial => {
  const e = m.entradas;
  return {
    id: "v1", previsaoId: "prev1", validoDesdeMs, origem: "trigger", hashPlano: "h", dias: [...m.dias].map(([data, d]) => ({ data, versao: d.versao, periodos_snapshot: d.snapshot })), linhas: m.alocacoes.map((a) => empacotarLinha(a)),
    entrada: JSON.parse(JSON.stringify({ diasProdutivos: e.diasProdutivos, equipe: e.equipeProdutiva.map((x) => x.funcionarioId), maquinasIndisponiveisPrevisao: e.maquinasIndisponiveisPrevisao, itens: e.itens })),
  };
};
async function mundo(e: EstadoBruto) { const m = new Mundo(e); await m.recalcular(AGORA, true); return m; }
const idx = (m: Mundo, a: { data: string; periodoId: string }) => ORD.indexOf(a.periodoId) + 6 * DIAS.indexOf(a.data);
const fim = (data: string, p: string) => epochMsNoFuso(data, { m1: "08:48", m2: "10:24", m3: "11:55", t1: "14:20", t2: "15:40", t3: "17:00" }[p] as string);

// apontamentos fiéis ao plano oficial até o slot `ate`, rendimento g (previsto e WIP/adicional: ambos são produção da etapa)
function apontar(m: Mundo, ate: number, g: number): ApontamentoBanco[] {
  return m.alocacoes.filter((a) => a.maquinaId && idx(m, a) <= ate).map((a) => ({
    data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId,
    quantidadeProduzida: Math.round((a.pecas + (a.pecasAdicional ?? 0)) * g), quantidadeRefugo: 0, meta: a.pecas + (a.pecasAdicional ?? 0), status: "produzindo" as const, motivo: null,
    criadoEmMs: fim(a.data, a.periodoId) + 5 * MIN, atualizadoEmMs: null,
  }));
}
async function decidir(m: Mundo, c: number, g: number, estadoOverride?: EstadoBruto) {
  const v = versaoDe(m, AGORA);
  const aps = apontar(m, c, g);
  const ev = { data: DIAS[Math.floor(c / 6)], periodoId: ORD[c % 6] };
  const r = await prepararDecisao(estadoOverride ?? estadoDe(m), aps, ev, fim(ev.data, ev.periodoId) + 30 * MIN, async () => v);
  if (!r.pronto) throw new Error("deveria estar pronto: " + JSON.stringify(r));
  return r.snapshot;
}
const vazios = (rows: AlocacaoEscala[]) => rows.filter((a) => !a.maquinaId).length;
const wip = (rows: AlocacaoEscala[]) => rows.filter((a) => a.maquinaId && (a.pecasAdicional ?? 0) > 0).reduce((s, a) => s + (a.pecasAdicional ?? 0), 0);
const postosPrevisto = (rows: AlocacaoEscala[]) => rows.filter((a) => a.maquinaId && a.pecas > 0).map((a) => `${a.data}|${a.periodoId}|${a.maquinaId}|${a.produtoId}|${a.etapaId}|${Math.round(a.pecas)}`).sort();
const pessoasComPrevisto = (rows: AlocacaoEscala[]) => rows.filter((a) => a.maquinaId && a.pecas > 0).map((a) => `${a.data}|${a.periodoId}|${a.funcionarioId}`).sort();

describe("pré-condição do cenário", () => {
  it("sem WIP há vazios no fim da semana; com WIP o adicional por etapa os ocupa", async () => {
    const sem = await mundo(estado({ wip: false }));
    const com = await mundo(estado({}));
    expect(vazios(sem.alocacoes)).toBeGreaterThan(0);
    expect(vazios(com.alocacoes)).toBeLessThan(vazios(sem.alocacoes));
    expect(wip(com.alocacoes)).toBeGreaterThan(0);
  });
});

describe("a sombra usa a MESMA regra de WIP da Escala oficial", () => {
  it("limites: os da sombra são exatamente os que a Escala oficial calcula (e o limite configurado vale)", async () => {
    const e = estado({});
    const m = await mundo(e);
    const snap = await decidir(m, 2, 1);
    const oficial = montarEntradaEscala(estadoDe(m), AGORA).entrada.wip!.limites;
    expect(snap.entradas.wip?.limites).toEqual(oficial);
    expect(snap.entrada.wip?.limites).toEqual(oficial);
    expect(snap.entradas.parametros.wipModo).toBe("ativo");
    expect(snap.entradas.parametros.wipDiasLimite).toBe(2);
    // o mesmo cenário com limite de 1 dia dá limites menores na entrada
    const um = montarEntradaEscala({ ...estadoDe(m), parametros: { wipModo: "ativo", wipDiasLimite: 1 } }, AGORA).entrada.wip!.limites;
    Object.keys(oficial).forEach((k) => expect(oficial[k]).toBeCloseTo(2 * um[k], 6));
  });

  it("sem atraso, o WIP que a sombra planeja é o da Escala oficial; nada é esvaziado nem retirado", async () => {
    const m = await mundo(estado({}));
    const snap = await decidir(m, 2, 1);
    const p = snap.diagnostico.preenchimento;
    expect(p.esvaziaria).toBe(0);
    expect(p.wipRetirado).toBe(0);
    expect(p.wipSombraPecas).toBeCloseTo(p.wipOficialPecas, 3);
    expect(p.vaziosSombra).toBeLessThanOrEqual(p.vaziosOficial);
  });

  it("o WIP respeita o limite e o teto (nunca planeja acima do limite de estoque nem do adicional programado)", async () => {
    const m = await mundo(estado({}));
    const snap = await decidir(m, 2, 1);
    (snap.entradas.wip?.pares ?? []).forEach((par) => {
      expect(par.planejadoSombraFuturo + par.realizado).toBeLessThanOrEqual(par.teto + 1e-6);
      if (par.limite !== null) expect(par.espacoRestante).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("estoque confirmado e reservas", () => {
  const wipBase = (conf: number): Omit<EntradaWip, "hoje"> => ({
    controles: [{ id: "c1", produtoId: "pA", etapaOrigemId: "eA1", etapaSeguinteId: "eA2", dataInicio: "2026-10-05", saldoInicial: 0, ativo: true }],
    ajustes: [], confirmacoes: conf > 0 ? [{ id: "k1", controleId: "c1", dataReferencia: "2026-10-30", quantidade: conf, saldoEstimado: conf, motivo: null, criadoEm: "2026-10-30T09:00:00Z" }] : [], snapshots: [],
    producao: [{ etapaId: "eA1", data: "2026-10-28", boas: 3000 }], semanas: [],
    roteiro: { produtoAtivo: { pA: true }, etapasPorProduto: { pA: [{ id: "eA1", ordem: 1 }, { id: "eA2", ordem: 2 }] } },
  });

  it("o confirmado OCUPA o limite: o espaço que sobra para WIP novo é limite − confirmado, e a sombra o enxerga igual à Escala oficial", async () => {
    const m = await mundo(estado({ wipControle: wipBase(500) }));
    const entradaOficial = montarEntradaEscala(estadoDe(m), AGORA).entrada;
    expect(entradaOficial.wip?.estoqueConfirmado).toEqual({ "pA|eA1": 500 });
    const snap = await decidir(m, 2, 1);
    expect(snap.entrada.wip?.estoqueConfirmado).toEqual({ "pA|eA1": 500 });
    const par = snap.entradas.wip?.pares.find((x) => x.etapaId === "eA1");
    expect(par?.confirmado).toBe(500);
    expect(par?.limite).toBe(entradaOficial.wip!.limites["pA|eA1"]);
    expect(par?.espacoRestante).toBeLessThanOrEqual((par?.limite ?? 0) - 500 + 1e-6);
    expect(par?.espacoRestante).toBeGreaterThanOrEqual(0);
  });

  it("reserva entre semanas: o saldo já RESERVADO por uma semana anterior não volta a ocupar o limite desta (sem duplicação)", async () => {
    const base = wipBase(1200);
    base.confirmacoes[0].dataReferencia = "2026-10-22";
    const livre = montarEntradaEscala(estado({ wipControle: { ...base, semanas: [] } }), AGORA).entrada.wip?.estoqueConfirmado?.["pA|eA1"] ?? 0;
    const comReserva = { ...base, semanas: [{ semanaInicio: "2026-10-26", quantidadePorProduto: { pA: 800 } }], snapshots: [{ semanaInicio: "2026-10-26", controleId: "c1", saldoEstimado: 1200, saldoConfirmadoDisponivel: 1200, saldoAlocado: 800 }] };
    const e = estado({ wipControle: comReserva });
    const reservado = montarEntradaEscala(e, AGORA).entrada.wip?.estoqueConfirmado?.["pA|eA1"] ?? 0;
    expect(livre).toBe(1200);
    expect(reservado).toBe(400); // 1.200 − 800 já usados pela semana anterior: nada é contado duas vezes
    const m = await mundo(e);
    const snap = await decidir(m, 2, 1);
    // no CORTE (já dentro da semana) vale a regra da Escala oficial naquele instante — a sombra usa exatamente a mesma função, no instante do corte
    const noCorte = montarEntradaEscala({ ...estadoDe(m) }, snap.identificacao.corteMs).entrada.wip?.estoqueConfirmado?.["pA|eA1"] ?? 0;
    expect(snap.entrada.wip?.estoqueConfirmado?.["pA|eA1"] ?? 0).toBe(noCorte);
  });

  it("nenhum WIP PLANEJADO vira estoque confirmado: sem controle/confirmação não existe estoqueConfirmado nem saldo0, mesmo com WIP planejado", async () => {
    const m = await mundo(estado({}));
    expect(wip(m.alocacoes)).toBeGreaterThan(0);
    const snap = await decidir(m, 2, 1);
    expect(snap.entrada.wip?.estoqueConfirmado).toBeUndefined();
    expect(snap.entrada.wip?.saldo0).toBeUndefined();
    expect((snap.entradas.wip?.pares ?? []).every((p) => p.confirmado === 0)).toBe(true);
  });

  it("confirmação criada DEPOIS do corte não entra na decisão do corte", async () => {
    const wc = wipBase(0);
    wc.confirmacoes = [{ id: "k9", controleId: "c1", dataReferencia: "2026-10-30", quantidade: 1500, saldoEstimado: 1500, motivo: null, criadoEm: new Date(fim(SEMANA, "m1") + 2 * 3600_000).toISOString() }];
    const m = await mundo(estado({ wipControle: wc }));
    const snap = await decidir(m, 0, 1);
    expect(snap.entrada.wip?.estoqueConfirmado).toBeUndefined();
  });
});

describe("prioridade: previsto > recuperação > adicional acabado > WIP", () => {
  it("o WIP só entra em quem ficaria SEM posto e nenhum posto do previsto é retirado para gerar WIP", async () => {
    const m = await mundo(estado({}));
    const comWip = await decidir(m, 2, 1);
    const semCaps = await mundo(estado({ caps: false }));
    const base = await decidir(semCaps, 2, 1, estadoDe(semCaps));
    // plano da sombra COM tetos × SEM tetos (mesma semana e mesma execução)
    const so = (s: Awaited<ReturnType<typeof decidir>>) => s.planos.proximosPeriodos.length;
    expect(so(comWip)).toBeGreaterThan(0);
    expect(so(base)).toBeGreaterThan(0);
    const rowsComWip = (await reexecutar(m, 2, 1)).alteravel;
    const rowsSem = (await reexecutar(semCaps, 2, 1)).alteravel;
    expect(postosPrevisto(rowsComWip)).toEqual(postosPrevisto(rowsSem)); // previsto idêntico
    // a PESSOA de um posto do previsto pode mudar por equidade/continuidade (decisão já aprovada), mas o NÚMERO de pessoas com previsto por período é o mesmo
    const porPeriodo = (rows: AlocacaoEscala[]) => { const r: Record<string, number> = {}; pessoasComPrevisto(rows).forEach((k) => { const p = k.split("|").slice(0, 2).join("|"); r[p] = (r[p] ?? 0) + 1; }); return r; };
    expect(porPeriodo(rowsComWip)).toEqual(porPeriodo(rowsSem));
    expect(wip(rowsComWip)).toBeGreaterThan(0);
    expect(wip(rowsSem)).toBe(0);
    // em cada período, as pessoas com WIP são, no máximo, as que ficariam SEM posto sem o WIP (e nunca alguém do previsto)
    ORD.forEach((p) => DIAS.forEach((d) => {
      const doWip = rowsComWip.filter((a) => a.data === d && a.periodoId === p && a.maquinaId && a.pecas === 0 && (a.pecasAdicional ?? 0) > 0).length;
      const ociososSem = rowsSem.filter((a) => a.data === d && a.periodoId === p && !a.maquinaId).length;
      expect(doWip).toBeLessThanOrEqual(ociososSem);
    }));
  });

  it("atraso real EXPULSA WIP futuro e o previsto ocupa a capacidade", async () => {
    const m = await mundo(estado({}));
    const c = 11; // fim do 2º dia
    const noPrazo = await reexecutar(m, c, 1);
    const atrasado = await reexecutar(m, c, 0.5);
    const piorado = await reexecutar(m, c, 0.1);
    expect(wip(atrasado.alteravel)).toBeLessThanOrEqual(wip(noPrazo.alteravel));
    expect(wip(piorado.alteravel)).toBeLessThanOrEqual(wip(atrasado.alteravel));
    expect(wip(piorado.alteravel)).toBeLessThan(wip(noPrazo.alteravel));
    const prev = (rows: AlocacaoEscala[]) => rows.reduce((s, a) => s + a.pecas, 0);
    expect(prev(piorado.alteravel)).toBeGreaterThanOrEqual(prev(noPrazo.alteravel));
  });

  it("revezamento continua duro: 0 repetições e 0 exceções no plano da sombra com WIP", async () => {
    const m = await mundo(estado({}));
    const r = await reexecutar(m, 5, 1);
    const por = new Map<string, AlocacaoEscala[]>();
    [...r.congeladas, ...r.comprometidas, ...r.alteravel].forEach((a) => por.set(`${a.data}|${a.funcionarioId}`, [...(por.get(`${a.data}|${a.funcionarioId}`) ?? []), a]));
    let rep = 0;
    por.forEach((l) => { l.sort((x, y) => idx(m, x) - idx(m, y)); for (let i = 1; i < l.length; i++) if (idx(m, l[i]) - idx(m, l[i - 1]) === 1 && l[i].maquinaId && l[i].operacaoId === l[i - 1].operacaoId) rep++; });
    expect(rep).toBe(0);
    expect(r.alteravel.some((a) => a.excecaoRevezamento)).toBe(false);
  });
});

describe("limite de WIP por SEMANA (sem mudar o padrão global)", () => {
  it("o parâmetro por semana vale só para aquela semana; o global continua 1", () => {
    const p = lerParametros([{ chave: "wip_dias_limite", valor: 1 }, { chave: "wip_dias_limite_semanas", valor: { "2026-10-26": 2, "lixo": 5, "2026-11-02": -1 } }]);
    expect(p.wipDiasLimite).toBe(1);
    expect(p.wipDiasLimitePorSemana).toEqual({ "2026-10-26": 2 });
    expect(wipDiasLimiteDaSemana(p, "2026-10-26")).toBe(2);
    expect(wipDiasLimiteDaSemana(p, "2026-11-02")).toBe(1);
  });
  it("na montagem da entrada, a semana configurada usa 2 dias e as outras 1 dia", () => {
    const base = estado({ dias: 1 });
    const outra = montarEntradaEscala({ ...base, parametros: { wipModo: "ativo", wipDiasLimite: 1, wipDiasLimitePorSemana: { [SEMANA]: 2 } } }, AGORA).entrada.wip!.limites;
    const global1 = montarEntradaEscala({ ...base, parametros: { wipModo: "ativo", wipDiasLimite: 1 } }, AGORA).entrada.wip!.limites;
    const naoConfigurada = montarEntradaEscala({ ...base, parametros: { wipModo: "ativo", wipDiasLimite: 1, wipDiasLimitePorSemana: { "2026-10-26": 2 } } }, AGORA).entrada.wip!.limites;
    Object.keys(global1).forEach((k) => { expect(outra[k]).toBeCloseTo(2 * global1[k], 6); expect(naoConfigurada[k]).toBeCloseTo(global1[k], 6); });
  });
});

describe("a configuração de WIP do corte vem da versão (não do parâmetro de agora)", () => {
  it("versão com parâmetros: o limite e o modo são os do momento da versão, mesmo que o parâmetro atual tenha mudado depois", async () => {
    const m = await mundo(estado({}));
    const v = versaoDe(m, AGORA);
    v.entrada.parametros = { wipModo: "ativo", wipDiasLimite: 1, wipDiasLimitePorSemana: 2 };
    const atual: EstadoBruto = { ...estadoDe(m), parametros: { wipModo: "desligado", wipDiasLimite: 5 } }; // alguém mudou o parâmetro DEPOIS
    const r = await prepararDecisao(atual, apontar(m, 2, 1), { data: DIAS[0], periodoId: "m3" }, fim(DIAS[0], "m3") + 30 * MIN, async () => v);
    if (!r.pronto) throw new Error("pronto");
    expect(r.snapshot.entradas.parametros).toMatchObject({ wipModo: "ativo", wipDiasLimite: 1, wipDiasLimitePorSemana: 2 });
    const oficial = montarEntradaEscala({ ...estadoDe(m), parametros: { wipModo: "ativo", wipDiasLimite: 1, wipDiasLimitePorSemana: { [SEMANA]: 2 } } }, AGORA).entrada.wip!.limites;
    expect(r.snapshot.entradas.wip?.limites).toEqual(oficial);
  });
});

// replano completo da sombra para inspecionar as linhas (mesma função da decisão)
import { executarCorteSombra } from "@/features/escala/sombraCorte";
import { paraParametrosCorte } from "@/features/escala/snapshotSombra";
async function reexecutar(m: Mundo, c: number, g: number) {
  const snap = await decidir(m, c, g);
  return executarCorteSombra(paraParametrosCorte(snap.entrada)).horizonte;
}
