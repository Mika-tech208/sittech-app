// Classificação oficial de Performance industrial — única fonte de
// verdade dos limiares (90% / 100%). NÃO recalcula a fórmula (isso
// continua em src/features/producao-real/calculations.ts,
// calcularPerformance — inalterada) — só classifica um percentual que já
// veio pronto de lá. Pensada pra ser reutilizada por qualquer tela/
// dashboard/alerta/notificação futura que precise do mesmo critério, sem
// duplicar os números 90/100 em cada lugar.
//
// performancePct pode passar de 100 (produção acima do teórico) — nunca
// é limitado aqui; null/NaN (denominador inválido) vira "indisponivel".

export type ClassificacaoPerformance = "critico" | "atencao" | "atingido" | "indisponivel";

export function classificarPerformance(performancePct: number | null | undefined): ClassificacaoPerformance {
  if (performancePct === null || performancePct === undefined || !Number.isFinite(performancePct)) {
    return "indisponivel";
  }
  if (performancePct < 90) return "critico";
  if (performancePct < 100) return "atencao";
  return "atingido";
}

export const LABEL_CLASSIFICACAO_PERFORMANCE: Record<ClassificacaoPerformance, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  atingido: "Atingido",
  indisponivel: "Indisponível",
};

export function formatarPerformancePct(performancePct: number | null | undefined): string {
  if (performancePct === null || performancePct === undefined || !Number.isFinite(performancePct)) return "N/A";
  return `${performancePct.toFixed(1)}%`;
}
