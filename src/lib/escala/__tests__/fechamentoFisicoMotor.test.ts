// FECHAMENTO FÍSICO × corte-v1 (motor real, banco em memória). Golden de 03/11 em miniatura: o estoque estimado estava MUITO acima do físico (7.122 × 4.800; M3 com 3.500 × 750);
// no fechamento, REAL + INVENTÁRIO FÍSICO substituem a projeção, o motor recalcula o PRÓXIMO período mesmo com o relógio já dentro dele, o passado não muda,
// o portão HARD recusa plano inválido (nada é gravado) e o inventário físico é preservado byte a byte.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/features/escala/gerarEscala", async (orig) => {
  const real = await orig<typeof import("@/features/escala/gerarEscala")>();
  return { ...real, gerarEscala: () => { throw new Error("MOTOR LEGADO CHAMADO NUMA SEMANA ATIVADA NO PLANEJADOR DE CORTE"); } };
});

import { lerParametros } from "@/features/escala/parametros";
import { distribuicaoEfetiva } from "@/features/escala/distribuicao";
import type { ContagemFisicaPar } from "@/features/escala/fluxo/tipos";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { AlocacaoEscala } from "@/features/escala/types";
import { portaoHard } from "@/features/escala/fechamento/validacao";
import { processarSemana } from "../processar";
import type { EscalaIO } from "../processar";
import type { EstadoBruto } from "../estado";
import { Mundo, estadoDeTeste } from "./bancoMemoria";

const SEMANA = "2026-11-02";
const DIAS = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const CFG = { objetivo: "EQUILIBRIO" as const, busca: { iter: 30000, reinicios: 1, semente: 1 }, buscaComVigente: { iter: 15000, reinicios: 1, semente: 1 } };
const FIM_M2 = epochMsNoFuso("2026-11-03", "10:24");
const TC = epochMsNoFuso("2026-11-03", "10:27"); // confirmação: 3 min DENTRO do M3 pelo relógio (a troca atrasou o início real)

function mundo() {
  const m = new Mundo(estadoDeTeste(SEMANA, DIAS, { pessoas: 10 }));
  m.editar((e) => {
    e.parametros = { ...lerParametros([]), revezamentoModo: "duro", revezamentoEscopo: "bloco", revezamentoPonteM3T1: true };
    e.producaoReal = { modoEfetivo: "ativo", limiar: null, paresLegado: [], apontamentos: [], mesmoPeriodo: false };
    e.planejadorCorte = { config: CFG, vigenteDoPlanejador: false, distribuicaoSuportada: true };
  });
  return m;
}
const par = (saldo: number, emMs: number, etapaO = "eA1", etapaS = "eA2", produtoId = "pA"): ContagemFisicaPar => ({ produtoId, etapaOrigemId: etapaO, etapaSeguinteId: etapaS, saldo, contadoEmMs: emMs, informadoPor: "t", observacao: "t" });
/** io que injeta o inventário do fechamento exatamente como supabaseFechamento.recalcular faz */
const ioComFechamento = (m: Mundo, contagens: ContagemFisicaPar[]): EscalaIO => {
  const base = m.io();
  return { ...base, carregarEstado: async (a, c) => { const e: EstadoBruto = await base.carregarEstado(a, c); return { ...e, ...(c ? { corteExplicito: { data: c.data, periodoId: c.periodoId } } : {}), producaoReal: { ...e.producaoReal!, fechamentoFisicoFimMs: FIM_M2, contagensFisicas: [...(e.producaoReal!.contagensFisicas ?? []), ...contagens] } }; } };
};
const producaoEtapa = (ls: AlocacaoEscala[], data: string, periodoId: string, etapaId: string) =>
  ls.filter((a) => a.data === data && a.periodoId === periodoId && a.maquinaId).flatMap((a) => distribuicaoEfetiva(a) ?? [{ produtoId: a.produtoId!, etapaId: a.etapaId!, pecas: a.pecas }]).filter((i) => i.etapaId === etapaId).reduce((s, i) => s + i.pecas, 0);

async function semanaGerada(contagensIniciais: ContagemFisicaPar[] = []) {
  const m = mundo();
  if (contagensIniciais.length) m.editar((e) => { e.producaoReal = { ...e.producaoReal!, contagensFisicas: contagensIniciais }; });
  await processarSemana(m.io(), { agoraMs: epochMsNoFuso("2026-11-02", "18:00"), criarSeNaoExiste: true });
  return m;
}

