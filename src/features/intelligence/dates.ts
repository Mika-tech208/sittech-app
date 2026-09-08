// Sittech Intelligence V1 — normalização determinística de janelas
// temporais (§9/§14 da análise aprovada). O LLM NUNCA calcula datas —
// só escolhe um `JanelaChave` semântico; esta função converte pra datas
// exatas reaproveitando as MESMAS funções já oficiais de cada domínio.
// Nunca uma fórmula de data nova.

import { toISODate } from "@/lib/date";
import { calcularJanelaOperacional } from "@/features/producao-real/desvios/janelas";
import type { JanelaChave, JanelaParametro, JanelaResolvida } from "@/features/intelligence/types";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class JanelaInvalidaError extends Error {}

export function resolverJanela(param: JanelaParametro, agora: Date = new Date()): JanelaResolvida {
  switch (param.janela) {
    case "hoje": {
      const hoje = toISODate(agora);
      return { dataInicial: hoje, dataFinal: hoje, rotulo: "Hoje", chave: "hoje" };
    }
    case "semana_atual": {
      // Mesma janela oficial de Desvios V1 — segunda-feira até agora.
      const { atual } = calcularJanelaOperacional(agora);
      return { dataInicial: atual.dataInicial, dataFinal: atual.dataFinal, rotulo: "Semana atual até agora", chave: "semana_atual" };
    }
    case "semana_passada": {
      // Mesmo trecho equivalente da semana anterior — nunca semana
      // parcial contra semana anterior completa (mesma regra de Desvios V1).
      const { referencia } = calcularJanelaOperacional(agora);
      return { dataInicial: referencia.dataInicial, dataFinal: referencia.dataFinal, rotulo: "Mesmo trecho da semana anterior", chave: "semana_passada" };
    }
    case "ultimos_14_dias": {
      // Mesmo cálculo de JANELA_HISTORICA_VALIDACAO_DIAS (Validação da
      // Previsão) — dias corridos a partir de agora, nunca segunda-feira.
      const dataInicial = toISODate(new Date(agora.getTime() - 14 * 24 * 60 * 60 * 1000));
      return { dataInicial, dataFinal: toISODate(agora), rotulo: "Últimos 14 dias", chave: "ultimos_14_dias" };
    }
    case "ultimos_28_dias": {
      // Mesmo cálculo de JANELA_ESTRUTURAL_DIAS (Desvios V1).
      const dataInicial = toISODate(new Date(agora.getTime() - 28 * 24 * 60 * 60 * 1000));
      return { dataInicial, dataFinal: toISODate(agora), rotulo: "Últimos 28 dias", chave: "ultimos_28_dias" };
    }
    case "custom": {
      const { dataInicialCustom, dataFinalCustom } = param;
      if (!dataInicialCustom || !dataFinalCustom || !ISO_DATE_RE.test(dataInicialCustom) || !ISO_DATE_RE.test(dataFinalCustom)) {
        throw new JanelaInvalidaError("Janela customizada precisa de dataInicial/dataFinal em formato ISO (AAAA-MM-DD).");
      }
      if (dataInicialCustom > dataFinalCustom) {
        throw new JanelaInvalidaError("dataInicial não pode ser depois de dataFinal.");
      }
      return { dataInicial: dataInicialCustom, dataFinal: dataFinalCustom, rotulo: `${dataInicialCustom} a ${dataFinalCustom}`, chave: "custom" };
    }
    default: {
      const _exhaustive: never = param.janela;
      throw new JanelaInvalidaError(`Janela desconhecida: ${_exhaustive as string}`);
    }
  }
}

export const JANELAS_VALIDAS: JanelaChave[] = ["hoje", "semana_atual", "semana_passada", "ultimos_14_dias", "ultimos_28_dias", "custom"];
