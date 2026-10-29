import { describe, it, expect } from "vitest";
import { tetoAntecipacao } from "../tetoAntecipacao";
import { melhorPlano, estatisticaPosto, type PlanoMedido } from "../valorFuturo";
import { aberturaProximaSemana, carregarWipAbertura } from "../proximaSemana";
import { demandaFutura } from "../demandaFutura";
import { decidirPessoaParada } from "../pessoaParada";

describe("abertura da próxima semana (regra geral, sem hardcode de data)", () => {
  it("segunda inativa (feriado) ⇒ avança ao próximo dia ativo", () => {
    expect(aberturaProximaSemana(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"], "2026-10-30")?.dia).toBe("2026-11-03");
  });
  it("segunda ativa ⇒ abre na segunda", () => {
    expect(aberturaProximaSemana(["2026-11-02", "2026-11-03"], "2026-10-30")?.dia).toBe("2026-11-02");
  });
  it("ignora dias <= fim da semana atual e devolve null sem dia ativo", () => {
    expect(aberturaProximaSemana(["2026-10-30", "2026-11-04"], "2026-10-30")?.dia).toBe("2026-11-04");
    expect(aberturaProximaSemana([], "2026-10-30")).toBeNull();
  });
});

describe("demanda futura: casca sem itens NÃO substitui o histórico; histórico não é infinito", () => {
  const hist = [1, 2, 3].map((n) => ({ semana: new Date(Date.parse("2026-11-02T12:00:00Z") - n * 7 * 86400000).toISOString().slice(0, 10), produtoId: "A", quantidade: 1000 }));
  it("casca ([]) usa histórico; com itens, a Previsão manda", () => {
    expect(demandaFutura({ produtos: ["A"], proximaSemana: "2026-11-02", previsaoProxima: [], historico: hist })[0].fonte).toBe("historico");
    expect(demandaFutura({ produtos: ["A"], proximaSemana: "2026-11-02", previsaoProxima: [{ produtoId: "A", quantidade: 50 }], historico: hist })[0]).toMatchObject({ fonte: "previsao_proxima", quantidade: 50 });
  });
  it("histórico nunca excede a maior quantidade já prevista (sem crescimento)", () => {
    const q = demandaFutura({ produtos: ["A"], proximaSemana: "2026-11-02", previsaoProxima: null, historico: hist, diasProdutivosProxima: 5 })[0].quantidade;
    expect(q).toBeLessThanOrEqual(1000);
  });
});

describe("teto de antecipação (sem estoque infinito)", () => {
  const base = { demandaFuturaNoPar: 10000, wipDisponivel: 1000, capacidadeDownstreamProx: 8000 };
  it("min(demanda, downstream, gargalo) − WIP − já antecipado", () => {
    expect(tetoAntecipacao(base)).toMatchObject({ teto: 7000, limitadoPor: "capacidade_downstream" });
    expect(tetoAntecipacao({ ...base, capacidadeGargaloProx: 5000 })).toMatchObject({ teto: 4000, limitadoPor: "gargalo_proxima_semana" });
    expect(tetoAntecipacao({ ...base, capacidadeGargaloProx: 5000, jaAntecipado: 1500 }).teto).toBe(2500);
    expect(tetoAntecipacao({ ...base, demandaFuturaNoPar: 500 })).toMatchObject({ teto: 0, limitadoPor: "wip_ja_cobre" });
  });
  it("nº de períodos antecipados limita", () => {
    expect(tetoAntecipacao({ ...base, maxPeriodosAntecipados: 2, periodosAntecipados: 1, pecasPorPeriodoOrigem: 1200 })).toMatchObject({ teto: 1200, limitadoPor: "periodos_antecipados" });
    expect(tetoAntecipacao({ ...base, maxPeriodosAntecipados: 2, periodosAntecipados: 2, pecasPorPeriodoOrigem: 1200 }).teto).toBe(0);
  });
  it("nunca negativo", () => { expect(tetoAntecipacao({ demandaFuturaNoPar: 0, wipDisponivel: 99, capacidadeDownstreamProx: 0 }).teto).toBe(0); });
});

describe("função objetivo LEXICOGRÁFICA (atual > futuro > WIP > churn > estabilidade)", () => {
  const p = (o: Partial<PlanoMedido> & { id: string }): PlanoMedido => ({ valorAtual: 0, valorFuturo: 0, wipInutil: 0, churn: 0, ...o });
  it("atual materialmente melhor vence mesmo com futuro pior", () => {
    expect(melhorPlano([p({ id: "a", valorAtual: 500, valorFuturo: -100 }), p({ id: "b", valorAtual: 0, valorFuturo: 900 })], 100)?.id).toBe("a");
  });
  it("atual indistinguível (dentro do limiar) ⇒ desempata por futuro, depois WIP inútil, churn", () => {
    expect(melhorPlano([p({ id: "a", valorAtual: 500, valorFuturo: 0 }), p({ id: "b", valorAtual: 450, valorFuturo: 300 })], 100)?.id).toBe("b");
    expect(melhorPlano([p({ id: "a", valorAtual: 500, valorFuturo: 10, wipInutil: 900 }), p({ id: "b", valorAtual: 500, valorFuturo: 10, wipInutil: 100 })], 100)?.id).toBe("b");
    expect(melhorPlano([p({ id: "a", valorAtual: 500, churn: 9 }), p({ id: "b", valorAtual: 500, churn: 2 })], 100)?.id).toBe("b");
  });
  it("NÃO é soma ponderada: futuro enorme não compra perda atual acima do limiar", () => {
    expect(melhorPlano([p({ id: "a", valorAtual: 1000 }), p({ id: "b", valorAtual: 0, valorFuturo: 100000 })], 363)?.id).toBe("a");
  });
  it("ordem do array não decide; lista vazia", () => {
    const l = [p({ id: "x", valorAtual: 5 }), p({ id: "y", valorAtual: 5 })];
    expect(melhorPlano(l, 1)?.id).toBe(melhorPlano([...l].reverse(), 1)?.id);
    expect(melhorPlano([], 1)).toBeNull();
  });
});

describe("estatística robusta do posto", () => {
  it("poucas observações ⇒ BAIXA_CONFIANCA_PRODUTIVIDADE; IC contém a mediana; determinístico", () => {
    const r = [0.85, 0.9, 0.78, 0.92, 0.88, 0.7, 0.95, 0.83, 0.87, 0.91, 0.86, 0.8, 0.89, 0.93, 0.84, 0.82, 0.9];
    const e = estatisticaPosto(r);
    expect(e.n).toBe(17);
    expect(e.confianca).toBe("BAIXA_CONFIANCA_PRODUTIVIDADE");
    expect(e.ic95[0]).toBeLessThanOrEqual(e.mediaRobusta);
    expect(e.ic95[1]).toBeGreaterThanOrEqual(e.mediaRobusta);
    expect(estatisticaPosto(r).ic95).toEqual(e.ic95);
  });
  it("amostra grande e homogênea ⇒ OK", () => {
    const r = Array.from({ length: 60 }, (_, i) => 0.9 + ((i % 5) - 2) * 0.005);
    expect(estatisticaPosto(r).confianca).toBe("OK");
  });
});

describe("WIP entre semanas: carrega origem, última confirmação e idade; sinaliza contagem sem bloquear", () => {
  const abertura = Date.parse("2026-11-03T13:00:00Z");
  const item = (o: object) => ({ chavePar: "p|e", produtoId: "p", etapaOrigemId: "e", etapaSeguinteId: "f", saldo: 5000, confirmadoFisico: false, ultimaConfirmacaoMs: null as number | null, confiancaBase: "media" as const, consumoPeriodoDestino: 3000, demandaNoPar: 40000, ...o });
  it("simulado e crítico ⇒ CONTAGEM_RECOMENDADA; saldo preservado", () => {
    const [w] = carregarWipAbertura([item({})], abertura);
    expect(w).toMatchObject({ origem: "simulacao", saldo: 5000, sinal: "CONTAGEM_RECOMENDADA" });
  });
  it("contagem física recente e confiança alta ⇒ sem sinal; idade calculada", () => {
    const [w] = carregarWipAbertura([item({ confirmadoFisico: true, confiancaBase: "alta", ultimaConfirmacaoMs: abertura - 20 * 3600_000 })], abertura);
    expect(w.sinal).toBeNull();
    expect(w.idadeHoras).toBeCloseTo(20, 5);
  });
  it("contagem velha (feriado) ⇒ idade indicada, saldo NÃO zera", () => {
    const [w] = carregarWipAbertura([item({ confirmadoFisico: true, confiancaBase: "alta", ultimaConfirmacaoMs: abertura - 100 * 3600_000 })], abertura);
    expect(w.saldo).toBe(5000);
    expect(w.sinal).toBe("CONTAGEM_RECOMENDADA");
  });
});

describe("pessoa parada: atual manda; trade-off visível", () => {
  it("atual +207 / futuro −125 ainda é escolhido sobre atual 0 / futuro +400 (atual > futuro)", () => {
    const o = (posto: string, a: number, f: number) => ({ posto, produtoId: "A", etapaId: "e", maquinaId: "m", maquinaPermitida: true, temMaterial: true, valorAtual: a, valorFuturo: f, hardOk: true });
    expect(decidirPessoaParada([o("Parafusadeira 9", 207.6, -125.75), o("Rosqueadeira 7", 0, 400)])).toMatchObject({ decisao: "trabalho_atual", posto: "Parafusadeira 9" });
  });
});
