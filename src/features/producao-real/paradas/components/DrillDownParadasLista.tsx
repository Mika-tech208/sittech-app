"use client";

// Lista detalhada — paradas manuais continuam uma linha por registro,
// exatamente como antes. Paradas de ORIGEM OCORRÊNCIA são agrupadas por
// ocorrencia_id (migration 34, "uma ocorrencia_maquina = uma parada real
// na interface") — a divisão por período existe só internamente
// (calcularCapacidadePerdidaParada/Trecho por segmento, somados) e no
// drill-down opcional; a linha principal mostra duração REAL
// (encerradaEm − abertaEm) e os totais já somados. Limite simples (mesma
// disciplina de useApontamentosRealizados) pra não virar ERP; ordenado
// por minutos/duração desc (maiores perdas primeiro).
//
// Expansão de detalhe — parada manual só quando existir descricaoProblema
// ou descricaoSolucao; card de ocorrência sempre expansível (tem
// problema/solução garantidos + distribuição por segmento).
//
// "Valor de produção não realizada" (migration 36) — coluna sempre
// marcada "(estimativa)" no cabeçalho, mesmo pra segmento real: é uma
// alocação gerencial de valor por esforço-tempo padrão da operação, não
// um fato financeiro. Fica sempre separada de "Custo ocioso" na tabela
// compacta — "Impacto econômico estimado" (migration 37, custo ocioso +
// valor não realizado) só aparece no card expandido da ocorrência, nunca
// como coluna, e nunca chamado de prejuízo/perda/faturamento perdido.

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  calcularCapacidadePerdidaParada, calcularCustoTempoOciosoParada, calcularValorProducaoNaoRealizadaParada,
  agruparParadasPorOcorrencia,
  type ParadaComContexto, type TrechoOcorrenciaSemApontamento, type OcorrenciaAgrupada,
} from "@/features/producao-real/paradas/calculations";
import { formatarBRLIndicador, formatarMinutos, formatarPecas } from "@/features/producao-real/indicadores/format";

const LIMITE = 200;
const TEMPLATE_COLUNAS = "0.9fr 0.6fr 1.1fr 1fr 1.3fr 1.1fr 0.8fr 0.8fr 0.9fr 1.1fr";

function formatarHorario(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

function formatarDataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
}

function formatarMinutosDecimal(min: number): string {
  return `${min.toFixed(1).replace(".", ",")} min`;
}

type Linha =
  | { tipo: "manual"; chave: string; minutos: number; parada: ParadaComContexto }
  | { tipo: "ocorrencia"; chave: string; minutos: number; grupo: OcorrenciaAgrupada };

