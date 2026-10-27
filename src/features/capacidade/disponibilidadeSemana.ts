// DISPONIBILIDADE EFETIVA DAS MÁQUINAS NA SEMANA — a mesma verdade da Escala, em HORAS por máquina, para a Capacidade e a Previsão.
//
// O que "Possível" significa (inalterado): a quantidade máxima da SEMANA NOMINAL — cada máquina selecionada vale `dias produtivos × horas/dia`.
// Esta função só informa quantas horas cada máquina REALMENTE tem na semana, sem fingir indisponibilidade que não existiu:
//   * máquina inativa, ou marcada "indisponível na semana" na Previsão (decisão explícita de semana inteira) => 0 h;
//   * Parada / bloqueio manual (causas com JANELA em escala_recurso_indisponivel) => perde só os períodos que a causa INTERSECTA ([início, fim), igual ao motor
//     da Escala: período afetado por qualquer sobreposição perde o período inteiro). Uma Parada que começou hoje NÃO tira a segunda-feira;
//   * semana já encerrada (fim < hoje) => `undefined`: números históricos nunca são recalculados com indisponibilidade registrada depois.
// Sem nenhuma indisponibilidade => `undefined` (o caminho antigo, idêntico). "Capacidade restante daqui para frente" = horasRestantesPorMaquina (mesma regra, só períodos futuros).

import type { Maquina } from "@/types/domain";
import type { PeriodoComDuracao } from "@/types/domain";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { causaAfetaIntervalo } from "@/features/escala/disponibilidade";
import type { HorasDisponiveisPorMaquina } from "./calculations";

export interface CausaMaquina { maquinaId: string; desdeMs: number; liberadaEmMs: number | null }
export interface PeriodoProdutivo { inicioMs: number; fimMs: number; horas: number }

export function fimDaSemanaIso(semanaInicio: string): string {
  const d = new Date(`${semanaInicio}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

export function periodosProdutivosDaSemana(diasProdutivos: string[], periodos: Pick<PeriodoComDuracao, "inicio" | "fim" | "duracaoHoras">[]): PeriodoProdutivo[] {
  return [...diasProdutivos].sort().flatMap((dia) => periodos.map((p) => ({ inicioMs: epochMsNoFuso(dia, p.inicio), fimMs: epochMsNoFuso(dia, p.fim), horas: p.duracaoHoras })));
}

function horasPerdidas(causas: CausaMaquina[], periodos: PeriodoProdutivo[]): number {
  return periodos.reduce((s, p) => s + (causas.some((c) => causaAfetaIntervalo({ desdeMs: c.desdeMs, liberadaEmMs: c.liberadaEmMs }, p.inicioMs, p.fimMs)) ? p.horas : 0), 0);
}

export function calcularHorasPorMaquinaDaSemana(a: {
  maquinas: Pick<Maquina, "id" | "ativo">[];
  semanaInicio: string;
  hojeIso: string;
  indisponiveisNaSemana: string[]; // marcadas na Previsão (semana inteira)
  causas: CausaMaquina[]; // Parada / bloqueio manual (abertas e já encerradas) que tocam a semana
  periodos: PeriodoProdutivo[]; // períodos produtivos da semana
  horasPorMaquinaSemana: number;
  somenteFuturoAPartirDeMs?: number; // "capacidade restante": só períodos que começam depois deste instante
}): HorasDisponiveisPorMaquina | undefined {
  if (fimDaSemanaIso(a.semanaInicio) < a.hojeIso) return undefined; // histórico intacto
  const periodos = a.somenteFuturoAPartirDeMs === undefined ? a.periodos : a.periodos.filter((p) => p.inicioMs > (a.somenteFuturoAPartirDeMs as number));
  const nominal = a.somenteFuturoAPartirDeMs === undefined ? a.horasPorMaquinaSemana : periodos.reduce((s, p) => s + p.horas, 0);
  const mapa: HorasDisponiveisPorMaquina = {};
  const porMaquina = new Map<string, CausaMaquina[]>();
  a.causas.forEach((c) => porMaquina.set(c.maquinaId, [...(porMaquina.get(c.maquinaId) ?? []), c]));
  a.maquinas.forEach((m) => {
    if (!m.ativo || a.indisponiveisNaSemana.includes(m.id)) { mapa[m.id] = 0; return; }
    const causas = porMaquina.get(m.id);
    if (!causas) { if (a.somenteFuturoAPartirDeMs !== undefined) mapa[m.id] = nominal; return; }
    const perdidas = horasPerdidas(causas, periodos);
    if (perdidas > 0 || a.somenteFuturoAPartirDeMs !== undefined) mapa[m.id] = Math.max(0, nominal - perdidas);
  });
  return Object.keys(mapa).length > 0 ? mapa : undefined;
}
