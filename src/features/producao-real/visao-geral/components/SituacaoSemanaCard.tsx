"use client";

// Faixa 2 — Situação da semana (§6/§7, aprovado). Uma linha por produto
// (previsto, realizado observado vs. previsto, estado) — cada linha é seu
// próprio número, NUNCA somado entre produtos (mesma regra de
// SaudeFabricaCards/§5/§7): por isso não existe aqui uma linha de total
// somando previsto entre produtos diferentes, mesmo que o conceito
// aprovado mostre uma. "Realizado vs. possível" usa produção acabada
// observada (nunca o realizado oficial manual — mesma regra de
// faltaOperacional em toda a Validação da Previsão) sobre o previsto,
// sem teto em 100%.

import { useRouter } from "next/navigation";
import type { ForecastSemana } from "@/features/producao-real/visao-geral/types";
import type { EstadoValidacao } from "@/features/producao-real/validacao-previsao/types";
import { formatarPecas } from "@/features/producao-real/indicadores/format";

const ESTADO: Record<EstadoValidacao, { label: string; cor: string }> = {
  concluido: { label: "Concluído", cor: "var(--accent)" },
  no_ritmo: { label: "No ritmo", cor: "var(--text-2)" },
  atencao: { label: "Atenção", cor: "var(--warning)" },
  inviavel_teoricamente: { label: "Inviável teoricamente", cor: "var(--danger)" },
  sem_estimativa: { label: "Sem estimativa", cor: "var(--text-3)" },
};

export default function SituacaoSemanaCard({ forecast }: { forecast: ForecastSemana }) {
  const router = useRouter();

  return (
    <div className="stx-vg-section">
      <div className="stx-vg-section-head">
        <h2 className="stx-vg-section-title">Situação da semana</h2>
        <button type="button" className="stx-vg-section-link" onClick={() => router.push("/producao-real/validacao-previsao")}>
          Ver validação da previsão →
        </button>
      </div>

      {!forecast.temPrevisao ? (
        <p className="stx-vg-empty">Nenhuma previsão lançada para esta semana.</p>
      ) : (
        <>
          <div className="stx-vg-table-head">
            <span>Produto</span>
            <span className="num">Previsto</span>
            <span>Realizado vs. previsto</span>
            <span className="num">Estado</span>
          </div>
          {forecast.itens.map((it) => {
            const pct = it.previsto > 0 ? (it.producaoAcabadaObservada / it.previsto) * 100 : null;
            const estado = ESTADO[it.estado];
            return (
              <button key={it.produtoId} type="button" className="stx-vg-table-row" onClick={() => router.push("/producao-real/validacao-previsao")}>
                <span>{it.produtoNome}</span>
                <span className="num">{formatarPecas(it.previsto)}</span>
                <span className="stx-vg-bar-cell">
                  <span className="stx-vg-bar-track">
                    <span className="stx-vg-bar-fill" style={{ width: `${Math.min(100, pct ?? 0)}%`, background: estado.cor }} />
                  </span>
                  <span className="stx-vg-bar-pct">{pct !== null ? `${pct.toFixed(1)}%` : "N/A"}</span>
                </span>
                <span className="stx-vg-estado" style={{ color: estado.cor }}>{estado.label}</span>
              </button>
            );
          })}
          {forecast.maiorDeficit && (
            <p className="stx-vg-hero-caption" style={{ marginTop: 14 }}>
              Maior déficit projetado (estimativa): {forecast.maiorDeficit.produtoNome} — {formatarPecas(forecast.maiorDeficit.deficitProjetado)} peças
            </p>
          )}
        </>
      )}
    </div>
  );
}
