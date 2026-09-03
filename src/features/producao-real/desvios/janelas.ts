// Desvios V1 — cálculo de janelas de comparação. Puro, sem I/O.
//
// OPERACIONAL (§3, aprovado): semana atual ATÉ AGORA vs. o MESMO TRECHO
// da semana anterior — nunca semana parcial contra semana anterior
// completa. Ex.: hoje é quinta -> compara segunda->quinta atual contra
// segunda->quinta anterior (mesmo número de dias decorridos).
//
// ESTRUTURAL (§4, aprovado): 28 dias vs. os 28 dias anteriores a esses —
// a função é agnóstica de tamanho de janela (aceita qualquer `dias`), 28
// é só o default da V1.
//
// A arquitetura NUNCA fixa "semana"/"28 dias" como único caminho — ambas
// as funções abaixo são casos particulares de `calcularParDeJanelas`
// (duas janelas de mesmo tamanho, adjacentes, terminando em `hoje`).

import { toISODate, mondayOf } from "@/lib/date";
import type { Janela, ParDeJanelas } from "@/features/producao-real/desvios/types";

function diffDias(a: Date, b: Date): number {
  const MS_POR_DIA = 24 * 60 * 60 * 1000;
  const inicioA = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const inicioB = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((inicioB.getTime() - inicioA.getTime()) / MS_POR_DIA);
}

function somarDias(d: Date, dias: number): Date {
  const copia = new Date(d);
  copia.setDate(copia.getDate() + dias);
  return copia;
}

// Duas janelas adjacentes de `dias` dias cada, terminando em `fimAtual`
// (inclusive) — a referência termina imediatamente antes do início da
// atual. Base genérica reaproveitada por operacional e estrutural.
export function calcularParDeJanelas(fimAtual: Date, dias: number): ParDeJanelas {
  const inicioAtual = somarDias(fimAtual, -(dias - 1));
  const fimReferencia = somarDias(inicioAtual, -1);
  const inicioReferencia = somarDias(fimReferencia, -(dias - 1));
  return {
    atual: { dataInicial: toISODate(inicioAtual), dataFinal: toISODate(fimAtual) },
    referencia: { dataInicial: toISODate(inicioReferencia), dataFinal: toISODate(fimReferencia) },
  };
}

// Operacional: segunda-feira desta semana até hoje, vs. o mesmo trecho
// (mesmo número de dias decorridos) da semana anterior. Nunca inclui dias
// futuros da semana atual — "até hoje" é o próprio limite.
export function calcularJanelaOperacional(hoje: Date = new Date()): ParDeJanelas {
  const segundaAtual = mondayOf(hoje);
  const diasDecorridos = diffDias(segundaAtual, hoje) + 1; // inclui hoje
  const segundaAnterior = somarDias(segundaAtual, -7);
  const fimEquivalenteAnterior = somarDias(segundaAnterior, diasDecorridos - 1);
  return {
    atual: { dataInicial: toISODate(segundaAtual), dataFinal: toISODate(hoje) },
    referencia: { dataInicial: toISODate(segundaAnterior), dataFinal: toISODate(fimEquivalenteAnterior) },
  };
}

export function calcularJanelaEstrutural(hoje: Date = new Date(), dias: number = 28): ParDeJanelas {
  return calcularParDeJanelas(hoje, dias);
}

// Alinhamento de períodos encerrados equivalentes (§3, "quando possível").
// Só o ÚLTIMO dia de cada janela pode estar em andamento (todos os dias
// anteriores já têm todos os períodos do dia encerrados, por definição —
// já são passado). No dia de hoje, só existem apontamentos dos períodos
// (M1..T3) que já aconteceram — isso já é natural via ausência de dados.
// O que NÃO é natural é o dia equivalente da janela de REFERÊNCIA: esse
// dia já passou por inteiro, então ele "vê" períodos que hoje ainda não
// aconteceu — isso infla artificialmente a base de comparação. Esta
// função remove, do dia final da referência, os períodos que não têm
// correspondente no dia final da janela atual (hoje).
export function alinharPeriodosDoUltimoDia<T extends { data: string; periodoId: string }>(
  itensAtual: T[],
  itensReferencia: T[],
  dataFinalAtual: string,
  dataFinalReferencia: string
): T[] {
  const periodosDeHoje = new Set(itensAtual.filter((i) => i.data === dataFinalAtual).map((i) => i.periodoId));
  return itensReferencia.filter((i) => i.data !== dataFinalReferencia || periodosDeHoje.has(i.periodoId));
}
