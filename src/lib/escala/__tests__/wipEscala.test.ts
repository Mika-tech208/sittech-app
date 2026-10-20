// Saldo de estoque intermediário CONFIRMADO como entrada canônica da Escala (Fase 3).
import { describe, it, expect } from "vitest";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { EntradaWip } from "@/features/escala/wipSaldo";
import { Mundo, estadoDeTeste } from "./bancoMemoria";
import { montarEntradaEscala } from "../montarEntrada";
import type { EstadoBruto } from "../estado";

const SEMANA = "2026-11-02";
const DIAS = [SEMANA, "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const AGORA = epochMsNoFuso("2026-10-30", "10:00"); // hoje = 30/10, semana inteira no futuro
const ABERTA = epochMsNoFuso("2026-11-03", "09:30"); // semana em andamento

const wipBase = (parcial: Partial<Omit<EntradaWip, "hoje">> = {}): Omit<EntradaWip, "hoje"> => ({
  controles: [{ id: "c1", produtoId: "pA", etapaOrigemId: "eA1", etapaSeguinteId: "eA2", dataInicio: "2026-10-05", saldoInicial: 0, ativo: true }],
  ajustes: [], confirmacoes: [], snapshots: [],
  producao: [{ etapaId: "eA1", data: "2026-10-28", boas: 1500 }],
  semanas: [],
  roteiro: { produtoAtivo: { pA: true }, etapasPorProduto: { pA: [{ id: "eA1", ordem: 1 }, { id: "eA2", ordem: 2 }] } },
  ...parcial,
});
const confirmacao = (q: number, dref = "2026-10-30") => ({ id: "k1", controleId: "c1", dataReferencia: dref, quantidade: q, saldoEstimado: q, motivo: null, criadoEm: "2026-10-30T09:00:00Z" });

function estado(wip?: Omit<EntradaWip, "hoje">, modo: "ativo" | "desligado" = "ativo"): EstadoBruto {
  const e = estadoDeTeste(SEMANA, DIAS, { pessoas: 14 });
  e.itens[0].quantidade = 3000;
  e.itens[1].quantidade = 2500;
  e.parametros = { wipModo: modo, wipDiasLimite: 1 };
  if (wip) e.wipControle = wip;
  return e;
}
const qOrigem = (e: EstadoBruto) => montarEntradaEscala(e, AGORA).entrada.pools.find((p) => p.etapaId === "eA1")!.quantidade;
const assinatura = async (e: EstadoBruto, agora = AGORA) => { const m = new Mundo(e); await m.recalcular(agora, true); return Mundo.assinatura(m.futuras(agora)); };

describe("WIP confirmado como entrada do motor", () => {
  it("sem controle/saldo: a entrada e a escala são IDÊNTICAS ao comportamento anterior", async () => {
    expect(await assinatura(estado(undefined))).toBe(await assinatura(estado(wipBase())));
    expect(qOrigem(estado(wipBase()))).toBe(3000);
  });

  it("saldo ESTIMADO (sem confirmação) NÃO altera nada: nem a quantidade da origem nem a escala", async () => {
    const e = estado(wipBase());
    expect(qOrigem(e)).toBe(3000);
    expect(montarEntradaEscala(e, AGORA).entrada.wip?.saldo0).toBeUndefined();
    expect(await assinatura(e)).toBe(await assinatura(estado(undefined)));
  });

  it("saldo CONFIRMADO reduz o que a etapa ORIGEM produz; o previsto salvo (itens) não muda", async () => {
    const e = estado(wipBase({ confirmacoes: [confirmacao(1200)] }));
    expect(qOrigem(e)).toBe(1800); // previsto 3.000 − WIP confirmado 1.200
    expect(e.itens[0].quantidade).toBe(3000); // o Previsto continua 3.000
    const entrada = montarEntradaEscala(e, AGORA).entrada;
    expect(entrada.pools.find((p) => p.etapaId === "eA2")!.quantidade).toBe(3000); // a etapa seguinte continua com 3.000
    expect(entrada.wip?.saldo0).toEqual({ "pA|eA1": 1200 });
    expect(await assinatura(e)).not.toBe(await assinatura(estado(undefined))); // confirmado ALTERA a escala
  });

  it("confirmado maior que o previsto da origem só usa o previsto (origem nunca produz negativo)", () => {
    expect(qOrigem(estado(wipBase({ confirmacoes: [confirmacao(99999)] })))).toBe(0);
  });

  it("WIP desligado ignora o saldo (parâmetro é o interruptor)", async () => {
    const e = estado(wipBase({ confirmacoes: [confirmacao(1200)] }), "desligado");
    expect(qOrigem(e)).toBe(3000);
    expect(await assinatura(e)).toBe(await assinatura(estado(undefined, "desligado")));
  });

  it("controle inconsistente (rota alterada) NÃO entra no planejamento", () => {
    const e = estado(wipBase({ confirmacoes: [confirmacao(1200)], roteiro: { produtoAtivo: { pA: true }, etapasPorProduto: { pA: [{ id: "eA1", ordem: 1 }, { id: "x", ordem: 2 }, { id: "eA2", ordem: 3 }] } } }));
    expect(qOrigem(e)).toBe(3000);
  });

  it("o alerta de falta de material considera o estoque confirmado (a etapa seguinte pode consumi-lo)", () => {
    // sem o saldo, a etapa seguinte (3.000) teria que esperar a origem (reduzida a 1.800): com o saldo não há risco
    const e = estado(wipBase({ confirmacoes: [confirmacao(1200)] }));
    const entrada = montarEntradaEscala(e, AGORA).entrada;
    expect(entrada.wip?.saldo0?.["pA|eA1"]).toBe(1200);
  });
});

describe("reversibilidade e reprodutibilidade com WIP confirmado", () => {
  it("confirmação -> controle desativado => volta exatamente à escala sem WIP", async () => {
    const m = new Mundo(estado(wipBase({ confirmacoes: [confirmacao(1200)] })));
    await m.recalcular(AGORA, true);
    const comWip = Mundo.assinatura(m.futuras(AGORA));
    m.editar((e) => (e.wipControle!.controles[0].ativo = false));
    await m.recalcular(AGORA);
    expect(Mundo.assinatura(m.futuras(AGORA))).toBe(await assinatura(estado(undefined)));
    m.editar((e) => (e.wipControle!.controles[0].ativo = true));
    await m.recalcular(AGORA);
    expect(Mundo.assinatura(m.futuras(AGORA))).toBe(comWip);
  });

  it("recalcular várias vezes é idempotente (mesmas entradas => mesma escala)", async () => {
    const m = new Mundo(estado(wipBase({ confirmacoes: [confirmacao(1200)] })));
    await m.recalcular(AGORA, true);
    const a = Mundo.assinatura(m.futuras(AGORA));
    for (let i = 0; i < 3; i++) { await m.recalcular(AGORA); expect(Mundo.assinatura(m.futuras(AGORA))).toBe(a); }
  });

  it("dois caminhos até o mesmo estado canônico => mesma escala", async () => {
    const direto = await assinatura(estado(wipBase({ confirmacoes: [confirmacao(1200)] })));
    const m = new Mundo(estado(wipBase()));
    await m.recalcular(AGORA, true);
    m.editar((e) => e.wipControle!.confirmacoes.push(confirmacao(500, "2026-10-29")));
    await m.recalcular(AGORA);
    m.editar((e) => e.wipControle!.confirmacoes.push({ ...confirmacao(1200), id: "k2", criadoEm: "2026-10-30T11:00:00Z" })); // nova contagem substitui
    await m.recalcular(AGORA);
    expect(Mundo.assinatura(m.futuras(AGORA))).toBe(direto);
  });
});

describe("foto semanal na abertura da semana", () => {
  it("semana já aberta: a foto é gravada UMA vez e congela o saldo (nova confirmação não muda essa semana)", async () => {
    const m = new Mundo(estado(wipBase({ confirmacoes: [confirmacao(1200, "2026-10-30")] })));
    await m.recalcular(epochMsNoFuso(SEMANA, "05:00"), true); // abertura (segunda 05:00)
    expect(m.snapshotsGravados).toBe(1);
    const snap = m.entradas.wipControle!.snapshots[0];
    expect(snap).toMatchObject({ semanaInicio: SEMANA, controleId: "c1", saldoConfirmadoDisponivel: 1200, saldoAlocado: 1200 });
    const antes = Mundo.assinatura(m.futuras(ABERTA));
    await m.recalcular(ABERTA);
    // chega OUTRA confirmação durante a semana: a semana aberta não muda
    m.editar((e) => e.wipControle!.confirmacoes.push({ ...confirmacao(1, "2026-11-02"), id: "k2", criadoEm: "2026-11-02T12:00:00Z", motivo: "recontagem" }));
    await m.recalcular(ABERTA);
    expect(m.entradas.wipControle!.snapshots).toHaveLength(1); // a 1ª gravada vale; nenhuma foto nova
    expect(qOrigem(m.entradas)).toBe(1800); // a foto congelada manda: a confirmação nova não reescreve a semana
    expect(Mundo.assinatura(m.futuras(ABERTA))).toBe(antes);
  });

  it("semana futura não grava foto", async () => {
    const m = new Mundo(estado(wipBase({ confirmacoes: [confirmacao(1200)] })));
    await m.recalcular(AGORA, true);
    expect(m.snapshotsGravados).toBe(0);
  });
});

// ---------------- Fase 3 (correção): o confirmado consome o limite de estoque no motor ----------------
import { gerarEscala } from "@/features/escala/gerarEscala";

describe("limite de estoque com WIP confirmado (motor)", () => {
  const cenario = (confirmado: number, capEtapa1 = 100000) => {
    const e = estado(confirmado > 0 ? wipBase({ confirmacoes: [confirmacao(confirmado)] }) : undefined);
    e.itens[0].adicionalPorEtapa = { eA1: capEtapa1, eA2: 0 }; // só WIP na etapa 1 (estoque aguardando a etapa 2)
    const { entrada } = montarEntradaEscala(e, AGORA);
    const r = gerarEscala(entrada);
    return { entrada, r, a1: r.adicionalProduzido["pA|eA1"] ?? 0, limite: entrada.wip!.limites["pA|eA1"] };
  };
  const L = cenario(0).limite;

  it("pré-condição: o limite existe e há WIP planejado sem saldo confirmado", () => {
    expect(L).toBeGreaterThan(0);
    expect(cenario(0).a1).toBeGreaterThan(0);
    expect(cenario(0).a1).toBeLessThanOrEqual(L + 1e-6);
  });

  it("confirmado ABAIXO do limite: o WIP novo cabe só no espaço que sobra (limite − confirmado)", () => {
    const c = Math.round(L / 2);
    const x = cenario(c);
    expect(x.entrada.wip?.estoqueConfirmado?.["pA|eA1"]).toBe(c);
    expect(x.a1).toBeLessThanOrEqual(L - c + 1e-6);
    expect(x.a1).toBeLessThan(cenario(0).a1 + 1e-6);
  });

  it("confirmado EXATAMENTE no limite: nenhum WIP novo, sem alerta", () => {
    const x = cenario(L);
    expect(x.a1).toBe(0);
    expect(x.r.alertas.some((a) => a.tipo === "wip_acima_do_limite")).toBe(false);
  });

  it("confirmado ACIMA do limite: nenhum WIP novo, nada é apagado, o previsto continua consumindo e há alerta", () => {
    const c = L + 500;
    const x = cenario(c);
    expect(x.a1).toBe(0);
    expect(x.entrada.wip?.estoqueConfirmado?.["pA|eA1"]).toBe(c); // não corrigido
    expect(x.entrada.pools.find((p) => p.etapaId === "eA1")!.quantidade).toBe(Math.max(0, 3000 - c)); // o previsto consome o saldo
    expect(x.r.alertas.some((a) => a.tipo === "wip_acima_do_limite" && a.pecas === c && a.quantidade === L)).toBe(true);
  });

  it("confirmado + WIP planejado chegando EXATAMENTE ao limite é permitido; acima disso é cortado", () => {
    const c = Math.round(L / 4);
    const exato = cenario(c, L - c);
    expect(exato.a1 + c).toBeLessThanOrEqual(L + 1e-6);
    const maior = cenario(c, L); // planejou mais do que cabe: o motor corta no espaço restante
    expect(maior.a1 + c).toBeLessThanOrEqual(L + 1e-6);
    expect(maior.a1).toBeLessThanOrEqual(L - c + 1e-6);
  });

  it("sem saldo confirmado o limite é o da Fase 1 (comportamento antigo)", () => {
    const x = cenario(0);
    expect(x.entrada.wip?.estoqueConfirmado).toBeUndefined();
  });

  it("o mesmo saldo não reduz a produção e fica livre para o limite: alocado ≤ disponível e ambos vêm da mesma fonte", () => {
    const c = 900;
    const x = cenario(c);
    expect(x.entrada.wip?.saldo0?.["pA|eA1"]).toBe(c);                // reduz a produção
    expect(x.entrada.wip?.estoqueConfirmado?.["pA|eA1"]).toBe(c);     // ocupa o limite
    expect(x.entrada.pools.find((p) => p.etapaId === "eA1")!.quantidade).toBe(3000 - c);
  });

  it("estimado (sem confirmação) NÃO ocupa o limite", () => {
    const e = estado(wipBase());
    e.itens[0].adicionalPorEtapa = { eA1: 100000, eA2: 0 };
    expect(montarEntradaEscala(e, AGORA).entrada.wip?.estoqueConfirmado).toBeUndefined();
  });
});
