import { describe, expect, it } from "vitest";
import { statusLiberacao, textoTvNaoLiberada, type FechamentoSelo, type SlotSelo } from "../selo";
import { visaoLiberacaoTv } from "../visaoTv";

const H = 3_600_000, D = "2026-11-04";
// períodos de 04/11 (fim em ms relativos; só a ordem importa)
const slots: SlotSelo[] = [
  { data: D, periodoId: "m1", rotulo: "M1", fimMs: 1 * H }, { data: D, periodoId: "m2", rotulo: "M2", fimMs: 2 * H }, { data: D, periodoId: "m3", rotulo: "M3", fimMs: 3 * H },
  { data: D, periodoId: "t1", rotulo: "T1", fimMs: 5 * H }, { data: D, periodoId: "t2", rotulo: "T2", fimMs: 6 * H }, { data: D, periodoId: "t3", rotulo: "T3", fimMs: 7 * H },
];
const fech = (...e: [string, FechamentoSelo][]) => new Map<string, FechamentoSelo>(e.map(([k, v]) => [`${D}|${k}`, v]));
const conf = (excecao = false): FechamentoSelo => ({ estado: "CONFIRMADO", excecao, fechadoEmMs: 2 * H + 60_000 });
const lib = (f: Map<string, FechamentoSelo>) => Object.fromEntries(slots.map((s) => [s.periodoId, statusLiberacao(s, slots, f)]));

