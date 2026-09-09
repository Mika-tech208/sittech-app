"use client";

// Faixa 5 — Paradas (§10, aprovado). Números executivos, cada um de sua
// unidade — minutos, R$ (custo do tempo ocioso), peças (capacidade local
// perdida) — nunca somados/misturados entre si. "Impacto econômico
// estimado" é a EXCEÇÃO deliberada: soma, parada a parada, de custo do
// tempo ocioso + valor de produção não realizada (sempre ESTIMATIVA,
// nunca faturamento/receita/prejuízo real) — só entram paradas com as
// duas partes calculáveis; se ALGUMAS ficarem de fora por falta de
// contexto, o total existe mas fica marcado "(parcial)" com a contagem
// logo abaixo (nunca finge estar completo); se NENHUMA for calculável, é
// null ("N/A"). A barra de composição usa as maiores fatias do MESMO
// pareto de motivos já calculado em calcularParetoParadasPorMetrica
// (percentualDoTotal oficial, nunca recalculado aqui) — Pareto completo
// continua exclusivo da tela própria de Paradas.

import { useRouter } from "next/navigation";
import type { DowntimeResumo } from "@/features/producao-real/visao-geral/types";
import { formatarMinutos, formatarPecas } from "@/features/producao-real/indicadores/format";
import { formatBRL } from "@/lib/format";

const CORES_FATIA = ["var(--accent)", "var(--accent-deep)", "var(--warning)", "#B87A33", "var(--faint)"];

export default function ParadasResumoCard({ downtime, drillDown }: { downtime: DowntimeResumo; drillDown: { dataInicial: string; dataFinal: string } }) {
  const router = useRouter();

  function verParadas() {
    const qs = new URLSearchParams();
    qs.set("dataInicial", drillDown.dataInicial);
    qs.set("dataFinal", drillDown.dataFinal);
    router.push(`/producao-real/paradas?${qs.toString()}`);
  }

  return (
    <div>
      <div className="stx-vg-ctx-head">
        <h2 className="stx-vg-ctx-title">Paradas</h2>
        <button type="button" className="stx-vg-section-link" onClick={verParadas}>Ver →</button>
      </div>

      {!downtime.temDados ? (
        <p className="stx-vg-empty">0 min parado no período.</p>
      ) : (
        <>
          <div className="stx-vg-stat-list">
            <div className="stx-vg-stat-row">
              <span className="stx-vg-stat-label">Minutos parados</span>
              <span className="stx-vg-stat-value">{formatarMinutos(downtime.minutosParadosTotal)}</span>
            </div>
            <div className="stx-vg-stat-row">
              <span className="stx-vg-stat-label">Custo do tempo ocioso</span>
              <span className="stx-vg-stat-value">{downtime.custoTempoOciosoTotal !== null ? formatBRL(downtime.custoTempoOciosoTotal) : "N/A"}</span>
            </div>
            <div className="stx-vg-stat-row">
              <span className="stx-vg-stat-label">Capacidade local perdida</span>
              <span className="stx-vg-stat-value">{downtime.capacidadePerdidaTotal !== null ? formatarPecas(downtime.capacidadePerdidaTotal) : "N/A"} pç</span>
            </div>
            <div className="stx-vg-stat-row">
              <span className="stx-vg-stat-label">
                Impacto econômico estimado{downtime.impactoParcial ? " (parcial)" : ""}
              </span>
              <span className="stx-vg-stat-value">{downtime.impactoEconomicoEstimadoTotal !== null ? formatBRL(downtime.impactoEconomicoEstimadoTotal) : "N/A"}</span>
            </div>
            {downtime.impactoParcial && (
              <p className="stx-vg-empty" style={{ margin: 0, fontSize: 11 }}>
                {downtime.quantidadeSemContextoEconomico} parada{downtime.quantidadeSemContextoEconomico > 1 ? "s" : ""} sem contexto econômico
              </p>
            )}
            {downtime.maquinaMaisAfetada && (
              <div className="stx-vg-stat-row">
                <span className="stx-vg-stat-label">Máquina mais afetada</span>
                <span className="stx-vg-stat-value">{downtime.maquinaMaisAfetada.maquinaNome}</span>
              </div>
            )}
          </div>

          {downtime.paretoPorMotivo.length > 0 && (
            <>
              <div className="stx-vg-stacked-bar">
                {downtime.paretoPorMotivo.map((f, i) => (
                  <span key={f.motivoNome} style={{ flex: Math.max(f.percentualDoTotal, 1), background: CORES_FATIA[i % CORES_FATIA.length] }} />
                ))}
              </div>
              <div className="stx-vg-stacked-legend">
                {downtime.paretoPorMotivo.map((f) => `${f.motivoNome} ${f.percentualDoTotal.toFixed(0)}%`).join(" · ")}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
