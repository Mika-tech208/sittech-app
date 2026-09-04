"use client";

// Faixa 3 — Principais atenções (§9, aprovado). Até 3 IncidenteDesvio já
// deduplicados e priorizados por gerarFilaDesvios (severidade → recência
// → impacto → persistência) — nenhum score novo, nenhuma reordenação
// aqui. Evidência resumida = justificativaSeveridade do desvio principal
// (já é um texto curto e defensável, nunca inventa causa nova).

import { useRouter } from "next/navigation";
import type { AttentionItem } from "@/features/producao-real/visao-geral/types";
import { rotuloContexto } from "@/features/producao-real/desvios/contexto";

const LABEL_SEVERIDADE: Record<AttentionItem["severidade"], string> = {
  critico: "Crítico", atencao: "Atenção", informativo: "Informativo",
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
    <div className="stx-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <p className="stx-panel-title">Principais atenções</p>
        <button type="button" className="stx-btn-secondary" onClick={() => router.push("/producao-real/desvios")}>Ver Desvios</button>
      </div>

      {incidentes.length === 0 ? (
        <p className="stx-panel-sub" style={{ marginTop: 6 }}>Nenhum desvio identificado — tudo dentro do esperado, ou amostra insuficiente pra comparar.</p>
      ) : (
        <div style={{ marginTop: 8 }}>
          {incidentes.map((inc) => (
            <div key={inc.id} className="stx-ind-tabela-linha" style={{ cursor: inc.desvioPrincipal.linkSugerido ? "pointer" : "default", flexDirection: "column", alignItems: "flex-start", gap: 2 }} onClick={() => verNaOrigem(inc)}>
              <span className={`stx-performance-badge ${inc.severidade}`}>{LABEL_SEVERIDADE[inc.severidade]}</span>
              <p className="stx-panel-title" style={{ marginTop: 4 }}>{inc.desvioPrincipal.titulo}</p>
              <p className="stx-panel-sub">{rotuloContexto(inc.contexto)}</p>
              <p className="stx-panel-sub">{inc.desvioPrincipal.justificativaSeveridade}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
