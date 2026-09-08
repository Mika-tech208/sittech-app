"use client";

// §15/§30 da instrução — usuário comum não precisa ver
// get_forecast_status/get_production_summary nem raciocínio interno; só
// "Análise baseada em N consultas", com nomes amigáveis ao expandir. Nunca
// mostra params/JSON cru aqui (isso só aparece no debug DEV, componente
// separado).

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { labelDaTool } from "@/features/intelligence/toolLabels";
import type { IntelligenceDebugInfo } from "@/features/intelligence/useIntelligencePanel";

export default function IntelligenceToolTrace({ debug }: { debug: IntelligenceDebugInfo }) {
  const [aberto, setAberto] = useState(false);
  const total = debug.toolsChamadas.length;
  if (total === 0) return null;

  return (
    <div className="stx-intel-tooltrace">
      <button type="button" className="stx-status-header" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        <span className="stx-status-compacto">Análise baseada em {total} {total === 1 ? "consulta" : "consultas"}</span>
        <span className="stx-status-toggle">{aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
      </button>
      {aberto && (
        <ul className="stx-status-detalhes stx-intel-tooltrace-list">
          {debug.toolsChamadas.map((t, i) => (
            <li key={i} className="stx-intel-tooltrace-item">
              {labelDaTool(t.tool)}
              {!t.sucesso && <span className="stx-intel-tooltrace-vazio"> · sem resultado no período</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
