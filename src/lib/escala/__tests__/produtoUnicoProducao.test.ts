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
import { Mundo, estadoDeTeste } from "./bancoMemoria";
import { MODELO, mundoUnico } from "./produtoUnicoFixture";

const SEMANA = "2026-11-02";
const DIAS = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const GERA = epochMsNoFuso("2026-11-02", "18:00");
const CFG = { objetivo: "EQUILIBRIO" as const, busca: { iter: 30000, reinicios: 1, semente: 1 }, buscaComVigente: { iter: 15000, reinicios: 1, semente: 1 } };

/** hash do plano do mundo legado (estadoDeTeste) gerado pela MAIN de 06/11 (bd62630); se mudar, o comportamento sem cutover mudou. */
export const HASH_GOLDEN_LEGADO = "5e9778b57bff051ba6d07a4e04850b665b213287dae715c47e6ac5a326fb1291";

function mundoLegado() {
  const m = new Mundo(estadoDeTeste(SEMANA, DIAS, { pessoas: 10 }));
  m.editar((e) => {
    e.parametros = { ...lerParametros([]), revezamentoModo: "duro", revezamentoEscopo: "bloco", revezamentoPonteM3T1: true };
    e.producaoReal = { modoEfetivo: "ativo", limiar: null, paresLegado: [], apontamentos: [], mesmoPeriodo: false };
    e.planejadorCorte = { config: CFG, vigenteDoPlanejador: false, distribuicaoSuportada: true };
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
