"use client";

import type { Maquina, Periodo } from "@/types/domain";
import type { ProdutoForm as ProdutoFormState, RoteiroEtapaForm } from "@/features/produtos/types";

export interface ProdutoFormProps {
  form: ProdutoFormState;
  setForm: (form: ProdutoFormState) => void;
  roteiro: RoteiroEtapaForm[];
  operacoes: string[];
  maquinas: Maquina[];
  periodos: Periodo[];
  editingProdutoId: string | null;
  novaOperacaoEtapaId: string | null;
  textoNovaOperacaoEtapa: string;
  setTextoNovaOperacaoEtapa: (v: string) => void;
  onIniciarNovaOperacao: (etapaId: string) => void;
  onConfirmarNovaOperacao: () => void;
  onCancelarNovaOperacao: () => void;
  onTrocarOperacaoEtapa: (etapaId: string, operacao: string) => void;
  onRemoverEtapa: (etapaId: string) => void;
  onAdicionarEtapa: () => void;
  onAtualizarMetaEtapa: (etapaId: string, periodoId: keyof RoteiroEtapaForm["metas"], valor: string) => void;
  onAlternarMaquinaNaEtapa: (etapaId: string, maquinaId: string) => void;
  onSubmit: () => void;
  onCancelar: () => void;
}

// Formulário de criação/edição de produto — nome, referência, valor
// unitário, prioridade e o roteiro (etapas → operação → metas por período →
// máquinas elegíveis). Extraído tal qual do JSX do monólito, sem redesign.
export default function ProdutoForm({
  form, setForm, roteiro, operacoes, maquinas, periodos, editingProdutoId,
  novaOperacaoEtapaId, textoNovaOperacaoEtapa, setTextoNovaOperacaoEtapa,
  onIniciarNovaOperacao, onConfirmarNovaOperacao, onCancelarNovaOperacao,
  onTrocarOperacaoEtapa, onRemoverEtapa, onAdicionarEtapa, onAtualizarMetaEtapa, onAlternarMaquinaNaEtapa,
  onSubmit, onCancelar,
}: ProdutoFormProps) {
  return (
    <div className="stx-form">
      <div className="stx-form-full">
        <label className="stx-label">Nome do produto</label>
        <input
          className="stx-input"
          value={form.nome}
          onChange={(e) => setForm({ ...form, nome: e.target.value })}
          placeholder="Ex: Suporte de fixação industrial"
          autoFocus
        />
      </div>
      <div>
        <label className="stx-label">Referência</label>
        <input
          className="stx-input"
          value={form.referencia}
          onChange={(e) => setForm({ ...form, referencia: e.target.value })}
          placeholder="Ex: SF-1024"
        />
      </div>
      <div>
        <label className="stx-label">Valor unitário (R$)</label>
        <input
          className="stx-input"
          value={form.valorUnitario}
          onChange={(e) => setForm({ ...form, valorUnitario: e.target.value })}
          placeholder="0,00"
          inputMode="decimal"
        />
      </div>
      <div>
        <label className="stx-label">Prioridade</label>
        <select
          className="stx-select"
          value={form.prioridade}
          onChange={(e) => setForm({ ...form, prioridade: e.target.value as ProdutoFormState["prioridade"] })}
        >
          <option value="alta">Alta</option>
          <option value="media">Média</option>
          <option value="baixa">Baixa</option>
        </select>
        <p className="stx-panel-sub" style={{ margin: "4px 0 0 0", fontSize: 11 }}>Ainda não afeta os cálculos — fica pronta pra quando formos priorizar entre produtos.</p>
      </div>

      <div className="stx-custos-builder">
        <p className="stx-custos-builder-title">Fluxo de produção (etapas até a peça pronta)</p>
        {roteiro.map((e) => {
          const maquinasDaOperacao = maquinas.filter((m) => m.operacao === e.operacao && m.ativo);
          return (
            <div className="stx-etapa-card" key={e.id}>
              <div className="stx-etapa-row">
                <select
                  className="stx-select"
                  value={e.operacao}
                  onChange={(ev) => {
                    if (ev.target.value === "__nova__") { onIniciarNovaOperacao(e.id); }
                    else { onTrocarOperacaoEtapa(e.id, ev.target.value); }
                  }}
                >
                  {operacoes.map((op) => <option key={op} value={op}>{op}</option>)}
                  <option value="__nova__">+ Criar nova etapa/operação…</option>
                </select>
                <button type="button" className="stx-icon-btn danger" title="Remover etapa" onClick={() => onRemoverEtapa(e.id)}>✕</button>
              </div>

              {novaOperacaoEtapaId === e.id && (
                <div className="stx-nova-cat-row">
                  <input
                    className="stx-input"
                    value={textoNovaOperacaoEtapa}
                    onChange={(ev) => setTextoNovaOperacaoEtapa(ev.target.value)}
                    onKeyDown={(ev) => ev.key === "Enter" && onConfirmarNovaOperacao()}
                    placeholder="Ex: Rosquear, Parafusar…"
                    autoFocus
                  />
                  <button type="button" className="stx-icon-btn on" title="Adicionar" onClick={onConfirmarNovaOperacao}>✓</button>
                  <button type="button" className="stx-icon-btn" title="Cancelar" onClick={onCancelarNovaOperacao}>✕</button>
                </div>
              )}

              <p className="stx-etapa-sublabel">Meta de peças por período</p>
              <div className="stx-etapa-metas">
                {periodos.map((p) => (
                  <div className="stx-etapa-meta-campo" key={p.id}>
                    <label>{p.nome}</label>
                    <input
                      className="stx-input"
                      value={e.metas[p.id as keyof RoteiroEtapaForm["metas"]]}
                      onChange={(ev) => onAtualizarMetaEtapa(e.id, p.id as keyof RoteiroEtapaForm["metas"], ev.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                    />
                  </div>
                ))}
              </div>

              <p className="stx-etapa-sublabel">Máquinas disponíveis pra essa etapa</p>
              {maquinasDaOperacao.length === 0 ? (
                <p className="stx-panel-sub" style={{ margin: 0 }}>
                  Nenhuma máquina cadastrada pra &quot;{e.operacao}&quot; ainda — cadastre na aba Máquinas.
                </p>
              ) : (
                <div className="stx-etapa-maquinas">
                  {maquinasDaOperacao.map((m) => (
                    <label className="stx-maquina-chip" key={m.id}>
                      <input
                        type="checkbox"
                        checked={e.maquinasIds.includes(m.id)}
                        onChange={() => onAlternarMaquinaNaEtapa(e.id, m.id)}
                      />
                      {m.nome}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <button type="button" className="stx-add-btn" style={{ marginTop: 4, marginBottom: 0 }} onClick={onAdicionarEtapa}>+ Adicionar etapa</button>
      </div>

      <div className="stx-form-actions">
        <button type="button" className="stx-btn-primary" onClick={onSubmit}>
          {editingProdutoId ? "Salvar alterações" : "Adicionar produto"}
        </button>
        <button type="button" className="stx-btn-secondary" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}
