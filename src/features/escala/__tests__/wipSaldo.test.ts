import { describe, it, expect } from "vitest";
import {
  espacoRestanteWip, reservadoParaSemanasFuturas,
  alocacaoDaSemana, confirmadoDisponivelAte, estimadoAte, inconsistencias, inicioDaSemana, planejamentoDaSemana, resumoWip, somarDias,
  type EntradaWip,
} from "../wipSaldo";

const P = "pA";
const E1 = "eA1";
const E2 = "eA2";
const C1 = "c1";
const base = (parcial: Partial<EntradaWip> = {}): EntradaWip => ({
  controles: [{ id: C1, produtoId: P, etapaOrigemId: E1, etapaSeguinteId: E2, dataInicio: "2026-10-05", saldoInicial: 0, ativo: true }],
  ajustes: [], confirmacoes: [], producao: [], snapshots: [],
  semanas: [
    { semanaInicio: "2026-10-19", quantidadePorProduto: { [P]: 7200 } },
    { semanaInicio: "2026-10-26", quantidadePorProduto: { [P]: 10000 } },
    { semanaInicio: "2026-11-02", quantidadePorProduto: { [P]: 10000 } },
  ],
  roteiro: { produtoAtivo: { [P]: true }, etapasPorProduto: { [P]: [{ id: E1, ordem: 1 }, { id: E2, ordem: 2 }] } },
  hoje: "2026-10-25", // sábado da semana de 19/10 já encerrada
  ...parcial,
});
const prod = (etapaId: string, data: string, boas: number) => ({ etapaId, data, boas });
const conf = (qtd: number, dref: string, estimado = qtd, motivo: string | null = null, id = "k1", criadoEm = "2026-10-25T10:00:00Z") => ({ id, controleId: C1, dataReferencia: dref, quantidade: qtd, saldoEstimado: estimado, motivo, criadoEm });

describe("saldo ESTIMADO", () => {
  it("saldo inicial", () => {
    const e = base({ controles: [{ ...base().controles[0], saldoInicial: 1500 }] });
    expect(estimadoAte(e.controles[0], e, "2026-10-10").valor).toBe(1500);
  });
  it("boas produzidas na origem − boas consumidas na etapa seguinte + saldo inicial + ajustes", () => {
    const e = base({
      controles: [{ ...base().controles[0], saldoInicial: 100 }],
      producao: [prod(E1, "2026-10-19", 5000), prod(E1, "2026-10-20", 3000), prod(E2, "2026-10-20", 2000), prod(E2, "2026-10-21", 1000)],
      ajustes: [{ controleId: C1, data: "2026-10-22", quantidade: -400, motivo: "contagem" }, { controleId: C1, data: "2026-10-22", quantidade: 50, motivo: "achado" }],
    });
    const r = estimadoAte(e.controles[0], e, "2026-10-24");
    expect(r).toMatchObject({ valor: 100 + 8000 - 3000 - 400 + 50, produzidoOrigem: 8000, consumidoSeguinte: 3000, ajustes: -350 });
  });
  it("produção anterior ao início do controle e posterior à data de corte não entram", () => {
    const e = base({ producao: [prod(E1, "2026-10-01", 999), prod(E1, "2026-10-19", 100), prod(E1, "2026-10-30", 777)] });
    expect(estimadoAte(e.controles[0], e, "2026-10-25").valor).toBe(100);
  });
  it("NUNCA é zerado/escondido: saldo negativo aparece como inconsistência (não inventa estoque)", () => {
    const e = base({ producao: [prod(E1, "2026-10-19", 1000), prod(E2, "2026-10-19", 4000)] });
    expect(estimadoAte(e.controles[0], e, "2026-10-25").valor).toBe(-3000);
    const inc = inconsistencias(e.controles[0], e);
    expect(inc.map((i) => i.codigo)).toContain("saldo_negativo");
    expect(inc.find((i) => i.codigo === "saldo_negativo")?.bloqueante).toBe(true);
    expect(confirmadoDisponivelAte(e.controles[0], e, "2026-10-25")).toBe(0);
  });
});

