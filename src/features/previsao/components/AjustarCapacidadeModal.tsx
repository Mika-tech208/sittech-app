"use client";

import type { CapacidadeMaximaSemana } from "@/features/capacidade/types";

export interface AjustarCapacidadeModalProps {
  aberto: boolean;
  onFechar: () => void;
  onAplicar: () => void;
  capacidadeMaximaSemana: CapacidadeMaximaSemana;
  formatBRL: (v: number) => string;
}

// Modal de confirmação do botão "AJUSTAR PARA CAPACIDADE" — reduz cada item
// previsto pro máximo que a capacidade da semana permite.
export default function AjustarCapacidadeModal({ aberto, onFechar, onAplicar, capacidadeMaximaSemana, formatBRL }: AjustarCapacidadeModalProps) {
  if (!aberto) return null;
  return (
    <div className="stx-modal-backdrop" onClick={onFechar}>
      <div className="stx-modal-card" onClick={(e) => e.stopPropagation()}>
        <p className="stx-modal-titulo">Confirmar ajuste da previsão</p>
        <div className="stx-modal-comparativo">
          <div>
            <p className="stx-capacidade-reais-label">Previsão atual</p>
            <p className="stx-capacidade-reais-valor">{formatBRL(capacidadeMaximaSemana.previstoTotalReais)}</p>
          </div>
          <div>
            <p className="stx-capacidade-reais-label">Previsão ajustada</p>
            <p className="stx-capacidade-reais-valor" style={{ color: "var(--accent)" }}>{formatBRL(capacidadeMaximaSemana.maximoTotalReais)}</p>
          </div>
        </div>
        <p className="stx-analise-secao-titulo">Alterações</p>
        {capacidadeMaximaSemana.resultadosPorItem
          .filter((r) => r.maximoPossivel !== r.previsto)
          .map((r) => (
            <div className="stx-tabela-producao-linha" key={r.itemId} style={{ gridTemplateColumns: "2fr 1fr" }}>
              <span>{r.produtoNome}</span>
              <span>{r.previsto} → <b>{r.maximoPossivel}</b></span>
            </div>
          ))}
        <div className="stx-form-actions" style={{ marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" className="stx-btn-secondary" onClick={onFechar}>Cancelar</button>
          <button type="button" className="stx-btn-primary" onClick={onAplicar}>Aplicar ajuste</button>
        </div>
      </div>
    </div>
  );
}
