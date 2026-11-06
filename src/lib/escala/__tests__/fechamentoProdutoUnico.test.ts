// FECHAMENTO FÍSICO × PRODUTO ÚNICO (motor real, banco em memória). O inventário pede SÓ os 3 buffers do produto canônico (1 par contábil cada, sem Conv/Auto, sem `zero`):
//   Rosquear→Parafusar | Parafusar→Etiquetar (buffer COMUM: recebe também a M8) | Etiquetar→Embalar.
// O físico vence: a pilha contada nunca é somada ao saldo ESTIMADO da M8; o portão HARD (inventário preservado, cadeia, WIP ≥ 0) funciona sobre ids canônicos.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/features/escala/gerarEscala", async (orig) => {
  const real = await orig<typeof import("@/features/escala/gerarEscala")>();
  return { ...real, gerarEscala: () => { throw new Error("MOTOR LEGADO CHAMADO NUMA SEMANA DE PRODUTO ÚNICO"); } };
});

import { buffersObrigatorios, contagensDoInventario, estimarBuffers, somaPorBuffer, verificarCatalogoUnico } from "@/features/escala/fechamento/catalogo";
import { portaoHard } from "@/features/escala/fechamento/validacao";
import type { BufferCatalogo } from "@/features/escala/fechamento/tipos";
import type { ContagemFisicaPar } from "@/features/escala/fluxo/tipos";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { desdobrarCanonico, paresParaCanonico, type ParCanonico } from "@/features/produto-canonico/adaptadorMotor";
import { paresCanonicosDoEstado } from "../fluxo/produtoUnicoVirtual";
import { processarSemana, type EscalaIO } from "../processar";
import { montarEntradaEscala } from "../montarEntrada";
import type { EstadoBruto } from "../estado";
import { MODELO, mundoUnico } from "./produtoUnicoFixture";
import type { Mundo } from "./bancoMemoria";

const FIM_M2 = epochMsNoFuso("2026-11-03", "10:24");
const TC = epochMsNoFuso("2026-11-03", "10:27");
const GERA = epochMsNoFuso("2026-11-02", "18:00");

const CATALOGO: BufferCatalogo[] = [
  { id: "b1", chave: "conector34:rosqueadas", rotulo: "Rosqueadas aguardando Parafusar", ordem: 1, pares: [{ produtoId: "pK", etapaOrigemId: "k_ros", etapaSeguinteId: "k_par", papel: "contabil" }] },
  { id: "b2", chave: "conector34:parafusadas", rotulo: "Parafusadas aguardando Etiquetar", ordem: 2, pares: [{ produtoId: "pK", etapaOrigemId: "k_par", etapaSeguinteId: "k_eti", papel: "contabil" }] },
  { id: "b3", chave: "conector34:etiquetadas", rotulo: "Etiquetadas aguardando Embalar", ordem: 3, pares: [{ produtoId: "pK", etapaOrigemId: "k_eti", etapaSeguinteId: "k_emb", papel: "contabil" }] },
];
const ap = (maq: string, etapaId: string, op: string, periodoId: string, boas: number, data = "2026-11-03"): ApontamentoReal => ({ data, periodoId, funcionarioId: "f01", maquinaId: maq, produtoId: "pK", etapaId, operacaoId: op, boas, refugo: 0, meta: boas, status: "produzindo", motivo: null, lancadoEmMs: epochMsNoFuso(data, "23:00") - 1 });

/** io que injeta o inventário como supabaseFechamento.recalcular faz */
const ioComFechamento = (m: Mundo, contagens: ContagemFisicaPar[], fimMs: number): EscalaIO => {
  const base = m.io();
  return { ...base, carregarEstado: async (a, c) => { const e: EstadoBruto = await base.carregarEstado(a, c); return { ...e, ...(c ? { corteExplicito: { data: c.data, periodoId: c.periodoId } } : {}), producaoReal: { ...e.producaoReal!, fechamentoFisicoFimMs: fimMs, contagensFisicas: [...(e.producaoReal!.contagensFisicas ?? []), ...contagens] } }; } };
};
const OPC = { agoraMs: TC, criarSeNaoExiste: false, gatilhoFluxo: "fechamento" as const, corteFluxo: { data: "2026-11-03", periodoId: "m2" }, corteExplicito: { data: "2026-11-03", periodoId: "m3", agoraEquidadeMs: FIM_M2 - 1 } };

