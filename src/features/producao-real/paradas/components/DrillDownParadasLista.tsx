"use client";

// Lista detalhada — cada parada individual, já com o rateio de custo/
// capacidade calculado por linha. Limite simples (mesma disciplina de
// useApontamentosRealizados) pra não virar ERP; ordenado por minutos
// desc (maiores perdas primeiro).
//
// Expansão de detalhe (migration 32) — só quando existir descricaoProblema
// ou descricaoSolucao; parada sem nenhum dos dois não é clicável, sem
// afetar a tabela compacta existente.

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { calcularCapacidadePerdidaParada, calcularCustoTempoOciosoParada, type ParadaComContexto } from "@/features/producao-real/paradas/calculations";
import { formatarBRLIndicador, formatarMinutos, formatarPecas } from "@/features/producao-real/indicadores/format";

const LIMITE = 200;
const TEMPLATE_COLUNAS = "0.9fr 0.6fr 1.1fr 1fr 1.3fr 0.8fr 0.8fr 0.9fr 0.9fr";

export default function DrillDownParadasLista({ paradas }: { paradas: ParadaComContexto[] }) {
  const [expandidoId, setExpandidoId] = useState<string | null>(null);
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
        {ordenado.map((p) => {
          const temDetalhe = Boolean(p.descricaoProblema || p.descricaoSolucao);
          const aberto = expandidoId === p.paradaId;
          return (
            <div key={p.paradaId}>
              <div
                className="stx-ind-tabela-linha"
                style={{ gridTemplateColumns: TEMPLATE_COLUNAS, cursor: temDetalhe ? "pointer" : "default" }}
                onClick={() => temDetalhe && setExpandidoId(aberto ? null : p.paradaId)}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {temDetalhe && (aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
                  {p.data.split("-").reverse().join("/")}
                </span>
                <span>{p.periodoId.toUpperCase()}</span>
                <span style={{ fontFamily: "inherit" }}>{p.maquinaNome}</span>
                <span style={{ fontFamily: "inherit" }}>{p.produtoNome || "—"}</span>
                <span style={{ fontFamily: "inherit" }}>{p.motivoNome}</span>
                <span>{p.origem === "manual" ? "Manual" : "Ocorrência"}</span>
                <span>{formatarMinutos(p.minutos)}</span>
                <span>{formatarBRLIndicador(calcularCustoTempoOciosoParada(p))}</span>
                <span>{formatarPecas(calcularCapacidadePerdidaParada(p))}</span>
              </div>
              {aberto && temDetalhe && (
                <div className="stx-panel-sub" style={{ padding: "8px 4px 12px", fontFamily: "inherit", lineHeight: 1.5 }}>
                  {p.descricaoProblema && (
                    <p style={{ margin: 0 }}><strong>Problema:</strong> {p.descricaoProblema}</p>
                  )}
                  {p.descricaoSolucao && (
                    <p style={{ margin: p.descricaoProblema ? "4px 0 0" : 0 }}><strong>Ação realizada / Solução:</strong> {p.descricaoSolucao}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
