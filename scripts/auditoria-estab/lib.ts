/* eslint-disable @typescript-eslint/no-explicit-any */
// BIBLIOTECA DA AUDITORIA DE ESTABILIDADE (OFFLINE; nada é gravado). Reconstrói o MESMO problema do corte-v1 (planoCorte.montarProblemaCorte) e expõe o despacho/objetivo do motor
// para avaliar, comparar e reparar planos arbitrários (conjuntos de postos = máquina × período × operação).
import * as fs from "node:fs";
import { montarEstado as carregar } from "../ativacao-0211/carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { montarProblemaCorte } from "@/features/escala/fluxo/planoCorte";
import { buscaLocal, despachar, linhasComDetalhes, linhasParaOcc, occParaLinhas, prepararDespacho, restricoesOk, type ConfigDespacho, type LinhaPostoD, type ResultadoDespacho } from "@/features/escala/fluxo/postosDespacho";
import { planejarFuturo } from "@/features/escala/fluxo/planejadorFuturo";
import { lerConfigPlanejador } from "@/lib/escala/fluxo/parametrosFluxo";
import { lerDistribuicao } from "@/features/escala/distribuicao";
import type { ContagemFisicaPar, DadosProducaoReal } from "@/features/escala/fluxo/tipos";
import type { AlocacaoEscala } from "@/features/escala/types";

export const CONV = "27c229d7-f192-41eb-aad1-0c69ece53eba", AUTO = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee";
const PAF_ETIQ = ["78aaa207-b8cc-412a-8a8b-d17bd95a1930", "34371af3-2608-42cc-9ded-1f7815a635a8"];
export const D14 = "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/auditoria-1030/D14";

export function lerPlano(p: string): AlocacaoEscala[] {
  const t = fs.readFileSync(p, "utf8");
  return JSON.parse(t.slice(t.indexOf("{"))).rows.map((r: any) => ({ data: r.d, periodoId: r.p, funcionarioId: r.f, maquinaId: r.m || null, produtoId: r.pr || null, etapaId: r.e || null, operacaoId: r.o || null, pecas: Number(r.pc), pecasAdicional: Number(r.pa), motivoSemPosto: r.ms || null, excecaoRevezamento: !!r.exc, motivoExcecao: null, origem: r.orig || "auto", ...(lerDistribuicao(r.dist) ? { distribuicao: lerDistribuicao(r.dist) } : {}) }));
}

export interface Ctx {
  estado: any; entrada: any; m: ReturnType<typeof montarProblemaCorte>; e: any; cfg: ConfigDespacho; D: ReturnType<typeof prepararDespacho>; CONFIG: any;
  nome: (id: string | null) => string; nm: (id: string | null) => string; slotIdx: Map<string, number>; vigente: AlocacaoEscala[];
}

/** paf = saldo Parafusar→Etiquetar do Conv (a contagem D acrescentada às 20:20) */
export function montar(paf: number, vigentePath: string, opts: { agora?: string; semente?: number } = {}): Ctx {
  const { estado, raw } = carregar();
  estado.parametros = { ...estado.parametros!, revezamentoPonteM3T1: true } as any;
  const AGORA = Date.parse(opts.agora ?? "2026-11-02T21:40:00-03:00");
  const entrada = montarEntradaEscala(estado, AGORA).entrada;
  const cfgJson = JSON.parse(fs.readFileSync("scripts/ativacao-0211/config-planejador.json", "utf8"));
  const CONFIG = lerConfigPlanejador(cfgJson);
  const param = (k: string) => { const v = raw.q_params.find((x: any) => x.chave === k)?.valor; return typeof v === "string" ? JSON.parse(v) : v; };
  let contagens: ContagemFisicaPar[] = (param("producao_real_contagens_fisicas") ?? []).map((c: any) => ({ produtoId: c.produtoId, etapaOrigemId: c.etapaOrigemId, etapaSeguinteId: c.etapaSeguinteId, saldo: Number(c.saldo), contadoEmMs: Date.parse(c.contadoEm), informadoPor: c.informadoPor, observacao: c.observacao }));
  const ehD = (c: ContagemFisicaPar) => /contagem física D/i.test(c.informadoPor ?? "");
  contagens = contagens.filter((c) => !(ehD(c) && c.produtoId === CONV && c.etapaOrigemId === PAF_ETIQ[0] && c.etapaSeguinteId === PAF_ETIQ[1]));
  contagens.push({ produtoId: CONV, etapaOrigemId: PAF_ETIQ[0], etapaSeguinteId: PAF_ETIQ[1], saldo: paf, contadoEmMs: Date.parse("2026-11-02T20:20:00-03:00"), informadoPor: "Mikael (contagem física D)" });
  const vigente = lerPlano(vigentePath);
  const dados: DadosProducaoReal = { apontamentos: [], agoraMs: AGORA, fechamentoMinutos: 10, planoVigente: vigente, contagensFisicas: contagens };
  const cfgP = { ...CONFIG, partirDoVigente: true, ...(opts.semente ? { busca: { ...CONFIG.busca, semente: opts.semente }, buscaComVigente: { ...CONFIG.buscaComVigente, semente: opts.semente } } : {}) };
  const m = montarProblemaCorte(entrada, dados, { fluxoMesmoPeriodo: false }, cfgP as any, vigente);
  const e = m.entradaPlanejador;
  const cfg = configDespacho(e, e.equipe.length);
  const D = prepararDespacho(cfg);
  const slotIdx = new Map<string, number>(e.slots.map((s: any) => [`${s.data}|${s.periodoId}`, s.indice]));
  return { estado, entrada, m, e, cfg, D, CONFIG: cfgP, nome: (id) => (id ? (estado.nomesProdutos?.[id] ?? id).trim() : "—"), nm: (id) => (id ? (estado.nomesMaquinas?.[id] ?? id).trim().replace("Maquina Automatica", "M8") : "—"), slotIdx, vigente };
}

