"use client";

import { calcularViabilidadeItem, calcularFuncionariosTotalSemana } from "@/features/capacidade/calculations";
import { toNumber } from "@/lib/format";
import type { Produto, Maquina, Previsao, PrevisaoItem, PeriodoComDuracao } from "@/types/domain";
import type { AnaliseCapacidadeSemanal } from "@/features/capacidade/types";

export interface PrevItemFormState {
  produtoId: string;
  quantidade: string;
  maquinasPorEtapa: Record<string, string[]>;
}

export interface ItensPrevistosProps {
  loading: boolean;
  produtos: Produto[];
  maquinas: Maquina[];
  periodosComDuracao: PeriodoComDuracao[];
  horasPorMaquinaSemana: number;
  semana: Previsao;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  editingId: string | null;
  form: PrevItemFormState;
  onSelecionarProduto: (produtoId: string) => void;
  onQuantidadeChange: (v: string) => void;
  onToggleMaquina: (etapaId: string, maquinaId: string) => void;
  onSubmit: () => void;
  onCancelar: () => void;
  onEditar: (it: PrevisaoItem) => void;
  onExcluir: (id: string) => void;
  analise: AnaliseCapacidadeSemanal;
  valorPrevistoSemana: number;
  funcionariosAtivosCount: number;
  formatBRL: (v: number) => string;
}

