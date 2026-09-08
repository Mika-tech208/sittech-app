"use client";

// Faixa 3 — Principais atenções (§9, aprovado). Até 3 IncidenteDesvio já
// deduplicados e priorizados por gerarFilaDesvios (severidade → recência
// → impacto → persistência) — nenhum score novo, nenhuma reordenação
// aqui. Evidência resumida = justificativaSeveridade do desvio principal
// (já é um texto curto e defensável, nunca inventa causa nova).

import { useRouter } from "next/navigation";
import type { AttentionItem } from "@/features/producao-real/visao-geral/types";
import { rotuloContexto } from "@/features/producao-real/desvios/contexto";

const COR_SEVERIDADE: Record<AttentionItem["severidade"], string> = {
  critico: "var(--danger)", atencao: "var(--warning)", informativo: "var(--text-3)",
};

export default function PrincipaisAtencoes({ incidentes }: { incidentes: AttentionItem[] }) {
  const router = useRouter();

  function verNaOrigem(inc: AttentionItem) {
    if (!inc.desvioPrincipal.linkSugerido) return;
    const rota = inc.desvioPrincipal.linkSugerido === "produtividade" ? "/producao-real/indicadores" : "/producao-real/paradas";
    const f = inc.desvioPrincipal.filtrosDrillDown;
    const qs = new URLSearchParams();
    qs.set("dataInicial", f.dataInicial);
    qs.set("dataFinal", f.dataFinal);
    if (f.produtoId) qs.set("produtoId", f.produtoId);
    if (f.maquinaId) qs.set("maquinaId", f.maquinaId);
    if (f.operacaoId) qs.set("operacaoId", f.operacaoId);
    router.push(`${rota}?${qs.toString()}`);
  }

  return (
    <div className="stx-vg-section">
      <div className="stx-vg-section-head">
        <h2 className="stx-vg-section-title">Principais atenções</h2>
        <button type="button" className="stx-vg-section-link" onClick={() => router.push("/producao-real/desvios")}>Ver desvios →</button>
      </div>

      {incidentes.length === 0 ? (
        <p className="stx-vg-empty">Nenhum desvio identificado — tudo dentro do esperado, ou amostra insuficiente pra comparar.</p>
      ) : (
        <div className="stx-vg-list">
          {incidentes.map((inc) => (
            <button
              key={inc.id} type="button" className="stx-vg-list-row"
              style={{ cursor: inc.desvioPrincipal.linkSugerido ? "pointer" : "default" }}
              onClick={() => verNaOrigem(inc)}
            >
              <span className="stx-vg-dot" style={{ background: COR_SEVERIDADE[inc.severidade] }} />
              <div>
                <div className="stx-vg-list-title">{inc.desvioPrincipal.titulo}</div>
                <div className="stx-vg-list-sub">{rotuloContexto(inc.contexto)} · {inc.desvioPrincipal.justificativaSeveridade}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