/** cópia FIEL de planejadorFuturo.planejarFuturo (cfgBase) para recomputar o objetivo do motor sobre qualquer conjunto de postos */
export function configDespacho(e: any, limiteOp: number): ConfigDespacho {
  const H = e.slots.length, t0 = e.aPartirDe;
  const finaisCongelados: Record<string, number> = Object.fromEntries(e.produtos.map((p: any) => [p.id, 0]));
  const prodsFuturo = e.produtos.map((p: any) => ({ ...p, wipInicial: e.wipNoInicioDeAPartirDe?.[p.id] ?? p.wipInicial }));
  const alvo = Object.fromEntries(e.produtos.map((p: any) => [p.id, Math.max(0, p.demandaFinal - finaisCongelados[p.id])]));
  const pessoas = e.slots.map((_: any, t: number) => e.equipe.length - (e.ausentes?.[t]?.length ?? 0));
  const margem = Object.fromEntries(e.produtos.map((p: any) => [p.id, e.objetivo === "MAX_PECAS_FINAIS" ? 1 : e.margemPorPeca?.[p.id] ?? p.valorUnitario ?? 1]));
  const cob = e.coberturaMinima ?? 0.45;
  const piso = e.objetivo === "MAX_PECAS_FINAIS" || e.objetivo === "MAX_RESULTADO_ECONOMICO" ? undefined : Object.fromEntries(e.produtos.map((p: any) => [p.id, Math.min(alvo[p.id], Math.max(0, (e.pisoPorProduto?.[p.id] ?? cob * p.demandaFinal) - finaisCongelados[p.id]))]));
  const blocos: number[][] = [];
  e.slots.forEach((s: any, i: number) => { const k = `${s.data}|${s.periodoId.startsWith("m") ? "m" : "t"}`; const u = blocos[blocos.length - 1]; if (u && `${e.slots[u[0]].data}|${e.slots[u[0]].periodoId.startsWith("m") ? "m" : "t"}` === k) u.push(i); else blocos.push([i]); });
  return { t0, produtos: prodsFuturo, recursos: e.recursos, pessoas, operacaoDe: e.operacaoDe, alvo, piso, margem, prioridade: e.prioridade ?? e.produtos.map((p: any) => p.id), blocos, penalPiso: 1, saidaTeto: Object.fromEntries(e.produtos.map((p: any) => [p.id, p.recorrentePorPeriodo ?? p.demandaFinal / H])), saidaPeso: 0.25, limiteOp };
}

export const postosDe = (c: Ctx, linhas: AlocacaoEscala[]): LinhaPostoD[] => linhas.filter((l) => l.maquinaId && l.operacaoId).map((l) => ({ t: c.slotIdx.get(`${l.data}|${l.periodoId}`) as number, recursoId: l.maquinaId as string, operacaoId: l.operacaoId as string }));
export const chave = (l: LinhaPostoD) => `${l.t}|${l.recursoId}|${l.operacaoId}`;

/** avaliação BRUTA do despacho (sem poda): objetivo, finais, produção/WIP, linhas ociosas (postos sem material/demanda) */
export function avaliar(c: Ctx, postos: LinhaPostoD[]): ResultadoDespacho {
  const occ = linhasParaOcc(c.cfg, c.D, postos);
  return despachar(c.cfg, c.D, occ, true);
}
/** visão DO MOTOR: poda + remoção de ociosas (exatamente o fim de buscaLocal com iter 0) ⇒ o plano que o motor entregaria para esses postos, sem mover nada */
export function visaoMotor(c: Ctx, postos: LinhaPostoD[]) {
  const r = buscaLocal(c.cfg, postos, { iter: 0, reinicios: 1, semente: 1 });
  return r;
}
export function semPostoPorSlot(c: Ctx, postos: LinhaPostoD[]): number[] {
  const n = new Array(c.cfg.pessoas.length).fill(0);
  postos.forEach((p) => n[p.t]++);
  return n.map((x, t) => Math.max(0, c.cfg.pessoas[t] - x));
}
export function valorFinais(c: Ctx, d: ResultadoDespacho): { total: number; porProd: Record<string, number>; margem: number } {
  const porProd: Record<string, number> = {};
  let total = 0, margem = 0;
  c.cfg.produtos.forEach((p) => { const f = d.finais[p.id] ?? 0; porProd[p.id] = f; total += f; margem += (c.cfg.margem[p.id] ?? 0) * f; });
  return { total, porProd, margem };
}
export function restricoesTodas(c: Ctx, postos: LinhaPostoD[]): boolean {
  const occ = linhasParaOcc(c.cfg, c.D, postos);
  for (let t = c.cfg.t0; t < c.D.H; t++) if (!restricoesOk(c.cfg, c.D, occ, t)) return false;
  return true;
}

/** plano completo do motor para um conjunto de postos (inclui pessoas, revezamento, validação) sem mover postos, mas COM a poda (iter 0) */
export function planoDoMotor(c: Ctx, postos: LinhaPostoD[]) {
  return planejarFuturo({ ...c.e, linhasIniciais: postos, busca: { iter: 0, reinicios: 1, semente: 1 } });
}

export { buscaLocal, despachar, linhasParaOcc, occParaLinhas, prepararDespacho, restricoesOk, linhasComDetalhes };
export type { LinhaPostoD, ResultadoDespacho, ConfigDespacho };