describe("fechamento físico × corte-v1", () => {
  it("recalcula o PRÓXIMO período (M3) com o relógio já dentro dele; M1/M2 (passado) ficam intactos", async () => {
    const m = await semanaGerada([par(3000, epochMsNoFuso("2026-11-03", "07:00"))]);
    const antes = m.alocacoes.map((a) => ({ ...a }));
    const fisico = [par(30, FIM_M2)];
    const r = await processarSemana(ioComFechamento(m, fisico), {
      agoraMs: TC, criarSeNaoExiste: false, gatilhoFluxo: "fechamento", corteFluxo: { data: "2026-11-03", periodoId: "m2" },
      corteExplicito: { data: "2026-11-03", periodoId: "m3", agoraEquidadeMs: epochMsNoFuso("2026-11-03", "10:24") - 1 },
    });
    expect(["processado", "sem_alteracao"]).toContain(r.status);
    const passado = (ls: AlocacaoEscala[]) => JSON.stringify(ls.filter((a) => a.data === "2026-11-03" && (a.periodoId === "m1" || a.periodoId === "m2")).sort((x, y) => (x.periodoId + x.funcionarioId < y.periodoId + y.funcionarioId ? -1 : 1)));
    expect(passado(m.alocacoes)).toBe(passado(antes)); // passado intacto
    expect(r.corte?.usado).toBe(true);
    const m3 = (ls: AlocacaoEscala[]) => JSON.stringify(ls.filter((a) => a.data === "2026-11-03" && a.periodoId === "m3").map((a) => [a.funcionarioId, a.maquinaId, a.pecas]).sort());
    expect(m3(m.alocacoes)).not.toBe(m3(antes)); // o M3 FOI recalculado (o relógio já o considerava iniciado)
  });

  it("o motor parte do INVENTÁRIO FÍSICO (lo=hi=físico) e não da projeção; o consumo do M3 respeita o físico (lote)", async () => {
    const m = await semanaGerada([par(3000, epochMsNoFuso("2026-11-03", "07:00"))]);
    const fisico = [par(30, FIM_M2)];
    const m3Antes = producaoEtapa(m.alocacoes, "2026-11-03", "m3", "eA2");
    expect(m3Antes).toBeGreaterThan(30); // sem o físico o plano programava bem mais que o estoque real (a distorção de 03/11 em miniatura: plano muito acima do físico)
    await processarSemana(ioComFechamento(m, fisico), {
      agoraMs: TC, criarSeNaoExiste: false, gatilhoFluxo: "fechamento", corteFluxo: { data: "2026-11-03", periodoId: "m2" },
      corteExplicito: { data: "2026-11-03", periodoId: "m3", agoraEquidadeMs: FIM_M2 - 1 },
    });
    const reg = m.registrosFluxo[m.registrosFluxo.length - 1];
    const p = (reg.wip as { pares: { produtoId: string; etapaOrigemId: string; wip: { lo: number; hi: number }; fonteConfirmacao?: string }[] }).pares.find((x) => x.produtoId === "pA" && x.etapaOrigemId === "eA1")!;
    expect(p.wip).toEqual({ lo: 30, hi: 30 });
    expect(p.fonteConfirmacao).toBe("contagem_fisica");
    expect(producaoEtapa(m.alocacoes, "2026-11-03", "m3", "eA2")).toBeLessThanOrEqual(30 + 1e-6); // M3 consome no máximo o físico (a produção de M3 só serve a T1)
  });

  it("portão HARD aprova o plano do motor com o inventário preservado", async () => {
    const m = await semanaGerada([par(3000, epochMsNoFuso("2026-11-03", "07:00"))]);
    const fisico = [par(30, FIM_M2)];
    const antes = m.aplicacoes;
    const r = await processarSemana(ioComFechamento(m, fisico), {
      agoraMs: TC, criarSeNaoExiste: false, gatilhoFluxo: "fechamento", corteFluxo: { data: "2026-11-03", periodoId: "m2" },
      corteExplicito: { data: "2026-11-03", periodoId: "m3", agoraEquidadeMs: FIM_M2 - 1 },
      portaoPublicacao: (c) => portaoHard({ corteUsado: c.corteUsado, corteMotivoFalha: c.corteMotivoFalha, checagens: c.checagens as Record<string, number>, contagens: fisico, paresDoEstado: (c.registro?.wip as { pares: never[] } | undefined)?.pares ?? null }),
    });
    expect(r.status).not.toBe("bloqueado");
    expect(m.aplicacoes).toBeGreaterThanOrEqual(antes);
  });

  it("portão que recusa ⇒ status bloqueado e NADA é gravado (nem plano mantido)", async () => {
    const m = await semanaGerada();
    const snapshot = JSON.stringify(m.alocacoes);
    const aplic = m.aplicacoes;
    const r = await processarSemana(ioComFechamento(m, [par(30, FIM_M2)]), {
      agoraMs: TC, criarSeNaoExiste: false, gatilhoFluxo: "fechamento", corteFluxo: { data: "2026-11-03", periodoId: "m2" },
      corteExplicito: { data: "2026-11-03", periodoId: "m3", agoraEquidadeMs: FIM_M2 - 1 },
      portaoPublicacao: () => "CADEIA_INVALIDA (1)",
    });
    expect(r.status).toBe("bloqueado");
    expect(r.motivoIgnorado).toMatch(/CADEIA_INVALIDA/);
    expect(JSON.stringify(m.alocacoes)).toBe(snapshot);
    expect(m.aplicacoes).toBe(aplic);
  });

  it("sem o fechamento (relógio dentro do M3) o M3 é congelado e o recálculo começa em T1 — o corte explícito é o que muda isso", async () => {
    const m = await semanaGerada();
    const m3Antes = JSON.stringify(m.alocacoes.filter((a) => a.data === "2026-11-03" && a.periodoId === "m3"));
    await processarSemana(m.io(), { agoraMs: TC, criarSeNaoExiste: false });
    expect(JSON.stringify(m.alocacoes.filter((a) => a.data === "2026-11-03" && a.periodoId === "m3"))).toBe(m3Antes);
  });

  it("flag/campos ausentes ⇒ recálculo idêntico ao de antes (byte-idêntico)", async () => {
    const a = await semanaGerada();
    const b = await semanaGerada();
    await processarSemana(a.io(), { agoraMs: epochMsNoFuso("2026-11-03", "12:50"), criarSeNaoExiste: false });
    await processarSemana(b.io(), { agoraMs: epochMsNoFuso("2026-11-03", "12:50"), criarSeNaoExiste: false });
    expect(JSON.stringify(a.alocacoes)).toBe(JSON.stringify(b.alocacoes));
  });

  it("fechamentos consecutivos M1 → M2 → M3: cada um recalcula só o seguinte e o passado fechado nunca muda", async () => {
    const m = await semanaGerada([par(3000, epochMsNoFuso("2026-11-03", "07:00"))]);
    const fins = [["m1", "08:48", "m2"], ["m2", "10:24", "m3"], ["m3", "11:55", "t1"]] as const;
    const contagens: ContagemFisicaPar[] = [];
    const congelado: string[] = [];
    for (const [fechado, fim, proximo] of fins) {
      const fimMs = epochMsNoFuso("2026-11-03", fim);
      contagens.push(par(1000 - contagens.length * 100, fimMs));
      const base = m.io();
      const io: EscalaIO = { ...base, carregarEstado: async (a, c) => { const e = await base.carregarEstado(a, c); return { ...e, ...(c ? { corteExplicito: { data: c.data, periodoId: c.periodoId } } : {}), producaoReal: { ...e.producaoReal!, fechamentoFisicoFimMs: fimMs, contagensFisicas: [...contagens] } }; } };
      const r = await processarSemana(io, { agoraMs: fimMs + 3 * 60_000, criarSeNaoExiste: false, gatilhoFluxo: "fechamento", corteFluxo: { data: "2026-11-03", periodoId: fechado }, corteExplicito: { data: "2026-11-03", periodoId: proximo, agoraEquidadeMs: fimMs - 1 } });
      expect(["processado", "sem_alteracao"]).toContain(r.status);
      congelado.push(JSON.stringify(m.alocacoes.filter((a) => a.data === "2026-11-03" && a.periodoId === fechado).sort((x, y) => (x.funcionarioId < y.funcionarioId ? -1 : 1))));
    }
    // o plano de M1 gravado no 1º fechamento continua idêntico depois dos 3 fechamentos
    expect(JSON.stringify(m.alocacoes.filter((a) => a.data === "2026-11-03" && a.periodoId === "m1").sort((x, y) => (x.funcionarioId < y.funcionarioId ? -1 : 1)))).toBe(congelado[0]);
  });
});
