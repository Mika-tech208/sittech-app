// Construtores de cenário para os testes do fluxo (não é um arquivo de teste).
import { gerarEscala } from "../../gerarEscala";
import type { ApontamentoReal } from "../../producaoReal";
import { primeiroSlotFuturo } from "../../tempo";
import type { AlocacaoEscala, EntradaEscala, PoolEscala } from "../../types";
import { entrada as entradaBase, equipe, pool } from "../../__tests__/helpers";
import { planejarComFluxo } from "../planejar";
import { verificarRestricoesDuras } from "../restricoes";
import type { DadosProducaoReal, OpcoesFluxo, ResultadoFluxo, SaldoWipConfirmadoPar } from "../tipos";

export { equipe, pool };
export const MIN = 60_000;

export interface Cenario {
  pools: PoolEscala[];
  funcionarios: { id: string }[];
  dias?: string[];
  /** índice do último período cujo fim já passou há `aposFimMin` minutos (default 11 ⇒ fechado) */
  c: number;
  aposFimMin?: number;
  apontamentos?: ApontamentoReal[];
  wipConfirmado?: SaldoWipConfirmadoPar[];
  extra?: Partial<EntradaEscala>;
  opcoes?: OpcoesFluxo;
  /** substitui o plano vigente/congelado (linhas manuais) em vez do gerado pelo motor */
  plano?: (slots: EntradaEscala["slots"]) => AlocacaoEscala[];
}

export function ap(p: Partial<ApontamentoReal> & Pick<ApontamentoReal, "data" | "periodoId" | "maquinaId" | "produtoId" | "etapaId" | "boas">): ApontamentoReal {
  return { funcionarioId: null, operacaoId: null, refugo: 0, meta: 0, status: "produzindo", motivo: null, lancadoEmMs: 0, ...p };
}

/** Monta (entrada, dados) como a Escala oficial os veria no instante `c` + `aposFimMin`. */
export function montar(c: Cenario): { entrada: EntradaEscala; dados: DadosProducaoReal; planoCompleto: AlocacaoEscala[] } {
  const e0 = entradaBase({ pools: c.pools, funcionarios: c.funcionarios, revezamentoDuro: true, ...(c.extra ?? {}) }, c.dias ?? ["2026-10-26", "2026-10-27"]);
  const planoCompleto = c.plano ? c.plano(e0.slots) : gerarEscala({ ...e0, aPartirDe: 0, congeladas: [] }).alocacoes;
  const slot = e0.slots[c.c];
  const agoraMs = slot.fimMs + (c.aposFimMin ?? 11) * MIN;
  const aPartirDe = primeiroSlotFuturo(e0.slots, agoraMs);
  const idx = new Map(e0.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const congeladas = planoCompleto.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) as number) < aPartirDe);
  const entrada: EntradaEscala = { ...e0, aPartirDe, congeladas };
  const apontamentos = (c.apontamentos ?? []).map((a) => ({ ...a, lancadoEmMs: a.lancadoEmMs || (e0.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.fimMs ?? 0) + 2 * MIN }));
  return { entrada, dados: { apontamentos, agoraMs, planoVigente: planoCompleto, wipConfirmado: c.wipConfirmado }, planoCompleto };
}

/** apontamentos "como planejado" (boas = capacidade da linha) para os períodos 0..ate do plano. */
export function realComoPlano(plano: AlocacaoEscala[], pools: PoolEscala[], ate: number, slots: EntradaEscala["slots"], fator: Record<string, number> = {}): ApontamentoReal[] {
  const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  return plano
    .filter((a) => a.maquinaId && a.produtoId && a.etapaId && (idx.get(`${a.data}|${a.periodoId}`) as number) <= ate)
    .map((a) => {
      const p = pools.find((x) => x.produtoId === a.produtoId && x.etapaId === a.etapaId) as PoolEscala;
      const mu = p.metas[a.periodoId] * (fator[`${a.produtoId}|${a.etapaId}`] ?? 1);
      return ap({ data: a.data, periodoId: a.periodoId, maquinaId: a.maquinaId as string, produtoId: a.produtoId as string, etapaId: a.etapaId as string, funcionarioId: a.funcionarioId, operacaoId: a.operacaoId, boas: Math.min(a.pecas, mu) });
    });
}

