"use client";

// Faixa 3 — "Agora" (§8, aprovado). Máquinas paradas neste exato momento
// — o único sinal em tempo real da tela, nunca histórico. Duração via
// formatarTempoDecorrido (helper compartilhado, mesma fórmula do modal de
// encerrar ocorrência — nunca duplicada). Sem polling novo: o valor só
// atualiza quando a página re-renderiza (mesmo comportamento já existente
// no Apontamento).

import { useRouter } from "next/navigation";
import type { OcorrenciaAbertaResumo } from "@/features/producao-real/visao-geral/types";

export default function OcorrenciasAbertasCard({ ocorrencias }: { ocorrencias: OcorrenciaAbertaResumo[] }) {
  const router = useRouter();

  return (
    <div className="stx-panel">
      <p className="stx-panel-title">Agora</p>
      {ocorrencias.length === 0 ? (
        <p className="stx-panel-sub" style={{ marginTop: 6 }}>Nenhuma máquina parada agora.</p>
      ) : (
        <div style={{ marginTop: 8 }}>
          {ocorrencias.map((o) => (
            <div key={o.id} className="stx-ind-tabela-linha" style={{ cursor: "default", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
              <span className="stx-performance-badge critico">🔴 Parada agora</span>
              <p className="stx-panel-title" style={{ marginTop: 4 }}>{o.maquinaNome}</p>
              <p className="stx-panel-sub">Motivo: {o.motivoNome} · Há {o.tempoDecorridoRotulo}</p>
              {o.descricao && <p className="stx-panel-sub">{o.descricao}</p>}
            </div>
          ))}
        </div>
      )}
      <button type="button" className="stx-btn-secondary" style={{ marginTop: 10 }} onClick={() => router.push("/producao-real")}>
        Ver Apontamento
      </button>
    </div>
  );
}
