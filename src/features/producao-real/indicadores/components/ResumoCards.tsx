"use client";

// Cards do resumo geral — SEMPRE consome ResumoIndicadores já pronto de
// calculations.ts, nunca recalcula nada aqui. Produção Acabada e Produção
// Processada nunca aparecem como um único número gigante: as duas vêm
// sempre acompanhadas do detalhamento por produto (ver ponto 2 do pedido
// — somar peças de produtos diferentes é útil como volume, não como
// leitura de capacidade/valor).

import type { ResumoIndicadores } from "@/features/producao-real/indicadores/calculations";
import { formatarMinutos, formatarPecas, formatarPercentualIndicador } from "@/features/producao-real/indicadores/format";

function CardBreakdown({ titulo, itens, vazio }: { titulo: string; itens: { produtoNome: string; quantidade: number }[]; vazio: string }) {
  if (itens.length === 0) return <p className="stx-panel-sub" style={{ margin: "6px 0 0 0" }}>{vazio}</p>;
  return (
    <div style={{ marginTop: 8 }}>
      <p className="stx-analise-secao-titulo" style={{ margin: "0 0 6px 0" }}>{titulo}</p>
      {itens.map((it) => (
        <div key={it.produtoNome} className="stx-tabela-producao-linha" style={{ gridTemplateColumns: "2fr 1fr" }}>
          <span>{it.produtoNome || "(sem produto)"}</span>
          <span>{formatarPecas(it.quantidade)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ResumoCards({ resumo }: { resumo: ResumoIndicadores }) {
  return (
    <div className="stx-panel">
      <p className="stx-panel-title">Produção acabada</p>
      <p className="stx-panel-sub">
        Quantidade boa (produzida − refugo) somente da última etapa do roteiro de cada produto — nunca soma etapa intermediária.
      </p>
      <p className="stx-produto-programado-valor" style={{ fontSize: 26, color: "var(--accent)" }}>{formatarPecas(resumo.producaoAcabadaTotal)} peças</p>
      <CardBreakdown titulo="Por produto" itens={resumo.producaoAcabadaPorProduto} vazio="Nenhuma produção acabada no período/filtro." />

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <p className="stx-analise-secao-titulo" style={{ margin: "0 0 4px 0" }}>Produção processada (volume operacional)</p>
        <p className="stx-panel-sub" style={{ margin: "0 0 8px 0" }}>
          Soma bruta de peças produzidas em qualquer etapa — mede atividade das máquinas/operações, não produto pronto. Somar produtos diferentes aqui não representa capacidade nem valor econômico; use o detalhamento por produto abaixo.
        </p>
        <p className="stx-produto-programado-valor" style={{ fontSize: 18 }}>{formatarPecas(resumo.producaoProcessadaTotal)} peças (bruto)</p>
        <CardBreakdown titulo="Por produto" itens={resumo.producaoProcessadaPorProduto} vazio="Nenhum apontamento no período/filtro." />
      </div>

      <div className="stx-capacidade-reais-grid" style={{ marginTop: 20 }}>
        <div>
          <p className="stx-capacidade-reais-label">Refugo</p>
          <p className="stx-capacidade-reais-valor">{formatarPecas(resumo.refugoTotal)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Qualidade</p>
          <p className="stx-capacidade-reais-valor">{formatarPercentualIndicador(resumo.qualidadePct)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Performance</p>
          <p className="stx-capacidade-reais-valor">{formatarPercentualIndicador(resumo.performancePct)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Disponibilidade (períodos apontados)</p>
          <p className="stx-capacidade-reais-valor">{formatarPercentualIndicador(resumo.disponibilidadePct)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">OEE</p>
          <p className="stx-capacidade-reais-valor">{formatarPercentualIndicador(resumo.oeePct)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Minutos de parada</p>
          <p className="stx-capacidade-reais-valor">{formatarMinutos(resumo.minutosParadosTotais)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Quantidade de paradas</p>
          <p className="stx-capacidade-reais-valor">{resumo.quantidadeParadas}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Capacidade perdida (peças)</p>
          <p className="stx-capacidade-reais-valor">{formatarPecas(resumo.capacidadePerdidaPecas)}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Períodos produtivos</p>
          <p className="stx-capacidade-reais-valor">{resumo.periodosProdutivos}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">&quot;Sem produção&quot; (registro explícito)</p>
          <p className="stx-capacidade-reais-valor">{resumo.periodosSemProducaoExplicito}</p>
        </div>
      </div>
      <p className="stx-panel-sub" style={{ marginTop: 12 }}>
        Disponibilidade/OEE representam só os períodos efetivamente apontados como produção — não é disponibilidade industrial absoluta da fábrica (não existe hoje um calendário de quando cada máquina deveria estar rodando). &quot;Sem produção&quot; conta somente registros explícitos com esse status — nunca inclui períodos em que simplesmente não houve nenhum apontamento.
      </p>
    </div>
  );
}