/** Apontamentos para TODAS as linhas do plano até o período `ate`: `fn` devolve as boas (ou null ⇒ sem_producao/outro). Elimina incerteza de "não confirmado". */
export function apontarPlano(plano: AlocacaoEscala[], pools: PoolEscala[], ate: number, slots: EntradaEscala["slots"], fn: (a: AlocacaoEscala, capacidade: number) => number | null): ApontamentoReal[] {
  const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  return plano
    .filter((a) => a.maquinaId && a.produtoId && a.etapaId && (idx.get(`${a.data}|${a.periodoId}`) as number) <= ate)
    .map((a) => {
      const p = pools.find((x) => x.produtoId === a.produtoId && x.etapaId === a.etapaId) as PoolEscala;
      const cap = p.metas[a.periodoId];
      const boas = fn(a, cap);
      const base = { data: a.data, periodoId: a.periodoId, maquinaId: a.maquinaId as string, produtoId: a.produtoId as string, etapaId: a.etapaId as string, funcionarioId: a.funcionarioId, operacaoId: a.operacaoId };
      return boas === null ? ap({ ...base, boas: 0, status: "sem_producao", motivo: "outro" }) : ap({ ...base, boas });
    });
}

export function rodar(c: Cenario): { r: ResultadoFluxo; entrada: EntradaEscala; dados: DadosProducaoReal; planoCompleto: AlocacaoEscala[] } {
  const m = montar(c);
  const r = planejarComFluxo(m.entrada, m.dados, c.opcoes);
  return { r, ...m };
}

/** Invariantes que valem para QUALQUER saída do núcleo: nenhuma restrição dura violada; falta final nunca pior que a do plano base. */
export function checarFluxo(x: { r: ResultadoFluxo; entrada: EntradaEscala }): string[] {
  const erros: string[] = [];
  const v = verificarRestricoesDuras(x.r.entradaFluxo, x.r.resultado.alocacoes);
  if (v.length) erros.push(`${v.length} violação(ões) dura(s): ${v[0].tipo} ${v[0].detalhe}`);
  const d = x.r.diagnostico;
  if (d.depois.faltaPrevista.lo > d.depoisBase.faltaPrevista.lo + 1e-6) erros.push(`falta pior que a do base: ${d.depois.faltaPrevista.lo} > ${d.depoisBase.faltaPrevista.lo}`);
  // v2: também nunca pior que o plano VIGENTE quando ele é um candidato válido (mesmo simulador)
  if (d.depoisVigente && d.vigente.valido && d.depois.faltaPrevista.lo > d.depoisVigente.faltaPrevista.lo + 1e-6) erros.push(`falta pior que a do vigente válido: ${d.depois.faltaPrevista.lo} > ${d.depoisVigente.faltaPrevista.lo}`);
  if (d.violacoes.length) erros.push(`diagnóstico traz ${d.violacoes.length} violação(ões)`);
  return erros;
}

export function jsonSerializavel(v: unknown): boolean {
  const s = JSON.stringify(v);
  return typeof s === "string" && !s.includes("null,null") && JSON.parse(s) !== undefined;
}

/** Linha manual de plano: pessoa `f` na máquina `m` (pool produto/etapa/op) no slot `i`, com a capacidade `pecas`. */
export function linhaPlano(slots: EntradaEscala["slots"], i: number, f: string, m: string, produto: string, etapa: string, op: string, pecas: number): AlocacaoEscala {
  return { data: slots[i].data, periodoId: slots[i].periodoId, funcionarioId: f, maquinaId: m, produtoId: produto, etapaId: etapa, operacaoId: op, pecas, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null };
}
