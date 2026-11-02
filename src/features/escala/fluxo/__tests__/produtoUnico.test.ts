// PRODUTO ÚNICO COM ROTAS — testes obrigatórios do pedido de 02/11 (A–F) + invariantes (cadeia, revezamento, ≤ pessoas, Previsão, sem dupla contagem, sem `distribuicao`).
// Mini-Conector: rota convencional Rosquear(r1) → Parafusar(p1) ┐ ; rota automática M8(m8) ┘ → Etiquetar(e1) → Embalar(b1) — Etiquetadora e Embalagem são recursos ÚNICOS.
import { describe, expect, it } from "vitest";
import { lerParametros } from "@/features/escala/parametros";
import { distribuicaoEfetiva } from "@/features/escala/distribuicao";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { EstadoBruto } from "@/lib/escala/estado";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { PERIODOS_REAIS } from "@/features/escala/__tests__/helpers";
import { planejarSemanaComCorte } from "../planoCorte";
import { prepararProdutoUnico, produtoUnicoDePar } from "../produtoUnico";
import type { ApontamentoReal } from "../../producaoReal";
import type { ContagemFisicaPar, DadosProducaoReal, ParLegado } from "../tipos";

const METAS = (a: number, b: number) => ({ m1: a, m2: b, m3: a, t1: b, t2: a, t3: b });
const DIAS = ["2026-11-03", "2026-11-04", "2026-11-05"];
const PAR: ParLegado = {
  id: "conector", produtoConvencionalId: "pC", produtoAutomaticaId: "pA",
  etapasComuns: [{ rotulo: "Etiquetar", etapaConvencionalId: "c3", etapaAutomaticaId: "a2" }, { rotulo: "Embalar", etapaConvencionalId: "c4", etapaAutomaticaId: "a3" }],
};
interface Var { qC?: number; qA?: number; r1?: string[]; p1?: string[]; m8?: string[]; etiq?: [number, number]; pessoas?: number }
function estado(v: Var = {}): EstadoBruto {
  const etiq = v.etiq ?? [900, 800];
  return {
    previsaoId: "prev", semanaInicio: "2026-11-02", diasProdutivos: DIAS, periodosAtuais: PERIODOS_REAIS, diasExistentes: [],
    equipeProdutiva: Array.from({ length: v.pessoas ?? 8 }, (_, i) => ({ funcionarioId: `f${String(i + 1).padStart(2, "0")}`, ativo: true })),
    itens: [
      { produtoId: "pC", quantidade: v.qC ?? 6000, quantidadeAdicional: 0, valorUnitario: 1, maquinasPorEtapa: { c1: v.r1 ?? ["r1"], c2: v.p1 ?? ["p1"], c3: ["e1"], c4: ["b1"] } },
      { produtoId: "pA", quantidade: v.qA ?? 4000, quantidadeAdicional: 0, valorUnitario: 1, maquinasPorEtapa: { a1: v.m8 ?? ["m8"], a2: ["e1"], a3: ["b1"] } },
    ],
    etapas: [
      { id: "c1", produtoId: "pC", operacaoId: "opR", ordem: 1, metas: METAS(600, 520) }, { id: "c2", produtoId: "pC", operacaoId: "opP", ordem: 2, metas: METAS(500, 420) },
      { id: "c3", produtoId: "pC", operacaoId: "opE", ordem: 3, metas: METAS(...etiq) }, { id: "c4", produtoId: "pC", operacaoId: "opB", ordem: 4, metas: METAS(1200, 1100) },
      { id: "a1", produtoId: "pA", operacaoId: "opM", ordem: 1, metas: METAS(400, 340) }, { id: "a2", produtoId: "pA", operacaoId: "opE", ordem: 2, metas: METAS(...etiq) },
      { id: "a3", produtoId: "pA", operacaoId: "opB", ordem: 3, metas: METAS(1200, 1100) },
    ],
    maquinasIndisponiveisPrevisao: [], maquinasInativas: [], ausencias: [], indisponibilidades: [], alocacoes: [],
    nomesOperacao: { opR: "Rosquear", opP: "Parafusar", opM: "M8", opE: "Etiquetar", opB: "Embalar" },
    parametros: { ...lerParametros([]), revezamentoModo: "duro", revezamentoEscopo: "bloco", revezamentoPonteM3T1: true },
  } as unknown as EstadoBruto;
}
const CFG = { objetivo: "MAX_PECAS_FINAIS" as const, busca: { iter: 40000, reinicios: 1, semente: 1 } };
const AGORA_VESPERA = epochMsNoFuso("2026-11-02", "18:00");
function dadosVazios(agoraMs = AGORA_VESPERA, extra: Partial<DadosProducaoReal> = {}): DadosProducaoReal {
  return { apontamentos: [], agoraMs, fechamentoMinutos: 10, planoVigente: [], contagensFisicas: [], ...extra };
}
function rodar(v: Var = {}, unico = true) {
  const e = montarEntradaEscala(estado(v), AGORA_VESPERA).entrada;
  const r = planejarSemanaComCorte(e, dadosVazios(), { fluxoMesmoPeriodo: false, paresLegado: [PAR] }, { ...CFG, ...(unico ? { produtoUnico: true } : {}) });
  return { e, r };
}
const somaMaq = (r: ReturnType<typeof rodar>["r"], maq: string) => (r.resultado?.alocacoes ?? []).filter((l) => l.maquinaId === maq).reduce((s, l) => s + l.pecas, 0);

