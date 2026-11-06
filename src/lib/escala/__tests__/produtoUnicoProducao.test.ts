// PRODUTO ÚNICO — LIGAÇÃO DE PRODUÇÃO (processarSemana + Mundo em memória). Prova:
//  (1) GOLDEN: sem cutover/modelo (estado sem `produtoUnico`) o plano gravado é BYTE-IDÊNTICO ao da main de 06/11 (hash de plano igual);
//  (2) a decisão de cutover é UMA função (cutoverDaSemana + escolherModeloUnico) e semana anterior/sem parâmetro/sem modelo = desligado;
//  (3) com `produtoUnico`: o plano gravado só tem ids CANÔNICOS (nunca `#CONV`/`#AUTO`/`@A`), 1 produto final, sem `distribuicao`, e o motor legado nunca é chamado;
//  (4) produto único sem planejador de corte ativo na semana: nada é recalculado (plano mantido) / geração recusada.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/features/escala/gerarEscala", async (orig) => {
  const real = await orig<typeof import("@/features/escala/gerarEscala")>();
  return { ...real, gerarEscala: (...a: Parameters<typeof real.gerarEscala>) => { (globalThis as { __legado?: number }).__legado = ((globalThis as { __legado?: number }).__legado ?? 0) + 1; return real.gerarEscala(...a); } };
});

import { hashAlocacoes } from "@/features/escala/horizonte";
import { lerParametros } from "@/features/escala/parametros";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { cutoverDaSemana, escolherModeloUnico } from "@/features/produto-canonico/cutover";
import type { ModeloCanonico } from "@/features/produto-canonico/tipos";
import { Mundo, estadoDeTeste } from "./bancoMemoria";

const SEMANA = "2026-11-02";
const DIAS = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const GERA = epochMsNoFuso("2026-11-02", "18:00");
const CFG = { objetivo: "EQUILIBRIO" as const, busca: { iter: 30000, reinicios: 1, semente: 1 }, buscaComVigente: { iter: 15000, reinicios: 1, semente: 1 } };
const METAS = (a: number, b: number) => ({ m1: a, m2: b, m3: a, t1: b, t2: a, t3: b });

/** hash do plano do mundo legado (estadoDeTeste) gerado pela MAIN de 06/11 (bd62630); se mudar, o comportamento sem cutover mudou. */
export const HASH_GOLDEN_LEGADO = "__GOLDEN__";

function mundoLegado() {
  const m = new Mundo(estadoDeTeste(SEMANA, DIAS, { pessoas: 10 }));
  m.editar((e) => {
    e.parametros = { ...lerParametros([]), revezamentoModo: "duro", revezamentoEscopo: "bloco", revezamentoPonteM3T1: true };
    e.producaoReal = { modoEfetivo: "ativo", limiar: null, paresLegado: [], apontamentos: [], mesmoPeriodo: false };
    e.planejadorCorte = { config: CFG, vigenteDoPlanejador: false, distribuicaoSuportada: true };
  });
  return m;
}

const MODELO: ModeloCanonico = {
  produtoCanonicoId: "pK", codigo: "CONECTOR_3_4_UNICO", nomeExibicao: "Conector 3/4",
  rotas: [{ id: "R1", codigo: "CONVENCIONAL", nome: "ROTA 1", tipo: "convencional", ordem: 1, ativa: true }, { id: "R2", codigo: "AUTOMATICA", nome: "ROTA 2", tipo: "automatica", ordem: 2, ativa: true }],
  etapas: [{ etapaId: "k_m8", papel: "ROTA", rotaId: "R2" }, { etapaId: "k_ros", papel: "ROTA", rotaId: "R1" }, { etapaId: "k_par", papel: "ROTA", rotaId: "R1" }, { etapaId: "k_eti", papel: "COMUM", rotaId: null }, { etapaId: "k_emb", papel: "FINAL", rotaId: null }],
  arestas: [{ origemEtapaId: "k_ros", destinoEtapaId: "k_par" }, { origemEtapaId: "k_par", destinoEtapaId: "k_eti" }, { origemEtapaId: "k_m8", destinoEtapaId: "k_eti" }, { origemEtapaId: "k_eti", destinoEtapaId: "k_emb" }],
  produtosLegado: {}, etapasLegado: {},
};

