// PONTE M3 → T1 + hotfix 29/10: a exposição individual vem da troca manual registrada / alocação congelada; o `funcionario_id` do APONTAMENTO (quem lançou) NUNCA vira exposição.
import { describe, it, expect } from "vitest";
import { repeticoesPorBloco } from "@/features/escala/exposicaoBloco";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { EntradaEscala } from "@/features/escala/types";
import type { EstadoProducaoReal } from "../estado";
import { nucleoFluxo, type NucleoFluxo } from "../fluxo/integracao";
import { montarEntradaEscala } from "../montarEntrada";
import { Mundo, estadoDeTeste } from "./bancoMemoria";

const SEMANA = "2026-11-02";
const DIAS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const TER = "2026-11-03";
const GERA = epochMsNoFuso(SEMANA, "05:00");
const AGORA = epochMsNoFuso(TER, "12:30"); // M3 encerrado, T1 ainda não começou => o recálculo começa em T1 (M3 = passado imediato)

const mundo = (apontamentos: ApontamentoReal[] = [], ponte = true) => {
  const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
  const pr: EstadoProducaoReal = { modoEfetivo: "ativo", limiar: null, paresLegado: [], apontamentos };
  m.editar((e) => {
    e.producaoReal = pr;
    e.parametros = { wipModo: "desligado", wipDiasLimite: 1, revezamentoModo: "duro", revezamentoEscopo: "bloco", ...(ponte ? { revezamentoPonteM3T1: true } : {}) };
  });
  return m;
};
function espiao() {
  const capt: EntradaEscala[] = [];
  const nucleo: NucleoFluxo = {
    planejarComFluxo(ent, dados, op) { capt.push(ent); return nucleoFluxo.planejarComFluxo(ent, dados, op); },
    avaliarPlano: (...a) => nucleoFluxo.avaliarPlano(...a),
    verificarRestricoesDuras: (...a) => nucleoFluxo.verificarRestricoesDuras(...a),
  };
  return { nucleo, capt };
}
const ap = (a: Partial<ApontamentoReal> & Pick<ApontamentoReal, "data" | "periodoId" | "funcionarioId" | "operacaoId">): ApontamentoReal => ({
  maquinaId: "m1", produtoId: "pA", etapaId: "eA1", boas: 10, refugo: 0, meta: 10, status: "produzindo", motivo: null, lancadoEmMs: AGORA - 60_000, ...a,
});

describe("ponte M3 → T1 no processarSemana", () => {
  it("a entrada do núcleo leva a flag só com duro+bloco+flag; sem apontamento-evidência; T1 não repete M3 (congelada) mesmo com apontamentos divergentes", async () => {
    const com = mundo();
    await com.recalcular(GERA, true);
    const m3 = com.alocacoes.filter((a) => a.data === TER && a.periodoId === "m3" && a.maquinaId && a.operacaoId);
    expect(m3.length).toBeGreaterThan(3);
    // lançadores "divergentes": cada pessoa de M3 lança a operação de OUTRA — se isso virasse exposição, o plano de T1 mudaria
    const aps = m3.map((a, i) => ap({ data: TER, periodoId: "m3", funcionarioId: a.funcionarioId, operacaoId: m3[(i + 1) % m3.length].operacaoId as string, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId }));
    // controle: MESMOS apontamentos (mesma produção) com o lançador coerente com a congelada
    const coer = m3.map((a) => ap({ data: TER, periodoId: "m3", funcionarioId: a.funcionarioId, operacaoId: a.operacaoId as string, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId }));
    const semAp = mundo(coer);
    semAp.alocacoes = com.alocacoes.map((x) => ({ ...x })); semAp.dias = new Map(com.dias);
    com.editar((e) => { e.producaoReal!.apontamentos = aps; });
    const e1 = espiao(), e2 = espiao();
    await semAp.recalcular(AGORA, false, { nucleoFluxo: e1.nucleo });
    await com.recalcular(AGORA, false, { nucleoFluxo: e2.nucleo });
    [...e1.capt, ...e2.capt].forEach((e) => { expect(e.revezamentoPonteM3T1).toBe(true); expect(e.revezamentoEscopo).toBe("bloco"); });
    e2.capt.forEach((e) => expect(e.exposicaoExecutada).toBeUndefined());
    const t1 = (m: Mundo) => m.alocacoes.filter((a) => a.data === TER && a.periodoId === "t1").map((a) => `${a.funcionarioId}:${a.maquinaId}:${a.operacaoId}`).sort();
    expect(t1(com)).toEqual(t1(semAp)); // quem lançou não mexe no plano (mesma produção, lançador diferente)
    // T1 respeita a exposição de M3 (alocação congelada)
    const opM3 = new Map(m3.map((a) => [a.funcionarioId, a.operacaoId]));
    com.alocacoes.filter((a) => a.data === TER && a.periodoId === "t1" && a.maquinaId).forEach((a) => expect(opM3.get(a.funcionarioId)).not.toBe(a.operacaoId));
    const slots = montarEntradaEscala(com.entradas, AGORA).entrada.slots;
    expect(repeticoesPorBloco(com.alocacoes.filter((x) => x.data === TER), slots, undefined, true)).toEqual([]);
  });
  it("troca manual registrada em M3 (origem 'manual') vira exposição para T1", async () => {
    const m = mundo();
    await m.recalcular(GERA, true);
    m.relogioMs = GERA;
    const m3 = m.alocacoes.filter((a) => a.data === TER && a.periodoId === "m3" && a.maquinaId && a.operacaoId);
    let trocou: string | null = null;
    for (const x of m3) for (const y of m3) { if (trocou || x.funcionarioId >= y.funcionarioId || x.operacaoId === y.operacaoId) continue; try { m.trocarManual(TER, "m3", x.funcionarioId, y.funcionarioId); trocou = x.funcionarioId; } catch { /* troca inválida: tenta outra */ } }
    expect(trocou).not.toBeNull();
    const a = m.alocacoes.find((x) => x.data === TER && x.periodoId === "m3" && x.funcionarioId === trocou)!;
    expect(a.origem).toBe("manual");
    await m.recalcular(AGORA, false);
    const t1a = m.alocacoes.find((x) => x.data === TER && x.periodoId === "t1" && x.funcionarioId === trocou);
    if (t1a?.maquinaId) expect(t1a.operacaoId).not.toBe(a.operacaoId); // a operação que a troca deu em M3 está exposta em T1
    expect(m.alocacoes.find((x) => x.data === TER && x.periodoId === "m3" && x.funcionarioId === trocou)!.origem).toBe("manual");
  });
  it("flag desligada: a entrada não leva a flag e o plano é o da regra de bloco atual", async () => {
    const off = mundo([], false);
    await off.recalcular(GERA, true);
    const e = espiao();
    await off.recalcular(AGORA, false, { nucleoFluxo: e.nucleo });
    e.capt.forEach((x) => expect(x.revezamentoPonteM3T1).toBeUndefined());
    expect(montarEntradaEscala(off.entradas, AGORA).entrada.revezamentoPonteM3T1).toBeUndefined();
  });
});
