// Derivações simples a partir dos dados brutos — sem algoritmo de negócio,
// só "achar/agregar o que já existe". Separado de calculations.ts porque
// não há regra a testar aqui além de "acha a semana certa" / "soma os
// valores certos".

import type { Previsao } from "@/types/domain";
import type { ResumoSemana } from "@/features/capacidade/types";

const SEMANA_VAZIA: Omit<Previsao, "semanaInicio"> = { itens: [], itensRealizados: [], maquinasIndisponiveis: [] };

export function selecionarSemana(previsoes: Previsao[], semanaAtual: string): Previsao {
  return previsoes.find((p) => p.semanaInicio === semanaAtual) || { semanaInicio: semanaAtual, ...SEMANA_VAZIA };
}

export function calcularResumoSemana(semana: Pick<Previsao, "itens" | "itensRealizados">): ResumoSemana {
  const valorPrevisto = semana.itens.reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);
  const valorRealizado = (semana.itensRealizados || []).reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);
  const percentualConcluido = valorPrevisto > 0 ? (valorRealizado / valorPrevisto) * 100 : 0;
  const diferenca = valorRealizado - valorPrevisto;
  return { valorPrevisto, valorRealizado, percentualConcluido, diferenca };
}
