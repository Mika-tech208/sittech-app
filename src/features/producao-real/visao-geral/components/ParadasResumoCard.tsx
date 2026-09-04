"use client";

// Faixa 5 — Paradas (§10, aprovado). 4 números executivos, cada um de
// sua unidade — minutos, motivo (contagem), máquina (minutos), peças
// (capacidade local perdida) — nunca somados/misturados. Sem Pareto
// completo aqui (isso fica só na tela própria de Paradas).

import { useRouter } from "next/navigation";
import type { DowntimeResumo } from "@/features/producao-real/visao-geral/types";
import { formatarMinutos, formatarPecas } from "@/features/producao-real/indicadores/format";

export default function ParadasResumoCard({ downtime, drillDown }: { downtime: DowntimeResumo; drillDown: { dataInicial: string; dataFinal: string } }) {
  const router = useRouter();

  function verParadas() {
    const qs = new URLSearchParams();
    qs.set("dataInicial", drillDown.dataInicial);
    qs.set("dataFinal", drillDown.dataFinal);
    router.push(`/producao-real/paradas?${qs.toString()}`);
  }

  return (
    <div className="stx-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p className="stx-panel-title">Paradas</p>
          <p className="stx-panel-sub">{downtime.janela.rotulo}</p>
        </div>
        <button type="button" className="stx-btn-secondary" onClick={verParadas}>Ver Paradas</button>
      </div>

      {!downtime.temDados ? (
        <p className="stx-panel-sub" style={{ marginTop: 6 }}>0 min parado no período.</p>
      ) : (
        <div className="stx-capacidade-reais-grid" style={{ marginTop: 10 }}>
          <div>
            <p className="stx-panel-sub">Tempo parado</p>
            <p className="stx-panel-title">{formatarMinutos(downtime.minutosParadosTotal)}</p>
          </div>
          <div>
            <p className="stx-panel-sub">Principal motivo</p>
            <p className="stx-panel-title">{downtime.principalMotivo ? `${downtime.principalMotivo.motivoNome} (${formatarMinutos(downtime.principalMotivo.minutos)})` : "—"}</p>
          </div>
          <div>
            <p className="stx-panel-sub">Máquina mais afetada</p>
            <p className="stx-panel-title">{downtime.maquinaMaisAfetada ? `${downtime.maquinaMaisAfetada.maquinaNome} (${formatarMinutos(downtime.maquinaMaisAfetada.minutos)})` : "—"}</p>
          </div>
          <div>
            <p className="stx-panel-sub">Capacidade local perdida (peças)</p>
            <p className="stx-panel-title">{downtime.capacidadePerdidaTotal !== null ? formatarPecas(downtime.capacidadePerdidaTotal) : "N/A"}</p>
          </div>
        </div>
      )}
    </div>
  );
}
