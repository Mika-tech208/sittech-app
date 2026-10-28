"use client";

import { useState } from "react";

export function TrocaModal({
  titulo, opcoes, onConfirmar, onFechar, salvando, erro,
}: {
  titulo: string;
  opcoes: { id: string; rotulo: string; bloqueio?: string }[]; // bloqueio: troca proibida pelo revezamento (sem exceção, sem bypass)
  onConfirmar: (outroId: string, motivo: string) => void;
  onFechar: () => void;
  salvando: boolean;
  erro: string | null;
}) {
  const [outro, setOutro] = useState("");
  const [motivo, setMotivo] = useState("");
  const motivoValido = motivo.trim().length >= 3;
  return (
    <div className="stx-esc-modal-bg" onClick={!salvando ? onFechar : undefined}>
      <div className="stx-esc-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Trocar funcionários</h3>
        <p className="stx-esc-muted">{titulo}</p>
        <div className="stx-esc-campo">
          <label htmlFor="esc-troca-outro">Trocar com</label>
          <select id="esc-troca-outro" value={outro} onChange={(e) => setOutro(e.target.value)}>
            <option value="">Selecione…</option>
            {opcoes.map((o) => <option key={o.id} value={o.id} disabled={Boolean(o.bloqueio)}>{o.rotulo}{o.bloqueio ? " — não permitido (repetiria a operação)" : ""}</option>)}
          </select>
        </div>
        {opcoes.some((o) => o.bloqueio) && <p className="stx-esc-muted">Trocas que fariam alguém repetir a mesma operação (em períodos consecutivos ou, no revezamento por bloco, na mesma manhã/tarde) não são permitidas — não há exceção.</p>}
        <div className="stx-esc-campo">
          <label htmlFor="esc-troca-motivo">Motivo da troca (obrigatório)</label>
          <input id="esc-troca-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: pedido do supervisor, treinamento…" maxLength={200} />
        </div>
        <p className="stx-esc-muted">A troca vale só para este período. Um recálculo futuro (ausência, indisponibilidade, mudança na Previsão) pode reorganizar a escala.</p>
        {erro && <div className="stx-esc-banner erro">{erro}</div>}
        <div className="stx-esc-acoes">
          <button type="button" className="stx-esc-btn" onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button type="button" className="stx-esc-btn primario" disabled={!outro || !motivoValido || salvando} onClick={() => onConfirmar(outro, motivo.trim())}>{salvando ? "Salvando…" : "Trocar"}</button>
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
