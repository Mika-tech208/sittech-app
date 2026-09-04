"use client";

// Faixa 6 — Recurso mais pressionado (§11, aprovado). SOMENTE o item mais
// pressionado de recursosPressionados (Validação da Previsão) — pctUso
// NUNCA capado em 100 (>100% é demanda real acima da capacidade restante,
// não bug).

import { useRouter } from "next/navigation";
import type { RecursoPressionadoResumo } from "@/features/producao-real/visao-geral/types";
import { formatarPercentualIndicador } from "@/features/producao-real/indicadores/format";

export default function RecursoPressionadoCard({ recurso }: { recurso: RecursoPressionadoResumo | null }) {
  const router = useRouter();

  return (
    <div className="stx-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <p className="stx-panel-title">Recurso mais pressionado</p>
        <button type="button" className="stx-btn-secondary" onClick={() => router.push("/producao-real/validacao-previsao")}>Ver Validação da Previsão</button>
      </div>

      {!recurso ? (
        <p className="stx-panel-sub" style={{ marginTop: 6 }}>Nenhum recurso pressionado calculado no momento.</p>
      ) : (
        <div className="stx-capacidade-reais-grid" style={{ marginTop: 10 }}>
          <div>
            <p className="stx-panel-sub">Máquina</p>
            <p className="stx-panel-title">{recurso.maquinaNome}{recurso.gargalo ? " (gargalo)" : ""}</p>
          </div>
          <div>
            <p className="stx-panel-sub">Horas necessárias</p>
            <p className="stx-panel-title">{recurso.horasNecessariasRestantes.toFixed(1)}h</p>
          </div>
          <div>
            <p className="stx-panel-sub">Horas restantes</p>
            <p className="stx-panel-title">{recurso.horasRestantes.toFixed(1)}h</p>
          </div>
          <div>
            <p className="stx-panel-sub">% de pressão</p>
            <p className="stx-panel-title" style={{ color: recurso.pctUso > 100 ? "var(--danger)" : undefined }}>{formatarPercentualIndicador(recurso.pctUso)}</p>
          </div>
        </div>
      )}
      {recurso && recurso.pctUso > 100 && (
        <p className="stx-panel-sub" style={{ marginTop: 8 }}>Acima de 100% significa demanda acima da capacidade restante da semana — não é um erro de cálculo.</p>
      )}
    </div>
  );
}