describe("estimado NÃO altera o planejamento; só o CONFIRMADO", () => {
  it("sem confirmação: nada entra para o motor, mesmo com estimado alto", () => {
    const e = base({ producao: [prod(E1, "2026-10-20", 7200)] });
    expect(estimadoAte(e.controles[0], e, e.hoje).valor).toBe(7200);
    expect(planejamentoDaSemana(e, "2026-10-26").saldos).toEqual([]);
  });
  it("com confirmação: o confirmado (alocado) entra para a semana seguinte", () => {
    const e = base({ producao: [prod(E1, "2026-10-20", 7200)], confirmacoes: [conf(7200, "2026-10-25", 7200)] });
    const pl = planejamentoDaSemana(e, "2026-10-26");
    expect(pl.saldos).toEqual([{ controleId: C1, produtoId: P, etapaOrigemId: E1, etapaSeguinteId: E2, saldo: 7200, disponivel: 7200 }]);
  });
  it("confirmação PARCIAL: só o confirmado entra (o resto do estimado continua só estimado)", () => {
    const e = base({ producao: [prod(E1, "2026-10-20", 7200)], confirmacoes: [conf(5000, "2026-10-25", 7200, "contei só 5.000")] });
    expect(confirmadoDisponivelAte(e.controles[0], e, "2026-10-25")).toBe(5000);
    expect(planejamentoDaSemana(e, "2026-10-26").saldos[0].saldo).toBe(5000);
  });
  it("produção nova da origem depois da confirmação NÃO aumenta o confirmado (fica estimada)", () => {
    const e = base({ hoje: "2026-10-29", producao: [prod(E1, "2026-10-27", 3000)], confirmacoes: [conf(2000, "2026-10-25", 2000)] });
    expect(estimadoAte(e.controles[0], e, "2026-10-29").valor).toBe(5000);
    expect(confirmadoDisponivelAte(e.controles[0], e, "2026-10-29")).toBe(2000);
  });
});

describe("consumo do saldo confirmado", () => {
  it("a etapa seguinte produzindo mais que a origem consome o confirmado (sem apagar nada manualmente)", () => {
    const e = base({ hoje: "2026-10-29", producao: [prod(E2, "2026-10-27", 1200)], confirmacoes: [conf(7200, "2026-10-25", 7200)] });
    expect(confirmadoDisponivelAte(e.controles[0], e, "2026-10-29")).toBe(6000);
  });
  it("se a origem também produz, só a diferença sai do confirmado; nunca passa do confirmado nem fica negativo", () => {
    const e1 = base({ hoje: "2026-10-29", producao: [prod(E1, "2026-10-27", 1000), prod(E2, "2026-10-27", 1200)], confirmacoes: [conf(7200, "2026-10-25", 7200)] });
    expect(confirmadoDisponivelAte(e1.controles[0], e1, "2026-10-29")).toBe(7000);
    const e2 = base({ hoje: "2026-10-29", producao: [prod(E2, "2026-10-27", 99999)], confirmacoes: [conf(7200, "2026-10-25", 7200)] });
    expect(confirmadoDisponivelAte(e2.controles[0], e2, "2026-10-29")).toBe(0);
  });
  it("ajuste negativo reduz o confirmado; ajuste positivo NÃO cria confirmado", () => {
    const neg = base({ hoje: "2026-10-29", ajustes: [{ controleId: C1, data: "2026-10-27", quantidade: -400, motivo: "contagem" }], confirmacoes: [conf(7200, "2026-10-25", 7200)] });
    expect(confirmadoDisponivelAte(neg.controles[0], neg, "2026-10-29")).toBe(6800);
    const pos = base({ hoje: "2026-10-29", ajustes: [{ controleId: C1, data: "2026-10-27", quantidade: 500, motivo: "achado" }], confirmacoes: [conf(7200, "2026-10-25", 7200)] });
    expect(estimadoAte(pos.controles[0], pos, "2026-10-29").valor).toBe(7700);
    expect(confirmadoDisponivelAte(pos.controles[0], pos, "2026-10-29")).toBe(7200);
  });
  it("uma nova confirmação substitui a base (contagem física vale mais que o histórico)", () => {
    const e = base({ hoje: "2026-10-29", producao: [prod(E1, "2026-10-20", 9000)], confirmacoes: [conf(9000, "2026-10-21", 9000, null, "k1"), conf(8800, "2026-10-25", 9000, "contagem física", "k2")] });
    expect(estimadoAte(e.controles[0], e, "2026-10-29").valor).toBe(8800);
  });
});

