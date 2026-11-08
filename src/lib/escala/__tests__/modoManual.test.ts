// MODO MANUAL (06/11/2026): a escala automática não comanda o chão. Provas:
//  (1) a definição de "operação manual" é uma só e exige as TRÊS flags desligadas (nada de meia desativação);
//  (2) o funil `processarSemana` NÃO grava plano no modo manual (eventos, /gerar, /gerar-semana, fechamento e sombra passam por ele);
//  (3) com as flags religadas o comportamento é BYTE-IDÊNTICO ao anterior (hash golden do plano);
//  (4) SEM exceção: nem a semana em PLANEJAMENTO do produto único nem o produto único OPERACIONAL gravam plano no modo manual.
import { describe, it, expect } from "vitest";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { lerParametros } from "@/features/escala/parametros";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { textoTvNaoLiberada, visaoLiberacaoTv } from "@/features/escala/fechamento/visaoTv";
import { Mundo, estadoDeTeste } from "./bancoMemoria";
import { mundoUnico } from "./produtoUnicoFixture";
import { MOTIVO_OPERACAO_MANUAL, lerOperacaoManual } from "../modoManual";

const SEMANA = "2026-11-02";
const DIAS = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const GERA = epochMsNoFuso("2026-11-02", "18:00");
const CFG = { objetivo: "EQUILIBRIO" as const, busca: { iter: 30000, reinicios: 1, semente: 1 }, buscaComVigente: { iter: 15000, reinicios: 1, semente: 1 } };
const HASH_GOLDEN_LEGADO = "5e9778b57bff051ba6d07a4e04850b665b213287dae715c47e6ac5a326fb1291"; // mesmo golden de produtoUnicoProducao.test.ts

function mundoLegado(manual: boolean) {
  const m = new Mundo(estadoDeTeste(SEMANA, DIAS, { pessoas: 10 }));
  m.editar((e) => {
    e.parametros = { ...lerParametros([]), revezamentoModo: "duro", revezamentoEscopo: "bloco", revezamentoPonteM3T1: true };
    e.producaoReal = { modoEfetivo: "ativo", limiar: null, paresLegado: [], apontamentos: [], mesmoPeriodo: false };
    e.planejadorCorte = { config: CFG, vigenteDoPlanejador: false, distribuicaoSuportada: true };
    if (manual) e.operacaoManual = true;
  });
  return m;
}

const P = (producao: unknown, replan: unknown, fech: unknown) => [
  { chave: "producao_real_modo", valor: producao }, { chave: "replanejamento_modo", valor: replan }, { chave: "escala_fechamento_fisico_modo", valor: fech },
];

describe("definição única de operação manual", () => {
  it("só é manual com as TRÊS flags desligadas (ausente/null contam como desligado, como nos acessores SQL)", () => {
    expect(lerOperacaoManual(P("desligado", "desligado", "desligado"))).toBe(true);
    expect(lerOperacaoManual([])).toBe(true);
    expect(lerOperacaoManual(null)).toBe(true);
    expect(lerOperacaoManual(P(null, null, null))).toBe(true);
  });
  it("qualquer flag ligada/sombra => NÃO é manual (nada de meia desativação)", () => {
    expect(lerOperacaoManual(P("ativo", "desligado", "desligado"))).toBe(false);
    expect(lerOperacaoManual(P("desligado", "ativo_restrito", "desligado"))).toBe(false);
    expect(lerOperacaoManual(P("desligado", "desligado", "ativo"))).toBe(false);
    expect(lerOperacaoManual(P("sombra", "desligado", "desligado"))).toBe(false);
    expect(lerOperacaoManual(P("desligado", "sombra", "sombra"))).toBe(false);
  });
});

describe("funil processarSemana no modo manual", () => {
  it("NÃO recalcula nem grava: status ignorado com o motivo explícito e nenhuma alocação", async () => {
    const m = mundoLegado(true);
    const r = await m.recalcular(GERA, true);
    expect(r.status).toBe("ignorado");
    expect(r.motivoIgnorado).toBe(MOTIVO_OPERACAO_MANUAL);
    expect(m.alocacoes.length).toBe(0);
  });
  it("evento de ausência no meio da semana também é ignorado e o plano gravado antes permanece idêntico", async () => {
    const m = mundoLegado(false);
    await m.recalcular(GERA, true);
    const antes = hashAlocacoes(m.alocacoes);
    m.editar((e) => { e.operacaoManual = true; e.ausencias = [{ funcionarioId: "f01", data: "2026-11-04", horarioInicio: null, horarioFim: null }]; });
    const r = await m.recalcular(epochMsNoFuso("2026-11-03", "12:50"));
    expect(r.status).toBe("ignorado");
    expect(hashAlocacoes(m.alocacoes)).toBe(antes);
  });
  it("flags religadas => comportamento anterior byte-idêntico (hash golden)", async () => {
    const m = mundoLegado(false);
    const r = await m.recalcular(GERA, true);
    expect(r.status).toBe("processado");
    expect(hashAlocacoes(m.alocacoes)).toBe(HASH_GOLDEN_LEGADO);
  });
  it("produto único OPERACIONAL no modo manual: ignorado (nada vai ao chão)", async () => {
    const m = mundoUnico();
    m.editar((e) => { e.operacaoManual = true; });
    const r = await m.recalcular(GERA, true);
    expect(r.status).toBe("ignorado");
    expect(m.alocacoes.length).toBe(0);
  });
  it("semana em PLANEJAMENTO do produto único TAMBÉM é ignorada: nenhuma geração grava plano no modo manual (sem exceção)", async () => {
    const m = mundoUnico();
    m.editar((e) => { e.operacaoManual = true; e.produtoUnico = { ...e.produtoUnico!, modo: "PLANEJAMENTO" }; });
    const r = await m.recalcular(GERA, true);
    expect(r.status).toBe("ignorado");
    expect(r.motivoIgnorado).toBe(MOTIVO_OPERACAO_MANUAL);
    expect(m.alocacoes.length).toBe(0);
  });
});

describe("TV no modo manual", () => {
  const lib = { liberado: false, motivo: "MODO_MANUAL" };
  it("texto neutro: sem postos nem pessoas", () => {
    const t = textoTvNaoLiberada(lib, "T1");
    expect(t.titulo).toBe("PROGRAMAÇÃO AUTOMÁTICA DESATIVADA");
    expect(t.detalhe).toMatch(/manualmente/);
    expect(JSON.stringify(t)).not.toMatch(/AGUARDANDO|fechamento/i);
  });
  it("nenhum período aparece liberado: a TV não mostra programação como ordem de trabalho", () => {
    const v = visaoLiberacaoTv({ liberacao: { t1: lib, t2: lib }, atual: { id: "t1", nome: "T1" }, proximo: { id: "t2", nome: "T2" }, agoraMs: Date.now() });
    expect(v.atual.liberado).toBe(false);
    expect(v.proximo.liberado).toBe(false);
    expect(v.atual.bloqueio?.titulo).toBe("PROGRAMAÇÃO AUTOMÁTICA DESATIVADA");
    expect(v.bannerLiberado).toBeNull();
  });
});
