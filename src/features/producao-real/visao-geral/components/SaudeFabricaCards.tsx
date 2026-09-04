"use client";

// Faixa 1 — Saúde da fábrica (§5, aprovado). Exatamente 5 KPIs, semana
// atual até agora. Performance usa o badge oficial (classificarPerformance,
// sem teto); os outros 4 são neutros (§13 — não precisam de cor
// decorativa). Nunca um total de "Produção acabada" somando produtos
// diferentes — por isso Produção acabada nem aparece aqui (§5/§7).

import { useRouter } from "next/navigation";
import type { FactoryHealth } from "@/features/producao-real/visao-geral/types";
import { formatarPercentualIndicador, formatarMinutos } from "@/features/producao-real/indicadores/format";
import { classificarPerformance, LABEL_CLASSIFICACAO_PERFORMANCE } from "@/lib/performance";

function qs(filtros: { dataInicial: string; dataFinal: string }): string {
  const p = new URLSearchParams();
  p.set("dataInicial", filtros.dataInicial);
  p.set("dataFinal", filtros.dataFinal);
  return p.toString();
}

export default function SaudeFabricaCards({ health, drillDown }: { health: FactoryHealth; drillDown: { dataInicial: string; dataFinal: string } }) {
  const router = useRouter();
  const classePerformance = classificarPerformance(health.performancePct);

  return (
    <div className="stx-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p className="stx-panel-title">Saúde da fábrica</p>
          <p className="stx-panel-sub">{health.janela.rotulo} ({health.janela.dataInicial.split("-").reverse().join("/")} – {health.janela.dataFinal.split("-").reverse().join("/")})</p>
        </div>
        <button type="button" className="stx-btn-secondary" onClick={() => router.push(`/producao-real/indicadores?${qs(drillDown)}`)}>Ver Produtividade</button>
      </div>

      {!health.temDados ? (
        <div className="stx-empty">Sem dados no período.</div>
      ) : (
        <div className="stx-capacidade-reais-grid" style={{ marginTop: 10 }}>
          <div>
            <span className={`stx-performance-badge ${classePerformance}`}>{LABEL_CLASSIFICACAO_PERFORMANCE[classePerformance]}</span>
            <p className="stx-panel-sub" style={{ marginTop: 4 }}>Performance</p>
            <p className="stx-panel-title">{formatarPercentualIndicador(health.performancePct)}</p>
          </div>
          <div>
            <p className="stx-panel-sub">Disponibilidade</p>
            <p className="stx-panel-title">{formatarPercentualIndicador(health.disponibilidadePct)}</p>
          </div>
          <div>
            <p className="stx-panel-sub">Qualidade</p>
            <p className="stx-panel-title">{formatarPercentualIndicador(health.qualidadePct)}</p>
          </div>
          <div>
            <p className="stx-panel-sub">OEE</p>
            <p className="stx-panel-title">{formatarPercentualIndicador(health.oeePct)}</p>
          </div>
          <div>
            <p className="stx-panel-sub">Tempo parado</p>
            <p className="stx-panel-title">{formatarMinutos(health.minutosParadosTotais)}</p>
          </div>
        </div>
      )}
      <p className="stx-panel-sub" style={{ marginTop: 8 }}>
        Disponibilidade/OEE representam só os períodos efetivamente apontados como produção — não é disponibilidade industrial absoluta da fábrica.
      </p>
    </div>
  );
}
