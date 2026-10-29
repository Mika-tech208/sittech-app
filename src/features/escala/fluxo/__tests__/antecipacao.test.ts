import { describe, it, expect } from "vitest";
import { demandaFutura } from "../demandaFutura";
import { decidirPessoaParada, type OpcaoDePosto } from "../pessoaParada";
import { slotsProximaSemana, tetoDeAntecipacao, montarEntradaProximaSemana, contagensDeAbertura } from "../proximaSemana";
import { prepararFluxo } from "../estado";
import { equipe, montar, pool } from "./helpersFluxo";

const sem = (n: number) => new Date(Date.parse("2026-11-02T12:00:00Z") - n * 7 * 86400000).toISOString().slice(0, 10);
const h = (produtoId: string, n: number, quantidade: number) => ({ semana: sem(n), produtoId, quantidade });

describe("demanda futura (geral, sem hardcode por produto)", () => {
  const base = { proximaSemana: "2026-11-02", produtos: ["caixa", "plug", "novo", "morto", "x"], previsaoProxima: null as null | { produtoId: string; quantidade: number }[], diasProdutivosProxima: 4, diasProdutivosTipicos: 5 };
  it("sem Previsão: histórico recorrente = mediana × frequência × maturidade × dias; descontinuado = 0; sem histórico = 0", () => {
    const historico = [
      ...[1, 2, 3, 4, 5, 6].map((n) => h("caixa", n, 70000)),
      h("plug", 1, 30000), h("plug", 3, 30000), h("plug", 4, 30000), h("plug", 6, 30000),
      h("novo", 1, 10000),
      h("morto", 4, 50000), h("morto", 5, 50000),
    ];
    const r = Object.fromEntries(demandaFutura({ ...base, historico }).map((d) => [d.produtoId, d]));
    expect(r.caixa.quantidade).toBe(Math.round(70000 * 0.8)); // freq 100% × maturidade 1 × 4/5
    expect(r.caixa.confianca).toBe("media");
    expect(r.plug.quantidade).toBe(Math.round(30000 * (4 / 6) * 1 * 0.8)); // 4 de 6 semanas
    expect(r.novo.quantidade).toBe(Math.round(10000 * 1 * (1 / 3) * 0.8)); // 1 semana de dados: encolhido
    expect(r.novo.confianca).toBe("baixa");
    expect(r.morto.quantidade).toBe(0);
    expect(r.x.fonte).toBe("nenhuma");
  });
  it("Previsão da próxima semana com itens manda; casca vazia não; pedido vem antes do histórico; configuração é o último recurso", () => {
    const historico = [h("caixa", 1, 70000)];
    expect(demandaFutura({ ...base, historico, previsaoProxima: [{ produtoId: "caixa", quantidade: 1000 }] }).find((d) => d.produtoId === "caixa")).toMatchObject({ fonte: "previsao_proxima", quantidade: 1000, confianca: "alta" });
    expect(demandaFutura({ ...base, historico, previsaoProxima: [{ produtoId: "caixa", quantidade: 1000 }] }).find((d) => d.produtoId === "plug")?.quantidade).toBe(0);
    expect(demandaFutura({ ...base, historico, previsaoProxima: [] }).find((d) => d.produtoId === "caixa")?.fonte).toBe("historico");
    expect(demandaFutura({ ...base, historico, pedidos: [{ produtoId: "x", quantidade: 5 }] }).find((d) => d.produtoId === "x")).toMatchObject({ fonte: "pedido", quantidade: 5 });
    expect(demandaFutura({ ...base, historico, configuracao: { x: 5000 } }).find((d) => d.produtoId === "x")).toMatchObject({ fonte: "configuracao", quantidade: 4000 });
  });
});

describe("teto de antecipação", () => {
  it("min(demanda no par, capacidade do destino) − WIP já existente, nunca negativo", () => {
    expect(tetoDeAntecipacao(10000, 6000, 1000)).toBe(5000);
    expect(tetoDeAntecipacao(3000, 6000, 1000)).toBe(2000);
    expect(tetoDeAntecipacao(3000, 6000, 9000)).toBe(0);
    expect(tetoDeAntecipacao(0, 6000, 0)).toBe(0);
  });
});