describe("produto único com rotas — testes do pedido", () => {
  it("A) demanda 10.000 ⇒ divide entre as rotas e o produto final é 10.000 (nunca 20.000); sem proporção fixa", () => {
    const { r } = rodar();
    expect(r.ok).toBe(true);
    const u = r.unico!.resumo!;
    expect(u.demandaTotal).toBe(10000);
    expect(u.finalPlanejado).toBeLessThanOrEqual(10000);
    expect(u.finalPlanejado).toBeGreaterThan(8500); // só as duas rotas juntas chegam perto (cada rota sozinha ≤ ~7.800)
    const conv = u.porRota.find((x) => x.produtoId === "pC")!, aut = u.porRota.find((x) => x.produtoId === "pA")!;
    expect(conv.entregue).toBeGreaterThan(0);
    expect(aut.entregue).toBeGreaterThan(0);
    expect(conv.entregue + aut.entregue).toBeGreaterThanOrEqual(u.finalPlanejado);
    expect(somaMaq(r, "b1")).toBe(u.finalPlanejado); // Embalagem 17 conta o produto final UMA vez
    expect(somaMaq(r, "b1")).toBeLessThanOrEqual(10000);
  });

  it("B) M8 indisponível (não selecionada) ⇒ 100% convencional; a rota automática não produz do nada", () => {
    const { r } = rodar({ m8: [] });
    expect(r.ok).toBe(true);
    const u = r.unico!.resumo!;
    expect(u.porRota.find((x) => x.produtoId === "pA")!.entregue).toBe(0);
    expect(u.porRota.find((x) => x.produtoId === "pA")!.disponivel).toBe(false);
    expect(somaMaq(r, "m8")).toBe(0);
    expect(u.porRota.find((x) => x.produtoId === "pC")!.entregue).toBeGreaterThan(5000);
    expect(r.unico!.info.demandaTotal).toBe(10000); // a demanda da rota automática continua na demanda única
    expect(u.finalPlanejado).toBeLessThanOrEqual(u.porRota[0].entregue + u.porRota[1].entregue);
  });

  it("C) rota convencional indisponível (Rosqueadeira não selecionada) ⇒ automática até a capacidade (M8: ≤ 400/340 por período)", () => {
    const { r } = rodar({ r1: [] });
    expect(r.ok).toBe(true);
    const u = r.unico!.resumo!;
    expect(u.porRota.find((x) => x.produtoId === "pC")!.entregue).toBe(0);
    const aut = u.porRota.find((x) => x.produtoId === "pA")!.entregue;
    expect(aut).toBeGreaterThan(4500);
    expect(aut).toBeLessThanOrEqual(18 * 400);
    expect(u.finalPlanejado).toBeLessThanOrEqual(aut);
    expect(somaMaq(r, "r1")).toBe(0);
  });

  it("D) Etiquetadora limitada ⇒ upstream não entrega acima do que ela absorve + WIP útil (≤ 1 período de saída útil)", () => {
    const { r } = rodar({ etiq: [150, 140] });
    expect(r.ok).toBe(true);
    const u = r.unico!.resumo!;
    const etiquetar = u.trechoComum[0].pecas;
    expect(etiquetar).toBeLessThanOrEqual(18 * 150);
    const saidaUtil = Math.ceil(10000 / 18);
    expect(u.entregueTotal - etiquetar).toBeLessThanOrEqual(saidaUtil + 1);
    expect(u.finalPlanejado).toBeLessThanOrEqual(etiquetar);
  });

  it("E) apontamento da Embalagem (de qualquer rota) reduz a demanda total única", () => {
    const e = montarEntradaEscala(estado(), epochMsNoFuso("2026-11-03", "12:50")).entrada;
    const ap = (maq: string, produtoId: string, etapaId: string, periodoId: string, boas: number): ApontamentoReal => ({ data: "2026-11-03", periodoId, funcionarioId: "f01", maquinaId: maq, produtoId, etapaId, operacaoId: "opB", boas, refugo: 0, meta: 1200, status: "produzindo", motivo: null, lancadoEmMs: epochMsNoFuso("2026-11-03", "12:40") });
    const dados = dadosVazios(epochMsNoFuso("2026-11-03", "12:50"), { apontamentos: [ap("b1", "pC", "c4", "m1", 1000), ap("b1", "pA", "a3", "m2", 500)] });
    const p = prepararProdutoUnico(e, dados, { fluxoMesmoPeriodo: false }, produtoUnicoDePar(PAR));
    expect("motivo" in p).toBe(false);
    if ("motivo" in p) return;
    expect(p.info.demandaTotal).toBe(10000);
    expect(p.info.finalBoaAteAgora).toBe(1500); // soma das duas rotas, sem clamp por rota
    expect(p.info.restante).toBe(8500);
    expect(p.produtos.find((x) => x.id === "pC")!.demandaFinal).toBe(8500);
  });

  it("E2) uma rota passou da sua parcela antiga: a demanda única continua somando (não zera por rota)", () => {
    const e = montarEntradaEscala(estado({ qC: 1000, qA: 9000 }), epochMsNoFuso("2026-11-03", "12:50")).entrada;
    const dados = dadosVazios(epochMsNoFuso("2026-11-03", "12:50"), { apontamentos: [{ data: "2026-11-03", periodoId: "m1", funcionarioId: "f01", maquinaId: "b1", produtoId: "pC", etapaId: "c4", operacaoId: "opB", boas: 3000, refugo: 0, meta: 1200, status: "produzindo", motivo: null, lancadoEmMs: epochMsNoFuso("2026-11-03", "12:40") }] });
    const p = prepararProdutoUnico(e, dados, { fluxoMesmoPeriodo: false }, produtoUnicoDePar(PAR));
    if ("motivo" in p) throw new Error(p.motivo);
    expect(p.info.restante).toBe(7000); // 10.000 − 3.000 (por rota: Conv 1.000 − 3.000 = 0 e Auto 9.000 = 9.000 seria 9.000: errado)
  });

  it("F) WIP das duas rotas soma antes da Etiquetadora; contagens do trecho comum não duplicam", () => {
    const e = montarEntradaEscala(estado(), AGORA_VESPERA).entrada;
    const t = epochMsNoFuso("2026-11-02", "06:00");
    const c = (produtoId: string, o: string, s: string, saldo: number, ms = t): ContagemFisicaPar => ({ produtoId, etapaOrigemId: o, etapaSeguinteId: s, saldo, contadoEmMs: ms });
    const base = [c("pC", "c1", "c2", 1200), c("pC", "c2", "c3", 3000), c("pA", "a1", "a2", 2000)];
    const p1 = prepararProdutoUnico(e, dadosVazios(AGORA_VESPERA, { contagensFisicas: [...base, c("pC", "c3", "c4", 700), c("pA", "a2", "a3", 300)] }), { fluxoMesmoPeriodo: false }, produtoUnicoDePar(PAR));
    if ("motivo" in p1) throw new Error(p1.motivo);
    const prin = p1.produtos.find((x) => x.id === "pC")!;
    expect(prin.wipInicial).toEqual([1200, 5000, 1000]); // entrada da Etiquetadora = 3.000 (Parafusar→Etiquetar) + 2.000 (M8→Etiquetar); Etiquetar→Embalar = 700 + 300 (mesmo instante)
    expect(p1.produtos.find((x) => x.id === "pA")!.wipInicial).toEqual([]);
    // instantes diferentes no trecho comum: vale só a mais recente (nunca soma estoques contados em momentos distintos)
    const p2 = prepararProdutoUnico(e, dadosVazios(AGORA_VESPERA, { contagensFisicas: [...base, c("pC", "c3", "c4", 700), c("pA", "a2", "a3", 300, t - 3 * 3600_000)] }), { fluxoMesmoPeriodo: false }, produtoUnicoDePar(PAR));
    if ("motivo" in p2) throw new Error(p2.motivo);
    expect(p2.produtos.find((x) => x.id === "pC")!.wipInicial[2]).toBe(700);
  });
});

