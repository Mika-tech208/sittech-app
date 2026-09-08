"use client";

// "Itens previstos" (tabela de comparação) — visão consolidada por
// produto: Previsto, Possível (capacidade — calcularCapacidadeMaximaSemana,
// inalterado), Realizado, Falta e % concluído. Substitui a antiga tabela
// "Produção possível por produto" (Previsto/Possível/Diferença) que ficava
// dentro do painel de capacidade — mesmos dois primeiros números, só que
// agora ao lado do Realizado, sem duplicar a lista de produtos em dois
// lugares da tela.
//
// Realizado vem dos "Itens realizados" da própria Previsão Semanal
// (previsao_itens, tipo='realizado') — NÃO de apontamentos_producao/
// Produção Real. Decisão de negócio revertida — ver PrevisaoSemanalPage.tsx
// e o relatório desta etapa. Por isso a tabela não expande linha (não há
// dado de Produção Real aqui pra mostrar — misturar seria contrariar a
// regra de negócio).
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
    <div className="stx-prev-section">
      <div className="stx-prev-section-head">
        <h2 className="stx-prev-section-title">Itens previstos</h2>
      </div>

      <div className="stx-prev-table-head">
        <span>Produto</span>
        <span className="num">Previsto</span>
        <span className="num">Possível</span>
        <span className="num">Realizado</span>
        <span className="num">Falta</span>
        <span className="num">%</span>
      </div>

      {produtos.map((p) => {
        const pctTexto = p.concluidoPct === null ? "N/A" : `${p.concluidoPct.toFixed(0)}%`;
        const pctBarra = p.concluidoPct === null ? 0 : Math.min(100, Math.max(0, p.concluidoPct));
        return (
          <div className="stx-prev-table-row" key={p.itemId}>
            <span>{p.produtoNome}</span>
            <span className="num">{formatQtd(p.previsto)}</span>
            <span className="num">{formatQtd(p.possivel)}</span>
            <span className="num" style={{ color: "var(--accent)" }}>{formatQtd(p.realizado)}</span>
            <span className="num" style={{ color: p.falta > 0 ? "var(--warning)" : "var(--text-3)" }}>{formatQtd(p.falta)}</span>
            <span className="stx-prev-bar-cell">
              <span className="num">{pctTexto}</span>
              <span className="stx-prev-bar-track">
                <span className="stx-prev-bar-fill" style={{ width: `${pctBarra}%`, background: p.concluidoPct !== null && p.concluidoPct >= 100 ? "var(--accent)" : "var(--text-3)" }} />
              </span>
            </span>
          </div>
        );
      })}

      {resumoPecas.totalPrevisto > 0 && (
        <div className="stx-prev-table-row total">
          <span>Total</span>
          <span className="num">{formatQtd(resumoPecas.totalPrevisto)}</span>
          <span className="num">{formatQtd(resumoPecas.totalPossivel)}</span>
          <span className="num">{formatQtd(resumoPecas.totalRealizado)}</span>
          <span className="num">{formatQtd(resumoPecas.totalFalta)}</span>
          <span className="num">{resumoPecas.concluidoPct === null ? "N/A" : `${resumoPecas.concluidoPct.toFixed(0)}%`}</span>
        </div>
      )}

      {naoPrevistos.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <p className="stx-prev-section-title" style={{ fontSize: 14 }}>Produzido fora da previsão</p>
          <p className="stx-prev-ref" style={{ margin: "4px 0 10px" }}>
            Teve item realizado lançado essa semana, mas não estava programado — não conta pra nenhum número acima.
          </p>
          {naoPrevistos.map((p) => (
            <div className="stx-prev-table-row" key={p.produtoId} style={{ gridTemplateColumns: "1.7fr 90px" }}>
              <span>{p.produtoNome}</span>
              <span className="num">{formatQtd(p.realizado)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