describe("dupla utilização do mesmo WIP em semanas diferentes", () => {
  const confirmado = base({ hoje: "2026-10-25", confirmacoes: [conf(10000, "2026-10-25", 10000)] });
  it("o confirmado é alocado às semanas em ordem cronológica e nunca passa do total", () => {
    // 26/10 precisa de 10.000 e leva tudo; 02/11 não encontra nada para usar de novo
    expect(alocacaoDaSemana(confirmado.controles[0], confirmado, "2026-10-26").alocado).toBe(10000);
    expect(alocacaoDaSemana(confirmado.controles[0], confirmado, "2026-11-02").alocado).toBe(0);
  });
  it("com previsto menor na 1ª semana, o resto vai para a seguinte (soma ≤ confirmado)", () => {
    const e = base({ hoje: "2026-10-25", confirmacoes: [conf(10000, "2026-10-25", 10000)], semanas: [{ semanaInicio: "2026-10-26", quantidadePorProduto: { [P]: 6000 } }, { semanaInicio: "2026-11-02", quantidadePorProduto: { [P]: 9000 } }] });
    const a = alocacaoDaSemana(e.controles[0], e, "2026-10-26").alocado;
    const b = alocacaoDaSemana(e.controles[0], e, "2026-11-02").alocado;
    expect([a, b]).toEqual([6000, 4000]);
    expect(a + b).toBeLessThanOrEqual(10000);
  });
  it("a alocação nunca passa do previsto da semana (origem não produz negativo)", () => {
    const e = base({ hoje: "2026-10-25", confirmacoes: [conf(50000, "2026-10-25", 50000)] });
    expect(alocacaoDaSemana(e.controles[0], e, "2026-10-26").alocado).toBe(10000);
  });
  it("semana encerrada: vale o consumo REAL (Produção Real), não o plano", () => {
    // 26/10 alocou 7.000 do plano, mas a Produção Real mostrou que só 2.000 foram consumidos: sobram 8.000 confirmados para 02/11
    const e = base({
      hoje: "2026-11-03", confirmacoes: [conf(10000, "2026-10-25", 10000)],
      snapshots: [{ semanaInicio: "2026-10-26", controleId: C1, saldoEstimado: 10000, saldoConfirmadoDisponivel: 10000, saldoAlocado: 7000 }],
      producao: [prod(E2, "2026-10-28", 2000)],
    });
    expect(alocacaoDaSemana(e.controles[0], e, "2026-11-02").disponivelAbertura).toBe(8000);
  });
  it("confirmação feita DURANTE a semana não muda essa semana (só as seguintes)", () => {
    const e = base({ hoje: "2026-10-28", confirmacoes: [conf(4000, "2026-10-27", 4000)] });
    expect(alocacaoDaSemana(e.controles[0], e, "2026-10-26").alocado).toBe(0);
    expect(alocacaoDaSemana(e.controles[0], e, "2026-11-02").alocado).toBe(4000);
  });
});