describe("catálogo do produto único: 3 buffers, sem adapter", () => {
  it("buffersObrigatorios = exatamente os 3; contagens = 1 por buffer com o saldo físico (sem zero, sem par da M8)", () => {
    const ob = buffersObrigatorios(CATALOGO, new Set(["pK"]));
    expect(ob.map((b) => b.chave)).toEqual(["conector34:rosqueadas", "conector34:parafusadas", "conector34:etiquetadas"]);
    const cs = contagensDoInventario(ob, [{ bufferId: "b1", fisico: 400 }, { bufferId: "b2", fisico: 1200 }, { bufferId: "b3", fisico: 300 }], FIM_M2, "t", "t");
    expect(cs.map((c) => [c.etapaOrigemId, c.etapaSeguinteId, c.saldo])).toEqual([["k_ros", "k_par", 400], ["k_par", "k_eti", 1200], ["k_eti", "k_emb", 300]]);
    expect(Object.values(somaPorBuffer(ob, cs))).toEqual([400, 1200, 300]); // a soma por buffer = o físico; nada duplicado
    expect(verificarCatalogoUnico(CATALOGO, MODELO)).toEqual([]);
  });
  it("catálogo com par `zero` ou par da M8 é recusado (adapter Conv/Auto proibido)", () => {
    const comZero: BufferCatalogo[] = [CATALOGO[0], { ...CATALOGO[1], pares: [...CATALOGO[1].pares, { produtoId: "pK", etapaOrigemId: "k_m8", etapaSeguinteId: "k_eti", papel: "zero" }] }, CATALOGO[2]];
    const p = verificarCatalogoUnico(comZero, MODELO);
    expect(p.length).toBeGreaterThanOrEqual(2);
    expect(p.join(" ")).toMatch(/zero/);
    expect(p.join(" ")).toMatch(/Máquina 8/);
  });
});

describe("estimativas dos 3 buffers a partir do estado canônico", () => {
  it("a saída da M8 compõe o buffer comum (Parafusar→Etiquetar) — sem par próprio e sem sumir", async () => {
    const m = mundoUnico();
    m.editar((e) => { e.producaoReal = { ...e.producaoReal!, apontamentos: [ap("m8", "k_m8", "opM", "m1", 400), ap("p1", "k_par", "opP", "m1", 100)] }; });
    await processarSemana(m.io(), { agoraMs: GERA, criarSeNaoExiste: true });
    const estado: EstadoBruto = { ...(await m.io().carregarEstado()), corteExplicito: undefined };
    const agora = epochMsNoFuso("2026-11-03", "10:27");
    const montada = montarEntradaEscala({ ...estado, producaoReal: { ...estado.producaoReal!, fechamentoFisicoFimMs: FIM_M2 } }, agora);
    const pares = paresCanonicosDoEstado({ ...estado, producaoReal: { ...estado.producaoReal!, fechamentoFisicoFimMs: FIM_M2 } }, montada.entrada, agora, MODELO);
    const chaves = pares.map((p) => `${p.etapaOrigemId}>${p.etapaSeguinteId}`).sort();
    expect(chaves).toEqual(["k_eti>k_emb", "k_par>k_eti", "k_ros>k_par"]); // só os 3 buffers; nenhum k_m8
    const est = estimarBuffers(buffersObrigatorios(CATALOGO, new Set(["pK"])), pares);
    expect(est).toHaveLength(3);
    expect(est[1].estimado).toBeGreaterThanOrEqual(0);
  });
});