// "Itens previstos" — formulário (com viabilidade ao vivo, seleção de
// máquina por etapa) + lista dos itens já lançados na semana.
export default function ItensPrevistos({
  loading, produtos, maquinas, periodosComDuracao, horasPorMaquinaSemana, semana,
  showForm, setShowForm, editingId, form, onSelecionarProduto, onQuantidadeChange, onToggleMaquina,
  onSubmit, onCancelar, onEditar, onExcluir, analise, valorPrevistoSemana, funcionariosAtivosCount, formatBRL,
}: ItensPrevistosProps) {
  const produtoSel = produtos.find((p) => p.id === form.produtoId) || null;
  const roteiroSel = produtoSel?.roteiro || [];

  const viabAoVivo = form.produtoId && produtoSel && roteiroSel.length > 0
    ? calcularViabilidadeItem(
        { produtoId: form.produtoId, quantidade: toNumber(form.quantidade), maquinasPorEtapa: form.maquinasPorEtapa },
        produtos, periodosComDuracao, horasPorMaquinaSemana
      )
    : null;

  const horasPessoaDisponiveis = funcionariosAtivosCount * horasPorMaquinaSemana;
  const horasPessoaDemandadas = analise.maquinas.reduce((s, m) => s + m.horasNecessarias, 0);
  const pctEquipe = horasPessoaDisponiveis > 0 ? (horasPessoaDemandadas / horasPessoaDisponiveis) * 100 : 0;

  return (
    <div className="stx-panel">
      <div className="stx-panel-title-row">
        <p className="stx-panel-title">Itens previstos</p>
      </div>
      <p className="stx-panel-sub">Produto e quantidade que a supervisora passou pra essa semana. Ao escolher o produto, marca quais máquinas de verdade vão rodar essa semana pra ele.</p>

      {produtos.filter((p) => p.ativo).length === 0 ? (
        <p className="stx-panel-sub">Cadastre produtos na aba &quot;Produtos&quot; antes de lançar itens aqui.</p>
      ) : (
        <>
          {!showForm && (
            <button className="stx-add-btn blueprint" onClick={() => setShowForm(true)}>+ Novo item</button>
          )}
          {showForm && (
            <div className="stx-form">
              <div className="stx-form-full">
                <label className="stx-label">Produto</label>
                <select className="stx-select" value={form.produtoId} onChange={(e) => onSelecionarProduto(e.target.value)}>
                  <option value="">Selecione um produto…</option>
                  {produtos.filter((p) => p.ativo).map((p) => (
                    <option key={p.id} value={p.id}>{p.nome} ({formatBRL(p.valorUnitario)})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="stx-label">Quantidade</label>
                <input
                  className="stx-input"
                  value={form.quantidade}
                  onChange={(e) => onQuantidadeChange(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSubmit()}
                  placeholder="Ex: 10"
                  inputMode="decimal"
                  autoFocus
                />
              </div>

              {form.produtoId && (
                roteiroSel.length === 0 ? (
                  <p className="stx-panel-sub stx-form-full" style={{ margin: 0 }}>Esse produto não tem fluxo de produção cadastrado — não dá pra escolher máquinas nem calcular viabilidade.</p>
                ) : (
                  <div className="stx-custos-builder">
                    <p className="stx-custos-builder-title">Máquinas dessa semana, por etapa</p>
                    {roteiroSel.map((etapa) => {
                      const maquinasDaOperacao = maquinas.filter(
                        (m) => m.operacao === etapa.operacao && m.ativo && !(semana.maquinasIndisponiveis || []).includes(m.id)
                      );
                      const selecionadas = form.maquinasPorEtapa[etapa.id] || [];
                      return (
                        <div className="stx-etapa-card" key={etapa.id}>
                          <p className="stx-panel-sub" style={{ margin: "0 0 6px 0", fontWeight: 600, color: "var(--blueprint)" }}>{etapa.operacao}</p>
                          {maquinasDaOperacao.length === 0 ? (
                            <p className="stx-panel-sub" style={{ margin: 0 }}>Nenhuma máquina disponível pra essa operação essa semana (nenhuma cadastrada, ou todas marcadas como indisponíveis).</p>
                          ) : (
                            <div className="stx-etapa-maquinas">
                              {maquinasDaOperacao.map((m) => (
                                <label className="stx-maquina-chip" key={m.id}>
                                  <input
                                    type="checkbox"
                                    checked={selecionadas.includes(m.id)}
                                    onChange={() => onToggleMaquina(etapa.id, m.id)}
                                  />
                                  {m.nome}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              )}

              {form.produtoId && produtoSel && roteiroSel.length > 0 && (
                viabAoVivo && viabAoVivo.funcionariosNecessarios === 0 ? (
                  <p className="stx-panel-sub stx-form-full" style={{ margin: 0 }}>Marca as máquinas acima pra ver quantos funcionários isso exige e quantas peças dá pra fazer.</p>
                ) : viabAoVivo ? (
                  <div className="stx-form-full stx-resumo-ao-vivo" style={{ borderColor: viabAoVivo.atingivel ? "var(--accent)" : "var(--warning)" }}>
                    Com essas máquinas, você vai usar <b>{viabAoVivo.funcionariosNecessarios} funcionário{viabAoVivo.funcionariosNecessarios > 1 ? "s" : ""}</b> e consegue produzir até <b>{viabAoVivo.maxPecas}</b> peças essa semana.
                    {!viabAoVivo.atingivel && toNumber(form.quantidade) > 0 && (
                      <> Isso é menos que a quantidade pedida ({toNumber(form.quantidade)}) — falta capacidade em <b>{viabAoVivo.gargalo}</b>.</>
                    )}
                  </div>
                ) : null
              )}

              <div className="stx-form-actions">
                <button type="button" className="stx-btn-primary" onClick={onSubmit}>
                  {editingId ? "Salvar alterações" : "Adicionar item"}
                </button>
                <button type="button" className="stx-btn-secondary" onClick={onCancelar}>Cancelar</button>
              </div>
            </div>
          )}
        </>
      )}

      {loading ? (
        <div className="stx-empty">Carregando…</div>
      ) : semana.itens.length === 0 ? (
        <div className="stx-empty">Nenhum item lançado nessa semana ainda.</div>
      ) : (
        semana.itens.map((it) => {
          const viab = calcularViabilidadeItem(it, produtos, periodosComDuracao, horasPorMaquinaSemana);
          const maquinasDoItem = new Set(Object.values(it.maquinasPorEtapa || {}).flat());
          const gargalosQueAfetam = analise.gargalos.filter((g) => maquinasDoItem.has(g.maquinaId));
          return (
            <div className="stx-entry" key={it.id}>
              <div>
                <p className="stx-entry-desc">
                  {it.produtoNome}
                  {viab.atingivel === true && <span className="stx-badge blueprint">✓ atinge sozinho</span>}
                  {viab.atingivel === false && (
                    <span className="stx-badge" style={{ background: "rgba(217,83,79,0.15)", color: "var(--danger)" }}>
                      faltam {it.quantidade - viab.maxPecas} ({viab.gargalo})
                    </span>
                  )}
                </p>
                {gargalosQueAfetam.length > 0 && (
                  <p className="stx-entry-aviso-compartilhada">
                    ⚠ {gargalosQueAfetam.map((g) => `${g.nome} está em ${g.pct.toFixed(0)}% (compartilhada com outro produto)`).join(" · ")}
                  </p>
                )}
                <p className="stx-entry-meta">
                  {it.quantidade} × {formatBRL(it.valorUnitario)}
                  {viab.funcionariosNecessarios > 0 && ` · usa ${viab.funcionariosNecessarios} máquina${viab.funcionariosNecessarios > 1 ? "s" : ""} → precisa de ${viab.funcionariosNecessarios} funcionário${viab.funcionariosNecessarios > 1 ? "s" : ""}`}
                </p>
              </div>
              <div className="stx-entry-right">
                <span className="stx-entry-value">{formatBRL(it.quantidade * it.valorUnitario)}</span>
                <button className="stx-icon-btn" title="Editar" onClick={() => onEditar(it)}>✎</button>
                <button className="stx-icon-btn danger" title="Excluir" onClick={() => onExcluir(it.id)}>✕</button>
              </div>
            </div>
          );
        })
      )}
      <p className="stx-custos-total" style={{ marginTop: 10 }}>Previsão da semana: <b>{formatBRL(valorPrevistoSemana)}</b></p>
      {semana.itens.length > 0 && (
        <>
          <p className="stx-custos-total" style={{ marginTop: 4 }}>
            Funcionários necessários pra essa programação: <b>{calcularFuncionariosTotalSemana(semana.itens)}</b> de {funcionariosAtivosCount} ativos
          </p>
          <p className="stx-custos-total" style={{ marginTop: 4 }}>
            Uso da equipe em horas: <b style={{ color: "var(--accent)" }}>{pctEquipe.toFixed(1)}%</b>
            {" "}<span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: 12 }}>
              ({horasPessoaDemandadas.toFixed(1)}h demandadas de {horasPessoaDisponiveis.toFixed(1)}h disponíveis nos {funcionariosAtivosCount} funcionários)
            </span>
          </p>
        </>
      )}
    </div>
  );
}
