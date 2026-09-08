"use client";

// §12/§13/§29 da instrução — lista de evidências, compacta e recolhível
// por padrão (reaproveita a MESMA classe/comportamento de
// stx-status-header/toggle/detalhes já usado em outras telas do Produção
// Real, não inventa um padrão de collapse novo). Cada evidência mostra
// métrica → valor formatado → confiança → contexto/período → "Ver dados",
// nessa ordem de prioridade visual (resposta > evidência > detalhe técnico).

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { IntelligenceEvidence } from "@/features/intelligence/types";
import { CONFIDENCE_LABEL, confidenceEhIncerta, formatEvidenceContextLine, formatEvidenceValue } from "@/features/intelligence/format";
import { buildDrillDownHref } from "@/features/intelligence/toolLabels";

function EvidenceItem({ evidencia }: { evidencia: IntelligenceEvidence }) {
  const router = useRouter();
  const href = buildDrillDownHref(evidencia);
  const contextLine = formatEvidenceContextLine(evidencia);
  const incerta = confidenceEhIncerta(evidencia.confidence);

  return (
    <div className="stx-intel-evidence-card">
      <div className="stx-intel-evidence-top">
        <p className="stx-intel-evidence-metric">{evidencia.metric}</p>
        <p className="stx-intel-evidence-value">{formatEvidenceValue(evidencia)}</p>
      </div>
      <div className="stx-intel-evidence-meta">
        <span className="stx-intel-evidence-meta-left">
          <span className={incerta ? "stx-intel-confidence incerta" : "stx-intel-confidence"}>
            {CONFIDENCE_LABEL[evidencia.confidence]}
          </span>
          {contextLine && <span className="stx-intel-evidence-context">{contextLine}</span>}
        </span>
        {href && (
          <button type="button" className="stx-intel-drilldown-btn" onClick={() => router.push(href)}>
            Ver dados
          </button>
        )}
      </div>
    </div>
  );
}

export default function IntelligenceEvidenceList({ evidencias }: { evidencias: IntelligenceEvidence[] }) {
  const [aberto, setAberto] = useState(false);
  if (evidencias.length === 0) return null;

  return (
    <div className="stx-intel-evidence-section">
      <button type="button" className="stx-status-header" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        <span className="stx-status-compacto">Evidências ({evidencias.length})</span>
        <span className="stx-status-toggle">
          {aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>
      {aberto && (
        <div className="stx-status-detalhes stx-intel-evidence-grid">
          {evidencias.map((ev) => (
            <EvidenceItem key={ev.id} evidencia={ev} />
          ))}
        </div>
      )}
    </div>
  );
}
