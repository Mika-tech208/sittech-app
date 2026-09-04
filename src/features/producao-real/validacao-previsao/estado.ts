// Validação da Previsão V1 — classificação de estado (§13, aprovado).
// SOMENTE estes 5 estados, sem score, regras literais à instrução.

import type { EstadoValidacao } from "@/features/producao-real/validacao-previsao/types";

export function classificarEstado(
  faltaOperacional: number,
  capacidadeTeoricaRestante: number,
  capacidadeProvavelRestante: number | null
): EstadoValidacao {
  if (faltaOperacional <= 0) return "concluido";
  if (faltaOperacional > capacidadeTeoricaRestante) return "inviavel_teoricamente";
  if (capacidadeProvavelRestante === null) return "sem_estimativa";
  if (faltaOperacional <= capacidadeProvavelRestante) return "no_ritmo";
  return "atencao"; // capacidadeProvavelRestante < faltaOperacional <= capacidadeTeoricaRestante
}