describe("foto semanal (snapshot)", () => {
  it("semana aberta sem foto pede a gravação; com foto, a foto vale e nunca é recalculada", () => {
    const e = base({ hoje: "2026-10-28", confirmacoes: [conf(7200, "2026-10-25", 7200)] });
    const pl = planejamentoDaSemana(e, "2026-10-26");
    expect(pl.snapshotsNovos).toEqual([{ controleId: C1, saldoEstimado: 7200, saldoConfirmadoDisponivel: 7200, saldoAlocado: 7200 }]);
    // a foto existe; depois chega OUTRA confirmação e uma produção: a semana de 26/10 não muda
    const depois = base({
      hoje: "2026-10-29", confirmacoes: [conf(7200, "2026-10-25", 7200), conf(1, "2026-10-28", 1, "recontagem", "k2", "2026-10-28T10:00:00Z")], producao: [prod(E2, "2026-10-27", 5000)],
      snapshots: [{ semanaInicio: "2026-10-26", controleId: C1, saldoEstimado: 0, saldoConfirmadoDisponivel: 7200, saldoAlocado: 7200 }],
    });
    const a = alocacaoDaSemana(depois.controles[0], depois, "2026-10-26");
    expect(a).toMatchObject({ origem: "snapshot", alocado: 7200, disponivelAbertura: 7200, precisaSnapshot: false });
    expect(planejamentoDaSemana(depois, "2026-10-26").snapshotsNovos).toEqual([]);
  });
  it("semana futura nunca gera foto", () => {
    const e = base({ confirmacoes: [conf(7200, "2026-10-25", 7200)] });
    expect(planejamentoDaSemana(e, "2026-11-02").snapshotsNovos).toEqual([]);
  });
  it("sem nenhum saldo, a abertura da semana também fica registrada (zero)", () => {
    const e = base({ hoje: "2026-10-27" });
    expect(planejamentoDaSemana(e, "2026-10-26").snapshotsNovos).toEqual([{ controleId: C1, saldoEstimado: 0, saldoConfirmadoDisponivel: 0, saldoAlocado: 0 }]);
  });
});

describe("inconsistências", () => {
  it("rota alterada (etapas deixaram de ser consecutivas) bloqueia o uso do saldo", () => {
    const e = base({ confirmacoes: [conf(7200, "2026-10-25", 7200)], roteiro: { produtoAtivo: { [P]: true }, etapasPorProduto: { [P]: [{ id: E1, ordem: 1 }, { id: "novaEtapa", ordem: 2 }, { id: E2, ordem: 3 }] } } });
    expect(inconsistencias(e.controles[0], e).map((i) => i.codigo)).toEqual(["rota_alterada"]);
    expect(planejamentoDaSemana(e, "2026-10-26").saldos).toEqual([]);
  });
  it("etapa removida do roteiro", () => {
    const e = base({ roteiro: { produtoAtivo: { [P]: true }, etapasPorProduto: { [P]: [{ id: E1, ordem: 1 }] } } });
    expect(inconsistencias(e.controles[0], e).map((i) => i.codigo)).toContain("etapa_inexistente");
  });
  it("produto desativado", () => {
    const e = base({ confirmacoes: [conf(7200, "2026-10-25", 7200)], roteiro: { produtoAtivo: { [P]: false }, etapasPorProduto: base().roteiro.etapasPorProduto } });
    expect(inconsistencias(e.controles[0], e).map((i) => i.codigo)).toEqual(["produto_inativo"]);
    expect(planejamentoDaSemana(e, "2026-10-26").saldos).toEqual([]);
  });
  it("confirmação acima do estimado SEM justificativa", () => {
    const e = base({ confirmacoes: [conf(9000, "2026-10-25", 7200, null)] });
    expect(inconsistencias(e.controles[0], e).map((i) => i.codigo)).toContain("confirmacao_sem_justificativa");
    expect(planejamentoDaSemana(e, "2026-10-26").saldos).toEqual([]);
  });
  it("confirmação acima do estimado COM justificativa é aceita", () => {
    const e = base({ confirmacoes: [conf(9000, "2026-10-25", 7200, "caixas achadas no corredor")] });
    expect(inconsistencias(e.controles[0], e)).toEqual([]);
  });
  it("a foto de uma semana já aberta continua valendo mesmo que o controle fique inconsistente depois", () => {
    const e = base({
      hoje: "2026-10-29", producao: [prod(E2, "2026-10-28", 99999)], confirmacoes: [conf(7200, "2026-10-25", 7200)],
      snapshots: [{ semanaInicio: "2026-10-26", controleId: C1, saldoEstimado: 0, saldoConfirmadoDisponivel: 7200, saldoAlocado: 7200 }],
    });
    expect(inconsistencias(e.controles[0], e).map((i) => i.codigo)).toContain("saldo_negativo");
    expect(alocacaoDaSemana(e.controles[0], e, "2026-10-26").alocado).toBe(7200); // congelada
    expect(planejamentoDaSemana(e, "2026-11-02").saldos).toEqual([]); // semanas ainda não abertas: bloqueado
  });
});

