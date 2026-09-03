"use client";

// Indicador compacto de Performance — mesmo componente usado na listagem
// (Apontamentos realizados) e no detalhe/resumo, pra garantir que os dois
// sempre mostrem exatamente o mesmo valor e a mesma classificação.
// Classificação vem de src/lib/performance.ts (única fonte de verdade dos
// limiares) — nenhum limite duplicado aqui.

import { classificarPerformance, formatarPerformancePct } from "@/lib/performance";

export default function PerformanceIndicador({ performancePct }: { performancePct: number | null }) {
  const classificacao = classificarPerformance(performancePct);
  return (
    <span className={`stx-performance-badge ${classificacao}`}>
      Performance {formatarPerformancePct(performancePct)}
    </span>
  );
}
