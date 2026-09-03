"use client";

// "Produtos programados" — visão consolidada por produto: Previsto,
// Possível (capacidade — calcularCapacidadeMaximaSemana, inalterado),
// Realizado, Falta e % concluído. Substitui a antiga tabela "Produção
// possível por produto" (Previsto/Possível/Diferença) que ficava dentro
// do painel de capacidade — mesmos dois primeiros números, só que agora
// ao lado do Realizado, sem duplicar a lista de produtos em dois lugares
// da tela.
//
// Realizado vem dos "Itens realizados" da própria Previsão Semanal
// (previsao_itens, tipo='realizado') — NÃO de apontamentos_producao/
// Produção Real. Decisão de negócio revertida — ver
// PrevisaoSemanalPage.tsx e o relatório desta etapa.
//
// A barra representa Realizado/Previsto (não Possível/Previsto) — se
// passar de 100%, a barra visual para no limite do componente mas o
// texto continua mostrando o número real (ex.: 108%).

import type { ProdutoProgramado, ProdutoNaoPrevisto, ResumoProgramacaoPecas } from "@/features/previsao/realizado";
import { formatQtd } from "@/lib/format";

export interface ProdutosProgramadosProps {
  produtos: ProdutoProgramado[];
  naoPrevistos: ProdutoNaoPrevisto[];
  resumoPecas: ResumoProgramacaoPecas;
}

export default function ProdutosProgramados({ produtos, naoPrevistos, resumoPecas }: ProdutosProgramadosProps) {
  if (produtos.length === 0) return null;

  return (
    <div className="stx-panel">
      <div className="stx-panel-title-row">
        <p className="stx-panel-title">Produtos programados</p>
      </div>
      <p className="stx-panel-sub">
        Previsto, possível (capacidade) e realizado (conforme lançamentos da previsão, em &quot;Itens realizados&quot;) de cada produto da semana.
      </p>

      {resumoPecas.totalPrevisto > 0 && (
        <p className="stx-custos-total" style={{ marginBottom: 14 }}>
          {formatQtd(resumoPecas.totalPrevisto)} peças previstas · {formatQtd(resumoPecas.totalRealizado)} realizadas
          {" · "}
          <b>{resumoPecas.concluidoPct === null ? "N/A" : `${resumoPecas.concluidoPct.toFixed(0)}%`}</b> concluído
          <span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: 11.5 }}> (soma simples de peças entre produtos — indicador de acompanhamento, não de capacidade)</span>
        </p>
      )}

      {produtos.map((p) => {
        const pctTexto = p.concluidoPct === null ? "N/A" : `${p.concluidoPct.toFixed(0)}% concluído`;
        const pctBarra = p.concluidoPct === null ? 0 : Math.min(100, Math.max(0, p.concluidoPct));
        return (
          <div className="stx-produto-programado" key={p.itemId}>
            <p className="stx-entry-desc" style={{ marginBottom: 8 }}>{p.produtoNome}</p>
            <div className="stx-produto-programado-grid">
              <div>
                <p className="stx-capacidade-reais-label">Previsto</p>
                <p className="stx-produto-programado-valor">{formatQtd(p.previsto)}</p>
              </div>
              <div>
                <p className="stx-capacidade-reais-label">Possível</p>
                <p className="stx-produto-programado-valor">{formatQtd(p.possivel)}</p>
              </div>
              <div>
                <p className="stx-capacidade-reais-label">Realizado</p>
                <p className="stx-produto-programado-valor" style={{ color: "var(--accent)" }}>{formatQtd(p.realizado)}</p>
              </div>
              <div>
                <p className="stx-capacidade-reais-label">Falta</p>
                <p className="stx-produto-programado-valor" style={{ color: p.falta > 0 ? "var(--warning)" : "var(--accent)" }}>{formatQtd(p.falta)}</p>
              </div>
            </div>
            <div className="stx-analise-barra-bg" style={{ marginTop: 8 }}>
              <div className="stx-analise-barra-fill stx-status-normal" style={{ width: `${pctBarra}%` }} />
            </div>
            <p className="stx-analise-maquina-detalhe">{pctTexto}</p>
          </div>
        );
      })}

      {naoPrevistos.length > 0 && (
        <div className="stx-analise-lista">
          <p className="stx-analise-secao-titulo">Produzido fora da previsão</p>
          <p className="stx-panel-sub" style={{ margin: "0 0 8px 0" }}>
            Teve item realizado lançado essa semana, mas não estava programado — não conta pra nenhum número acima.
          </p>
          {naoPrevistos.map((p) => (
            <div className="stx-tabela-producao-linha" key={p.produtoId} style={{ gridTemplateColumns: "2fr 1fr" }}>
              <span>{p.produtoNome}</span>
              <span>{formatQtd(p.realizado)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
