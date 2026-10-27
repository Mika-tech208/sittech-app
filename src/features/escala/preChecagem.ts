// Revalidação da disponibilidade das máquinas poucos minutos ANTES de cada período — funções puras (fuso America/Sao_Paulo).
// A checagem em si é idempotente e só gera trabalho se algo mudou (ver lib/escala/revalidarDisponibilidade.ts); aqui só ficam
// os instantes: o ponto-alvo é início do período − 5 min (07:07, 08:43, 10:19, 12:55, 14:15, 15:35 com os períodos de hoje) e a
// janela em que a verificação completa é aceita vai de 6 min antes até 15 min depois do início (atraso de alguns minutos ainda
// vale; depois do início o período em andamento nunca é reescrito — o horizonte do motor já protege — e vale o próximo).

import { dataHoraNoFuso, epochMsNoFuso } from "./tempo";
import type { PeriodoEscala } from "./types";

export const ANTECEDENCIA_PRE_CHECAGEM_MIN = 5;
export const JANELA_ANTES_MIN = 6;
export const JANELA_DEPOIS_MIN = 15;
const MIN = 60_000;

function somarDiaIso(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function inicioDoPeriodoMs(data: string, p: Pick<PeriodoEscala, "inicio">): number {
  return epochMsNoFuso(data, p.inicio);
}

// true se `agoraMs` está na janela de verificação completa de algum período do dia (no fuso operacional).
export function dentroDaJanelaPreChecagem(agoraMs: number, periodos: Pick<PeriodoEscala, "inicio">[]): boolean {
  const { data } = dataHoraNoFuso(agoraMs);
  return periodos.some((p) => {
    const ini = inicioDoPeriodoMs(data, p);
    return agoraMs >= ini - JANELA_ANTES_MIN * MIN && agoraMs <= ini + JANELA_DEPOIS_MIN * MIN;
  });
}

// Próximo instante-alvo (início − 5 min) estritamente depois de `agoraMs`, hoje ou amanhã (para o agendador do navegador).
export function proximaPreChecagemMs(agoraMs: number, periodos: Pick<PeriodoEscala, "inicio">[]): number | null {
  if (periodos.length === 0) return null;
  const { data } = dataHoraNoFuso(agoraMs);
  const alvos = [data, somarDiaIso(data, 1)].flatMap((d) => periodos.map((p) => inicioDoPeriodoMs(d, p) - ANTECEDENCIA_PRE_CHECAGEM_MIN * MIN));
  return alvos.filter((t) => t > agoraMs).sort((a, b) => a - b)[0] ?? null;
}
