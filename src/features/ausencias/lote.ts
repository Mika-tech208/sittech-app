// Lançamento de ausência em vários dias — lógica pura (a gravação é a RPC
// registrar_ausencias_funcionario_lote, um registro por dia). Nenhum
// calendário de feriados/dias úteis é assumido: todo dia do intervalo
// aparece marcado e quem confirma é a supervisora.

import { toISODate } from "@/lib/date";

export const MAX_DIAS_LOTE = 31;
const SEMANA_CURTA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function diaSemanaCurto(iso: string): string {
  return SEMANA_CURTA[new Date(iso + "T00:00:00").getDay()];
}

export function gerarDiasDoIntervalo(de: string, ate: string): { dias: string[]; erro: string | null } {
  if (!de || !ate) return { dias: [], erro: null };
  if (ate < de) return { dias: [], erro: "A data final não pode ser anterior à inicial." };
  const dias: string[] = [];
  const cursor = new Date(de + "T00:00:00");
  const fim = new Date(ate + "T00:00:00");
  while (cursor <= fim) {
    if (dias.length >= MAX_DIAS_LOTE) return { dias: [], erro: `O intervalo pode ter no máximo ${MAX_DIAS_LOTE} dias.` };
    dias.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return { dias, erro: null };
}

export type StatusDiaLote = "criado" | "ja_registrado" | "conflito";

export interface ResultadoDiaLote {
  data: string;
  status: StatusDiaLote;
  id?: string;
  mensagem?: string;
}

export interface ResumoLote {
  criados: string[];
  jaRegistrados: string[];
  conflitos: string[];
  ignorados: string[]; // dias do intervalo que a supervisora desmarcou
}

export function resumirResultadoLote(resultados: ResultadoDiaLote[], diasDoIntervalo: string[], diasEnviados: string[]): ResumoLote {
  const enviados = new Set(diasEnviados);
  return {
    criados: resultados.filter((r) => r.status === "criado").map((r) => r.data).sort(),
    jaRegistrados: resultados.filter((r) => r.status === "ja_registrado").map((r) => r.data).sort(),
    conflitos: resultados.filter((r) => r.status === "conflito").map((r) => r.data).sort(),
    ignorados: diasDoIntervalo.filter((d) => !enviados.has(d)),
  };
}
