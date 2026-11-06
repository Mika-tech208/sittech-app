// PRODUTO ÚNICO — HARD GATES 1–12 + invariantes, com o corte-v1 REAL (planejarSemanaComCorte), NÃO dois produtos independentes.
// Entrada = produto CANÔNICO (1 item, 5 etapas, grafo com convergência) -> montarEntradaEscala (com `produtoUnico`) -> desdobrarCanonico -> planejarSemanaComCorte({produtoUnico:true}) -> recomporAlocacoes.
// Mini-Conector: Rosquear(r1) → Parafusar(p1) ┐ ; M8(m8) ┘ → Etiquetar(e1) → Embalar(b1). Buffer comum = Parafusar→Etiquetar (recebe Parafusar E M8).
import { describe, expect, it } from "vitest";
import { lerParametros } from "@/features/escala/parametros";
import { distribuicaoEfetiva } from "@/features/escala/distribuicao";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { EstadoBruto } from "@/lib/escala/estado";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { PERIODOS_REAIS } from "@/features/escala/__tests__/helpers";
import { desdobrarCanonico, dadosParaVirtual, recomporAlocacoes } from "@/features/produto-canonico/adaptadorMotor";
import type { ModeloCanonico } from "@/features/produto-canonico/tipos";
import { planejarSemanaComCorte } from "../planoCorte";
import { verificarRestricoesDuras } from "../restricoes";
import type { ContagemFisicaPar, DadosProducaoReal } from "../tipos";
import type { AlocacaoEscala } from "@/features/escala/types";

const METAS = (a: number, b: number) => ({ m1: a, m2: b, m3: a, t1: b, t2: a, t3: b });
const DIAS = ["2026-11-03", "2026-11-04", "2026-11-05"];
const PERIODOS = ["m1", "m2", "m3", "t1", "t2", "t3"];
interface Var { etiq?: [number, number]; r1?: string[]; p1?: string[]; m8?: string[]; e1?: string[]; b1?: string[]; total?: number; pessoas?: number; indisponiveis?: string[] }
const MODELO: ModeloCanonico = {
  produtoCanonicoId: "pK", codigo: "CONECTOR_3_4_UNICO", nomeExibicao: "Conector 3/4",
  rotas: [{ id: "R1", codigo: "CONVENCIONAL", nome: "ROTA 1", tipo: "convencional", ordem: 1, ativa: true }, { id: "R2", codigo: "AUTOMATICA", nome: "ROTA 2", tipo: "automatica", ordem: 2, ativa: true }],
  etapas: [{ etapaId: "k_m8", papel: "ROTA", rotaId: "R2" }, { etapaId: "k_ros", papel: "ROTA", rotaId: "R1" }, { etapaId: "k_par", papel: "ROTA", rotaId: "R1" }, { etapaId: "k_eti", papel: "COMUM", rotaId: null }, { etapaId: "k_emb", papel: "FINAL", rotaId: null }],
  arestas: [{ origemEtapaId: "k_ros", destinoEtapaId: "k_par" }, { origemEtapaId: "k_par", destinoEtapaId: "k_eti" }, { origemEtapaId: "k_m8", destinoEtapaId: "k_eti" }, { origemEtapaId: "k_eti", destinoEtapaId: "k_emb" }],
  produtosLegado: {}, etapasLegado: {},
};
function canonico(v: Var = {}): EstadoBruto {
  return {
    previsaoId: "prev", semanaInicio: "2026-11-02", diasProdutivos: DIAS, periodosAtuais: PERIODOS_REAIS, diasExistentes: [],
    equipeProdutiva: Array.from({ length: v.pessoas ?? 8 }, (_, i) => ({ funcionarioId: `f${String(i + 1).padStart(2, "0")}`, ativo: true })),
    itens: [{ produtoId: "pK", quantidade: v.total ?? 10000, quantidadeAdicional: 0, valorUnitario: 1, maquinasPorEtapa: { k_ros: v.r1 ?? ["r1"], k_par: v.p1 ?? ["p1"], k_m8: v.m8 ?? ["m8"], k_eti: v.e1 ?? ["e1"], k_emb: v.b1 ?? ["b1"] } }],
    etapas: [
      { id: "k_m8", produtoId: "pK", operacaoId: "opM", ordem: 0, metas: METAS(400, 340) }, { id: "k_ros", produtoId: "pK", operacaoId: "opR", ordem: 1, metas: METAS(600, 520) },
      { id: "k_par", produtoId: "pK", operacaoId: "opP", ordem: 2, metas: METAS(500, 420) }, { id: "k_eti", produtoId: "pK", operacaoId: "opE", ordem: 3, metas: METAS(...(v.etiq ?? [900, 800])) },
      { id: "k_emb", produtoId: "pK", operacaoId: "opB", ordem: 4, metas: METAS(1200, 1100) },
    ],
    maquinasIndisponiveisPrevisao: v.indisponiveis ?? [], maquinasInativas: [], ausencias: [], indisponibilidades: [], alocacoes: [],
    nomesOperacao: { opR: "Rosquear", opP: "Parafusar", opM: "Rosquear + Parafusar (M8)", opE: "Etiquetar", opB: "Embalar" },
    parametros: { ...lerParametros([]), revezamentoModo: "duro", revezamentoEscopo: "bloco", revezamentoPonteM3T1: true },
    produtoUnico: { modelo: MODELO, cutover: "2026-11-02", modo: "OPERACIONAL" as const },
  } as unknown as EstadoBruto;
}
const CFG = { objetivo: "EQUILIBRIO" as const, busca: { iter: 40000, reinicios: 1, semente: 1 } };
const AGORA = epochMsNoFuso("2026-11-02", "18:00");
const ct = (o: string, s: string, saldo: number, produtoId = "pK"): ContagemFisicaPar => ({ produtoId, etapaOrigemId: o, etapaSeguinteId: s, saldo, contadoEmMs: epochMsNoFuso("2026-11-02", "17:50"), informadoPor: "t", observacao: "t" });
const dados = (contagens: ContagemFisicaPar[] = []): DadosProducaoReal => ({ apontamentos: [], agoraMs: AGORA, fechamentoMinutos: 10, planoVigente: [], contagensFisicas: contagens });

