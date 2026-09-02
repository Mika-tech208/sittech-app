"use client";

import type { MaquinaForm as MaquinaFormState } from "@/features/maquinas/types";

export interface MaquinaFormProps {
  form: MaquinaFormState;
  setForm: (form: MaquinaFormState) => void;
  operacoes: string[];
  editingMaquinaId: string | null;
  novaOperacao: boolean;
  textoNovaOperacao: string;
  setTextoNovaOperacao: (v: string) => void;
  onIniciarNovaOperacao: () => void;
  onConfirmarNovaOperacao: () => void;
  onCancelarNovaOperacao: () => void;
  onSubmit: () => void;
  onCancelar: () => void;
}

// Formulário de criação/edição de máquina — nome + operação (catálogo
// compartilhado, com o mesmo atalho "criar nova operação" usado em
// Funcionários/Produtos). Extraído tal qual do JSX do monólito.
export default function MaquinaForm({
  form, setForm, operacoes, editingMaquinaId, novaOperacao, textoNovaOperacao, setTextoNovaOperacao,
  onIniciarNovaOperacao, onConfirmarNovaOperacao, onCancelarNovaOperacao, onSubmit, onCancelar,
}: MaquinaFormProps) {
  return (
    <div className="stx-form">
      <div>
        <label className="stx-label">Nome da máquina</label>
        <input
          className="stx-input"
          value={form.nome}
          onChange={(e) => setForm({ ...form, nome: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          placeholder="Ex: Rosqueadeira 3"
          autoFocus
        />
      </div>
      <div>
        <label className="stx-label">Operação</label>
        <select
          className="stx-select"
          value={form.operacao}
          onChange={(e) => {
            if (e.target.value === "__nova__") onIniciarNovaOperacao();
            else setForm({ ...form, operacao: e.target.value });
          }}
        >
          {operacoes.map((op) => <option key={op} value={op}>{op}</option>)}
          <option value="__nova__">+ Criar nova operação…</option>
        </select>
        {novaOperacao && (
          <div className="stx-nova-cat-row">
            <input
              className="stx-input"
              value={textoNovaOperacao}
              onChange={(e) => setTextoNovaOperacao(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onConfirmarNovaOperacao()}
              placeholder="Nome da operação"
              autoFocus
            />
            <button type="button" className="stx-icon-btn on" title="Adicionar operação" onClick={onConfirmarNovaOperacao}>✓</button>
            <button type="button" className="stx-icon-btn" title="Cancelar" onClick={onCancelarNovaOperacao}>✕</button>
          </div>
        )}
      </div>
      <div className="stx-form-actions">
        <button type="button" className="stx-btn-primary" onClick={onSubmit}>
          {editingMaquinaId ? "Salvar alterações" : "Adicionar máquina"}
        </button>
        <button type="button" className="stx-btn-secondary" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}