describe("status e resumo para a tela", () => {
  it("sem saldo → estimado → confirmado → divergência", () => {
    const s = (e: EntradaWip) => resumoWip(e, "2026-10-26")[0].status;
    expect(s(base({ hoje: "2026-10-25" }))).toBe("sem_saldo");
    expect(s(base({ producao: [prod(E1, "2026-10-20", 7200)] }))).toBe("estimado");
    expect(s(base({ producao: [prod(E1, "2026-10-20", 7200)], confirmacoes: [conf(7200, "2026-10-25", 7200)] }))).toBe("confirmado");
    expect(s(base({ producao: [prod(E2, "2026-10-20", 100)] }))).toBe("divergencia");
  });
  it("Previsto 56.400 − WIP confirmado 7.200 = A produzir 49.200 (o previsto salvo não muda)", () => {
    const e = base({
      semanas: [{ semanaInicio: "2026-10-26", quantidadePorProduto: { [P]: 56400 } }],
      producao: [prod(E1, "2026-10-20", 7200)], confirmacoes: [conf(7200, "2026-10-25", 7200)],
    });
    const r = resumoWip(e, "2026-10-26")[0];
    expect(r).toMatchObject({ previstoOrigem: 56400, alocado: 7200, aProduzir: 49200, confirmadoDisponivel: 7200 });
    expect(r.estimado.valor).toBe(7200);
  });
});

describe("determinismo, reversibilidade e datas", () => {
  it("mesmas entradas => mesmo resultado (idempotente)", () => {
    const e = base({ producao: [prod(E1, "2026-10-20", 7200)], confirmacoes: [conf(7200, "2026-10-25", 7200)] });
    expect(JSON.stringify(planejamentoDaSemana(e, "2026-10-26"))).toBe(JSON.stringify(planejamentoDaSemana(e, "2026-10-26")));
  });
  it("controle desativado => volta a não ter saldo (reversível)", () => {
    const e = base({ producao: [prod(E1, "2026-10-20", 7200)], confirmacoes: [conf(7200, "2026-10-25", 7200)] });
    expect(planejamentoDaSemana(e, "2026-10-26").saldos.length).toBe(1);
    const off = { ...e, controles: e.controles.map((c) => ({ ...c, ativo: false })) };
    expect(planejamentoDaSemana(off, "2026-10-26")).toEqual({ saldos: [], snapshotsNovos: [] });
  });
  it("somarDias e início da semana (segunda)", () => {
    expect(somarDias("2026-10-31", 1)).toBe("2026-11-01");
    expect(inicioDaSemana("2026-10-25")).toBe("2026-10-19"); // domingo
    expect(inicioDaSemana("2026-10-26")).toBe("2026-10-26");
    expect(inicioDaSemana("2026-10-29")).toBe("2026-10-26");
  });
});

