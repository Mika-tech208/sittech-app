/* eslint-disable @typescript-eslint/no-explicit-any */
// Infra comum dos replays do FORECAST DE BUFFER (SOMENTE LEITURA: os dados vêm do cache de SELECTs em PROD; nada é gravado em PROD).
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { buscar, carregar, CACHE, RODAPROD, type DadosCarregados } from "./carga";
import { slotsDa } from "./estado";
import { desempacotarLinha } from "@/features/escala/snapshotSombra";
import { prepararFluxo, type CtxFluxo } from "@/features/escala/fluxo/estado";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import type { ContagemFisicaPar, DadosProducaoReal, OpcoesFluxo } from "@/features/escala/fluxo";
import type { AlocacaoEscala, EntradaEscala, SlotEscala } from "@/features/escala/types";
import { montarCenario } from "../escala-fluxo-replay/montar";
import type { OpcoesForecastPlano } from "@/features/escala/fluxo/forecastBufferPlano";

export const SEMANA = "2026-10-26";

// Contagens físicas pós-M3 de 30/10 (já em PROD desde 12:29; o cache de q_par é anterior): Rosquear→Parafusar 6.000; Parafusar→Etiquetar 6.000; Etiquetar→Embalar 3.600; Caixa Amarela 2.300.
export const NOVAS_RAW = [
  { produtoId: "27c229d7-f192-41eb-aad1-0c69ece53eba", etapaOrigemId: "34371af3-2608-42cc-9ded-1f7815a635a8", etapaSeguinteId: "b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4", saldo: 3600 },
  { produtoId: "27c229d7-f192-41eb-aad1-0c69ece53eba", etapaOrigemId: "78aaa207-b8cc-412a-8a8b-d17bd95a1930", etapaSeguinteId: "34371af3-2608-42cc-9ded-1f7815a635a8", saldo: 6000 },
  { produtoId: "27c229d7-f192-41eb-aad1-0c69ece53eba", etapaOrigemId: "ca90456c-9077-40f4-a058-bd0f467e87ec", etapaSeguinteId: "78aaa207-b8cc-412a-8a8b-d17bd95a1930", saldo: 6000 },
  { produtoId: "238ca607-2111-4aff-9a19-a9ae6f20da7e", etapaOrigemId: "c765eb93-4597-405f-803a-91c7fab9ad8e", etapaSeguinteId: "f75cc037-a579-4e82-b457-3287dbb6f694", saldo: 2300 },
];
export const CONTADO_EM = "2026-10-30T12:00:00-03:00";
export const NOVAS: ContagemFisicaPar[] = NOVAS_RAW.map((c) => ({ ...c, contadoEmMs: Date.parse(CONTADO_EM), informadoPor: "Mikael" }));

export interface Ambiente {
  d: DadosCarregados;
  slots: SlotEscala[];
  ix: (a: { data: string; periodoId: string }) => number;
  nome: (id: string | null | undefined) => string;
  hist: ApontamentoReal[];
}

export function abrir(): Ambiente {
  const d = carregar(buscar({ semana: SEMANA, antesIso: new Date().toISOString(), depoisIso: "2999-01-01T00:00:00Z", usarCache: true }));
  const slots = slotsDa(d);
  const idxDe = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const t = fs.readFileSync(path.join(CACHE, "hist.sql.out"), "utf8");
  const rows = JSON.parse(t.slice(t.indexOf("{"))).rows as any[];
  const hist: ApontamentoReal[] = rows.map((a) => ({
    data: a.data, periodoId: a.periodo_id, funcionarioId: a.funcionario_id, maquinaId: a.maquina_id, produtoId: a.produto_id, etapaId: a.etapa_id, operacaoId: a.operacao_id,
    boas: Number(a.quantidade_produzida) - Number(a.quantidade_refugo), refugo: Number(a.quantidade_refugo), meta: Number(a.meta), status: a.status === "produzindo" ? "produzindo" : "sem_producao",
    motivo: a.motivo, lancadoEmMs: Math.round(Number(a.lancado_ms)),
  }));
  return { d, slots, ix: (a) => idxDe.get(`${a.data}|${a.periodoId}`) ?? -1, nome: (id) => (id ? (d.nomes[id] ?? id.slice(0, 8)).trim() : "-"), hist };
}

