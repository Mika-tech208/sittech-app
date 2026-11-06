// INTEGRAÇÃO com o planejador da Frente E (branch feat/conector-unico-motor; opção `produtoUnico`). Só roda onde essa branch está mesclada (a opção e `produtoUnico.ts` não existem em origin/main).
// Prova: o MESMO problema no espaço LEGADO (2 produtos, ids legados) e no espaço CANÔNICO (1 produto, 5 etapas, grafo) dá o mesmo plano em métricas (peças finais, peças por máquina,
// pessoas, checagens), e o plano canônico não tem `distribuicao`. G/H/I que dependem do motor.
import { describe, expect, it } from "vitest";
import { lerParametros } from "@/features/escala/parametros";
import { distribuicaoEfetiva } from "@/features/escala/distribuicao";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { EstadoBruto } from "@/lib/escala/estado";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { PERIODOS_REAIS } from "@/features/escala/__tests__/helpers";
import { planejarSemanaComCorte } from "@/features/escala/fluxo/planoCorte";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import type { DadosProducaoReal, ParLegado } from "@/features/escala/fluxo/tipos";
import { desdobrarCanonico, dadosParaVirtual, recomporAlocacoes } from "../adaptadorMotor";
import { canonizarAlocacoes } from "../mapeamento";
import type { ModeloCanonico } from "../tipos";

const METAS = (a: number, b: number) => ({ m1: a, m2: b, m3: a, t1: b, t2: a, t3: b });
const DIAS = ["2026-11-03", "2026-11-04", "2026-11-05"];
const PAR: ParLegado = { id: "conector", produtoConvencionalId: "pC", produtoAutomaticaId: "pA", etapasComuns: [{ rotulo: "Etiquetar", etapaConvencionalId: "c3", etapaAutomaticaId: "a2" }, { rotulo: "Embalar", etapaConvencionalId: "c4", etapaAutomaticaId: "a3" }] };
const base = (itens: unknown[], etapas: unknown[], pessoas = 8) => ({
  previsaoId: "prev", semanaInicio: "2026-11-02", diasProdutivos: DIAS, periodosAtuais: PERIODOS_REAIS, diasExistentes: [],
  equipeProdutiva: Array.from({ length: pessoas }, (_, i) => ({ funcionarioId: `f${String(i + 1).padStart(2, "0")}`, ativo: true })),
  itens, etapas, maquinasIndisponiveisPrevisao: [], maquinasInativas: [], ausencias: [], indisponibilidades: [], alocacoes: [],
  nomesOperacao: { opR: "Rosquear", opP: "Parafusar", opM: "M8", opE: "Etiquetar", opB: "Embalar" },
  parametros: { ...lerParametros([]), revezamentoModo: "duro", revezamentoEscopo: "bloco", revezamentoPonteM3T1: true },
}) as unknown as EstadoBruto;

