"use client";

// Resumo (§19-A) — contagem por severidade. Nenhuma fórmula aqui, só
// contagem do que já saiu do motor de detecção.

import type { IncidenteDesvio } from "@/features/producao-real/desvios/types";

export default function ResumoDesviosCards({ incidentes }: { incidentes: IncidenteDesvio[] }) {
  const criticos = incidentes.filter((i) => i.severidade === "critico").length;
  const atencao = incidentes.filter((i) => i.severidade === "atencao").length;
  const informativos = incidentes.filter((i) => i.severidade === "informativo").length;

  return (
    <div className="stx-panel">
      <p className="stx-panel-title">Resumo</p>
      <p className="stx-panel-sub">
        Fila automática de situações que saíram do esperado, comparando a semana atual (até agora) e os últimos 28 dias contra suas respectivas referências — nunca um dashboard a mais.
      </p>
      <div className="stx-capacidade-reais-grid" style={{ marginTop: 12 }}>
        <div>
          <p className="stx-capacidade-reais-label">
            <span className="stx-performance-badge critico" style={{ marginRight: 6 }}>Crítico</span>
          </p>
          <p className="stx-capacidade-reais-valor">{criticos}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">
            <span className="stx-performance-badge atencao" style={{ marginRight: 6 }}>Atenção</span>
          </p>
          <p className="stx-capacidade-reais-valor">{atencao}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">
            <span className="stx-performance-badge indisponivel" style={{ marginRight: 6 }}>Informativo</span>
          </p>
          <p className="stx-capacidade-reais-valor">{informativos}</p>
        </div>
      </div>
    </div>
  );
}
