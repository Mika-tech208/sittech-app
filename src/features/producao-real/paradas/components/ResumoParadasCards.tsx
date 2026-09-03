"use client";

// Cards principais de Paradas — sempre consome ResumoParadas já pronto de
// calculations.ts, nunca recalcula nada aqui.

import type { ResumoParadas } from "@/features/producao-real/paradas/calculations";
import { formatarBRLIndicador, formatarPecas, formatarPercentualIndicador } from "@/features/producao-real/indicadores/format";

function formatarMinutosLongo(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return "N/A";
  const arredondado = Math.round(min);
  const horas = Math.floor(arredondado / 60);
  const minutosRestantes = arredondado % 60;
  return horas > 0 ? `${arredondado} min (${horas}h${minutosRestantes > 0 ? `${minutosRestantes}min` : ""})` : `${arredondado} min`;
}

export default function ResumoParadasCards({ resumo }: { resumo: ResumoParadas }) {
  return (
    <div className="stx-panel">
      <p className="stx-panel-title">Resumo do período</p>
      <p className="stx-panel-sub">
        Minutos, quantidade, origem e motivo são fatos diretos dos apontamentos. Custo do tempo ocioso e capacidade perdida são calculados a partir dos mesmos snapshots do Motor Econômico V1 — nunca faturamento perdido.
      </p>
      <div className="stx-capacidade-reais-grid" style={{ marginTop: 12 }}>
        <div>
          <p className="stx-capacidade-reais-label">Minutos parados</p>
          <p className="stx-capacidade-reais-valor">{formatarMinutosLongo(resumo.minutosParadosTotal)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Quantidade de paradas</p>
          <p className="stx-capacidade-reais-valor">{resumo.quantidadeParadas}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Duração média</p>
          <p className="stx-capacidade-reais-valor">{formatarMinutosLongo(resumo.duracaoMediaMinutos)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Maior parada</p>
          <p className="stx-capacidade-reais-valor">{formatarMinutosLongo(resumo.maiorParadaMinutos)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Custo do tempo ocioso</p>
          <p className="stx-capacidade-reais-valor">{formatarBRLIndicador(resumo.custoTempoOciosoTotal)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Capacidade local perdida (peças)</p>
          <p className="stx-capacidade-reais-valor">{formatarPecas(resumo.capacidadePerdidaTotal)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">% do tempo apontado perdido</p>
          <p className="stx-capacidade-reais-valor">{formatarPercentualIndicador(resumo.pctTempoApontadoPerdido)}</p>
        </div>
      </div>
      <p className="stx-panel-sub" style={{ marginTop: 12 }}>
        % do tempo apontado perdido = minutos parados ÷ duração dos apontamentos produzindo do filtro — não é disponibilidade industrial da fábrica, e nunca inclui períodos &quot;sem produção&quot; nesse cálculo.
      </p>
    </div>
  );
}
