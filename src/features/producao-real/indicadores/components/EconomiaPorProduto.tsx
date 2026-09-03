"use client";

// Economia por produto — custo industrial aproximado, margem de
// processamento e possível restrição operacional. Tudo consumido pronto
// de economico.ts (calcularEconomicoPorProduto), nenhuma fórmula aqui.
//
// Confiança (§8 da decisão): custo industrial/margem são sempre
// "aproximação" (agregado por período, sem rastreamento de lote — ver
// cabeçalho de economico.ts) e a possível restrição é sempre "estimativa"
// — ambos os rótulos aparecem só no detalhe expandido de cada linha, não
// como badge repetido em cada número.

import { useState } from "react";
import type { EconomicoProduto } from "@/features/producao-real/indicadores/economico";
import { formatarBRLIndicador, formatarPecas, formatarPercentualIndicador } from "@/features/producao-real/indicadores/format";

const TEMPLATE_COLUNAS = "1.6fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr";

export default function EconomiaPorProduto({ itens }: { itens: EconomicoProduto[] }) {
  const [expandido, setExpandido] = useState<string | null>(null);

  if (itens.length === 0) return <div className="stx-empty">Nenhum apontamento no período/filtro.</div>;

  return (
    <div className="stx-panel">
      <p className="stx-panel-title">Economia por produto</p>
      <p className="stx-panel-sub">
        Custo industrial e margem são aproximações agregadas do período (sem rastreamento de lote/WIP) — não são custo contábil exato. Receita reconhecida só na última etapa do roteiro (produtos.valor_unitario), nunca em etapa intermediária. Clique num produto para ver a possível restrição operacional (estimativa).
      </p>
      <div className="stx-ind-tabela-wrap" style={{ marginTop: 8 }}>
        <div className="stx-ind-tabela-header" style={{ gridTemplateColumns: TEMPLATE_COLUNAS }}>
          <span>Produto</span>
          <span>Prod. acabada</span>
          <span>Custo industrial/peça</span>
          <span>Receita/peça</span>
          <span>Margem/peça</span>
          <span>Margem %</span>
          <span>Margem total</span>
          <span>Margem/hora</span>
        </div>
        {itens.map((item) => {
          const aberto = expandido === item.produtoId;
          return (
            <div key={item.produtoId}>
              <div
                className="stx-ind-tabela-linha"
                style={{ gridTemplateColumns: TEMPLATE_COLUNAS }}
                onClick={() => setExpandido(aberto ? null : item.produtoId)}
              >
                <span style={{ fontFamily: "inherit" }}>{item.produtoNome || "(sem produto)"}</span>
                <span>{formatarPecas(item.custoIndustrial.producaoBoaAcabada)}</span>
                <span>{formatarBRLIndicador(item.custoIndustrial.custoIndustrialPorPecaAcabada)}</span>
                <span>{formatarBRLIndicador(item.margem.receitaPorPeca)}</span>
                <span>{formatarBRLIndicador(item.margem.margemPorPecaAcabada)}</span>
                <span>{formatarPercentualIndicador(item.margem.margemPct)}</span>
                <span>{formatarBRLIndicador(item.margem.margemTotalAproximada)}</span>
                <span>{formatarBRLIndicador(item.margem.margemPorHora)}</span>
              </div>
              {aberto && (
                <div className="stx-ind-drilldown">
                  <p className="stx-analise-secao-titulo" style={{ margin: "0 0 6px 0" }}>Possível restrição operacional (estimativa) — {item.produtoNome}</p>
                  {!item.restricao ? (
                    <p className="stx-panel-sub">Não há dados suficientes (produto com uma única etapa apontada no período, ou sem apontamentos produzindo).</p>
                  ) : (
                    <>
                      <p className="stx-panel-sub" style={{ marginBottom: 8 }}>{item.restricao.observacao}</p>
                      <div className="stx-ind-tabela-header" style={{ gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr" }}>
                        <span>Etapa</span>
                        <span>Produção boa</span>
                        <span>Performance</span>
                        <span>Sem produção na máquina?</span>
                        <span>Máquinas elegíveis</span>
                      </div>
                      {item.restricao.etapas.map((e) => (
                        <div
                          key={e.etapaId}
                          className="stx-ind-tabela-linha"
                          style={{
                            gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr",
                            cursor: "default",
                            color: item.restricao?.etapaSinalizada?.etapaId === e.etapaId ? "var(--warning)" : undefined,
                          }}
                        >
                          <span style={{ fontFamily: "inherit" }}>{e.operacaoNome}</span>
                          <span>{formatarPecas(e.producaoBoaEtapa)}</span>
                          <span>{formatarPercentualIndicador(e.performancePct)}</span>
                          <span>{e.temSemProducaoNaMaquina ? "Sim" : "Não"}</span>
                          <span>{e.maquinasElegiveis}</span>
                        </div>
                      ))}
                    </>
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
