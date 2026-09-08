// Sittech Intelligence V1 — UI/UX (etapa de painel lateral). Camada de
// APRESENTAÇÃO apenas — nunca recalcula nada. Recebe o `value` exatamente
// como veio na evidência (já calculado pelo motor determinístico) e só
// decide quantas casas mostrar. `evidence.value` nunca é alterado — isto
// aqui produz só uma string pra tela.

import { formatBRL, formatQtd } from "@/lib/format";
import type { IntelligenceConfidence, IntelligenceEvidence } from "@/features/intelligence/types";

// §9 da instrução: percentual bruto tipo "940.5941872710622" vira "940,6%"
// pra tela — o rawValue continua intacto na evidência, isso aqui só formata.
function formatPercentBR(raw: number): string {
  return `${raw.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatHorasBR(raw: number): string {
  const casas = Number.isInteger(raw) ? 0 : 1;
  return `${raw.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })} h`;
}

// Minutos "humanizados": abaixo de 60min mostra só minutos; acima, "Xh Ymin".
function formatMinutosBR(raw: number): string {
  const totalMin = Math.round(raw);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min === 0 ? `${h}h` : `${h}h ${min}min`;
}

// Ponto único de formatação de `IntelligenceEvidence.value` pra tela —
// dispatch por `unit`. Nunca usado para decidir o texto da resposta (essa
// vem pronta do core); só para os cartões de evidência.
export function formatEvidenceValue(evidence: Pick<IntelligenceEvidence, "value" | "unit">): string {
  const { value, unit } = evidence;
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;

  switch (unit) {
    case "%":
      return formatPercentBR(value);
    case "R$":
      return formatBRL(value);
    case "peças":
      return `${formatQtd(value)} peças`;
    case "min":
      return formatMinutosBR(value);
    case "h":
      return formatHorasBR(value);
    default:
      return value.toLocaleString("pt-BR");
  }
}

// Rótulo curto exibido junto de cada evidência — nunca decide cor sozinho;
// ver CONFIDENCE_TOM abaixo, que só diferencia FATO/CALCULADO (neutro) de
// ESTIMATIVA/APROXIMACAO (precisa deixar claro que não é definitivo), sem
// badge colorido gritante nem ícone de alerta (§13 da instrução).
export const CONFIDENCE_LABEL: Record<IntelligenceConfidence, string> = {
  FATO: "Fato",
  CALCULADO: "Calculado",
  ESTIMATIVA: "Estimativa",
  APROXIMACAO: "Aproximação",
};

export function confidenceEhIncerta(confidence: IntelligenceConfidence): boolean {
  return confidence === "ESTIMATIVA" || confidence === "APROXIMACAO";
}

// Linha "Embalagem 17 · Semana atual" — junta contexto (nome da entidade,
// quando houver) com o período, na ordem em que a instrução pediu.
export function formatEvidenceContextLine(evidence: Pick<IntelligenceEvidence, "context" | "period">): string {
  const nomeEntidade =
    evidence.context?.maquinaNome || evidence.context?.produtoNome || evidence.context?.operacaoNome || evidence.context?.funcionarioNome;
  const partes = [nomeEntidade, evidence.period?.label].filter(Boolean);
  return partes.join(" · ");
}
