"use client";

// Resumo da semana (§19/§22-A) — só contagens por estado (§13). Nunca
// soma peças de produtos diferentes.

import type { ResultadoValidacaoPrevisao } from "@/features/producao-real/validacao-previsao/types";

const LABELS: { key: ResultadoValidacaoPrevisao["itens"][number]["estado"]; label: string; classe: string }[] = [
  { key: "concluido", label: "Concluído", classe: "atingido" },
  { key: "no_ritmo", label: "No ritmo", classe: "atingido" },
  { key: "atencao", label: "Atenção", classe: "atencao" },
  { key: "inviavel_teoricamente", label: "Inviável teoricamente", classe: "critico" },
  { key: "sem_estimativa", label: "Sem estimativa", classe: "indisponivel" },
];

export default function ResumoSemanaCards({ resultado }: { resultado: ResultadoValidacaoPrevisao }) {
  return (
    <div className="stx-panel">
      <p className="stx-panel-title">Resumo da semana</p>
      <p className="stx-panel-sub">
        Tempo restante desta semana: {resultado.tempoRestanteHoras.toFixed(1)}h. Falta operacional sempre calculada com a produção acabada observada (Produção Real, última etapa) — nunca com o Realizado oficial manual.
      </p>
      <div className="stx-capacidade-reais-grid" style={{ marginTop: 12 }}>
        {LABELS.map((l) => (
          <div key={l.key}>
            <p className="stx-capacidade-reais-label">
              <span className={`stx-performance-badge ${l.classe}`} style={{ marginRight: 6 }}>{l.label}</span>
            </p>
            <p className="stx-capacidade-reais-valor">{resultado.itens.filter((it) => it.estado === l.key).length}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
