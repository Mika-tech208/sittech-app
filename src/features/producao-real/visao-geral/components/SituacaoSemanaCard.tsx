"use client";

// Faixa 2 — Situação da semana (§6/§7, aprovado). Contagem por estado +
// maior déficit projetado (nunca soma peças de produtos diferentes).
// EstadoValidacao é a semântica oficial (§13) — reaproveitada, nunca um
// verde/amarelo/vermelho genérico.

import { useRouter } from "next/navigation";
import type { ForecastSemana } from "@/features/producao-real/visao-geral/types";
import type { EstadoValidacao } from "@/features/producao-real/validacao-previsao/types";
import { formatarPecas } from "@/features/producao-real/indicadores/format";

const LABEL_ESTADO: Record<EstadoValidacao, { label: string; classe: string }> = {
  concluido: { label: "Concluído", classe: "atingido" },
  no_ritmo: { label: "No ritmo", classe: "atingido" },
  atencao: { label: "Atenção", classe: "atencao" },
  inviavel_teoricamente: { label: "Inviável teoricamente", classe: "critico" },
  sem_estimativa: { label: "Sem estimativa", classe: "indisponivel" },
};

export default function SituacaoSemanaCard({ forecast }: { forecast: ForecastSemana }) {
  const router = useRouter();

  return (
    <div className="stx-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <p className="stx-panel-title">Situação da semana</p>
        <button type="button" className="stx-btn-secondary" onClick={() => router.push("/producao-real/validacao-previsao")}>Ver Validação da Previsão</button>
      </div>

      {!forecast.temPrevisao ? (
        <div className="stx-empty">Nenhuma previsão lançada para esta semana.</div>
      ) : (
        <>
          <div className="stx-capacidade-reais-grid" style={{ marginTop: 10 }}>
            {(Object.keys(LABEL_ESTADO) as EstadoValidacao[]).map((estado) => (
              <div key={estado}>
                <span className={`stx-performance-badge ${LABEL_ESTADO[estado].classe}`}>{LABEL_ESTADO[estado].label}</span>
                <p className="stx-panel-title" style={{ marginTop: 4 }}>{forecast.porEstado[estado]}</p>
              </div>
            ))}
          </div>
          {forecast.maiorDeficit ? (
            <p className="stx-panel-sub" style={{ marginTop: 10 }}>
              <strong>Maior déficit projetado</strong> (estimativa): {forecast.maiorDeficit.produtoNome} — {formatarPecas(forecast.maiorDeficit.deficitProjetado)} peças
            </p>
          ) : (
            <p className="stx-panel-sub" style={{ marginTop: 10 }}>Nenhum déficit projetado no momento.</p>
          )}
        </>
      )}
    </div>
  );
}