function rodar(v: Var = {}, contagens: ContagemFisicaPar[] = [], objetivo: "EQUILIBRIO" | "MAX_PECAS_FINAIS" = "EQUILIBRIO") {
  const e = montarEntradaEscala(canonico(v), AGORA).entrada;
  const d = desdobrarCanonico(e, MODELO);
  if ("erro" in d) throw new Error(d.erro);
  const r = planejarSemanaComCorte(d.entrada, dadosParaVirtual(dados(contagens), d), { fluxoMesmoPeriodo: false, paresLegado: [d.par] }, { ...CFG, objetivo, produtoUnico: true });
  const linhas: AlocacaoEscala[] = r.resultado ? recomporAlocacoes(r.resultado.alocacoes, d) : [];
  return { r, d, e, linhas };
}
const soma = (ls: AlocacaoEscala[], filtro: { maq?: string; etapa?: string; periodo?: string; data?: string }) =>
  ls.filter((l) => l.maquinaId && (!filtro.maq || l.maquinaId === filtro.maq) && (!filtro.etapa || l.etapaId === filtro.etapa) && (!filtro.periodo || l.periodoId === filtro.periodo) && (!filtro.data || l.data === filtro.data)).reduce((s, l) => s + l.pecas, 0);
const ZERO_CHECK = { cadeiaInvalida: 0, semMaterial: 0, violacoesDuras: 0, maquinaForaDaPrevisao: 0, duplicidade: 0, excedePessoas: 0, passadoAlterado: 0 };