interface Var { r1?: string[]; p1?: string[]; m8?: string[]; etiq?: [number, number]; pessoas?: number; total?: number }
function legado(v: Var = {}): EstadoBruto {
  const etiq = v.etiq ?? [900, 800], total = v.total ?? 10000;
  return base([
    { produtoId: "pC", quantidade: total * 0.6, quantidadeAdicional: 0, valorUnitario: 1, maquinasPorEtapa: { c1: v.r1 ?? ["r1"], c2: v.p1 ?? ["p1"], c3: ["e1"], c4: ["b1"] } },
    { produtoId: "pA", quantidade: total * 0.4, quantidadeAdicional: 0, valorUnitario: 1, maquinasPorEtapa: { a1: v.m8 ?? ["m8"], a2: ["e1"], a3: ["b1"] } },
  ], [
    { id: "c1", produtoId: "pC", operacaoId: "opR", ordem: 1, metas: METAS(600, 520) }, { id: "c2", produtoId: "pC", operacaoId: "opP", ordem: 2, metas: METAS(500, 420) },
    { id: "c3", produtoId: "pC", operacaoId: "opE", ordem: 3, metas: METAS(...etiq) }, { id: "c4", produtoId: "pC", operacaoId: "opB", ordem: 4, metas: METAS(1200, 1100) },
    { id: "a1", produtoId: "pA", operacaoId: "opM", ordem: 1, metas: METAS(400, 340) }, { id: "a2", produtoId: "pA", operacaoId: "opE", ordem: 2, metas: METAS(...etiq) }, { id: "a3", produtoId: "pA", operacaoId: "opB", ordem: 3, metas: METAS(1200, 1100) },
  ], v.pessoas);
}
// canônico: M8 ordem 0 (como o backfill), Rosquear 1, Parafusar 2, Etiquetar 3, Embalar 4
function canonico(v: Var = {}): EstadoBruto {
  const etiq = v.etiq ?? [900, 800], total = v.total ?? 10000;
  return { ...base([
    { produtoId: "pK", quantidade: total, quantidadeAdicional: 0, valorUnitario: 1, maquinasPorEtapa: { k_ros: v.r1 ?? ["r1"], k_par: v.p1 ?? ["p1"], k_m8: v.m8 ?? ["m8"], k_eti: ["e1"], k_emb: ["b1"] } },
  ], [
    { id: "k_m8", produtoId: "pK", operacaoId: "opM", ordem: 0, metas: METAS(400, 340) }, { id: "k_ros", produtoId: "pK", operacaoId: "opR", ordem: 1, metas: METAS(600, 520) },
    { id: "k_par", produtoId: "pK", operacaoId: "opP", ordem: 2, metas: METAS(500, 420) }, { id: "k_eti", produtoId: "pK", operacaoId: "opE", ordem: 3, metas: METAS(...etiq) },
    { id: "k_emb", produtoId: "pK", operacaoId: "opB", ordem: 4, metas: METAS(1200, 1100) },
  ], v.pessoas), produtoUnico: { modelo: MODELO, cutover: "2026-11-02", modo: "OPERACIONAL" as const } };
}
const MODELO: ModeloCanonico = {
  produtoCanonicoId: "pK", codigo: "CONECTOR_3_4", nomeExibicao: "Conector", rotas: [{ id: "R1", codigo: "CONVENCIONAL", nome: "ROTA 1", tipo: "convencional", ordem: 1, ativa: true }, { id: "R2", codigo: "AUTOMATICA", nome: "ROTA 2", tipo: "automatica", ordem: 2, ativa: true }],
  etapas: [{ etapaId: "k_m8", papel: "ROTA", rotaId: "R2" }, { etapaId: "k_ros", papel: "ROTA", rotaId: "R1" }, { etapaId: "k_par", papel: "ROTA", rotaId: "R1" }, { etapaId: "k_eti", papel: "COMUM", rotaId: null }, { etapaId: "k_emb", papel: "FINAL", rotaId: null }],
  arestas: [{ origemEtapaId: "k_ros", destinoEtapaId: "k_par" }, { origemEtapaId: "k_par", destinoEtapaId: "k_eti" }, { origemEtapaId: "k_m8", destinoEtapaId: "k_eti" }, { origemEtapaId: "k_eti", destinoEtapaId: "k_emb" }],
  produtosLegado: { pC: { produtoCanonicoId: "pK", rotaId: "R1" }, pA: { produtoCanonicoId: "pK", rotaId: "R2" } },
  etapasLegado: { c1: { etapaCanonicaId: "k_ros", produtoLegadoId: "pC" }, c2: { etapaCanonicaId: "k_par", produtoLegadoId: "pC" }, c3: { etapaCanonicaId: "k_eti", produtoLegadoId: "pC" }, c4: { etapaCanonicaId: "k_emb", produtoLegadoId: "pC" }, a1: { etapaCanonicaId: "k_m8", produtoLegadoId: "pA" }, a2: { etapaCanonicaId: "k_eti", produtoLegadoId: "pA" }, a3: { etapaCanonicaId: "k_emb", produtoLegadoId: "pA" } },
};
const CFG = { objetivo: "MAX_PECAS_FINAIS" as const, busca: { iter: 40000, reinicios: 1, semente: 1 } };
const AGORA = epochMsNoFuso("2026-11-02", "18:00");
const dadosVazios = (agoraMs = AGORA, extra: Partial<DadosProducaoReal> = {}): DadosProducaoReal => ({ apontamentos: [], agoraMs, fechamentoMinutos: 10, planoVigente: [], contagensFisicas: [], ...extra });

function rodarLegado(v: Var = {}) {
  const e = montarEntradaEscala(legado(v), AGORA).entrada;
  return planejarSemanaComCorte(e, dadosVazios(), { fluxoMesmoPeriodo: false, paresLegado: [PAR] }, { ...CFG, produtoUnico: true });
}
function rodarCanonico(v: Var = {}) {
  const e = montarEntradaEscala(canonico(v), AGORA).entrada;
  const d = desdobrarCanonico(e, MODELO);
  if ("erro" in d) throw new Error(d.erro);
  const r = planejarSemanaComCorte(d.entrada, dadosParaVirtual(dadosVazios(), d), { fluxoMesmoPeriodo: false, paresLegado: [d.par] }, { ...CFG, produtoUnico: true });
  return { r, d, linhas: r.resultado ? recomporAlocacoes(r.resultado.alocacoes, d) : [] };
}
const soma = (ls: { maquinaId: string | null; pecas: number }[], maq: string) => ls.filter((l) => l.maquinaId === maq).reduce((s, l) => s + l.pecas, 0);
const pessoasPico = (ls: { data: string; periodoId: string; maquinaId: string | null }[]) => { const m = new Map<string, number>(); ls.filter((l) => l.maquinaId).forEach((l) => m.set(`${l.data}|${l.periodoId}`, (m.get(`${l.data}|${l.periodoId}`) ?? 0) + 1)); return Math.max(0, ...m.values()); };

