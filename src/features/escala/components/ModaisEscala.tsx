"use client";

import { useState } from "react";

export function TrocaModal({
  titulo, opcoes, onConfirmar, onFechar, salvando, erro,
}: {
  titulo: string;
  opcoes: { id: string; rotulo: string }[];
  onConfirmar: (outroId: string) => void;
  onFechar: () => void;
  salvando: boolean;
  erro: string | null;
}) {
  const [outro, setOutro] = useState("");
  return (
    <div className="stx-esc-modal-bg" onClick={!salvando ? onFechar : undefined}>
      <div className="stx-esc-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Trocar funcionários</h3>
        <p className="stx-esc-muted">{titulo}</p>
        <div className="stx-esc-campo">
          <label htmlFor="esc-troca-outro">Trocar com</label>
          <select id="esc-troca-outro" value={outro} onChange={(e) => setOutro(e.target.value)}>
            <option value="">Selecione…</option>
            {opcoes.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
          </select>
        </div>
        <p className="stx-esc-muted">A troca vale só para este período. Um recálculo futuro (ausência, indisponibilidade, mudança na Previsão) pode reorganizar a escala.</p>
        {erro && <div className="stx-esc-banner erro">{erro}</div>}
        <div className="stx-esc-acoes">
          <button type="button" className="stx-esc-btn" onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button type="button" className="stx-esc-btn primario" disabled={!outro || salvando} onClick={() => onConfirmar(outro)}>{salvando ? "Salvando…" : "Trocar"}</button>
        </div>
      </div>
    </div>
  );
}

export const MOTIVOS_INDISPONIBILIDADE: { valor: string; rotulo: string }[] = [
  { valor: "setup", rotulo: "Setup" },
  { valor: "manutencao", rotulo: "Manutenção" },
  { valor: "falta_material", rotulo: "Falta de material" },
  { valor: "problema_operacional", rotulo: "Problema operacional" },
  { valor: "outros", rotulo: "Outros" },
];

export function BloquearModal({
  maquinaNome, onConfirmar, onFechar, salvando, erro,
}: {
  maquinaNome: string;
  onConfirmar: (motivo: string, observacao: string) => void;
  onFechar: () => void;
  salvando: boolean;
  erro: string | null;
}) {
  const [motivo, setMotivo] = useState("manutencao");
  const [obs, setObs] = useState("");
  return (
    <div className="stx-esc-modal-bg" onClick={!salvando ? onFechar : undefined}>
      <div className="stx-esc-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Tornar indisponível</h3>
        <p className="stx-esc-muted">{maquinaNome} fica indisponível a partir de agora, até alguém liberar manualmente. Os períodos futuros serão recalculados; o período em andamento não muda.</p>
        <div className="stx-esc-campo">
          <label htmlFor="esc-bloq-motivo">Motivo</label>
          <select id="esc-bloq-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            {MOTIVOS_INDISPONIBILIDADE.map((m) => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
          </select>
        </div>
        <div className="stx-esc-campo">
          <label htmlFor="esc-bloq-obs">Observação (opcional)</label>
          <input id="esc-bloq-obs" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Detalhe do problema…" />
        </div>
        {erro && <div className="stx-esc-banner erro">{erro}</div>}
        <div className="stx-esc-acoes">
          <button type="button" className="stx-esc-btn" onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button type="button" className="stx-esc-btn primario" disabled={salvando} onClick={() => onConfirmar(motivo, obs)}>{salvando ? "Salvando…" : "Tornar indisponível"}</button>
        </div>
      </div>
    </div>
  );
}