describe("HARD gates do produto único (corte-v1 real)", () => {
  it("1) só convencional (M8 não selecionada): produz Rosquear→Parafusar→Etiquetar→Embalar; M8 = 0; rota automática indisponível", () => {
    const { r, linhas } = rodar({ m8: [] });
    expect(r.ok).toBe(true);
    expect(soma(linhas, { maq: "m8" })).toBe(0);
    expect(soma(linhas, { etapa: "k_m8" })).toBe(0);
    for (const e of ["k_ros", "k_par", "k_eti", "k_emb"]) expect(soma(linhas, { etapa: e }), e).toBeGreaterThan(0);
    const aut = r.unico!.resumo!.porRota.find((x) => x.produtoId.endsWith("#AUTO"))!;
    expect(aut.entregue).toBe(0);
    expect(aut.disponivel).toBe(false);
    expect(r.checagens).toMatchObject(ZERO_CHECK);
  });

  it("2) só M8 (rota convencional desmarcada: Rosqueadeira e Parafusadeira fora da Previsão): M8 + Etiquetar + Embalar; Rosquear/Parafusar = 0", () => {
    const { r, linhas } = rodar({ r1: [], p1: [] });
    expect(r.ok).toBe(true);
    expect(soma(linhas, { maq: "r1" }) + soma(linhas, { maq: "p1" })).toBe(0);
    expect(soma(linhas, { maq: "m8" })).toBeGreaterThan(4500);
    expect(soma(linhas, { maq: "m8" })).toBeLessThanOrEqual(18 * 400); // capacidade da M8 (1 máquina)
    expect(soma(linhas, { etapa: "k_emb" })).toBeGreaterThan(0);
    expect(r.checagens).toMatchObject(ZERO_CHECK);
  });

  it("3) ambas as rotas: o MOTOR divide (as duas entregam), sem proporção fixa; a divisão muda com o problema", () => {
    const a = rodar();
    const u = a.r.unico!.resumo!;
    const conv = u.porRota.find((x) => x.produtoId.endsWith("#CONV"))!, aut = u.porRota.find((x) => x.produtoId.endsWith("#AUTO"))!;
    expect(conv.entregue).toBeGreaterThan(0);
    expect(aut.entregue).toBeGreaterThan(0);
    // com a Etiquetadora forte e a Rosqueadeira fraca o mix é diferente (nada é fixado pelo Forecast/50-50)
    const b = rodar({ total: 4000 });
    const ub = b.r.unico!.resumo!;
    expect(`${Math.round(ub.porRota[0].pctDoTotal)}`).not.toBe(`${Math.round(u.porRota[0].pctDoTotal)}`);
    expect(a.r.checagens).toMatchObject(ZERO_CHECK);
  });

  it("4) M8 suficiente para tudo: com a convencional desmarcada a M8 entrega TODA a demanda (capacidade 18×400 ≥ demanda) — a rota automática pode ficar com 100%", () => {
    const { r, linhas } = rodar({ r1: [], total: 4000 });
    expect(r.ok).toBe(true);
    expect(soma(linhas, { etapa: "k_emb" })).toBe(4000);
    expect(soma(linhas, { maq: "m8" })).toBeGreaterThanOrEqual(4000);
    expect(r.unico!.resumo!.porRota.find((x) => x.produtoId.endsWith("#CONV"))!.entregue).toBe(0);
  });

  it("5) M8 insuficiente: a convencional complementa (final > o que a M8 sozinha entrega)", () => {
    const so = rodar({ r1: [], p1: [] });
    const com = rodar();
    expect(soma(com.linhas, { etapa: "k_emb" })).toBeGreaterThan(soma(so.linhas, { etapa: "k_emb" }));
    expect(soma(com.linhas, { maq: "r1" })).toBeGreaterThan(0);
    expect(soma(com.linhas, { maq: "m8" })).toBeGreaterThan(0);
  });

  it("6) WIP físico comum > 0 (Parafusadas aguardando Etiquetar): o downstream USA o WIP já no 1º período livre (Etiquetadora gargalo); o estoque de entrada comum já começa em 600", () => {
    const apertado: Var = { etiq: [150, 140] }; // a Etiquetadora é o gargalo: cada peça de WIP aproveitada vira peça final
    const sem = rodar(apertado, [], "MAX_PECAS_FINAIS");
    const com = rodar(apertado, [ct("k_par", "k_eti", 600)], "MAX_PECAS_FINAIS");
    expect(com.r.unico!.resumo!.wipUnificado.find((w) => w.rotulo.startsWith("entrada"))!.inicio[0]).toBe(600);
    const ganho = soma(com.linhas, { etapa: "k_emb" }) - soma(sem.linhas, { etapa: "k_emb" });
    expect(soma(com.linhas, { etapa: "k_eti", data: "2026-11-03", periodo: "m1" })).toBe(150); // 1º período: a Etiquetadora trabalha com o WIP contado (capacidade 150 ≤ 600)
    expect(ganho).toBeGreaterThanOrEqual(100); // a Etiquetadora satura nos dois casos; o WIP recupera o 1º período, que sem ele ficaria vazio
    expect(ganho).toBeLessThanOrEqual(600 + 1e-6); // nunca mais do que o WIP existente (sem material novo do nada)
    expect(com.r.checagens).toMatchObject(ZERO_CHECK);
    // sem WIP e sem produção anterior, Etiquetar no 1º período é 0 (lote Tn→Tn+1)
    expect(soma(sem.linhas, { etapa: "k_eti", data: "2026-11-03", periodo: "m1" })).toBe(0);
  });

  it("7) nenhum upstream (M8, Rosqueadeira e Parafusadeira fora da Previsão) e WIP 0: Etiquetar e Embalar = 0 (nunca etapa inicial, nunca material infinito)", () => {
    const { r, linhas } = rodar({ m8: [], r1: [], p1: [] });
    expect(r.ok).toBe(true);
    expect(soma(linhas, { etapa: "k_eti" }) + soma(linhas, { etapa: "k_emb" })).toBe(0);
    expect(soma(linhas, { maq: "e1" }) + soma(linhas, { maq: "b1" })).toBe(0);
    expect(r.checagens).toMatchObject(ZERO_CHECK);
  });

  it("8) nenhum upstream e WIP físico comum > 0: Etiquetar/Embalar consomem SÓ o WIP existente (≤ WIP) e nada além", () => {
    const { r, linhas } = rodar({ m8: [], r1: [], p1: [] }, [ct("k_par", "k_eti", 800)]);
    expect(r.ok).toBe(true);
    const eti = soma(linhas, { etapa: "k_eti" });
    expect(eti).toBeGreaterThan(0);
    expect(eti).toBeLessThanOrEqual(800);
    expect(soma(linhas, { etapa: "k_emb" })).toBeLessThanOrEqual(eti);
    expect(soma(linhas, { maq: "m8" }) + soma(linhas, { maq: "r1" }) + soma(linhas, { maq: "p1" })).toBe(0);
    expect(r.checagens).toMatchObject(ZERO_CHECK);
  });

  it("9) produção no M1 só alimenta o downstream no M2 (lote Tn→Tn+1): Σ Etiquetar até Tn ≤ Σ (Parafusar + M8) até Tn−1, em todos os períodos", () => {
    const { r, linhas } = rodar();
    expect(r.checagens.cadeiaInvalida).toBe(0);
    const ordem = DIAS.flatMap((d) => PERIODOS.map((p) => [d, p] as const));
    let upAnt = 0, etiAcum = 0, embAcum = 0, etiAnt = 0;
    for (const [d, p] of ordem) {
      etiAcum += soma(linhas, { etapa: "k_eti", data: d, periodo: p });
      embAcum += soma(linhas, { etapa: "k_emb", data: d, periodo: p });
      expect(etiAcum, `Etiquetar até ${d} ${p}`).toBeLessThanOrEqual(upAnt + 1e-6);
      expect(embAcum, `Embalar até ${d} ${p}`).toBeLessThanOrEqual(etiAnt + 1e-6);
      upAnt += soma(linhas, { etapa: "k_par", data: d, periodo: p }) + soma(linhas, { etapa: "k_m8", data: d, periodo: p });
      etiAnt = etiAcum;
    }
    expect(soma(linhas, { etapa: "k_eti", data: "2026-11-03", periodo: "m1" })).toBe(0);
  });

  it("10) demanda 93.300 (64.800 + 28.500): o total é UM (nunca 186.600 por duplicação de rotas); final ≤ demanda; Embalagem conta uma vez", () => {
    const { r, linhas } = rodar({ total: 93300 });
    expect(r.ok).toBe(true);
    expect(r.unico!.info.demandaTotal).toBe(93300);
    expect(r.unico!.resumo!.finalPlanejado).toBe(soma(linhas, { etapa: "k_emb" }));
    expect(soma(linhas, { etapa: "k_emb" })).toBeLessThanOrEqual(93300);
    // com demanda pequena o final é a demanda, não 2×: duas rotas disponíveis não duplicam
    const peq = rodar({ total: 3000 });
    expect(soma(peq.linhas, { etapa: "k_emb" })).toBeLessThanOrEqual(3000);
    expect(peq.r.unico!.resumo!.finalPlanejado).toBeLessThanOrEqual(3000);
  });

  it("11) M8 + convencional alimentam o MESMO buffer: o estoque de entrada comum é a SOMA; contagem da M8 e da convencional no mesmo instante somam; só os 3 buffers", () => {
    const { r } = rodar({}, [ct("k_par", "k_eti", 300), ct("k_m8", "k_eti", 200)]);
    expect(r.ok).toBe(true);
    const w = r.unico!.resumo!.wipUnificado.find((x) => x.rotulo.startsWith("entrada"))!;
    expect(w.inicio[0]).toBe(500);
    const u = r.unico!.resumo!;
    expect(u.trechoComum[0].pecas).toBeLessThanOrEqual(u.entregueTotal + 500); // Etiquetar só consome o entregue pelas duas rotas + WIP comum
    expect(w.inicio.every((v) => v >= 0)).toBe(true);
  });

  it("12) máquina não selecionada no Forecast NUNCA é usada (M8, Rosqueadeira, Parafusadeira, Etiquetadora…) e a indisponível na Previsão também não", () => {
    for (const v of [{ m8: [] }, { r1: [] }, { p1: [] }, { m8: [], p1: [] }] as Var[]) {
      const { r, linhas } = rodar(v);
      const usadas = new Set(linhas.filter((l) => l.maquinaId).map((l) => l.maquinaId));
      if (v.m8) expect(usadas.has("m8"), JSON.stringify(v)).toBe(false);
      if (v.r1) expect(usadas.has("r1"), JSON.stringify(v)).toBe(false);
      if (v.p1) expect(usadas.has("p1"), JSON.stringify(v)).toBe(false);
      expect(r.checagens.maquinaForaDaPrevisao).toBe(0);
    }
    const { linhas } = rodar({ indisponiveis: ["m8"] });
    expect(linhas.some((l) => l.maquinaId === "m8")).toBe(false);
  });
});

