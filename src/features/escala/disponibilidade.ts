// Disponibilidade de uma máquina num período (slot) — regra ÚNICA, usada pelo motor e
// pelo diagnóstico de cobertura: máquina inativa, indisponível na Previsão (semana
// inteira) ou com ao menos UMA causa de indisponibilidade (Parada de máquina ou bloqueio manual)
// que INTERSECTA o período.

import type { EntradaEscala, IndisponibilidadeRecursoEscala, SlotEscala } from "./types";

// Interseção de intervalos semiabertos [início, fim): uma causa afeta um período se
//   desde < fim_do_período  E  (liberada_em é NULL  OU  liberada_em > início_do_período).
//   causa que começa NO meio do período afeta; começa exatamente no fim, não;
//   termina exatamente no início, não; termina no meio ou exatamente no fim, afeta. liberada_em NULL = sem prazo final.
// (A regra antiga olhava só o INÍCIO do período e deixava passar a causa que começava no meio dele.)
export function causaAfetaIntervalo(c: Pick<IndisponibilidadeRecursoEscala, "desdeMs" | "liberadaEmMs">, inicioMs: number, fimMs: number): boolean {
  return c.desdeMs < fimMs && (c.liberadaEmMs === null || c.liberadaEmMs > inicioMs);
}

export function maquinaDisponivelNoSlot(entrada: EntradaEscala, maquinaId: string, slot: SlotEscala): boolean {
  if ((entrada.maquinasInativas ?? []).includes(maquinaId) || entrada.maquinasIndisponiveisPrevisao.includes(maquinaId)) return false;
  return !entrada.indisponibilidades.some((i) => i.maquinaId === maquinaId && causaAfetaIntervalo(i, slot.inicioMs, slot.fimMs));
}