describe("produto único com rotas — invariantes do plano", () => {
  it("cadeia, revezamento (bloco + ponte M3→T1), ≤ pessoas, Previsão e sem dupla contagem; trecho comum sem `distribuicao`", () => {
    const { e, r } = rodar({ pessoas: 8 });
    expect(r.ok).toBe(true);
    expect(r.checagens.cadeiaInvalida).toBe(0);
    expect(r.checagens.semMaterial).toBe(0);
    expect(r.checagens.violacoesDuras).toBe(0);
    expect(r.checagens.maquinaForaDaPrevisao).toBe(0);
    expect(r.checagens.duplicidade).toBe(0);
    expect(r.checagens.excedePessoas).toBe(0);
    expect(r.checagens.maxPostosSimultaneos).toBeLessThanOrEqual(8);
    const linhas = r.resultado!.alocacoes;
    expect(linhas.filter((l) => distribuicaoEfetiva(l)).length).toBe(0); // Etiquetadora 15/Embalagem 17 com produto = o único, nenhuma linha com 2 produtos
    const tail = linhas.filter((l) => l.maquinaId === "e1" || l.maquinaId === "b1");
    expect(tail.length).toBeGreaterThan(0);
    expect(new Set(tail.map((l) => l.produtoId))).toEqual(new Set(["pC"])); // um só produto (o canônico) no trecho comum
    // Etiquetadora/Embalagem nunca com dois postos no mesmo período
    const vis = new Set<string>();
    tail.forEach((l) => { const k = `${l.data}|${l.periodoId}|${l.maquinaId}`; expect(vis.has(k)).toBe(false); vis.add(k); });
    expect(e.funcionarios.length).toBe(8);
    expect(r.unico!.resumo!.finalPlanejado).toBe(somaMaq(r, "b1"));
  });

  it("DESLIGADO por padrão: sem `produtoUnico` o resultado não traz `unico` (modo antigo intacto)", () => {
    const { r } = rodar({}, false);
    expect(r.ok).toBe(true);
    expect(r.unico).toBeUndefined();
  });
});
