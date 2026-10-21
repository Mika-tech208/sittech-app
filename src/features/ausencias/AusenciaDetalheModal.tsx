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
import { hhmm, horaEmSaoPaulo, hojeEmSaoPaulo, minutosEmAndamento, validarChegadaInformada, visaoAtrasoAberto } from "./atrasoAberto";

export interface AusenciaDetalheModalProps {
  ausencia: AusenciaFuncionario;
  onFechar: () => void;
  onEditar: (payload: EditarAusenciaPayload) => Promise<string | null>;
  // Atraso em aberto
  onEncerrarAtraso: (id: string, horarioChegada: string | null) => Promise<string | null>;
  onCorrigirInicioAberto: (id: string, horarioInicio: string, motivo: string) => Promise<string | null>;
  modoInicial?: "chegada";
}

type Modo = "resumo" | "editando" | "salvo" | "chegada" | "corrigirInicio";

export default function AusenciaDetalheModal({ ausencia, onFechar, onEditar, onEncerrarAtraso, onCorrigirInicioAberto, modoInicial }: AusenciaDetalheModalProps) {
  const [modo, setModo] = useState<Modo>(ausencia.emAberto && modoInicial ? modoInicial : "resumo");
  const [chegadaInformada, setChegadaInformada] = useState("");
  const [novoInicio, setNovoInicio] = useState(hhmm(ausencia.horarioInicio));
  const hoje = hojeEmSaoPaulo();
  const visaoAberto = ausencia.emAberto ? visaoAtrasoAberto(ausencia, hoje) : null;
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

  async function confirmarChegada(agora: boolean) {
    if (salvando) return;
    if (!agora) {
      const msg = validarChegadaInformada({ data: ausencia.data, horarioInicio: ausencia.horarioInicio ?? "", }, chegadaInformada, periodosSnapshot, hoje, horaEmSaoPaulo());
      if (msg) { setErro(msg); return; }
    }
    setSalvando(true);
    setErro(null);
    const e = await onEncerrarAtraso(ausencia.id, agora ? null : chegadaInformada);
    setSalvando(false);
    if (e) { setErro(e); return; }
    setModo("salvo");
  }

  async function confirmarCorrecaoInicio() {
    if (salvando || !motivoPreenchido || !novoInicio) return;
    setSalvando(true);
    setErro(null);
    const e = await onCorrigirInicioAberto(ausencia.id, novoInicio, motivoAlteracao);
    setSalvando(false);
    if (e) { setErro(e); return; }
    setModo("salvo");
  }

  return (
    <div className="stx-modal-backdrop" onClick={!salvando ? onFechar : undefined}>
      <div className="stx-ap-modal-card" onClick={(e) => e.stopPropagation()}>
        {modo === "salvo" ? (
          <div className="stx-ap-confirm">
            <p className="stx-ap-confirm-check">{ausencia.emAberto ? "✓ Atraso atualizado" : "✓ Ausência atualizada"}</p>
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
              {visaoAberto ? (
                <>
                  <div className="stx-ap-resumo-linha"><span>Situação</span><b style={{ color: "var(--danger)" }}>{visaoAberto.texto}</b></div>
                  <div className="stx-ap-resumo-linha"><span>Perdido até agora</span><b>{ausencia.data === hoje ? formatarDuracao(minutosEmAndamento(periodosSnapshot, ausencia.horarioInicio ?? "", horaEmSaoPaulo())) : "—"}</b></div>
                </>
              ) : (
                <>
                  <div className="stx-ap-resumo-linha"><span>Duração</span><b>{formatarDuracao(ausencia.duracaoMinutos)}</b></div>
                  {ausencia.horarioInicio && (
                    <div className="stx-ap-resumo-linha"><span>Horário</span><b>{hhmm(ausencia.horarioInicio)}–{hhmm(ausencia.horarioFim)}</b></div>
                  )}
                  {ausencia.encerramentoAutomatico && (
                    <div className="stx-ap-resumo-linha"><span>Encerramento</span><b>Automático no fim da jornada (nenhuma chegada foi registrada)</b></div>
                  )}
                  {ausencia.tipo === "atraso" && ausencia.chegadaManual !== null && (
                    <div className="stx-ap-resumo-linha"><span>Chegada</span><b>{ausencia.chegadaManual ? "Horário informado" : "Registrada no momento (“Funcionário chegou”)"}</b></div>
                  )}
                </>
              )}
              {ausencia.observacao && (
                <div className="stx-ap-resumo-linha"><span>Observação</span><b>{ausencia.observacao}</b></div>
              )}
            </div>
            {visaoAberto?.inconsistente && (
              <p className="stx-ap-error">Atraso em aberto de um dia anterior: inconsistência operacional. Informe o horário de chegada ou corrija o horário inicial.</p>
            )}
            <div className="stx-ap-actions">
              {ausencia.emAberto ? (
                <>
                  <button type="button" className="stx-ap-btn-primary" onClick={() => confirmarChegada(true)} disabled={salvando || ausencia.data !== hoje}>{salvando ? "Salvando…" : "FUNCIONÁRIO CHEGOU"}</button>
                  <button type="button" className="stx-ap-btn-secondary" onClick={() => { setErro(null); setModo("chegada"); }}>INFORMAR HORÁRIO DE CHEGADA</button>
                  <button type="button" className="stx-ap-btn-secondary" onClick={() => { setErro(null); setModo("corrigirInicio"); }}>Corrigir horário inicial</button>
                </>
              ) : (
                <button type="button" className="stx-ap-btn-primary" onClick={() => setModo("editando")}>Editar ausência</button>
              )}
              <button type="button" className="stx-ap-btn-secondary" onClick={onFechar}>Fechar</button>
            </div>
            {erro && <p className="stx-ap-error">{erro}</p>}
          </>
        ) : modo === "chegada" ? (
          <>
            <div className="stx-ap-modal-head">
              <p className="stx-ap-modal-title" style={{ margin: 0 }}>{ausencia.funcionarioNome || "Funcionário"}</p>
              <button type="button" className="stx-ap-modal-close" onClick={() => setModo("resumo")} aria-label="Voltar">✕</button>
            </div>
            <p className="stx-ap-modal-eyebrow" style={{ marginTop: 8 }}>{dataFormatada} — atraso desde {hhmm(ausencia.horarioInicio)}</p>
            <div className="stx-ap-field" style={{ marginTop: 16 }}>
              <label className="stx-ap-field-label">Horário de chegada</label>
              <input type="time" className="stx-ap-input" value={chegadaInformada} onChange={(e) => setChegadaInformada(e.target.value)} />
            </div>
            <p className="stx-apr-ref" style={{ margin: "0 0 8px" }}>Mesmo dia, depois do início do atraso, sem horário futuro e dentro da jornada.</p>
            {erro && <p className="stx-ap-error">{erro}</p>}
            <div className="stx-ap-actions">
              <button type="button" className="stx-ap-btn-primary" disabled={salvando || !chegadaInformada} onClick={() => confirmarChegada(false)}>{salvando ? "Salvando…" : "Registrar chegada"}</button>
              <button type="button" className="stx-ap-btn-secondary" onClick={() => setModo("resumo")} disabled={salvando}>Voltar</button>
            </div>
          </>
        ) : modo === "corrigirInicio" ? (
          <>
            <div className="stx-ap-modal-head">
              <p className="stx-ap-modal-title" style={{ margin: 0 }}>{ausencia.funcionarioNome || "Funcionário"}</p>
              <button type="button" className="stx-ap-modal-close" onClick={() => setModo("resumo")} aria-label="Voltar">✕</button>
            </div>
            <p className="stx-ap-modal-eyebrow" style={{ marginTop: 8 }}>{dataFormatada} — atraso em aberto desde {hhmm(ausencia.horarioInicio)}</p>
            <div className="stx-ap-field" style={{ marginTop: 16 }}>
              <label className="stx-ap-field-label">Novo horário inicial</label>
              <input type="time" className="stx-ap-input" value={novoInicio} onChange={(e) => setNovoInicio(e.target.value)} />
            </div>
            <div className="stx-ap-field">
              <label className="stx-ap-field-label">Motivo da correção (obrigatório)</label>
              <input type="text" className="stx-ap-input" value={motivoAlteracao} onChange={(e) => setMotivoAlteracao(e.target.value)} placeholder="Ex: ele avisou que chegaria às 07:30" />
            </div>
            {erro && <p className="stx-ap-error">{erro}</p>}
            <div className="stx-ap-actions">
              <button type="button" className="stx-ap-btn-primary" disabled={salvando || !motivoPreenchido || !novoInicio} onClick={confirmarCorrecaoInicio}>{salvando ? "Salvando…" : "Salvar correção"}</button>
              <button type="button" className="stx-ap-btn-secondary" onClick={() => setModo("resumo")} disabled={salvando}>Voltar</button>
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