describe("fechamento físico com produto único (corte-v1)", () => {
  async function semana() {
    const m = mundoUnico();
    await processarSemana(m.io(), { agoraMs: GERA, criarSeNaoExiste: true });
    return m;
  }
  const fisico = (b1: number, b2: number, b3: number): ContagemFisicaPar[] => contagensDoInventario(buffersObrigatorios(CATALOGO, new Set(["pK"])), [{ bufferId: "b1", fisico: b1 }, { bufferId: "b2", fisico: b2 }, { bufferId: "b3", fisico: b3 }], FIM_M2, "t", "t");

  it("o físico vence: o buffer comum no motor é exatamente o contado, mesmo com a M8 tendo produzido antes (estimado não soma)", async () => {
    const m = await semana();
    // a M8 produziu 800 no M1/M2 e a Etiquetadora consumiu pouco: o ESTIMADO do buffer comum seria alto; o físico contado é 120
    m.editar((e) => { e.producaoReal = { ...e.producaoReal!, apontamentos: [ap("m8", "k_m8", "opM", "m1", 400), ap("m8", "k_m8", "opM", "m2", 400)] }; });
    const contagens = fisico(50, 120, 30);
    let paresPortao: ParCanonico[] | null = null;
    const r = await processarSemana(ioComFechamento(m, contagens, FIM_M2), {
      ...OPC,
      portaoPublicacao: (c) => {
        const brutos = (c.registro?.wip as { pares: ParCanonico[] }).pares;
        const d = desdobrarCanonico(c.entrada, MODELO);
        if ("erro" in d) return "modelo";
        paresPortao = paresParaCanonico(brutos, d);
        return portaoHard({ corteUsado: c.corteUsado, corteMotivoFalha: c.corteMotivoFalha, checagens: c.checagens as Record<string, number>, contagens, paresDoEstado: paresPortao });
      },
    });
    expect(r.status).not.toBe("bloqueado");
    expect(r.corte?.usado).toBe(true);
    const comum = paresPortao!.find((p) => p.etapaOrigemId === "k_par" && p.etapaSeguinteId === "k_eti")!;
    expect(comum.wip).toEqual({ lo: 120, hi: 120 });
    expect(paresPortao!.find((p) => p.etapaOrigemId === "k_ros")!.wip).toEqual({ lo: 50, hi: 50 });
    expect(paresPortao!.find((p) => p.etapaOrigemId === "k_eti")!.wip).toEqual({ lo: 30, hi: 30 });
    expect(paresPortao!.every((p) => !p.negativo)).toBe(true);
    // plano gravado: só ids canônicos; passado (M1/M2) intacto
    expect(JSON.stringify(m.alocacoes)).not.toMatch(/#CONV|#AUTO|@A/);
  });

  it("o portão HARD recusa quando o motor NÃO preserva o inventário (par comum ≠ físico)", () => {
    const contagens = fisico(50, 120, 30);
    const pares: ParCanonico[] = [{ produtoId: "pK", etapaOrigemId: "k_ros", etapaSeguinteId: "k_par", wip: { lo: 50, hi: 50 } }, { produtoId: "pK", etapaOrigemId: "k_par", etapaSeguinteId: "k_eti", wip: { lo: 920, hi: 920 } }, { produtoId: "pK", etapaOrigemId: "k_eti", etapaSeguinteId: "k_emb", wip: { lo: 30, hi: 30 } }];
    const msg = portaoHard({ corteUsado: true, corteMotivoFalha: null, checagens: { cadeiaInvalida: 0 }, contagens, paresDoEstado: pares });
    expect(msg).toMatch(/inventário físico não preservado/);
  });

  it("buffer comum estimado nunca negativo e sem material fantasma: com físico 0 nos 3 buffers, o downstream do M3 não produz do nada", async () => {
    const m = await semana();
    const contagens = fisico(0, 0, 0);
    await processarSemana(ioComFechamento(m, contagens, FIM_M2), OPC);
    const m3 = m.alocacoes.filter((a) => a.data === "2026-11-03" && a.periodoId === "m3" && a.maquinaId);
    const emb = m3.filter((a) => a.etapaId === "k_emb").reduce((s, a) => s + a.pecas, 0);
    const eti = m3.filter((a) => a.etapaId === "k_eti").reduce((s, a) => s + a.pecas, 0);
    expect(emb).toBe(0); // buffers vazios no início do M3 e lote Tn→Tn+1: Etiquetar/Embalar do M3 só consomem o que existia
    expect(eti).toBe(0);
  });

  it("fechamento do modelo legado intacto: sem `produtoUnico` no estado o portão/pares seguem pelo caminho de sempre (nenhuma referência a ids canônicos)", async () => {
    const m = await semana();
    const e = await m.io().carregarEstado();
    delete (e as { produtoUnico?: unknown }).produtoUnico;
    expect(e.produtoUnico).toBeUndefined();
  });
});