describe("invariantes do produto único", () => {
  it("M8 = 1 operador (nunca 2 na mesma hora), sem pessoa/máquina duplicada, buffer comum nunca negativo, sem `distribuicao`, 1 produto, sem ids internos", () => {
    const { r, linhas } = rodar();
    const porSlot = new Map<string, number>();
    linhas.filter((l) => l.maquinaId === "m8").forEach((l) => porSlot.set(`${l.data}|${l.periodoId}`, (porSlot.get(`${l.data}|${l.periodoId}`) ?? 0) + 1));
    expect(Math.max(0, ...porSlot.values())).toBeLessThanOrEqual(1);
    expect(r.checagens.duplicidade).toBe(0);
    expect(r.unico!.resumo!.wipUnificado.every((w) => w.inicio.every((v) => v >= 0))).toBe(true);
    expect(linhas.filter((l) => distribuicaoEfetiva(l)).length).toBe(0);
    expect(linhas.filter((l) => l.maquinaId).every((l) => l.produtoId === "pK")).toBe(true);
    expect(JSON.stringify(linhas)).not.toMatch(/#CONV|#AUTO|@A/);
    expect(r.checagens).toMatchObject(ZERO_CHECK);
  });

  it("nenhuma rota fantasma com M8 desligada: sem linha de M8, rota automática indisponível, demanda não duplicada, WIP não inventado", () => {
    const { r, linhas } = rodar({ m8: [] });
    expect(linhas.some((l) => l.etapaId === "k_m8" || l.maquinaId === "m8")).toBe(false);
    expect(r.unico!.resumo!.porRota.find((x) => x.produtoId.endsWith("#AUTO"))!.entregue).toBe(0);
    expect(r.unico!.info.demandaTotal).toBe(10000);
    expect(soma(linhas, { etapa: "k_emb" })).toBeLessThanOrEqual(10000);
  });

  it("rota convencional desmarcada ⇒ a M8 continua; ambas desmarcadas ⇒ só consome WIP (gates 2 e 8 acima)", () => {
    const { linhas } = rodar({ r1: [] });
    expect(soma(linhas, { maq: "m8" })).toBeGreaterThan(0);
    expect(soma(linhas, { maq: "r1" })).toBe(0);
  });

  it("DECISÃO de revezamento: a operação da M8 ('Rosquear + Parafusar') é UMA operação própria — M8→Parafusar/Rosquear no período seguinte não viola; M8→M8 na pessoa viola 1 vez (sem dupla violação)", () => {
    const { e } = rodar();
    const L = (periodoId: string, op: string, maq: string, etapaId: string): AlocacaoEscala => ({ data: "2026-11-03", periodoId, funcionarioId: "f01", maquinaId: maq, produtoId: "pK", etapaId, operacaoId: op, pecas: 100, excecaoRevezamento: false, motivoExcecao: null, origem: "auto" } as AlocacaoEscala);
    const aposM8 = verificarRestricoesDuras({ ...e, aPartirDe: 0 }, [L("m1", "opM", "m8", "k_m8"), L("m2", "opP", "p1", "k_par")]).filter((v) => v.tipo === "revezamento");
    expect(aposM8).toHaveLength(0);
    const m8m8 = verificarRestricoesDuras({ ...e, aPartirDe: 0 }, [L("m1", "opM", "m8", "k_m8"), L("m2", "opM", "m8", "k_m8")]).filter((v) => v.tipo === "revezamento");
    expect(m8m8.length).toBe(1);
  });
});
