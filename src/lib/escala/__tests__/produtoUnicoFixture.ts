// Fixture do produto único para os testes de produção/fechamento: modelo canônico (M8 ordem 0 como o backfill; Rosquear 1, Parafusar 2, Etiquetar 3, Embalar 4) em um Mundo em memória.
import { lerParametros } from "@/features/escala/parametros";
import type { ModeloCanonico } from "@/features/produto-canonico/tipos";
import { Mundo, estadoDeTeste } from "./bancoMemoria";

export const SEMANA = "2026-11-02";
export const DIAS = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
export const CFG = { objetivo: "EQUILIBRIO" as const, busca: { iter: 30000, reinicios: 1, semente: 1 }, buscaComVigente: { iter: 15000, reinicios: 1, semente: 1 } };
const METAS = (a: number, b: number) => ({ m1: a, m2: b, m3: a, t1: b, t2: a, t3: b });

export const MODELO: ModeloCanonico = {
  produtoCanonicoId: "pK", codigo: "CONECTOR_3_4_UNICO", nomeExibicao: "Conector 3/4",
  rotas: [{ id: "R1", codigo: "CONVENCIONAL", nome: "ROTA 1", tipo: "convencional", ordem: 1, ativa: true }, { id: "R2", codigo: "AUTOMATICA", nome: "ROTA 2", tipo: "automatica", ordem: 2, ativa: true }],
  etapas: [{ etapaId: "k_m8", papel: "ROTA", rotaId: "R2" }, { etapaId: "k_ros", papel: "ROTA", rotaId: "R1" }, { etapaId: "k_par", papel: "ROTA", rotaId: "R1" }, { etapaId: "k_eti", papel: "COMUM", rotaId: null }, { etapaId: "k_emb", papel: "FINAL", rotaId: null }],
  arestas: [{ origemEtapaId: "k_ros", destinoEtapaId: "k_par" }, { origemEtapaId: "k_par", destinoEtapaId: "k_eti" }, { origemEtapaId: "k_m8", destinoEtapaId: "k_eti" }, { origemEtapaId: "k_eti", destinoEtapaId: "k_emb" }],
  produtosLegado: {}, etapasLegado: {},
};

export function mundoUnico(opts: { planejador?: boolean; unico?: boolean; m8?: string[]; total?: number } = {}) {
  const m = new Mundo(estadoDeTeste(SEMANA, DIAS, { pessoas: 8 }));
  m.editar((e) => {
    e.itens = [{ produtoId: "pK", quantidade: opts.total ?? 9000, quantidadeAdicional: 0, valorUnitario: 1, maquinasPorEtapa: { k_ros: ["r1"], k_par: ["p1"], k_m8: opts.m8 ?? ["m8"], k_eti: ["e1"], k_emb: ["b1"] } }];
    e.etapas = [
      { id: "k_m8", produtoId: "pK", operacaoId: "opM", ordem: 0, metas: METAS(400, 340) }, { id: "k_ros", produtoId: "pK", operacaoId: "opR", ordem: 1, metas: METAS(600, 520) },
      { id: "k_par", produtoId: "pK", operacaoId: "opP", ordem: 2, metas: METAS(500, 420) }, { id: "k_eti", produtoId: "pK", operacaoId: "opE", ordem: 3, metas: METAS(900, 800) },
      { id: "k_emb", produtoId: "pK", operacaoId: "opB", ordem: 4, metas: METAS(1200, 1100) },
    ];
    e.nomesOperacao = { opR: "Rosquear", opP: "Parafusar", opM: "M8", opE: "Etiquetar", opB: "Embalar" };
    e.parametros = { ...lerParametros([]), revezamentoModo: "duro", revezamentoEscopo: "bloco", revezamentoPonteM3T1: true };
    e.producaoReal = { modoEfetivo: "ativo", limiar: null, paresLegado: [], apontamentos: [], mesmoPeriodo: false };
    if (opts.planejador !== false) e.planejadorCorte = { config: CFG, vigenteDoPlanejador: false, distribuicaoSuportada: true };
    if (opts.unico !== false) e.produtoUnico = { modelo: MODELO, cutover: "2026-11-02" };
  });
  return m;
}

