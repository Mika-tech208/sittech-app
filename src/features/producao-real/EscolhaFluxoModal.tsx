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
      <div className="stx-modal-card stx-pr-modal" onClick={(e) => e.stopPropagation()}>
        <p className="stx-modal-titulo">{maquinaNome}</p>
        <p className="stx-panel-sub" style={{ marginTop: -10, marginBottom: 20 }}>{periodoNome} · {periodoHorario}</p>

        <div className="stx-pr-escolha-acoes">
          <button type="button" className="stx-btn-primary" onClick={onRegistrarProducao}>REGISTRAR PRODUÇÃO</button>
          <button type="button" className="stx-btn-secondary" onClick={onSemProducao}>SEM PRODUÇÃO NESTE PERÍODO</button>
        </div>

        <div className="stx-form-actions" style={{ marginTop: 16 }}>
          <button type="button" className="stx-btn-secondary" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
