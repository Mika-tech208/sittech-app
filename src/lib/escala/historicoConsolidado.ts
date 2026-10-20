// Histórico de equidade = SÓ o que de fato já aconteceu (período iniciado até `agoraMs`).
//
// As linhas de escala_producao_alocacoes de períodos que ainda não começaram são SAÍDA derivada de
// um recálculo — descartável e refeita a cada evento. Se contassem como histórico, a equidade de
// uma semana posterior (ex.: a próxima segunda, gerada na sexta) dependeria do plano futuro da
// semana em curso, ou seja, do caminho de eventos, e não das entradas. Aqui entra somente o
// consolidado, no mesmo critério do congelamento do recálculo (período iniciado = congelado).

import { epochMsNoFuso, minutosDoHorario } from "@/features/escala/tempo";
import type { PeriodoEscala } from "@/features/escala/types";

export interface LinhaHistoricoBruta {
  data: string;
  periodo_id: string;
  funcionario_id: string;
  maquina_id: string | null;
  operacao_id: string | null;
}

export interface LinhaHistoricoMinutos {
  funcionarioId: string;
  maquinaId: string | null;
  operacaoId: string | null;
  minutos: number;
}

function duracaoMin(p: { inicio: string; fim: string }): number {
  return Math.max(0, minutosDoHorario(p.fim) - minutosDoHorario(p.inicio));
}

// Cada linha vale os MINUTOS do período, tirados do snapshot de horários do próprio dia (os horários
// podem mudar com o tempo; sem snapshot usa os horários atuais). Períodos que ainda não começaram
// em `agoraMs` ficam de fora.
export function linhasConsolidadas(
  linhas: LinhaHistoricoBruta[],
  snapshots: { data: string; periodos_snapshot: PeriodoEscala[] }[],
  periodosAtuais: PeriodoEscala[],
  agoraMs: number
): LinhaHistoricoMinutos[] {
  const periodoPorDia = new Map<string, PeriodoEscala>();
  snapshots.forEach((d) => (d.periodos_snapshot ?? []).forEach((p) => periodoPorDia.set(`${d.data}|${p.id}`, p)));
  const atuais = new Map(periodosAtuais.map((p) => [p.id, p]));

  const resultado: LinhaHistoricoMinutos[] = [];
  linhas.forEach((r) => {
    const periodo = periodoPorDia.get(`${r.data}|${r.periodo_id}`) ?? atuais.get(r.periodo_id);
    if (!periodo) return;
    if (epochMsNoFuso(r.data, periodo.inicio) > agoraMs) return; // ainda não aconteceu: plano descartável
    const minutos = duracaoMin(periodo);
    if (minutos > 0) resultado.push({ funcionarioId: r.funcionario_id, maquinaId: r.maquina_id, operacaoId: r.operacao_id, minutos });
  });
  return resultado;
}
