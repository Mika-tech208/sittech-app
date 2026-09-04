// Validação da Previsão V1 — tempo restante (§5, aprovado). TypeScript
// puro. Convenção V1 centralizada aqui (nunca espalhada): dias_uteis_semana
// = N significa os primeiros N dias corridos a partir de segunda-feira
// (5 = segunda a sexta, 6 = segunda a sábado). `semanaInicio` já é sempre
// segunda-feira (Previsao.semanaInicio, tipo de domínio existente).
//
// Timezone: mesma convenção já usada em toda a Produção Real e em
// Desvios V1 (Date do navegador, sem conversão explícita — a fábrica
// opera num único fuso).

import type { PeriodoComDuracao } from "@/types/domain";

// ---------------------------------------------------------------------
// Convenção de dias úteis — único lugar que decide "quais dias da semana
// contam" (§5: "centralizar essa convenção... não espalhar magic logic").
// ---------------------------------------------------------------------
export function diaUtilConvencao(diasUteisSemana: number): { primeiroDiaIndex: number; ultimoDiaIndex: number } {
  return { primeiroDiaIndex: 0, ultimoDiaIndex: Math.max(0, Math.round(diasUteisSemana) - 1) }; // 0 = segunda
}

function parseDataLocal(iso: string): Date {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

function diffDiasCorridos(a: Date, b: Date): number {
  const MS_POR_DIA = 24 * 60 * 60 * 1000;
  const ia = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const ib = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ib.getTime() - ia.getTime()) / MS_POR_DIA);
}

function horaParaMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

// Horas restantes HOJE, a partir de `agora` — período encerrado = 0,
// período futuro = duração cheia, período em andamento = só a fração
// entre agora e o fim (§5, literal).
export function calcularHorasRestantesHoje(periodosComDuracao: PeriodoComDuracao[], agora: Date): number {
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
  return periodosComDuracao.reduce((soma, p) => {
    if (p.duracaoHoras <= 0) return soma;
    const inicioMin = horaParaMinutos(p.inicio);
    const fimMin = horaParaMinutos(p.fim);
    if (fimMin <= minutosAgora) return soma; // encerrado
    if (inicioMin >= minutosAgora) return soma + p.duracaoHoras; // futuro, completo
    return soma + (fimMin - minutosAgora) / 60; // em andamento, só a fração restante
  }, 0);
}

export interface TempoRestanteSemana {
  horasRestantes: number;
  diaIndexHoje: number | null; // null = semana futura ou já encerrada
  motivo: string;
}

// Horas restantes da SEMANA a partir de agora — a peça central do §5.
// horasPorDia = soma da duração de todos os períodos válidos (mesma
// derivação já usada em toda a Previsão/Capacidade, calcularHorasPorDia).
export function calcularTempoRestanteSemana(
  periodosComDuracao: PeriodoComDuracao[],
  semanaInicio: string,
  diasUteisSemana: number,
  horasPorDia: number,
  agora: Date
): TempoRestanteSemana {
  const { ultimoDiaIndex } = diaUtilConvencao(diasUteisSemana);
  const segunda = parseDataLocal(semanaInicio);
  const diaIndex = diffDiasCorridos(segunda, agora);

  if (diaIndex < 0) {
    // semana futura — nada aconteceu ainda, resta a semana inteira.
    const horas = (ultimoDiaIndex + 1) * horasPorDia;
    return { horasRestantes: horas, diaIndexHoje: null, motivo: "semana ainda não começou — capacidade da semana inteira" };
  }
  if (diaIndex > ultimoDiaIndex) {
    // depois do último dia útil (inclui "semana passada", que cai bem
    // além do último índice) — zero, nunca inventar capacidade.
    return { horasRestantes: 0, diaIndexHoje: null, motivo: "semana já encerrada (depois do último dia útil)" };
  }

  const diasFuturosCompletos = ultimoDiaIndex - diaIndex; // dias úteis inteiros DEPOIS de hoje
  const horasDiasFuturos = diasFuturosCompletos * horasPorDia;
  const horasHoje = calcularHorasRestantesHoje(periodosComDuracao, agora);

  return { horasRestantes: horasDiasFuturos + horasHoje, diaIndexHoje: diaIndex, motivo: "dentro da semana — hoje parcial + dias úteis futuros completos" };
}
