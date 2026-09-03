"use client";

// Fila de atenção (§19-B) — 1 card por INCIDENTE (já deduplicado), já
// ordenados por prioridade (severidade > recência > impacto >
// persistência, §14). Clique expande o detalhe (§19-D) inline —
// nenhum gráfico novo, reaproveita stx-panel/stx-performance-badge.

import { useState } from "react";
import type { IncidenteDesvio } from "@/features/producao-real/desvios/types";
import { rotuloContexto } from "@/features/producao-real/desvios/contexto";
import DetalheDesvio from "@/features/producao-real/desvios/components/DetalheDesvio";

const LABEL_SEVERIDADE: Record<IncidenteDesvio["severidade"], string> = {
  critico: "Crítico", atencao: "Atenção", informativo: "Informativo",
};

export default function FilaDesvios({ incidentes }: { incidentes: IncidenteDesvio[] }) {
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  if (incidentes.length === 0) {
    return <div className="stx-empty">Nenhum desvio identificado no filtro atual — tudo dentro do esperado, ou amostra insuficiente pra comparar.</div>;
  }

  return (
    <div>
      {incidentes.map((inc) => {
        const expandido = expandidoId === inc.id;
        return (
          <div key={inc.id} className="stx-panel" style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <span className={`stx-performance-badge ${inc.severidade}`}>{LABEL_SEVERIDADE[inc.severidade]}</span>
                <p className="stx-panel-title" style={{ marginTop: 6 }}>{inc.desvioPrincipal.titulo}</p>
                <p className="stx-panel-sub">
                  {rotuloContexto(inc.contexto)} · {inc.desvioPrincipal.origemJanela === "operacional" ? "Semana atual" : "Últimos 28 dias"}
                  {inc.efeitos.length > 0 && ` · +${inc.efeitos.length} efeito(s) relacionado(s)`}
                </p>
                {inc.possiveisFatores.length > 0 && (
                  <p className="stx-panel-sub">Possíveis fatores: {inc.possiveisFatores.map((f) => f.fator).join(", ")}</p>
                )}
              </div>
              <button type="button" className="stx-btn-secondary" onClick={() => setExpandidoId(expandido ? null : inc.id)}>
                {expandido ? "Ocultar" : "Ver evidências"}
              </button>
            </div>
            {expandido && <DetalheDesvio incidente={inc} />}
          </div>
        );
      })}
    </div>
  );
}
