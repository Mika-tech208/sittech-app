"use client";

// Seção "Paradas do período" reaproveitada tanto no apontamento novo
// (ApontamentoModal) quanto na edição (ResumoApontamentoModal) — mesma
// UX nos dois lugares, de propósito. Paradas automáticas (vindas de uma
// ocorrência) são só exibidas, nunca editáveis aqui — o 🔒 e a legenda
// deixam isso claro. "Editar" numa parada manual não abre edição inline:
// remove a linha e repõe os valores no formulário de adicionar — mais
// leve que manter dois modos de edição por linha, mesmo resultado.

import { useState } from "react";
import type { MotivoParada } from "@/hooks/useMotivosParada";

export interface ParadaManual {
  motivoId: string;
  minutos: number;
  descricao: string | null;
}

export interface ParadaAutomatica {
  motivoNome: string;
  minutos: number;
}

export interface ParadasManuaisEditorProps {
  paradasManuais: ParadaManual[];
  onChange: (paradas: ParadaManual[]) => void;
  motivosParada: MotivoParada[];
  paradasAutomaticas?: ParadaAutomatica[];
}

export default function ParadasManuaisEditor({ paradasManuais, onChange, motivosParada, paradasAutomaticas }: ParadasManuaisEditorProps) {
  const [formAberto, setFormAberto] = useState(false);
  const [editandoIndex, setEditandoIndex] = useState<number | null>(null);
  const [motivoId, setMotivoId] = useState("");
  const [minutos, setMinutos] = useState("");
  const [descricao, setDescricao] = useState("");

  const motivoSelecionado = motivosParada.find((m) => m.id === motivoId);
  const precisaDescricao = !!motivoSelecionado?.exigeDescricao;
  const minutosNum = Number(minutos);
  const podeAdicionar = !!motivoId && minutos !== "" && !Number.isNaN(minutosNum) && minutosNum > 0 && (!precisaDescricao || descricao.trim().length > 0);

  function abrirNovaParada() {
    setEditandoIndex(null);
    setMotivoId("");
    setMinutos("");
    setDescricao("");
    setFormAberto(true);
  }

  function editarParada(index: number) {
    const p = paradasManuais[index];
    setEditandoIndex(index);
    setMotivoId(p.motivoId);
    setMinutos(String(p.minutos));
    setDescricao(p.descricao || "");
    setFormAberto(true);
  }

  function removerParada(index: number) {
    onChange(paradasManuais.filter((_, i) => i !== index));
  }

  function confirmarParada() {
    if (!podeAdicionar) return;
    const nova: ParadaManual = { motivoId, minutos: minutosNum, descricao: precisaDescricao ? descricao.trim() : null };
    if (editandoIndex !== null) {
      onChange(paradasManuais.map((p, i) => (i === editandoIndex ? nova : p)));
    } else {
      onChange([...paradasManuais, nova]);
    }
    setFormAberto(false);
    setEditandoIndex(null);
  }

  const totalMinutos =
    (paradasAutomaticas || []).reduce((soma, p) => soma + p.minutos, 0) +
    paradasManuais.reduce((soma, p) => soma + p.minutos, 0);

  return (
    <div className="stx-pr-paradas" style={{ marginBottom: 16 }}>
      <label className="stx-label">Paradas do período</label>

      {(paradasAutomaticas && paradasAutomaticas.length > 0) || paradasManuais.length > 0 ? (
        <div className="stx-pr-paradas-lista">
          {(paradasAutomaticas || []).map((p, i) => (
            <div key={`auto-${i}`} className="stx-pr-parada-linha bloqueada">
              <div>
                <span className="stx-pr-parada-nome">{p.motivoNome} — {p.minutos} min 🔒</span>
                <span className="stx-pr-parada-legenda">Registrada automaticamente por ocorrência</span>
              </div>
            </div>
          ))}
          {paradasManuais.map((p, i) => (
            <div key={`manual-${i}`} className="stx-pr-parada-linha">
              <span className="stx-pr-parada-nome">{motivosParada.find((m) => m.id === p.motivoId)?.nome || "Motivo"} — {p.minutos} min</span>
              <div className="stx-pr-parada-acoes">
                <button type="button" className="stx-icon-btn" title="Editar" onClick={() => editarParada(i)}>✎</button>
                <button type="button" className="stx-icon-btn danger" title="Remover" onClick={() => removerParada(i)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {formAberto ? (
        <div className="stx-pr-parada-form">
          <select className="stx-select" value={motivoId} onChange={(e) => setMotivoId(e.target.value)}>
            <option value="">Motivo…</option>
            {motivosParada.map((m) => (
              <option key={m.id} value={m.id}>{m.nome}</option>
            ))}
          </select>
          <input
            type="number" inputMode="numeric" min={1} className="stx-input"
            placeholder="Minutos" value={minutos} onChange={(e) => setMinutos(e.target.value)}
          />
          {precisaDescricao && (
            <input
              type="text" className="stx-input" placeholder="Descreva o motivo"
              value={descricao} onChange={(e) => setDescricao(e.target.value)}
            />
          )}
          <div className="stx-pr-parada-form-acoes">
            <button type="button" className="stx-btn-primary" disabled={!podeAdicionar} onClick={confirmarParada}>
              {editandoIndex !== null ? "Salvar" : "Adicionar"}
            </button>
            <button type="button" className="stx-btn-secondary" onClick={() => { setFormAberto(false); setEditandoIndex(null); }}>Cancelar</button>
          </div>
        </div>
      ) : (
        <button type="button" className="stx-pr-add-parada-btn" onClick={abrirNovaParada}>+ Adicionar parada</button>
      )}

      {totalMinutos > 0 && <p className="stx-pr-parada-total">Tempo parado total: {totalMinutos} min</p>}
    </div>
  );
}
