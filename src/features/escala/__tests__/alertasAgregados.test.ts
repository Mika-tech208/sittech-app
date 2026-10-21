// FASE 4d — agregação de alertas: EVENTO NOVO × ESTADO QUE CONTINUA; mudança de estado sempre é evento.
import { describe, it, expect } from "vitest";
import { agregarAlertas, type DecisaoParaAgregar } from "../alertasAgregados";
import type { AlertaSnapshot } from "../snapshotSombra";

const D = "2026-10-19";
const PER = ["m1", "m2", "m3", "t1", "t2", "t3"];
const dec = (slot: number, alertas: AlertaSnapshot[], extra: Partial<DecisaoParaAgregar> = {}): DecisaoParaAgregar => ({
  marco: { slot, data: D, periodoId: PER[slot], corteMs: slot * 1000 }, situacao: "B→D", compromissoOriginal: "compromisso_valido", compromissoApos: "compromisso_valido", alertas, ...extra,
});
const nao = (qtd = 1, data = "2026-10-20", periodoId = "m2"): AlertaSnapshot => ({ tipo: "demanda_nao_atendida", data, periodoId, produtoId: "pA", etapaId: "eA1", pecas: qtd });

describe("alertas de ESTADO: o mesmo problema corte após corte vira um item", () => {
  it("persiste em M1, M2, M3: 1 item, iniciou em M1, continua ativo, 3 cortes, pior valor", () => {
    const r = agregarAlertas([dec(0, [nao(100)]), dec(1, [nao(300)]), dec(2, [nao(200)])]);
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0]).toMatchObject({ tipo: "demanda_nao_atendida", natureza: "estado", cortesPersistiu: 3, primeiroValor: 100, piorValor: 300, continuaAtivo: true, resolvidoEm: null, expiradoEm: null, reaparicao: 0 });
    expect(r.alertas[0].iniciouEm.slot).toBe(0);
    expect(r.alertas[0].ultimoVistoEm.slot).toBe(2);
    expect(r.resumo).toMatchObject({ alertasBrutos: 3, itensTotal: 1, ativos: 1 });
  });
  it("some enquanto o período ainda está no futuro => RESOLVEU; reaparece => item novo (recorrência visível)", () => {
    const r = agregarAlertas([dec(0, [nao(100)]), dec(1, [nao(100)]), dec(2, []), dec(3, [nao(50)])]);
    expect(r.alertas).toHaveLength(2);
    expect(r.alertas[0]).toMatchObject({ cortesPersistiu: 2, continuaAtivo: false, expiradoEm: null });
    expect(r.alertas[0].resolvidoEm?.slot).toBe(2);
    expect(r.alertas[1]).toMatchObject({ reaparicao: 1, continuaAtivo: true, cortesPersistiu: 1 });
  });
  it("some porque o período a que se refere já passou => EXPIROU (não é resolução)", () => {
    const r = agregarAlertas([dec(0, [nao(100, D, "m2")]), dec(1, [nao(100, D, "m2")]), dec(2, [])]);
    expect(r.alertas[0].expiradoEm?.slot).toBe(2);
    expect(r.alertas[0].resolvidoEm).toBeNull();
    expect(r.resumo.expirados).toBe(1);
  });
  it("alertas de períodos diferentes são itens diferentes; produto/etapa diferentes também", () => {
    const r = agregarAlertas([dec(0, [nao(1, "2026-10-20", "m1"), nao(1, "2026-10-20", "m2"), { ...nao(1), produtoId: "pB" }])]);
    expect(r.alertas).toHaveLength(3);
  });
});

describe("alertas de EVENTO e mudanças de estado NÃO são deduplicados demais", () => {
  it("conflito de rotação / inviável / contingência continuam sendo um item por corte", () => {
    const ev = (slot: number): AlertaSnapshot => ({ tipo: "conflito_rotacao_comprometido", data: D, periodoId: PER[slot + 1], quantidade: 2 });
    const r = agregarAlertas([dec(0, [ev(0)]), dec(1, [ev(1)]), dec(2, [ev(2)])]);
    expect(r.alertas.filter((a) => a.natureza === "evento")).toHaveLength(3);
    expect(r.resumo).toMatchObject({ itensEvento: 3, itensEstado: 0 });
  });
  it("situação: Atingível → Em risco recuperável → Não recuperável são eventos; continuar igual não é", () => {
    const seq = ["OK", "OK", "B→C", "B→C", "B→D", "B→D", "B→D", "B→C", "B→D"];
    const r = agregarAlertas(seq.map((s, i) => dec(i % 6, [], { situacao: s, marco: { slot: i, data: D, periodoId: PER[i % 6], corteMs: i } })));
    expect(r.mudancas.filter((m) => m.dimensao === "situacao").map((m) => `${m.de}>${m.para}`)).toEqual(["null>OK", "OK>B→C", "B→C>B→D", "B→D>B→C", "B→C>B→D"]);
    expect(r.resumo.mudancasSituacao).toBe(5);
  });
  it("compromisso: válido → conflito de rotação → reparado → válido preserva o caminho", () => {
    const r = agregarAlertas([
      dec(0, []), dec(1, [], { compromissoOriginal: "conflito_rotacao_comprometido", compromissoApos: "compromisso_reparavel" }),
      dec(2, [], { compromissoOriginal: "conflito_rotacao_comprometido", compromissoApos: "compromisso_reparavel" }), dec(3, []),
    ]);
    expect(r.mudancas.filter((m) => m.dimensao === "compromisso").map((m) => m.para)).toEqual(["compromisso_valido", "conflito_rotacao_comprometido→compromisso_reparavel", "compromisso_valido"]);
  });
  it("redução reportada = brutos − itens", () => {
    const r = agregarAlertas([dec(0, [nao(), { ...nao(), periodoId: "m3" }]), dec(1, [nao(), { ...nao(), periodoId: "m3" }]), dec(2, [nao(), { ...nao(), periodoId: "m3" }])]);
    expect(r.resumo).toMatchObject({ alertasBrutos: 6, itensTotal: 2, reducao: 66.7 });
  });
});
