// Disponibilidade de uma máquina num período (slot) — regra ÚNICA, usada pelo motor e
// pelo diagnóstico de cobertura: máquina inativa, indisponível na Previsão (semana
// inteira) ou com indisponibilidade de recurso aberta/ativa no início do período.

import type { EntradaEscala, SlotEscala } from "./types";

export function maquinaDisponivelNoSlot(entrada: EntradaEscala, maquinaId: string, slot: SlotEscala): boolean {
  if ((entrada.maquinasInativas ?? []).includes(maquinaId) || entrada.maquinasIndisponiveisPrevisao.includes(maquinaId)) return false;
  return !entrada.indisponibilidades.some((i) => i.maquinaId === maquinaId && i.desdeMs <= slot.inicioMs && (i.liberadaEmMs === null || slot.inicioMs < i.liberadaEmMs));
}
