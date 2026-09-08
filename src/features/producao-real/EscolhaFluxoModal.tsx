"use client";

// Primeiro passo ao tocar numa máquina PENDENTE — escolhe entre os dois
// fluxos hoje suportados. Nada é gravado aqui, só decide qual formulário
// abrir em seguida.

export interface EscolhaFluxoModalProps {
  maquinaNome: string;
  periodoNome: string;
  periodoHorario: string;
  onRegistrarProducao: () => void;
  onSemProducao: () => void;
  onFechar: () => void;
}

export default function EscolhaFluxoModal({
  maquinaNome, periodoNome, periodoHorario, onRegistrarProducao, onSemProducao, onFechar,
}: EscolhaFluxoModalProps) {
  return (
    <div className="stx-modal-backdrop" onClick={onFechar}>
      <div className="stx-ap-modal-card" onClick={(e) => e.stopPropagation()}>
        <p className="stx-ap-modal-eyebrow">{maquinaNome} · {periodoNome} · {periodoHorario}</p>
        <p className="stx-ap-modal-title">O que aconteceu neste período?</p>

        <div className="stx-ap-choice-actions">
          <button type="button" className="stx-ap-choice-btn primario" onClick={onRegistrarProducao}>Registrar produção</button>
          <button type="button" className="stx-ap-choice-btn secundario" onClick={onSemProducao}>Sem produção neste período</button>
        </div>

        <div className="stx-ap-actions">
          <button type="button" className="stx-ap-btn-secondary" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
