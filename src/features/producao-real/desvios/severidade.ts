// Desvios V1 — magnitude, persistência e severidade (§9/§10, aprovado).
// Três fatores avaliados SEPARADAMENTE (magnitude / persistência /
// impacto), combinados por uma regra legível — nunca um score numérico
// ponderado. Cada combinação abaixo é literal ao exemplo aprovado:
//
// CRÍTICO:  magnitude forte + persistência
//        OU magnitude forte + impacto alto
//        OU (Produtividade) Performance em faixa oficial crítica + persistência
// ATENÇÃO:  deterioração relevante confirmada (magnitude relevante ou forte)
//        OU impacto alto (mesmo com magnitude menor)
// INFORMATIVO: alteração observável (passou amostra mínima e houve piora
//              real), mas sem evidência suficiente pros níveis acima.
//
// "Impacto alto" reaproveita a MESMA escala de magnitude (20%/50%)
// aplicada à métrica de impacto associada — não introduz um terceiro
// número novo.

import type { AvaliacaoSeveridade, NivelMagnitude, SeveridadeDesvio } from "@/features/producao-real/desvios/types";
import { LIMIAR_MAGNITUDE_FORTE_PCT, LIMIAR_MAGNITUDE_RELEVANTE_PCT, LIMIAR_PERSISTENCIA_PCT } from "@/features/producao-real/desvios/thresholds";
import { classificarPerformance } from "@/lib/performance";

export function classificarMagnitudePercentual(pctPiora: number): NivelMagnitude {
  if (pctPiora >= LIMIAR_MAGNITUDE_FORTE_PCT) return "forte";
  if (pctPiora >= LIMIAR_MAGNITUDE_RELEVANTE_PCT) return "relevante";
  return "leve";
}

export interface ResultadoDelta {
  deltaAbsoluto: number;
  deltaPercentual: number | null;
  houvePiora: boolean;
  magnitude: NivelMagnitude;
}

// direcao: "aumento_e_pior" (minutos, custo, refugo...) ou
// "reducao_e_pior" (Qualidade%, margem%, atingimento%...).
// Referência zero + piora real (foi de 0 pra algo) não é expressável em
// %, mas continua sendo um sinal real — tratado como magnitude "forte"
// direto (documentado), nunca descartado nem virando N/A silencioso.
export function calcularDelta(valorAtual: number, valorReferencia: number, direcao: "aumento_e_pior" | "reducao_e_pior"): ResultadoDelta {
  const deltaAbsoluto = valorAtual - valorReferencia;
  const deltaPercentual = valorReferencia !== 0 ? (deltaAbsoluto / Math.abs(valorReferencia)) * 100 : null;
  const piora = direcao === "aumento_e_pior" ? valorAtual - valorReferencia : valorReferencia - valorAtual;

  if (piora <= 0) return { deltaAbsoluto, deltaPercentual, houvePiora: false, magnitude: "leve" };
  if (valorReferencia === 0) return { deltaAbsoluto, deltaPercentual, houvePiora: true, magnitude: "forte" };
  const pctPiora = (piora / Math.abs(valorReferencia)) * 100;
  return { deltaAbsoluto, deltaPercentual, houvePiora: true, magnitude: classificarMagnitudePercentual(pctPiora) };
}

export function calcularPersistencia(periodosDistintosComSinal: number, totalPeriodosNoContexto: number): { percentual: number | null; persistente: boolean } {
  if (totalPeriodosNoContexto <= 0) return { percentual: null, persistente: false };
  const percentual = (periodosDistintosComSinal / totalPeriodosNoContexto) * 100;
  return { percentual, persistente: percentual >= LIMIAR_PERSISTENCIA_PCT };
}

function combinar(magnitude: NivelMagnitude, persistente: boolean, impactoAlto: boolean): { severidade: SeveridadeDesvio; justificativa: string } {
  const forte = magnitude === "forte";
  const relevanteOuForte = magnitude === "relevante" || forte;

  if (forte && persistente) {
    return { severidade: "critico", justificativa: `Magnitude forte (≥${LIMIAR_MAGNITUDE_FORTE_PCT}%) e persistente (≥${LIMIAR_PERSISTENCIA_PCT}% dos períodos afetados).` };
  }
  if (forte && impactoAlto) {
    return { severidade: "critico", justificativa: "Magnitude forte e impacto econômico/operacional também com magnitude forte no mesmo período." };
  }
  if (relevanteOuForte) {
    return { severidade: "atencao", justificativa: `Deterioração relevante confirmada (magnitude ${magnitude}, ≥${LIMIAR_MAGNITUDE_RELEVANTE_PCT}%).` };
  }
  if (impactoAlto) {
    return { severidade: "atencao", justificativa: "Magnitude leve isolada, mas o impacto associado tem magnitude forte no mesmo período." };
  }
  return { severidade: "informativo", justificativa: "Alteração observável, com amostra suficiente, mas sem magnitude/persistência/impacto suficientes para Atenção." };
}

export function avaliarSeveridadeGenerica(magnitude: NivelMagnitude, persistente: boolean, impactoAlto: boolean): AvaliacaoSeveridade {
  const { severidade, justificativa } = combinar(magnitude, persistente, impactoAlto);
  return { severidade, magnitude, persistente, impactoAlto, justificativa };
}

// Produtividade — Performance reutiliza classificarPerformance (90/100,
// única fonte de verdade já aprovada) COMO CAMINHO ADICIONAL pra CRÍTICO,
// em paralelo à regra genérica (nunca a substitui).
export function avaliarSeveridadePerformance(
  performanceAtual: number,
  magnitude: NivelMagnitude,
  persistente: boolean,
  impactoAlto: boolean
): AvaliacaoSeveridade {
  const faixaOficial = classificarPerformance(performanceAtual);
  if (faixaOficial === "critico" && persistente) {
    return {
      severidade: "critico",
      magnitude,
      persistente,
      impactoAlto,
      justificativa: "Performance na faixa oficial crítica (<90%, classificarPerformance) e persistente no período.",
    };
  }
  const generica = combinar(magnitude, persistente, impactoAlto);
  return { severidade: generica.severidade, magnitude, persistente, impactoAlto, justificativa: generica.justificativa };
}
