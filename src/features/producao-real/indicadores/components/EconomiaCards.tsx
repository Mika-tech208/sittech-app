"use client";

// Resumo econômico geral — sempre consome ResumoEconomico já pronto de
// economico.ts, nunca recalcula nada aqui. Só métricas CALCULADAS (custo
// observado direto dos snapshots) — nada de estimativa/aproximação nesta
// seção, por isso sem rótulo de confiança nos cards (ver §8 da decisão:
// não poluir a UI com badge em métrica óbvia).

import type { ResumoEconomico } from "@/features/producao-real/indicadores/economico";
import { formatarBRLIndicador } from "@/features/producao-real/indicadores/format";

export default function EconomiaCards({ resumo }: { resumo: ResumoEconomico }) {
  return (
    <div className="stx-panel">
      <p className="stx-panel-title">Custo observado do período</p>
      <p className="stx-panel-sub">
        Direto dos snapshots já gravados em cada apontamento (custo/hora da operação × tempo, congelado no momento do lançamento) — nunca recalculado a partir do cadastro atual.
      </p>
      <div className="stx-capacidade-reais-grid" style={{ marginTop: 12 }}>
        <div>
          <p className="stx-capacidade-reais-label">Custo operacional total</p>
          <p className="stx-capacidade-reais-valor">{formatarBRLIndicador(resumo.custoOperacionalTotal)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Custo médio / peça produzida</p>
          <p className="stx-capacidade-reais-valor">{formatarBRLIndicador(resumo.custoMedioPorPecaProduzida)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Custo médio / peça boa</p>
          <p className="stx-capacidade-reais-valor">{formatarBRLIndicador(resumo.custoMedioPorPecaBoa)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Custo do tempo parado</p>
          <p className="stx-capacidade-reais-valor">{formatarBRLIndicador(resumo.custoTempoParadoTotal)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Impacto do refugo</p>
          <p className="stx-capacidade-reais-valor">{formatarBRLIndicador(resumo.impactoRefugoTotal)}</p>
        </div>
      </div>
      <p className="stx-panel-sub" style={{ marginTop: 12 }}>
        Custo do tempo parado (R$ da hora ociosa) e capacidade perdida em peças (aba Resumo geral) são duas leituras da mesma perda, em unidades diferentes — nunca somar as duas.
      </p>
    </div>
  );
}