describe("regra 'nunca deixar pessoa parada'", () => {
  const o = (p: Partial<OpcaoDePosto>): OpcaoDePosto => ({ posto: "p", produtoId: "A", etapaId: "e", maquinaId: "m", maquinaPermitida: true, temMaterial: true, valorAtual: 0, valorFuturo: 0, hardOk: true, ...p });
  it("semana atual primeiro; senão antecipação; valor atual > valor futuro", () => {
    expect(decidirPessoaParada([o({ posto: "a", valorAtual: 5, valorFuturo: 0 }), o({ posto: "b", valorAtual: 0, valorFuturo: 100 })]).decisao).toBe("trabalho_atual");
    expect(decidirPessoaParada([o({ posto: "a", valorAtual: 0, valorFuturo: 30 }), o({ posto: "b", valorAtual: 0, valorFuturo: 80 })])).toMatchObject({ decisao: "antecipacao", posto: "b" });
  });
  it("antecipação nunca sacrifica a semana atual (valor atual negativo é rejeitado)", () => {
    expect(decidirPessoaParada([o({ valorAtual: -20, valorFuturo: 500 })]).decisao).toBe("sem_posto_auditavel");
  });
  it("valor futuro zero em R$: ainda assim usa a pessoa se alivia capacidade da próxima semana (dentro do teto)", () => {
    expect(decidirPessoaParada([o({ posto: "a", valorAtual: 0, valorFuturo: 0, alivioPostoPeriodos: 0.8 }), o({ posto: "b", valorAtual: 0, valorFuturo: 0, alivioPostoPeriodos: 1.5 })])).toMatchObject({ decisao: "antecipacao_alivio_capacidade", posto: "b" });
    expect(decidirPessoaParada([o({ posto: "a", valorAtual: -5, valorFuturo: 0, alivioPostoPeriodos: 2 })]).decisao).toBe("sem_posto_auditavel");
  });
  it("exceções auditáveis", () => {
    expect(decidirPessoaParada([o({ maquinaPermitida: false })])).toMatchObject({ motivo: "nenhuma_maquina_permitida" });
    expect(decidirPessoaParada([o({ hardOk: false })])).toMatchObject({ motivo: "hard_constraints_impedem" });
    expect(decidirPessoaParada([o({ temMaterial: false })])).toMatchObject({ motivo: "nenhum_material" });
    expect(decidirPessoaParada([o({})])).toMatchObject({ motivo: "nenhuma_demanda_atual_nem_futura" });
    expect(decidirPessoaParada([])).toMatchObject({ decisao: "sem_posto_auditavel" });
  });
});

describe("próxima semana: slots, entrada e contagens de abertura", () => {
  const pools = [pool({ produto: "A", etapa: "A1", op: "opA1", ordem: 1, q: 90000, maquinas: ["a1"], mu: 1000, valor: 0.2 }), pool({ produto: "A", etapa: "A2", op: "opA2", ordem: 2, q: 90000, maquinas: ["a2"], mu: 800, valor: 0.2 }), pool({ produto: "B", etapa: "B1", op: "opB", ordem: 1, q: 5000, maquinas: ["b1"], mu: 700, valor: 0.18 })];
  const m = montar({ pools, funcionarios: equipe(3), c: 1, dias: ["2026-10-29", "2026-10-30"] });
  it("slots: dia inativo (feriado) não gera slot; horários deslocados", () => {
    const dia = m.entrada.slots.filter((s) => s.data === "2026-10-30");
    const prox = slotsProximaSemana(dia, ["2026-11-03", "2026-11-04"]);
    expect(prox).toHaveLength(2 * dia.length);
    expect(prox[0].data).toBe("2026-11-03");
    expect(prox[0].inicioMs - dia[0].inicioMs).toBe(4 * 86400000);
    expect(prox.map((s) => s.indice)).toEqual(prox.map((_, i) => i));
  });
  it("entrada: produto sem demanda sai; Q = demanda esperada; nada congelado", () => {
    const e = montarEntradaProximaSemana(m.entrada, m.entrada.slots, { A: 20000, B: 0 });
    expect(new Set(e.pools.map((p) => p.produtoId))).toEqual(new Set(["A"]));
    expect(e.pools.every((p) => p.quantidade === 20000)).toBe(true);
    expect(e.congeladas).toEqual([]);
    expect(e.aPartirDe).toBe(0);
  });
  it("contagens de abertura: uma por aresta com saldo > 0, com a chave do par", () => {
    const e = montarEntradaProximaSemana(m.entrada, m.entrada.slots, { A: 20000 });
    const ctx = prepararFluxo(e, { apontamentos: [], agoraMs: 0, fechamentoMinutos: 10, planoVigente: [] }, {});
    const chave = Object.values(ctx.grafo.arestas)[0].chavePar;
    const c = contagensDeAbertura(ctx, { [chave]: 1234.4 }, 1000, "teste");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ saldo: 1234, contadoEmMs: 1000 });
  });
});