export function versaoEm(agoraIso: string): AlocacaoEscala[] {
  const arq = path.join(CACHE, `ver_${agoraIso.replace(/[^0-9]/g, "")}.sql`);
  if (!fs.existsSync(arq + ".out")) {
    const sql = fs.readFileSync(path.join(__dirname, "sql/q_ver.sql"), "utf8").replaceAll("__SEMANA__", SEMANA).replaceAll("__ANTES_ISO__", agoraIso);
    fs.writeFileSync(arq, sql);
    for (let t = 0; t < 4; t++) { try { fs.rmSync(arq + ".out", { force: true }); execFileSync("bash", [RODAPROD, arq], { stdio: "ignore", timeout: 170000 }); } catch { /* repete */ } if (fs.existsSync(arq + ".out") && fs.readFileSync(arq + ".out", "utf8").includes('"rows"')) break; }
  }
  const t = fs.readFileSync(arq + ".out", "utf8");
  const rows = JSON.parse(t.slice(t.indexOf("{"))).rows;
  if (!rows[0]) throw new Error("sem versão do plano antes de " + agoraIso);
  return (rows[0].linhas as any[]).map(desempacotarLinha);
}

export interface EstadoReplay {
  agoraMs: number;
  ap: number;
  plano: AlocacaoEscala[];
  aps: ApontamentoReal[];
  ent: EntradaEscala;
  dados: DadosProducaoReal;
  opcoes: OpcoesFluxo;
  ctx: CtxFluxo;
}

/** Estado do motor "de hoje" (bloco + ponte M3→T1 + regra conservadora de material) no instante `agoraMs`, sobre o plano vigente `plano`. */
export function estadoEm(a: Ambiente, agoraMs: number, plano: AlocacaoEscala[], op: { mesmoPeriodo?: boolean; ponte?: boolean; aps?: ApontamentoReal[]; apOverride?: number } = {}): EstadoReplay {
  const { d, slots, ix } = a;
  const ap = op.apOverride ?? (slots.find((s) => s.inicioMs > agoraMs)?.indice ?? slots.length);
  const aps = op.aps ?? d.apontamentos.filter((x) => x.lancadoEmMs <= agoraMs);
  const dec = { ...d.decisao, corteMs: agoraMs };
  const cen = montarCenario(dec, aps, { offset: ap - dec.entrada.c, planoVigente: plano, paresLegado: d.cfg.paresLegado, apontamentos: aps });
  const contagens = [...d.cfg.contagensFisicas, ...NOVAS].filter((c) => c.contadoEmMs <= agoraMs);
  const dados: DadosProducaoReal = { apontamentos: aps, agoraMs, fechamentoMinutos: 10, planoVigente: plano, ...(contagens.length > 0 ? { contagensFisicas: contagens } : {}) };
  const opcoes: OpcoesFluxo = { ...cen.opcoes, ...(d.cfg.limiar !== null ? { limiarEstabilidadePecas: d.cfg.limiar } : {}), fluxoMesmoPeriodo: op.mesmoPeriodo === true };
  const ent: EntradaEscala = { ...cen.entrada, aPartirDe: ap, congeladas: plano.filter((x) => ix(x) < ap), revezamentoDuro: true, revezamentoEscopo: "bloco", ...(op.ponte === false ? {} : { revezamentoPonteM3T1: true }) };
  delete (ent as any).exposicaoExecutada;
  return { agoraMs, ap, plano, aps, ent, dados, opcoes, ctx: prepararFluxo(ent, dados, opcoes) };
}

export const receita = (ent: EntradaEscala, av: any) => {
  const val = new Map<string, number>();
  ent.pools.forEach((p) => val.set(p.produtoId, Math.max(val.get(p.produtoId) ?? 0, p.valorUnitario)));
  return Math.round(av.produtos.reduce((s: number, p: any) => s + p.finalEntregue.lo * (val.get(p.produtoId) ?? 0), 0));
};

/**
 * TIPO_TRANSFERENCIA por ligação, confirmado pelo usuário no chão de fábrica (30/10): Etiquetar→Embalar = CONTÍNUO no mesmo período; Parafusar→Etiquetar = LOTE (Tn entra no WIP disponível só em Tn+1);
 * Rosquear→Parafusar e Máquina 8 (Rosquear+Parafusar)→Etiquetar = DESCONHECIDO (os dois cenários são calculados). Qualquer outra ligação (Caixa Amarela, 1.1/4", Pino...) = DESCONHECIDO.
 * É DADO de entrada do forecast (por aresta), não flag global.
 */
export function modoLigacaoConector(nome: (id: string | null | undefined) => string): NonNullable<OpcoesForecastPlano["modoLigacao"]> {
  return (a) => {
    const o = nome(a.etapaOrigemId), d = nome(a.etapaSeguinteId);
    if (o === "Etiquetar" && d === "Embalar") return { modo: "continuo" };
    if (o === "Parafusar" && d === "Etiquetar") return { modo: "lote", atrasoPeriodos: 1 };
    return { modo: "desconhecido" };
  };
}
