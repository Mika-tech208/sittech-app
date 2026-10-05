"use client";

// Resumo + edição de uma ausência já registrada — mesmo padrão de
// ResumoApontamentoModal.tsx: "Motivo da alteração" obrigatório em toda
// edição, antes/depois gravado em ausencia_funcionario_historico (pela
// RPC), nunca apaga. Funcionário e data NÃO são editáveis nesta V1 (mesma
// regra já usada em apontamentos_producao pra máquina/data/período).

import { useState } from "react";
import { calcularAusencia, formatarDuracao, LABEL_TIPO_AUSENCIA, TIPOS_AUSENCIA, TIPOS_COM_HORARIO, TIPOS_COM_JANELA_EXPLICITA, type TipoAusencia } from "./calculations";
import type { PeriodoSimples } from "./calculations";
import type { AusenciaFuncionario, EditarAusenciaPayload } from "@/hooks/useAusenciasFuncionarios";

export interface AusenciaDetalheModalProps {
  ausencia: AusenciaFuncionario;
  onFechar: () => void;
  onEditar: (payload: EditarAusenciaPayload) => Promise<string | null>;
}

type Modo = "resumo" | "editando" | "salvo";

export default function AusenciaDetalheModal({ ausencia, onFechar, onEditar }: AusenciaDetalheModalProps) {
  const [modo, setModo] = useState<Modo>("resumo");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const periodosSnapshot: PeriodoSimples[] = ausencia.periodosSnapshot;

  const [tipo, setTipo] = useState<TipoAusencia>(ausencia.tipo);
  const [horarioReal, setHorarioReal] = useState(tipo === "atraso" ? ausencia.horarioFim || "" : tipo === "saida_antecipada" ? ausencia.horarioInicio || "" : "");
  const [horarioJanelaInicio, setHorarioJanelaInicio] = useState(TIPOS_COM_JANELA_EXPLICITA.includes(tipo) ? ausencia.horarioInicio || "" : "");
  const [horarioJanelaFim, setHorarioJanelaFim] = useState(TIPOS_COM_JANELA_EXPLICITA.includes(tipo) ? ausencia.horarioFim || "" : "");
  const [observacao, setObservacao] = useState(ausencia.observacao || "");
  const [motivoAlteracao, setMotivoAlteracao] = useState("");

  const precisaHorario = TIPOS_COM_HORARIO.includes(tipo);
  const resultado = calcularAusencia({
    tipo, periodos: periodosSnapshot,
    horarioReal: horarioReal || undefined,
    horarioJanelaInicio: horarioJanelaInicio || undefined,
    horarioJanelaFim: horarioJanelaFim || undefined,
  });

  const motivoPreenchido = motivoAlteracao.trim().length > 0;
  const podeSalvar = !salvando && !!tipo && (!precisaHorario || resultado !== null) && motivoPreenchido;

  async function salvar() {
    if (!podeSalvar || !resultado) return;
    setSalvando(true);
    setErro(null);
    const erroRpc = await onEditar({
      id: ausencia.id,
      tipo,
      horarioInicio: resultado.horarioInicio,
      horarioFim: resultado.horarioFim,
      duracaoMinutos: resultado.duracaoMinutos,
      observacao,
      motivo: motivoAlteracao,
    });
    if (erroRpc) {
      setErro(erroRpc);
      setSalvando(false);
      return;
    }
    setSalvando(false);
    setModo("salvo");
  }

  const dataFormatada = ausencia.data.split("-").reverse().join("/");

  return (
    <div className="stx-modal-backdrop" onClick={!salvando ? onFechar : undefined}>
      <div className="stx-ap-modal-card" onClick={(e) => e.stopPropagation()}>
        {modo === "salvo" ? (
          <div className="stx-ap-confirm">
            <p className="stx-ap-confirm-check">✓ Ausência atualizada</p>
            <div className="stx-ap-confirm-actions">
              <button type="button" className="stx-ap-btn-primary" onClick={onFechar}>Fechar</button>
            </div>
          </div>
        ) : modo === "resumo" ? (
          <>
            <div className="stx-ap-modal-head">
              <p className="stx-ap-modal-title" style={{ margin: 0 }}>{ausencia.funcionarioNome || "Funcionário"}</p>
              <button type="button" className="stx-ap-modal-close" onClick={onFechar} aria-label="Fechar">✕</button>
            </div>
            <p className="stx-ap-modal-eyebrow" style={{ marginTop: 8 }}>{dataFormatada}</p>
            <div className="stx-ap-resumo-linhas">
              <div className="stx-ap-resumo-linha"><span>Tipo</span><b>{LABEL_TIPO_AUSENCIA[ausencia.tipo]}</b></div>
              <div className="stx-ap-resumo-linha"><span>Duração</span><b>{formatarDuracao(ausencia.duracaoMinutos)}</b></div>
              {ausencia.horarioInicio && (
                <div className="stx-ap-resumo-linha"><span>Horário</span><b>{ausencia.horarioInicio}–{ausencia.horarioFim}</b></div>
              )}
              {ausencia.observacao && (
                <div className="stx-ap-resumo-linha"><span>Observação</span><b>{ausencia.observacao}</b></div>
              )}
            </div>
            <div className="stx-ap-actions">
              <button type="button" className="stx-ap-btn-primary" onClick={() => setModo("editando")}>Editar ausência</button>
              <button type="button" className="stx-ap-btn-secondary" onClick={onFechar}>Fechar</button>
            </div>
          </>
        ) : (
          <>
            <div className="stx-ap-modal-head">
              <p className="stx-ap-modal-title" style={{ margin: 0 }}>{ausencia.funcionarioNome || "Funcionário"}</p>
              <button type="button" className="stx-ap-modal-close" onClick={() => setModo("resumo")} aria-label="Cancelar edição">✕</button>
            </div>
            <p className="stx-ap-modal-eyebrow" style={{ marginTop: 8, marginBottom: 16 }}>
              {dataFormatada} — funcionário/data não são editáveis
            </p>

            <div className="stx-ap-field">
              <label className="stx-ap-field-label">Tipo</label>
              <select className="stx-ap-select" value={tipo} onChange={(e) => { setTipo(e.target.value as TipoAusencia); setHorarioReal(""); setHorarioJanelaInicio(""); setHorarioJanelaFim(""); }}>
                {TIPOS_AUSENCIA.map((t) => (
                  <option key={t.valor} value={t.valor}>{t.label}</option>
                ))}
              </select>
            </div>

            {tipo === "atraso" && (
              <div className="stx-ap-field">
                <label className="stx-ap-field-label">Chegada</label>
                <input type="time" className="stx-ap-input" value={horarioReal} onChange={(e) => setHorarioReal(e.target.value)} />
              </div>
            )}
            {tipo === "saida_antecipada" && (
              <div className="stx-ap-field">
                <label className="stx-ap-field-label">Saída</label>
                <input type="time" className="stx-ap-input" value={horarioReal} onChange={(e) => setHorarioReal(e.target.value)} />
              </div>
            )}
            {tipo === "saida_durante_expediente" && (
              <div className="stx-ap-grid-2 stx-ap-field">
                <div>
                  <label className="stx-ap-field-label">Saída</label>
                  <input type="time" className="stx-ap-input" value={horarioJanelaInicio} onChange={(e) => setHorarioJanelaInicio(e.target.value)} />
                </div>
                <div>
                  <label className="stx-ap-field-label">Retorno</label>
                  <input type="time" className="stx-ap-input" value={horarioJanelaFim} onChange={(e) => setHorarioJanelaFim(e.target.value)} />
                </div>
              </div>
            )}
            {tipo === "outro" && (
              <div className="stx-ap-grid-2 stx-ap-field">
                <div>
                  <label className="stx-ap-field-label">Horário inicial</label>
                  <input type="time" className="stx-ap-input" value={horarioJanelaInicio} onChange={(e) => setHorarioJanelaInicio(e.target.value)} />
                </div>
                <div>
                  <label className="stx-ap-field-label">Horário final</label>
                  <input type="time" className="stx-ap-input" value={horarioJanelaFim} onChange={(e) => setHorarioJanelaFim(e.target.value)} />
                </div>
              </div>
            )}

            <div className="stx-ausencia-preview">
              <span>Duração calculada</span>
              <b>{resultado ? formatarDuracao(resultado.duracaoMinutos) : "—"}</b>
            </div>

            <div className="stx-ap-field">
              <label className="stx-ap-field-label">Observação (opcional)</label>
              <input type="text" className="stx-ap-input" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            </div>

            <div className="stx-ap-field">
              <label className="stx-ap-field-label">Motivo da alteração (obrigatório)</label>
              <input
                type="text"
                className="stx-ap-input"
                value={motivoAlteracao}
                onChange={(e) => setMotivoAlteracao(e.target.value)}
                placeholder="Ex: tipo lançado errado, corrigido após verificação"
              />
            </div>

            {erro && <p className="stx-ap-error">{erro}</p>}
            {!podeSalvar && !salvando && !motivoPreenchido && (
              <p className="stx-ap-modal-eyebrow">Preencha &quot;Motivo da alteração&quot; para poder salvar.</p>
            )}

            <div className="stx-ap-actions">
              <button type="button" className="stx-ap-btn-primary" disabled={!podeSalvar} onClick={salvar}>
                {salvando ? "Salvando…" : "Salvar alterações"}
              </button>
              <button type="button" className="stx-ap-btn-secondary" onClick={() => setModo("resumo")} disabled={salvando}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