describe("integração motor (Frente E) × produto canônico — paridade legado × canônico", () => {
  it("H) mesmo problema: peças finais, peças por máquina, pico de pessoas e checagens iguais; trecho comum no produto canônico, sem distribuição", () => {
    const L = rodarLegado();
    const C = rodarCanonico();
    expect(L.ok).toBe(true);
    expect(C.r.ok).toBe(true);
    expect(C.r.unico!.resumo!.demandaTotal).toBe(10000);
    expect(C.r.unico!.resumo!.finalPlanejado).toBe(L.unico!.resumo!.finalPlanejado);
    for (const [leg, can] of [["r1", "r1"], ["p1", "p1"], ["m8", "m8"], ["e1", "e1"], ["b1", "b1"]]) {
      expect(soma(C.linhas, can), `máquina ${can}`).toBe(soma(L.resultado!.alocacoes, leg));
    }
    expect(pessoasPico(C.linhas)).toBe(pessoasPico(L.resultado!.alocacoes));
    expect(C.r.checagens).toMatchObject({ cadeiaInvalida: 0, semMaterial: 0, violacoesDuras: 0, maquinaForaDaPrevisao: 0, duplicidade: 0, excedePessoas: 0 });
    expect(C.linhas.filter((l) => l.maquinaId).every((l) => l.produtoId === "pK")).toBe(true); // um só produto final
    expect(C.linhas.filter((l) => distribuicaoEfetiva(l)).length).toBe(0); // item 8: nada de distribuição
    expect(C.linhas.filter((l) => l.maquinaId === "m8").every((l) => l.etapaId === "k_m8")).toBe(true); // a rota é a máquina/operação
    expect(C.linhas.filter((l) => l.maquinaId === "e1").every((l) => l.etapaId === "k_eti")).toBe(true); // nunca "k_eti@A"
    const mix = C.r.unico!.resumo!.porRota;
    expect(mix.every((x) => x.entregue > 0)).toBe(true); // o motor escolheu o mix; nenhuma proporção imposta
  });

  it("A) demanda 10.000 no produto único: final ≤ 10.000 (nunca 20.000) e a Embalagem conta uma vez", () => {
    const C = rodarCanonico();
    expect(soma(C.linhas, "b1")).toBeLessThanOrEqual(10000);
    expect(soma(C.linhas, "b1")).toBe(C.r.unico!.resumo!.finalPlanejado);
  });

  it("B) M8 não selecionada no canônico ⇒ 100% convencional (rota automática indisponível)", () => {
    const C = rodarCanonico({ m8: [] });
    expect(C.r.ok).toBe(true);
    expect(soma(C.linhas, "m8")).toBe(0);
    expect(C.r.unico!.resumo!.porRota.find((x) => x.produtoId.endsWith("#AUTO"))!.entregue).toBe(0);
    const L = rodarLegado({ m8: [] });
    expect(C.r.unico!.resumo!.finalPlanejado).toBe(L.unico!.resumo!.finalPlanejado);
  });

  it("C) rota convencional indisponível (Rosqueadeira não selecionada) ⇒ automática até a capacidade", () => {
    const C = rodarCanonico({ r1: [] });
    expect(C.r.ok).toBe(true);
    expect(soma(C.linhas, "r1")).toBe(0);
    expect(soma(C.linhas, "m8")).toBeGreaterThan(4500);
    expect(soma(C.linhas, "m8")).toBeLessThanOrEqual(18 * 400);
    expect(soma(C.linhas, "m8")).toBe(soma(rodarLegado({ r1: [] }).resultado!.alocacoes, "m8"));
  });

  it("D) Etiquetadora limitada ⇒ upstream não entrega acima do que ela absorve + WIP útil", () => {
    const C = rodarCanonico({ etiq: [150, 140] });
    const u = C.r.unico!.resumo!;
    expect(u.trechoComum[0].pecas).toBeLessThanOrEqual(18 * 150);
    expect(u.entregueTotal - u.trechoComum[0].pecas).toBeLessThanOrEqual(Math.ceil(10000 / 18) + 1);
    expect(u.finalPlanejado).toBe(rodarLegado({ etiq: [150, 140] }).unico!.resumo!.finalPlanejado);
  });

  it("E) apontamento da Embalagem no canônico reduz a demanda total; contagens do WIP das duas rotas vindas em ids LEGADOS convergem após canonizar", () => {
    const agora = epochMsNoFuso("2026-11-03", "12:50");
    const e = montarEntradaEscala(canonico(), agora).entrada;
    const d = desdobrarCanonico(e, MODELO);
    if ("erro" in d) throw new Error(d.erro);
    const ap = (maq: string, etapaId: string, periodoId: string, boas: number): ApontamentoReal => ({ data: "2026-11-03", periodoId, funcionarioId: "f01", maquinaId: maq, produtoId: "pK", etapaId, operacaoId: "opB", boas, refugo: 0, meta: 1200, status: "produzindo", motivo: null, lancadoEmMs: epochMsNoFuso("2026-11-03", "12:40") });
    const dados = dadosParaVirtual(dadosVazios(agora, { apontamentos: [ap("b1", "k_emb", "m1", 1000), ap("b1", "k_emb", "m2", 500)] }), d);
    const r = planejarSemanaComCorte(d.entrada, dados, { fluxoMesmoPeriodo: false, paresLegado: [d.par] }, { ...CFG, produtoUnico: true });
    expect(r.ok).toBe(true);
    expect(r.unico!.info.demandaTotal).toBe(10000);
    expect(r.unico!.info.finalBoaAteAgora).toBe(1500);
    expect(r.unico!.info.restante).toBe(8500);
  });

  it("G/I) o plano legado vigente lido no espaço canônico (canonizar) NÃO perde pessoas, máquinas nem peças; o original não é mutado", () => {
    const L = rodarLegado();
    const original = JSON.stringify(L.resultado!.alocacoes);
    const mapeado = canonizarAlocacoes(L.resultado!.alocacoes, { ...MODELO, produtosLegado: { pC: MODELO.produtosLegado.pC, pA: MODELO.produtosLegado.pA } });
    expect(JSON.stringify(L.resultado!.alocacoes)).toBe(original); // histórico/entrada intacto
    for (const m of ["r1", "p1", "m8", "e1", "b1"]) expect(soma(mapeado, m)).toBe(soma(L.resultado!.alocacoes, m));
    expect(mapeado.map((l) => l.funcionarioId)).toEqual(L.resultado!.alocacoes.map((l) => l.funcionarioId));
    expect(mapeado.filter((l) => l.maquinaId).every((l) => l.produtoId === "pK")).toBe(true);
  });

  it("recálculo no meio da semana com produção real já apontada (canônico): passado intacto, plano válido, restante único", () => {
    const C0 = rodarCanonico();
    const plano = C0.r.resultado!.alocacoes; // virtual, como o motor devolve
    const agora = epochMsNoFuso("2026-11-03", "12:50");
    const st = canonico();
    st.alocacoes = recomporAlocacoes(plano, C0.d).map((a) => ({ ...a }));
    const e = montarEntradaEscala(st, agora).entrada;
    const d = desdobrarCanonico(e, MODELO);
    if ("erro" in d) throw new Error(d.erro);
    const ap = (maq: string, etapaId: string, op: string, periodoId: string, boas: number): ApontamentoReal => ({ data: "2026-11-03", periodoId, funcionarioId: "f01", maquinaId: maq, produtoId: "pK", etapaId, operacaoId: op, boas, refugo: 0, meta: boas, status: "produzindo", motivo: null, lancadoEmMs: epochMsNoFuso("2026-11-03", "12:40") });
    const dados = dadosParaVirtual(dadosVazios(agora, { planoVigente: st.alocacoes, apontamentos: [ap("b1", "k_emb", "opB", "m2", 700), ap("b1", "k_emb", "opB", "m3", 300), ap("r1", "k_ros", "opR", "m1", 600), ap("m8", "k_m8", "opM", "m1", 400)] }), d);
    const r = planejarSemanaComCorte(d.entrada, dados, { fluxoMesmoPeriodo: false, paresLegado: [d.par] }, { ...CFG, produtoUnico: true });
    expect(r.ok).toBe(true);
    expect(r.checagens).toMatchObject({ passadoAlterado: 0, cadeiaInvalida: 0, violacoesDuras: 0 });
    expect(r.unico!.info.finalBoaAteAgora).toBe(1000);
    expect(r.unico!.info.restante).toBe(9000);
    expect(recomporAlocacoes(r.resultado!.alocacoes, d).filter((l) => distribuicaoEfetiva(l)).length).toBe(0);
  });

  it("adaptador: modelo/entrada incompletos devolvem erro explícito (o chamador mantém o motor atual)", () => {
    const e = montarEntradaEscala(legado(), AGORA).entrada; // sem o produto canônico na Previsão
    expect("erro" in desdobrarCanonico(e, MODELO)).toBe(true);
    expect("erro" in desdobrarCanonico(montarEntradaEscala(canonico(), AGORA).entrada, { ...MODELO, rotas: [] })).toBe(true);
  });
});
