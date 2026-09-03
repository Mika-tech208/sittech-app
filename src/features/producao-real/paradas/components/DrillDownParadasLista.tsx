"use client";

// Lista detalhada — cada parada individual, já com o rateio de custo/
// capacidade calculado por linha. Limite simples (mesma disciplina de
// useApontamentosRealizados) pra não virar ERP; ordenado por minutos
// desc (maiores perdas primeiro).

import { calcularCapacidadePerdidaParada, calcularCustoTempoOciosoParada, type ParadaComContexto } from "@/features/producao-real/paradas/calculations";
import { formatarBRLIndicador, formatarMinutos, formatarPecas } from "@/features/producao-real/indicadores/format";

const LIMITE = 200;
const TEMPLATE_COLUNAS = "0.9fr 0.6fr 1.1fr 1fr 1.3fr 0.8fr 0.8fr 0.9fr 0.9fr";

export default function DrillDownParadasLista({ paradas }: { paradas: ParadaComContexto[] }) {
  const ordenado = [...paradas].sort((a, b) => b.minutos - a.minutos).slice(0, LIMITE);

  if (paradas.length === 0) return <div className="stx-empty">Nenhuma parada no período/filtro.</div>;

  return (
    <div>
      {paradas.length > LIMITE && (
        <p className="stx-panel-sub" style={{ marginBottom: 8 }}>Mostrando as {LIMITE} maiores paradas do filtro — refine os filtros pra ver outras.</p>
      )}
      <div className="stx-ind-tabela-wrap">
        <div className="stx-ind-tabela-header" style={{ gridTemplateColumns: TEMPLATE_COLUNAS }}>
          <span>Data</span>
          <span>Período</span>
          <span>Máquina</span>
          <span>Produto</span>
          <span>Motivo</span>
          <span>Origem</span>
          <span>Minutos</span>
          <span>Custo ocioso</span>
          <span>Cap. perdida</span>
        </div>
        {ordenado.map((p) => (
          <div key={p.paradaId} className="stx-ind-tabela-linha" style={{ gridTemplateColumns: TEMPLATE_COLUNAS, cursor: "default" }}>
            <span>{p.data.split("-").reverse().join("/")}</span>
            <span>{p.periodoId.toUpperCase()}</span>
            <span style={{ fontFamily: "inherit" }}>{p.maquinaNome}</span>
            <span style={{ fontFamily: "inherit" }}>{p.produtoNome || "—"}</span>
            <span style={{ fontFamily: "inherit" }}>{p.motivoNome}</span>
            <span>{p.origem === "manual" ? "Manual" : "Ocorrência"}</span>
            <span>{formatarMinutos(p.minutos)}</span>
            <span>{formatarBRLIndicador(calcularCustoTempoOciosoParada(p))}</span>
            <span>{formatarPecas(calcularCapacidadePerdidaParada(p))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
