"use client";

// Merecem atenção (§17-B) e Destaques positivos (§17-C) — mesmo
// componente, só troca polaridade/rótulo. Cada card é funcionário+
// CONTEXTO, nunca uma avaliação global da pessoa (§16: o mesmo
// funcionário pode aparecer aqui em um contexto e em Destaques noutro).

import { rotuloContextoFuncionario } from "@/features/producao-real/funcionarios/contexto";
import type { SinalFuncionario } from "@/features/producao-real/funcionarios/types";
import { formatarPercentualIndicador } from "@/features/producao-real/indicadores/format";

const LABEL_REFERENCIA: Record<SinalFuncionario["referenciaTipo"], string> = {
  pares: "Referência comparável (outros operadores)",
  meta: "Meta oficial",
  historico_proprio: "Histórico do próprio funcionário",
};

const LABEL_METRICA: Record<SinalFuncionario["metrica"], string> = {
  performance: "Performance",
  qualidade: "Qualidade",
};

export default function CardsSinais({
  sinais, polaridade, onVerAnalise,
}: {
  sinais: SinalFuncionario[];
  polaridade: "atencao" | "positivo";
  onVerAnalise: (funcionarioId: string) => void;
}) {
  if (sinais.length === 0) {
    return <div className="stx-empty">Nenhum {polaridade === "atencao" ? "sinal de atenção" : "destaque positivo"} identificado no filtro atual — ou amostra insuficiente pra comparar.</div>;
  }

  return (
    <div>
      {sinais.map((s) => {
        const periodosComSinal = s.persistencia.percentual !== null ? Math.round((s.persistencia.percentual / 100) * s.amostraFuncionario.periodos) : null;
        return (
          <div key={s.id} className="stx-panel" style={{ marginBottom: 10 }}>
            <span className={`stx-performance-badge ${polaridade === "atencao" ? "critico" : "atingido"}`}>
              {polaridade === "atencao" ? "Atenção" : "Destaque positivo"}
            </span>
            <p className="stx-panel-title" style={{ marginTop: 6 }}>{s.funcionarioNome}</p>
            <p className="stx-panel-sub">{rotuloContextoFuncionario(s.contexto)}</p>
            <p className="stx-panel-sub">
              {LABEL_METRICA[s.metrica]} {formatarPercentualIndicador(s.valorFuncionario)} · {LABEL_REFERENCIA[s.referenciaTipo]} {formatarPercentualIndicador(s.valorReferencia)}
            </p>
            <p className="stx-panel-sub">
              {s.amostraFuncionario.periodos} períodos analisados
              {periodosComSinal !== null && ` · ${periodosComSinal} ${polaridade === "atencao" ? "abaixo" : "acima"} da referência`}
            </p>
            <button type="button" className="stx-btn-secondary" style={{ marginTop: 8 }} onClick={() => onVerAnalise(s.funcionarioId)}>
              Ver análise
            </button>
          </div>
        );
      })}
    </div>
  );
}