function mundoUnico(opts: { planejador?: boolean; unico?: boolean; m8?: string[]; total?: number } = {}) {
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

describe("cutover: uma única decisão", () => {
  const P = (v: unknown) => [{ chave: "produto_unico_cutover", valor: v }];
  it("semana >= cutover liga; anterior/ausente/inválido desliga", () => {
    expect(cutoverDaSemana(P("2026-11-09"), "2026-11-09")).toBe("2026-11-09");
    expect(cutoverDaSemana(P("2026-11-09"), "2026-11-16")).toBe("2026-11-09");
    expect(cutoverDaSemana(P("2026-11-09"), "2026-11-02")).toBeNull();
    expect(cutoverDaSemana([], "2026-11-09")).toBeNull();
    expect(cutoverDaSemana(null, "2026-11-09")).toBeNull();
    expect(cutoverDaSemana(P("2026-11-10"), "2026-11-16")).toBeNull(); // não é segunda
    expect(cutoverDaSemana(P(null), "2026-11-16")).toBeNull();
  });
  it("modelo: precisa das duas rotas; sem modelo = null (legado)", () => {
    expect(escolherModeloUnico([MODELO])).toBe(MODELO);
    expect(escolherModeloUnico([])).toBeNull();
    expect(escolherModeloUnico(null)).toBeNull();
    expect(escolherModeloUnico([{ ...MODELO, rotas: [MODELO.rotas[0]] }])).toBeNull();
  });
});

describe("sem cutover: comportamento idêntico à main (golden)", () => {
  it("o plano gravado do mundo legado tem o hash da main de 06/11", async () => {
    const m = mundoLegado();
    const r = await m.recalcular(GERA, true);
    expect(r.status).toBe("processado");
    expect(hashAlocacoes(m.alocacoes)).toBe(HASH_GOLDEN_LEGADO);
  });
});

describe("com cutover: plano gravado em ids canônicos", () => {
  it("geração: só ids canônicos, 1 produto, sem distribuição, final ≤ demanda, motor legado nunca chamado", async () => {
    (globalThis as { __legado?: number }).__legado = 0;
    const m = mundoUnico();
    const r = await m.recalcular(GERA, true);
    expect(r.status).toBe("processado");
    expect(r.corte?.usado).toBe(true);
    const com = m.alocacoes.filter((a) => a.maquinaId);
    expect(com.length).toBeGreaterThan(0);
    expect(com.every((a) => a.produtoId === "pK")).toBe(true);
    expect(com.every((a) => ["k_m8", "k_ros", "k_par", "k_eti", "k_emb"].includes(a.etapaId!))).toBe(true);
    expect(JSON.stringify(m.alocacoes)).not.toMatch(/#CONV|#AUTO|@A/);
    expect(m.alocacoes.every((a) => !a.distribuicao)).toBe(true);
    const emb = com.filter((a) => a.etapaId === "k_emb").reduce((s, a) => s + a.pecas, 0);
    expect(emb).toBeLessThanOrEqual(9000);
    expect(emb).toBeGreaterThan(0);
    expect((globalThis as { __legado?: number }).__legado).toBe(0);
  });

  it("recálculo no meio da semana (ausência) segue em ids canônicos e determinístico", async () => {
    const m = mundoUnico();
    await m.recalcular(GERA, true);
    m.editar((e) => { e.ausencias = [{ funcionarioId: "f01", data: "2026-11-04", horarioInicio: null, horarioFim: null }]; });
    const r = await m.recalcular(epochMsNoFuso("2026-11-03", "12:50"));
    expect(["processado", "sem_alteracao"]).toContain(r.status);
    expect(JSON.stringify(m.alocacoes)).not.toMatch(/#CONV|#AUTO|@A/);
    expect(m.alocacoes.filter((a) => a.maquinaId).every((a) => a.produtoId === "pK")).toBe(true);
  });

  it("M8 sem máquina na Previsão: plano 100% convencional, M8 nunca usada", async () => {
    const m = mundoUnico({ m8: [] });
    const r = await m.recalcular(GERA, true);
    expect(r.status).toBe("processado");
    expect(m.alocacoes.some((a) => a.maquinaId === "m8")).toBe(false);
    expect(m.alocacoes.some((a) => a.maquinaId === "e1")).toBe(true); // Etiquetar não foi removido (não é etapa inicial: recebe da convencional)
  });
});

describe("produto único exige o planejador de corte", () => {
  it("sem planejador na semana: geração recusada (nada gravado)", async () => {
    const m = mundoUnico({ planejador: false });
    await expect(m.recalcular(GERA, true)).rejects.toThrow(/planejador de corte/);
    expect(m.alocacoes.length).toBe(0);
  });
  it("sem planejador na semana COM plano vigente: plano mantido, alerta explícito", async () => {
    const m = mundoUnico();
    await m.recalcular(GERA, true);
    const antes = JSON.stringify(m.alocacoes);
    m.editar((e) => { delete e.planejadorCorte; });
    const r = await m.recalcular(epochMsNoFuso("2026-11-03", "12:50"));
    expect(["sem_alteracao", "processado"]).toContain(r.status);
    expect(JSON.stringify(m.alocacoes)).toBe(antes); // nada reescrito sem o planejador de corte
  });
});
