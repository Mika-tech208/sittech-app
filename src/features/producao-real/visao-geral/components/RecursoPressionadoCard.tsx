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
    <div>
      <div className="stx-vg-ctx-head">
        <h2 className="stx-vg-ctx-title">Recurso mais pressionado</h2>
        <button type="button" className="stx-vg-section-link" onClick={() => router.push("/producao-real/validacao-previsao")}>Ver →</button>
      </div>

      {!recurso ? (
        <p className="stx-vg-empty">Nenhum recurso pressionado calculado no momento.</p>
      ) : (
        <>
          <div className="stx-vg-resource-row">
            <span className="stx-vg-resource-nome">{recurso.maquinaNome}{recurso.gargalo ? " (gargalo)" : ""}</span>
            <span className="stx-vg-resource-pct" style={{ color: recurso.pctUso > 100 ? "var(--danger)" : "var(--text)" }}>
              {formatarPercentualIndicador(recurso.pctUso)}
            </span>
          </div>
          <div className="stx-vg-resource-caption">
            da capacidade restante da semana ({recurso.horasRestantes.toFixed(1)}h de {recurso.horasNecessariasRestantes.toFixed(1)}h necessárias)
            {recurso.pctUso > 100 && " — acima de 100% é demanda acima da capacidade, não erro de cálculo."}
          </div>
        </>
      )}
    </div>
  );
}
