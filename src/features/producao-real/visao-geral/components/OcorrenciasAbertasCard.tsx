"use client";

// Faixa 3 — "Agora" (§8, aprovado). Máquinas paradas neste exato momento
// — o único sinal em tempo real da tela, nunca histórico. Duração via
// formatarTempoDecorrido (helper compartilhado, mesma fórmula do modal de
// encerrar ocorrência — nunca duplicada). Sem polling novo: o valor só
// atualiza quando a página re-renderiza (mesmo comportamento já existente
// no Apontamento). Sem barra "N/M fechadas" — esse total pertence ao
// domínio do Apontamento, não é um dos 6 domínios que esta composição
// já recebe (evitaria uma nova integração cruzada só pra layout).

import { useRouter } from "next/navigation";
import type { OcorrenciaAbertaResumo } from "@/features/producao-real/visao-geral/types";

export default function OcorrenciasAbertasCard({ ocorrencias }: { ocorrencias: OcorrenciaAbertaResumo[] }) {
  const router = useRouter();

  return (
    <div>
      <div className="stx-vg-ctx-head">
        <h2 className="stx-vg-ctx-title">Agora</h2>
        {ocorrencias.length > 0 && (
          <span className="stx-vg-ctx-badge">{ocorrencias.length} {ocorrencias.length === 1 ? "ocorrência aberta" : "ocorrências abertas"}</span>
        )}
      </div>

      {ocorrencias.length === 0 ? (
        <p className="stx-vg-empty">Nenhuma máquina parada agora.</p>
      ) : (
        <div className="stx-vg-occ-list">
          {ocorrencias.map((o) => (
            <div key={o.id}>
              <div className="stx-vg-occ-top">
                <span className="stx-vg-occ-nome">{o.maquinaNome}</span>
                <span className="stx-vg-occ-tempo" style={{ color: "var(--danger)" }}>Há {o.tempoDecorridoRotulo}</span>
              </div>
              <div className="stx-vg-occ-sub">{o.motivoNome}{o.descricao ? ` · ${o.descricao}` : ""}</div>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="stx-vg-link" onClick={() => router.push("/producao-real")}>
        Ir para apontamento →
      </button>
    </div>
  );
}
