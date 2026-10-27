"use client";

// METODOLOGIA HISTÓRICA (Realizado manual) — componente anterior à feature do Apontado real, usado só para semanas anteriores a APONTADO_REAL_PROGRESSO_DESDE (vigencia.ts).

// "Itens previstos" (tabela de comparação) — visão consolidada por
// produto: Previsto, Possível (capacidade — calcularCapacidadeMaximaSemana,
// inalterado), Realizado, Falta e % concluído. Substitui a antiga tabela
// "Produção possível por produto" (Previsto/Possível/Diferença) que ficava
// dentro do painel de capacidade — mesmos dois primeiros números, só que
// agora ao lado do Realizado, sem duplicar a lista de produtos em dois
// lugares da tela.
//
// A coluna "Apontado real" (diagnóstico) vem dos apontamentos da ÚLTIMA etapa do roteiro (ver apontadoReal.ts) e NÃO participa de Falta/%.
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

import type { ProdutoProgramadoLegado, ProdutoNaoPrevistoLegado, ResumoProgramacaoPecasLegado } from "@/features/previsao/progressoLegado";
import { formatQtd } from "@/lib/format";

export interface ProdutosProgramadosLegadoProps {
  produtos: ProdutoProgramadoLegado[];
  naoPrevistos: ProdutoNaoPrevistoLegado[];
  resumoPecas: ResumoProgramacaoPecasLegado;
}

export default function ProdutosProgramadosLegado({ produtos, naoPrevistos, resumoPecas }: ProdutosProgramadosLegadoProps) {
  if (produtos.length === 0) return null;

  return (
    <div className="stx-prev-section stx-prev-legado">
      <div className="stx-prev-section-head">
        <h2 className="stx-prev-section-title">Itens previstos</h2>
      </div>

      <div className="stx-prev-table-head">
        <span>Produto</span>
        <span className="num">Previsto</span>
        <span className="num">Possível</span>
        <span className="num">Realizado</span>
        <span className="num" title="Produção concluída calculada automaticamente pelos apontamentos da última etapa do roteiro (peças boas: produzido − refugo). Só diagnóstico: não entra em Falta, % nem no resultado financeiro.">Apontado real</span>
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
            <span className="num" style={{ color: "var(--text-2)" }}>
              {p.apontadoAmbiguoPecas > 0 && (
                <span title={`${formatQtd(p.apontadoAmbiguoPecas)} peças de apontamentos feitos antes de uma alteração do roteiro NÃO foram contadas (não dá para saber com segurança se eram da etapa final).`} style={{ color: "var(--warning)", marginRight: 4, cursor: "help" }}>⚠</span>
              )}
              {p.apontadoReal === null ? "—" : formatQtd(p.apontadoReal)}
            </span>
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
          <span className="num">{resumoPecas.totalApontadoReal === null ? "—" : formatQtd(resumoPecas.totalApontadoReal)}</span>
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