describe("liberação da programação para o chão (TV)", () => {
  it("TRANSIÇÃO de 04/11: M1 e M2 seguem liberados sem fechamento (M1 já passou, M2 em execução)", () => {
    const l = lib(fech());
    expect(l.m1).toMatchObject({ liberado: true, motivo: "TRANSICAO" }); expect(l.m2).toMatchObject({ liberado: true, motivo: "TRANSICAO" });
  });
  it("M3 NÃO é liberada enquanto o fechamento físico de M2 não aconteceu (existe uma M3 antiga no banco, mas não é autorização operacional)", () => {
    const l = lib(fech());
    expect(l.m3).toMatchObject({ liberado: false, motivo: "AGUARDANDO_FECHAMENTO", predecessor: { periodoId: "m2" } });
    expect(l.t1.liberado).toBe(false); // e as seguintes continuam dependendo do fechamento do anterior
  });
  it("REGRESSÃO: M2 terminou, M3 antiga no banco, sem fechamento ⇒ TV NÃO mostra os postos da M3 e pede AGUARDANDO NOVA PROGRAMAÇÃO; depois do fechamento CONFIRMADO ⇒ mostra a nova M3", () => {
    const antes = visaoLiberacaoTv({ modo: "ativo", liberacao: lib(fech()), atual: { id: "m3", nome: "M3" }, proximo: { id: "t1", nome: "T1" }, agoraMs: 2 * H + 30_000 });
    expect(antes.atual.liberado).toBe(false); expect(antes.proximo.liberado).toBe(false);
    expect(antes.atual.bloqueio!.titulo).toBe("AGUARDANDO NOVA PROGRAMAÇÃO"); expect(antes.atual.bloqueio!.detalhe).toMatch(/M2 encerrado.*Fechamento físico de M2 em andamento/);
    const depois = visaoLiberacaoTv({ modo: "ativo", liberacao: lib(fech(["m2", conf()])), atual: { id: "m3", nome: "M3" }, proximo: { id: "t1", nome: "T1" }, agoraMs: 2 * H + 90_000 });
    expect(depois.atual).toEqual({ liberado: true, bloqueio: null }); expect(depois.bannerLiberado).toBe("M3 LIBERADO");
    expect(visaoLiberacaoTv({ modo: "ativo", liberacao: lib(fech(["m2", conf()])), atual: { id: "m3", nome: "M3" }, proximo: null, agoraMs: 2 * H + 10 * 60_000 }).bannerLiberado).toBeNull();
  });
  it("durante o recálculo: 'RECALCULANDO M3…'", () => {
    const v = visaoLiberacaoTv({ modo: "ativo", liberacao: lib(fech(["m2", { estado: "RECALCULANDO", excecao: false, fechadoEmMs: 2 * H }])), atual: { id: "m3", nome: "M3" }, proximo: null, agoraMs: 2 * H + 5_000 });
    expect(v.atual.liberado).toBe(false); expect(v.atual.bloqueio!.titulo).toBe("RECALCULANDO M3…");
  });
  it("FALHA DE RECÁLCULO: estoque salvo, motor falhou ⇒ NÃO mostra a M3 antiga: 'PROGRAMAÇÃO NÃO LIBERADA' + 'Estoque salvo. Aguardando correção do recálculo.'", () => {
    const l = lib(fech(["m2", { estado: "ERRO_RECALCULO", excecao: false, fechadoEmMs: 2 * H }]));
    expect(l.m3.motivo).toBe("ERRO_RECALCULO");
    expect(textoTvNaoLiberada(l.m3, "M3")).toEqual({ titulo: "PROGRAMAÇÃO NÃO LIBERADA", detalhe: "Estoque salvo. Aguardando correção do recálculo." });
    expect(visaoLiberacaoTv({ modo: "ativo", liberacao: l, atual: { id: "m3", nome: "M3" }, proximo: null, agoraMs: 3 * H }).atual.liberado).toBe(false);
  });
  it("durante M2 (em execução) a PRÓXIMA (M3) também fica oculta; M2 segue visível", () => {
    const v = visaoLiberacaoTv({ modo: "ativo", liberacao: lib(fech()), atual: { id: "m2", nome: "M2" }, proximo: { id: "m3", nome: "M3" }, agoraMs: 1.5 * H });
    expect(v.atual.liberado).toBe(true); expect(v.proximo.liberado).toBe(false);
  });
  it("fechamento de exceção (sem contagem) também libera; sombra/desligado nunca bloqueiam; simulação ignora", () => {
    expect(lib(fech(["m2", conf(true)])).m3).toMatchObject({ liberado: true, motivo: "CONFIRMADO", excecao: true });
    for (const modo of ["desligado", "sombra"]) expect(visaoLiberacaoTv({ modo, liberacao: lib(fech()), atual: { id: "m3", nome: "M3" }, proximo: null, agoraMs: 3 * H }).atual.liberado).toBe(true);
    expect(visaoLiberacaoTv({ modo: "ativo", liberacao: lib(fech()), atual: { id: "m3", nome: "M3" }, proximo: null, agoraMs: 3 * H, ignorar: true }).atual.liberado).toBe(true);
  });
  it("estado desconhecido (API fora/1ª leitura): nunca expõe o PRÓXIMO período; o em execução não some", () => {
    const v = visaoLiberacaoTv({ modo: null, liberacao: null, atual: { id: "m2", nome: "M2" }, proximo: { id: "m3", nome: "M3" }, agoraMs: 1.5 * H });
    expect(v.atual.liberado).toBe(true); expect(v.proximo.liberado).toBe(false);
  });
  it("dia seguinte: M1 de amanhã só libera com o fechamento físico de T3 de hoje", () => {
    const D2 = "2026-11-05";
    const s2: SlotSelo[] = [...slots, { data: D2, periodoId: "m1", rotulo: "M1", fimMs: 25 * H }, { data: D2, periodoId: "m2", rotulo: "M2", fimMs: 26 * H }];
    expect(statusLiberacao({ data: D2, periodoId: "m1" }, s2, new Map())).toMatchObject({ liberado: false, predecessor: { periodoId: "t3", data: D } });
    expect(statusLiberacao({ data: D2, periodoId: "m1" }, s2, new Map([[`${D}|t3`, conf()]])).liberado).toBe(true);
  });
});
