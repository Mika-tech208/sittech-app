"use client";

// "Itens previstos" (tabela de comparação) — visão consolidada por produto: Previsto, Possível (capacidade — calcularCapacidadeMaximaSemana,
// inalterado), Apontado real, Falta e % concluído.
//
// ANDAMENTO = APONTADO REAL (Produção Real; só produção boa da última etapa válida do produto — ver apontadoReal.ts). Falta = max(Previsto − Apontado, 0);
// % = Apontado / Previsto, sem teto em 100. O Realizado digitado à mão NÃO aparece nem soma aqui (ver progressoSemana.ts). Possível é capacidade, não andamento.
// A barra representa Apontado/Previsto: passa de 100% no texto, e a barra visual para no limite do componente.

import type { ProdutoProgramado, ProdutoNaoPrevisto, ResumoProgramacaoPecas } from "@/features/previsao/progressoSemana";
import { formatQtd } from "@/lib/format";
import { formatPct } from "@/features/previsao/formatPct";

export interface ProdutosProgramadosProps {
  produtos: ProdutoProgramado[];
  naoPrevistos: ProdutoNaoPrevisto[];
  resumoPecas: ResumoProgramacaoPecas;
  apontadoIndisponivel?: string | null; // mensagem quando o apontado real não pôde ser carregado
}

const qtdOuTraco = (v: number | null) => (v === null ? "—" : formatQtd(v));

export default function ProdutosProgramados({ produtos, naoPrevistos, resumoPecas, apontadoIndisponivel }: ProdutosProgramadosProps) {
  if (produtos.length === 0) return null;

  return (
    <div className="stx-prev-section">
      <div className="stx-prev-section-head">
        <h2 className="stx-prev-section-title">Itens previstos</h2>
      </div>
      {apontadoIndisponivel && <p className="stx-prev-ref" style={{ color: "var(--danger)", margin: "0 0 10px" }}>{apontadoIndisponivel} Falta e % ficam indisponíveis até carregar.</p>}

      <div className="stx-prev-table-head">
        <span>Produto</span>
        <span className="num">Previsto</span>
        <span className="num" title="Capacidade (atingibilidade) — não é andamento.">Possível</span>
        <span className="num" title="Produção concluída calculada automaticamente pelos apontamentos da última etapa do roteiro (peças boas: produzido − refugo). Atualiza sozinho quando um apontamento é registrado ou corrigido.">Apontado real</span>
        <span className="num">Falta</span>
        <span className="num">%</span>
      </div>

      {produtos.map((p) => {
        const pctBarra = p.concluidoPct === null ? 0 : Math.min(100, Math.max(0, p.concluidoPct));
        return (
          <div className="stx-prev-table-row" key={p.itemId}>
            <span>{p.produtoNome}</span>
            <span className="num">{formatQtd(p.previsto)}</span>
            <span className="num">{formatQtd(p.possivel)}</span>
            <span className="num" style={{ color: "var(--accent)" }}>
              {p.apontadoAmbiguoPecas > 0 && (
                <span title={`${formatQtd(p.apontadoAmbiguoPecas)} peças de apontamentos feitos antes de uma alteração do roteiro NÃO foram contadas (não dá para saber com segurança se eram da etapa final).`} style={{ color: "var(--warning)", marginRight: 4, cursor: "help" }}>⚠</span>
              )}
              {qtdOuTraco(p.apontadoReal)}
            </span>
            <span className="num" style={{ color: p.falta !== null && p.falta > 0 ? "var(--warning)" : "var(--text-3)" }}>{qtdOuTraco(p.falta)}</span>
            <span className="stx-prev-bar-cell">
              <span className="num">{formatPct(p.concluidoPct)}</span>
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
          <span className="num">{qtdOuTraco(resumoPecas.totalApontadoReal)}</span>
          <span className="num">{qtdOuTraco(resumoPecas.totalFalta)}</span>
          <span className="num">{formatPct(resumoPecas.concluidoPct)}</span>
        </div>
      )}
      {resumoPecas.totalFalta !== null && resumoPecas.somaFaltasPorProduto !== null && resumoPecas.somaFaltasPorProduto !== resumoPecas.totalFalta && (
        <p className="stx-prev-ref" style={{ margin: "8px 0 0" }}>
          Falta total = Previsto total − Apontado real total. Produto produzido acima do previsto abate a falta do total, por isso ela difere da soma das faltas por produto ({formatQtd(resumoPecas.somaFaltasPorProduto)}).
        </p>
      )}

      {naoPrevistos.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <p className="stx-prev-section-title" style={{ fontSize: 14 }}>Produzido fora da previsão</p>
          <p className="stx-prev-ref" style={{ margin: "4px 0 10px" }}>
            Teve apontado real essa semana, mas não estava programado — não conta pra nenhum número acima.
          </p>
          {naoPrevistos.map((p) => (
            <div className="stx-prev-table-row" key={p.produtoId} style={{ gridTemplateColumns: "1.7fr 90px" }}>
              <span>{p.produtoNome}</span>
              <span className="num">{formatQtd(p.apontadoReal)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
