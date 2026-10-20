// Lógica PURA do modo TV: qual é o período AGORA e qual é o PRÓXIMO, e
// quantos minutos faltam para a troca. A TV só mostra — nunca recalcula
// escala. O relógio vem do servidor (offset) para não depender da hora do
// aparelho.

import { epochMsNoFuso } from "./tempo";
import type { PeriodoEscala } from "./types";

export interface PeriodoTv extends PeriodoEscala {
  inicioMs: number;
  fimMs: number;
}

export interface SituacaoTv {
  atual: PeriodoTv | null;
  proximo: PeriodoTv | null;
  minutosParaTroca: number | null; // até o fim do período atual (ou até o início do próximo se não há atual)
  destacarProximo: boolean;
  encerrado: boolean; // não há mais períodos hoje
  antesDoInicio: boolean; // ainda não começou nenhum período do dia (não é intervalo)
}

export const MINUTOS_DESTAQUE_PROXIMO = 5; // constante de UI: quanto antes o próximo período ganha destaque

export function periodosDoDia(data: string, periodos: PeriodoEscala[]): PeriodoTv[] {
  return [...periodos]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => ({ ...p, inicioMs: epochMsNoFuso(data, p.inicio), fimMs: epochMsNoFuso(data, p.fim) }))
    .filter((p) => p.fimMs > p.inicioMs);
}

export function situacaoTv(data: string, periodos: PeriodoEscala[], agoraMs: number, minutosDestaque = MINUTOS_DESTAQUE_PROXIMO): SituacaoTv {
  const lista = periodosDoDia(data, periodos);
  const atual = lista.find((p) => agoraMs >= p.inicioMs && agoraMs < p.fimMs) ?? null;
  const proximo = lista.find((p) => p.inicioMs > agoraMs) ?? null;
  const alvoMs = atual ? atual.fimMs : proximo ? proximo.inicioMs : null;
  const minutosParaTroca = alvoMs === null ? null : Math.max(0, Math.ceil((alvoMs - agoraMs) / 60000));
  return {
    atual,
    proximo,
    minutosParaTroca,
    destacarProximo: !!proximo && !!atual && (atual.fimMs - agoraMs) <= minutosDestaque * 60000,
    encerrado: !atual && !proximo,
    antesDoInicio: !atual && !!proximo && proximo.id === lista[0]?.id,
  };
}

export interface LinhaTv {
  periodo_id: string;
  funcionario_id: string;
  funcionario: string;
  maquina: string | null;
  produto: string | null;
  operacao: string | null;
  motivo_sem_posto: string | null;
  excecao: boolean;
}

export function linhasDoPeriodo(alocacoes: LinhaTv[], periodoId: string | null | undefined): LinhaTv[] {
  if (!periodoId) return [];
  return alocacoes.filter((a) => a.periodo_id === periodoId).sort((a, b) => a.funcionario.localeCompare(b.funcionario, "pt-BR"));
}

// offset = (relógio do servidor) − (relógio do aparelho) no instante da leitura
export function calcularOffset(agoraServidorIso: string, agoraLocalMs: number): number {
  const s = Date.parse(agoraServidorIso);
  return Number.isNaN(s) ? 0 : s - agoraLocalMs;
}
