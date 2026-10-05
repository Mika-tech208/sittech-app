"use client";

// "Registrar ausência" — Faltas e Ausências V1. Mesmo padrão de
// ApontamentoModal.tsx: trava de "salvando" com early-return, botão
// disabled + "Salvando…", idempotency_key gerada uma vez por tentativa
// (trocada a cada sucesso OU cancelar — ver o bug de reaproveitamento de
// chave corrigido em SittechApp.tsx/useFaturamentos.ts na revisão de
// integridade de gravação).
//
// A supervisora nunca calcula hora — calcularAusencia roda a cada
// mudança de campo, e o preview da duração já aparece antes de salvar.

import { useState } from "react";
import DatePicker from "@/components/shared/DatePicker";
import { calcularAusencia, formatarDuracao, TIPOS_AUSENCIA, TIPOS_COM_HORARIO, type TipoAusencia } from "./calculations";
import type { PeriodoSimples } from "./calculations";
import type { RegistrarAusenciaPayload } from "@/hooks/useAusenciasFuncionarios";

interface FuncionarioSimples {
  id: string;
  nome: string;
}

export interface RegistrarAusenciaModalProps {
  funcionariosAtivos: FuncionarioSimples[];
  periodos: PeriodoSimples[];
  dataInicial: string;
  onFechar: () => void;
  onRegistrar: (payload: RegistrarAusenciaPayload) => Promise<string | null>;
}

export default function RegistrarAusenciaModal({ funcionariosAtivos, periodos, dataInicial, onFechar, onRegistrar }: RegistrarAusenciaModalProps) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  const [funcionarioId, setFuncionarioId] = useState("");
  const [data, setData] = useState(dataInicial);
  const [tipo, setTipo] = useState<TipoAusencia>("falta_dia_inteiro");
  const [horarioReal, setHorarioReal] = useState("");
  const [horarioJanelaInicio, setHorarioJanelaInicio] = useState("");
  const [horarioJanelaFim, setHorarioJanelaFim] = useState("");
  const [observacao, setObservacao] = useState("");

  const precisaHorario = TIPOS_COM_HORARIO.includes(tipo);
  const resultado = calcularAusencia({
    tipo, periodos,
    horarioReal: horarioReal || undefined,
    horarioJanelaInicio: horarioJanelaInicio || undefined,
    horarioJanelaFim: horarioJanelaFim || undefined,
  });

  function resetFormulario() {
    setFuncionarioId("");
    setTipo("falta_dia_inteiro");
    setHorarioReal("");
    setHorarioJanelaInicio("");
    setHorarioJanelaFim("");
    setObservacao("");
    setErro(null);
    // encerra a tentativa atual (sucesso OU cancelar) — chave nova pra
    // próxima, senão uma tentativa cancelada/incerta poderia ser
    // reaproveitada por um lançamento seguinte diferente.
    setIdempotencyKey(crypto.randomUUID());
  }

  const podeSalvar = !salvando && !!funcionarioId && !!data && !!tipo && (!precisaHorario || resultado !== null);

  async function salvar() {
    if (!podeSalvar || !resultado) return;
    setSalvando(true);
    setErro(null);
    const erroRpc = await onRegistrar({
      funcionarioId, data, tipo,
      horarioInicio: resultado.horarioInicio,
      horarioFim: resultado.horarioFim,
      duracaoMinutos: resultado.duracaoMinutos,
      observacao,
      idempotencyKey,
    });
    if (erroRpc) {
      setErro(erroRpc);
      setSalvando(false);
      return;
    }
    setSalvando(false);
    setSucesso(true);
  }

  // Cancelar == encerrar a tentativa atual (ver resetFormulario).
  function cancelar() {
    resetFormulario();
    onFechar();
  }

  if (sucesso) {
    return (
      <div className="stx-modal-backdrop" onClick={onFechar}>
        <div className="stx-ap-modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="stx-ap-confirm">
            <p className="stx-ap-confirm-check">✓ Ausência registrada</p>
            <div className="stx-ap-confirm-actions">
              <button type="button" className="stx-ap-btn-primary" onClick={onFechar}>Fechar</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stx-modal-backdrop" onClick={!salvando ? cancelar : undefined}>
      <div className="stx-ap-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="stx-ap-modal-head">
          <p className="stx-ap-modal-title" style={{ margin: 0 }}>Registrar ausência</p>
          <button type="button" className="stx-ap-modal-close" onClick={cancelar} aria-label="Fechar">✕</button>
        </div>

        <div className="stx-ap-field" style={{ marginTop: 20 }}>
          <label className="stx-ap-field-label">Funcionário</label>
          <select className="stx-ap-select" value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)}>
            <option value="">Selecione…</option>
            {funcionariosAtivos.map((f) => (
              <option key={f.id} value={f.id}>{f.nome}</option>
            ))}
          </select>
        </div>

        <div className="stx-ap-field">
          <label className="stx-ap-field-label">Data</label>
          <DatePicker className="stx-ap-input" value={data} onChange={setData} />
        </div>

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
          <input type="text" className="stx-ap-input" value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Motivo, contexto..." />
        </div>

        {erro && <p className="stx-ap-error">{erro}</p>}

        <div className="stx-ap-actions">
          <button type="button" className="stx-ap-btn-primary" disabled={!podeSalvar} onClick={salvar}>
            {salvando ? "Salvando…" : "Registrar ausência"}
          </button>
          <button type="button" className="stx-ap-btn-secondary" onClick={cancelar} disabled={salvando}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
