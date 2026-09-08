"use client";

// Faixa 1 — Saúde da fábrica (§5, aprovado). 4 KPIs iguais — Performance,
// Disponibilidade, Qualidade, OEE —, sem badge/cor decorativa (§13).
// Nunca um total de "Produção acabada" somando produtos diferentes — por
// isso Produção acabada nem aparece aqui (§5/§7), inclusive nesta etapa
// de composição visual: o par "Produção acabada/processada" do conceito
// aprovado somaria peças de produtos diferentes num único número, o que
// esta tela decidiu explicitamente nunca fazer — por isso não virou o
// número-hero da composição.
//
// Empty state (refinamento de escala): a grade continua de pé mesmo sem
// dados — cada formatarPercentualIndicador(null) já vira "N/A" sozinho
// (mesma função usada em todo o resto do app, nunca um "0%" fictício). Só
// uma legenda pequena abaixo avisa "Sem dados no período" — não
// escondemos a faixa inteira, senão o resto da composição fica com um
// buraco vazio no lugar dela.

import { useRouter } from "next/navigation";
import type { FactoryHealth } from "@/features/producao-real/visao-geral/types";
import { formatarPercentualIndicador } from "@/features/producao-real/indicadores/format";

function qs(filtros: { dataInicial: string; dataFinal: string }): string {
  const p = new URLSearchParams();
  p.set("dataInicial", filtros.dataInicial);
  p.set("dataFinal", filtros.dataFinal);
  return p.toString();
}

export default function SaudeFabricaCards({ health, drillDown }: { health: FactoryHealth; drillDown: { dataInicial: string; dataFinal: string } }) {
  const router = useRouter();

  return (
    <>
      <div className="stx-vg-kpi-grid stx-vg-kpi-grid-4">
        <div>
          <div className="stx-vg-kpi-label">Performance</div>
          <div className="stx-vg-kpi-value">{formatarPercentualIndicador(health.performancePct)}</div>
        </div>
        <div>
          <div className="stx-vg-kpi-label">Disponibilidade</div>
          <div className="stx-vg-kpi-value">{formatarPercentualIndicador(health.disponibilidadePct)}</div>
          <div className="stx-vg-kpi-caption">só períodos apontados</div>
        </div>
        <div>
          <div className="stx-vg-kpi-label">Qualidade</div>
          <div className="stx-vg-kpi-value">{formatarPercentualIndicador(health.qualidadePct)}</div>
        </div>
        <div>
          <div className="stx-vg-kpi-label">OEE</div>
          <div className="stx-vg-kpi-value">{formatarPercentualIndicador(health.oeePct)}</div>
          <div className="stx-vg-kpi-caption">sem teto em 100%</div>
        </div>
      </div>

      {!health.temDados && <p className="stx-vg-kpi-caption" style={{ marginTop: 14 }}>Sem dados no período.</p>}

      <button type="button" className="stx-vg-link" onClick={() => router.push(`/producao-real/indicadores?${qs(drillDown)}`)}>
        Ver produtividade →
      </button>
    </>
  );
}