// ---------------- Fase 3 (correção): o confirmado consome o LIMITE de estoque, uma só fonte de verdade ----------------
describe("limite de estoque: espaço restante para NOVO WIP", () => {
  it("abaixo do limite: limite − confirmado − WIP planejado", () => {
    expect(espacoRestanteWip(20000, 14100, 0)).toBe(5900);
    expect(espacoRestanteWip(20000, 14100, 900)).toBe(5000);
  });
  it("exatamente no limite: zero", () => {
    expect(espacoRestanteWip(20000, 20000, 0)).toBe(0);
  });
  it("confirmado + WIP planejado chegando exatamente ao limite: zero", () => {
    expect(espacoRestanteWip(20000, 14100, 5900)).toBe(0);
  });
  it("acima do limite: nunca negativo", () => {
    expect(espacoRestanteWip(20000, 25000, 0)).toBe(0);
    expect(espacoRestanteWip(20000, 14100, 9000)).toBe(0);
  });

  const comConf = (q: number, extra: Partial<EntradaWip> = {}) => base({ producao: [prod(E1, "2026-10-20", Math.max(q, 1))], confirmacoes: [conf(q, "2026-10-25", q)], ...extra });
  const r = (e: EntradaWip, limite: number, planejado = 0) => resumoWip(e, "2026-10-26", { limites: { [`${P}|${E1}`]: limite }, adicionalPlanejado: { [`${P}|${E1}`]: planejado } })[0];

  it("confirmado abaixo do limite: mostra limite, confirmado, reservado e espaço restante (14.100 de 20.000 = 5.900)", () => {
    const x = r(comConf(14100, { semanas: [{ semanaInicio: "2026-10-26", quantidadePorProduto: { [P]: 7200 } }, { semanaInicio: "2026-11-02", quantidadePorProduto: { [P]: 9000 } }] }), 20000);
    expect(x).toMatchObject({ limite: 20000, confirmadoOcupando: 14100, reservadoSemana: 7200, reservadoFuturo: 6900, espacoRestante: 5900, acimaDoLimite: false });
  });
  it("confirmado exatamente no limite: sem espaço e SEM alerta", () => {
    const x = r(comConf(20000), 20000);
    expect(x).toMatchObject({ espacoRestante: 0, acimaDoLimite: false });
    expect(x.inconsistencias.map((i) => i.codigo)).not.toContain("acima_do_limite");
  });
  it("confirmado acima do limite: não apaga nada, impede novo WIP e alerta (não bloqueante: o previsto continua consumindo)", () => {
    const x = r(comConf(25000), 20000);
    expect(x).toMatchObject({ confirmadoOcupando: 25000, espacoRestante: 0, acimaDoLimite: true });
    const al = x.inconsistencias.find((i) => i.codigo === "acima_do_limite")!;
    expect(al.mensagem).toContain("Estoque intermediário acima do limite definido");
    expect(al.bloqueante).toBe(false);
    expect(x.status).toBe("confirmado"); // não vira divergência: o saldo continua entrando no planejamento
    expect(x.alocado).toBeGreaterThan(0);
    expect(planejamentoDaSemana(comConf(25000), "2026-10-26").saldos[0].disponivel).toBe(25000); // nada foi apagado
  });
  it("confirmado + WIP planejado chegando exatamente ao limite", () => {
    expect(r(comConf(14100), 20000, 5900).espacoRestante).toBe(0);
  });
  const lim = { limites: { [`${P}|${E1}`]: 20000 } };
  const conf21 = (q: number) => conf(q, "2026-10-21", q);
  it("consumo pela etapa seguinte libera espaço para novo WIP", () => {
    const antes = resumoWip(base({ hoje: "2026-10-25", producao: [prod(E1, "2026-10-20", 14100)], confirmacoes: [conf21(14100)] }), "2026-10-26", lim)[0];
    const depois = resumoWip(base({ hoje: "2026-10-25", producao: [prod(E1, "2026-10-20", 14100), prod(E2, "2026-10-23", 3000)], confirmacoes: [conf21(14100)] }), "2026-10-26", lim)[0];
    expect(antes).toMatchObject({ confirmadoOcupando: 14100, espacoRestante: 5900 });
    expect(depois).toMatchObject({ confirmadoOcupando: 11100, espacoRestante: 8900 });
  });
  it("ajuste POSITIVO não cria confirmado: o limite só muda quando alguém confirma a nova contagem", () => {
    const e = base({ hoje: "2026-10-25", producao: [prod(E1, "2026-10-20", 14100)], confirmacoes: [conf21(14100)], ajustes: [{ controleId: C1, data: "2026-10-23", quantidade: 8000, motivo: "caixas achadas" }] });
    const x = resumoWip(e, "2026-10-26", lim)[0];
    expect(x.estimado.valor).toBe(22100);               // o estimado já passa do limite...
    expect(x.confirmadoOcupando).toBe(14100);            // ...mas o confirmado (que entra no motor e no limite) não
    expect(x.espacoRestante).toBe(5900);
    const confirmado = resumoWip({ ...e, confirmacoes: [...e.confirmacoes, conf(22100, "2026-10-24", 22100, null, "k2", "2026-10-24T10:00:00Z")] }, "2026-10-26", lim)[0];
    expect(confirmado).toMatchObject({ confirmadoOcupando: 22100, acimaDoLimite: true, espacoRestante: 0 });
  });
  it("ajuste NEGATIVO reabre capacidade de estoque", () => {
    const e = base({ hoje: "2026-10-25", producao: [prod(E1, "2026-10-20", 14100)], confirmacoes: [conf21(14100)], ajustes: [{ controleId: C1, data: "2026-10-23", quantidade: -2000, motivo: "contagem física" }] });
    const x = resumoWip(e, "2026-10-26", lim)[0];
    expect(x).toMatchObject({ confirmadoOcupando: 12100, espacoRestante: 7900 });
  });
});

