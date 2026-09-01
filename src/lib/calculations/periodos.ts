import type { Periodo, PeriodoComDuracao } from "@/types/domain";

export function duracaoPeriodoHorasCalc(inicio: string, fim: string): number {
  if (!inicio || !fim) return 0;
  const [h1, m1] = inicio.split(":").map(Number);
  const [h2, m2] = fim.split(":").map(Number);
  if ([h1, m1, h2, m2].some((n) => Number.isNaN(n))) return 0;
  const minutos = h2 * 60 + m2 - (h1 * 60 + m1);
  return minutos > 0 ? minutos / 60 : 0;
}

// Cadeia de derivação de tempo disponível, compartilhada entre o domínio de
// Custo por hora e o de Previsão/Capacidade — extraída uma única vez pra
// evitar que as duas telas divirjam se alguém mexer só numa delas.

export function calcularPeriodosComDuracao(periodos: Periodo[]): PeriodoComDuracao[] {
  return periodos.map((p) => ({ ...p, duracaoHoras: duracaoPeriodoHorasCalc(p.inicio, p.fim) }));
}

export function filtrarPeriodosValidos(periodosComDuracao: PeriodoComDuracao[]): PeriodoComDuracao[] {
  return periodosComDuracao.filter((p) => p.duracaoHoras > 0);
}

export function calcularHorasPorDia(periodosValidos: PeriodoComDuracao[]): number {
  return periodosValidos.reduce((s, p) => s + p.duracaoHoras, 0);
}

export function calcularDuracaoMediaPeriodo(periodosValidos: PeriodoComDuracao[], horasPorDia: number): number {
  return periodosValidos.length > 0 ? horasPorDia / periodosValidos.length : 0;
}

export function calcularHorasPorMaquinaSemana(horasPorDia: number, diasUteisSemana: number): number {
  return horasPorDia * diasUteisSemana;
}
