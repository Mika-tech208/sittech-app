"use client";

// Recorrência — unidade oficial (data, periodo_id). Distingue
// visualmente evento isolado longo (poucos períodos afetados, duração
// média alta) de problema recorrente (muitos períodos afetados em
// relação ao total apontado da máquina).

import { calcularRecorrenciaParadas, type ParadaComContexto } from "@/features/producao-real/paradas/calculations";
import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import { formatarMinutos, formatarPercentualIndicador } from "@/features/producao-real/indicadores/format";

const LIMIAR_RECORRENTE_PCT = 40;

export default function RecorrenciaParadas({ paradas, apontamentos }: { paradas: ParadaComContexto[]; apontamentos: ApontamentoIndicador[] }) {
  const itens = calcularRecorrenciaParadas(paradas, apontamentos);

  if (itens.length === 0) return <div className="stx-empty">Nenhuma parada no período/filtro.</div>;

  return (
    <div>
      <p className="stx-panel-sub" style={{ marginBottom: 10 }}>
        % de períodos afetados = quantos períodos distintos (data + período) daquela máquina tiveram pelo menos uma parada daquele motivo, sobre o total de períodos apontados da máquina no filtro. Destacado em laranja quando ≥{LIMIAR_RECORRENTE_PCT}% — sinal de problema recorrente, não evento isolado.
      </p>
      <div className="stx-ind-tabela-wrap">
        <div className="stx-ind-tabela-header" style={{ gridTemplateColumns: "1.3fr 1.3fr 1fr 1fr 1fr 1fr" }}>
          <span>Máquina</span>
          <span>Motivo</span>
          <span>Períodos afetados</span>
          <span>% dos períodos</span>
          <span>Qtd. paradas</span>
          <span>Duração média</span>
        </div>
        {itens.map((item) => {
          const recorrente = (item.percentualPeriodosAfetados ?? 0) >= LIMIAR_RECORRENTE_PCT;
          return (
            <div
              key={`${item.maquinaId}::${item.motivoId}`}
              className="stx-ind-tabela-linha"
              style={{ gridTemplateColumns: "1.3fr 1.3fr 1fr 1fr 1fr 1fr", cursor: "default", color: recorrente ? "var(--warning)" : undefined }}
            >
              <span style={{ fontFamily: "inherit" }}>{item.maquinaNome}</span>
              <span style={{ fontFamily: "inherit" }}>{item.motivoNome}</span>
              <span>{item.periodosDistintosAfetados} de {item.totalPeriodosApontadosMaquina}</span>
              <span>{formatarPercentualIndicador(item.percentualPeriodosAfetados)}</span>
              <span>{item.quantidadeParadas}</span>
              <span>{formatarMinutos(item.duracaoMediaMinutos)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