export default function DrillDownParadasLista({
  paradas,
  trechosSemApontamento = [],
}: {
  paradas: ParadaComContexto[];
  trechosSemApontamento?: TrechoOcorrenciaSemApontamento[];
}) {
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  const paradasManuais = paradas.filter((p) => p.origem === "manual");
  const paradasOcorrencia = paradas.filter((p) => p.origem === "ocorrencia");
  const ocorrenciasAgrupadas = agruparParadasPorOcorrencia(paradasOcorrencia, trechosSemApontamento);

  const linhas: Linha[] = [
    ...paradasManuais.map((p): Linha => ({ tipo: "manual", chave: p.paradaId, minutos: p.minutos, parada: p })),
    ...ocorrenciasAgrupadas.map((g): Linha => ({ tipo: "ocorrencia", chave: g.ocorrenciaId, minutos: g.duracaoTotalMinutos, grupo: g })),
  ];
  const ordenado = linhas.sort((a, b) => b.minutos - a.minutos).slice(0, LIMITE);

  if (linhas.length === 0) return <div className="stx-empty">Nenhuma parada no período/filtro.</div>;

  return (
    <div>
      {linhas.length > LIMITE && (
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
          <span>Valor não realizado (estimativa)</span>
        </div>
        {ordenado.map((linha) => {
          if (linha.tipo === "manual") {
            const p = linha.parada;
            const temDetalhe = Boolean(p.descricaoProblema || p.descricaoSolucao);
            const aberto = expandidoId === linha.chave;
            return (
              <div key={linha.chave}>
                <div
                  className="stx-ind-tabela-linha"
                  style={{ gridTemplateColumns: TEMPLATE_COLUNAS, cursor: temDetalhe ? "pointer" : "default" }}
                  onClick={() => temDetalhe && setExpandidoId(aberto ? null : linha.chave)}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {temDetalhe && (aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
                    {p.data.split("-").reverse().join("/")}
                  </span>
                  <span>{p.periodoId.toUpperCase()}</span>
                  <span style={{ fontFamily: "inherit" }}>{p.maquinaNome}</span>
                  <span style={{ fontFamily: "inherit" }}>{p.produtoNome || "—"}</span>
                  <span style={{ fontFamily: "inherit" }}>{p.motivoNome}</span>
                  <span>Manual</span>
                  <span>{formatarMinutos(p.minutos)}</span>
                  <span>{formatarBRLIndicador(calcularCustoTempoOciosoParada(p))}</span>
                  <span>{formatarPecas(calcularCapacidadePerdidaParada(p))}</span>
                  <span>{formatarBRLIndicador(calcularValorProducaoNaoRealizadaParada(p))}</span>
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
          }

          const g = linha.grupo;
          const aberto = expandidoId === linha.chave;
          return (
            <div key={linha.chave}>
              <div
                className="stx-ind-tabela-linha"
                style={{ gridTemplateColumns: TEMPLATE_COLUNAS, cursor: "pointer" }}
                onClick={() => setExpandidoId(aberto ? null : linha.chave)}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  {formatarDataCurta(g.abertaEm)}
                </span>
                <span>—</span>
                <span style={{ fontFamily: "inherit" }}>{g.maquinaNome}</span>
                <span style={{ fontFamily: "inherit" }}>—</span>
                <span style={{ fontFamily: "inherit" }}>{g.motivoNome}</span>
                <span>
                  Ocorrência
                  {g.temEstimativa && <span style={{ fontStyle: "italic", opacity: 0.75 }}> · c/ estimativa</span>}
                </span>
                <span>{formatarMinutosDecimal(g.duracaoTotalMinutos)}</span>
                <span>{formatarBRLIndicador(g.custoTempoOciosoTotal)}</span>
                <span>{formatarPecas(g.capacidadePerdidaTotal)}</span>
                <span>{formatarBRLIndicador(g.valorProducaoNaoRealizadaTotal)}</span>
              </div>
              {aberto && (
                <div className="stx-panel-sub" style={{ padding: "8px 4px 12px", fontFamily: "inherit", lineHeight: 1.5 }}>
                  <p style={{ margin: 0 }}>
                    {g.maquinaNome} — {g.motivoNome} · {formatarHorario(g.abertaEm)} → {formatarHorario(g.encerradaEm)} ({formatarMinutosDecimal(g.duracaoTotalMinutos)} reais)
                  </p>
                  {g.descricaoProblema && (
                    <p style={{ margin: "4px 0 0" }}><strong>Problema:</strong> {g.descricaoProblema}</p>
                  )}
                  {g.descricaoSolucao && (
                    <p style={{ margin: "4px 0 0" }}><strong>Ação realizada / Solução:</strong> {g.descricaoSolucao}</p>
                  )}
                  {g.temEstimativa && (
                    <p style={{ margin: "8px 0 0", fontStyle: "italic" }}>
                      Capacidade perdida inclui trecho(s) ESTIMADO(S) — produto presumido do último apontamento anterior da máquina, meta real do cadastro pra esse produto. Custo do tempo ocioso não inclui esse trecho (sem contexto suficiente de operação/funcionário).
                    </p>
                  )}
                  {g.valorProducaoNaoRealizadaTotal !== null && (
                    <p style={{ margin: "4px 0 0", fontStyle: "italic" }}>
                      Valor de produção não realizada é sempre ESTIMATIVA — peso por esforço-tempo padrão da operação (calculado com custo/hora, meta e roteiro vigentes agora), nunca faturamento/receita real.
                    </p>
                  )}
                  <div style={{ margin: "8px 0 0", padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 6 }}>
                    <p style={{ margin: 0 }}>Custo do tempo ocioso: <strong>{formatarBRLIndicador(g.custoTempoOciosoTotal)}</strong></p>
                    <p style={{ margin: "2px 0 0" }}>Valor de produção não realizada: <strong>{formatarBRLIndicador(g.valorProducaoNaoRealizadaTotal)}</strong></p>
                    <p style={{ margin: "2px 0 0" }}>Impacto econômico estimado: <strong>{formatarBRLIndicador(g.impactoEconomicoEstimadoTotal)}</strong></p>
                  </div>
                  <p style={{ margin: "8px 0 0", opacity: 0.75 }}>Distribuição por período:</p>
                  {g.segmentos.map((s) => (
                    <p key={s.chave} style={{ margin: "2px 0 0" }}>
                      {s.periodoId.toUpperCase()} — {formatarMinutos(s.minutos)} — {s.produtoNome || "—"} — {s.real ? "real" : "estimativa"} — {formatarBRLIndicador(s.valorProducaoNaoRealizada)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