describe("uma só fonte de verdade: o mesmo saldo não reduz uma semana e fica livre para outra", () => {
  const e = base({
    hoje: "2026-10-25",
    confirmacoes: [conf(10000, "2026-10-25", 10000)],
    semanas: [{ semanaInicio: "2026-10-26", quantidadePorProduto: { [P]: 6000 } }, { semanaInicio: "2026-11-02", quantidadePorProduto: { [P]: 9000 } }, { semanaInicio: "2026-11-09", quantidadePorProduto: { [P]: 9000 } }],
  });
  it("duas (ou três) semanas tentando reservar o mesmo saldo: a soma das alocações nunca passa do confirmado", () => {
    const aloc = ["2026-10-26", "2026-11-02", "2026-11-09"].map((w) => alocacaoDaSemana(e.controles[0], e, w).alocado);
    expect(aloc).toEqual([6000, 4000, 0]);
    expect(aloc.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10000);
  });
  it("o que a semana usa + o que as futuras reservam = o confirmado disponível (nada sobra 'livre' em duplicidade)", () => {
    const a = alocacaoDaSemana(e.controles[0], e, "2026-10-26");
    expect(a.alocado + reservadoParaSemanasFuturas(e.controles[0], e, "2026-10-26")).toBe(a.disponivelAbertura);
    // a próxima semana enxerga só o que sobrou depois da reserva da anterior (ocupa o limite só com o que é dela)
    expect(alocacaoDaSemana(e.controles[0], e, "2026-11-02").disponivelAbertura).toBe(4000);
    expect(alocacaoDaSemana(e.controles[0], e, "2026-11-09").disponivelAbertura).toBe(0);
  });
  it("o motor recebe a MESMA fonte para reduzir a produção e para ocupar o limite", () => {
    const [s] = planejamentoDaSemana(e, "2026-10-26").saldos;
    expect(s).toMatchObject({ saldo: 6000, disponivel: 10000 });
    expect(s.saldo).toBeLessThanOrEqual(s.disponivel);
    const [s2] = planejamentoDaSemana(e, "2026-11-02").saldos;
    expect(s2).toMatchObject({ saldo: 4000, disponivel: 4000 });
  });
  it("idempotente: recalcular com as mesmas entradas (inclusive confirmação duplicada com a mesma data) dá o mesmo resultado", () => {
    const dup = { ...e, confirmacoes: [...e.confirmacoes, { ...e.confirmacoes[0], id: "k1-dup" }] };
    const a = JSON.stringify(resumoWip(e, "2026-10-26", { limites: { [`${P}|${E1}`]: 20000 } }));
    expect(JSON.stringify(resumoWip(e, "2026-10-26", { limites: { [`${P}|${E1}`]: 20000 } }))).toBe(a);
    expect(planejamentoDaSemana(dup, "2026-10-26").saldos[0].saldo).toBe(planejamentoDaSemana(e, "2026-10-26").saldos[0].saldo);
  });
});
