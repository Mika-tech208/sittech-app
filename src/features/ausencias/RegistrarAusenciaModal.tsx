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
import type { RegistrarAusenciaPayload, RegistrarLotePayload } from "@/hooks/useAusenciasFuncionarios";
import { diaSemanaCurto, gerarDiasDoIntervalo, resumirResultadoLote, type ResultadoDiaLote, type ResumoLote } from "./lote";
import { isoParaBR } from "@/lib/date";

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
  onRegistrarLote: (payload: RegistrarLotePayload) => Promise<{ erro: string | null; resultados: ResultadoDiaLote[] }>;
}

export default function RegistrarAusenciaModal({ funcionariosAtivos, periodos, dataInicial, onFechar, onRegistrar, onRegistrarLote }: RegistrarAusenciaModalProps) {
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

  // ---- vários dias: um registro por dia, a supervisora confirma cada dia ----
  const [variosDias, setVariosDias] = useState(false);
  const [dataFim, setDataFim] = useState(dataInicial);
  const [desmarcados, setDesmarcados] = useState<string[]>([]);
  const [resumoLote, setResumoLote] = useState<ResumoLote | null>(null);
  const intervalo = variosDias ? gerarDiasDoIntervalo(data, dataFim) : { dias: [] as string[], erro: null };
  const diasSelecionados = intervalo.dias.filter((d) => !desmarcados.includes(d));

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
    setVariosDias(false);
    setDataFim(data);
    setDesmarcados([]);
    setErro(null);
    // encerra a tentativa atual (sucesso OU cancelar) — chave nova pra
    // próxima, senão uma tentativa cancelada/incerta poderia ser
    // reaproveitada por um lançamento seguinte diferente.
    setIdempotencyKey(crypto.randomUUID());
  }

  const podeSalvar = !salvando && !!funcionarioId && !!data && !!tipo && (!precisaHorario || resultado !== null)
    && (!variosDias || (!!dataFim && !intervalo.erro && diasSelecionados.length > 0));

  async function salvar() {
    if (!podeSalvar || !resultado) return;
    setSalvando(true);
    setErro(null);
    if (variosDias) {
      const { erro: erroLote, resultados } = await onRegistrarLote({
        funcionarioId, datas: diasSelecionados, tipo,
        horarioInicio: resultado.horarioInicio,
        horarioFim: resultado.horarioFim,
        duracaoMinutos: resultado.duracaoMinutos,
        observacao,
        loteKey: idempotencyKey,
      });
      if (erroLote) {
        setErro(erroLote);
        setSalvando(false);
        return;
      }
      setResumoLote(resumirResultadoLote(resultados, intervalo.dias, diasSelecionados));
      setSalvando(false);
      setSucesso(true);
      return;
    }
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

  if (sucesso && resumoLote) {
    const fmt = (ds: string[]) => ds.map((d) => `${isoParaBR(d).slice(0, 5)} (${diaSemanaCurto(d)})`).join(", ");
    return (
      <div className="stx-modal-backdrop" onClick={onFechar}>
        <div className="stx-ap-modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="stx-ap-confirm">
            <p className="stx-ap-confirm-check">
              {resumoLote.criados.length > 0 ? `✓ ${resumoLote.criados.length} ausência${resumoLote.criados.length === 1 ? "" : "s"} registrada${resumoLote.criados.length === 1 ? "" : "s"}` : "Nenhuma ausência nova registrada"}
            </p>
            <div className="stx-ap-resumo-linhas" style={{ textAlign: "left", marginTop: 12 }}>
              {resumoLote.criados.length > 0 && <div className="stx-ap-resumo-linha"><span>Dias criados</span><b>{fmt(resumoLote.criados)}</b></div>}
              {resumoLote.jaRegistrados.length > 0 && <div className="stx-ap-resumo-linha"><span>Já registrados nesta ação</span><b>{fmt(resumoLote.jaRegistrados)}</b></div>}
              {resumoLote.conflitos.length > 0 && <div className="stx-ap-resumo-linha"><span>Bloqueados por conflito</span><b style={{ color: "var(--danger)" }}>{fmt(resumoLote.conflitos)}</b></div>}
              {resumoLote.ignorados.length > 0 && <div className="stx-ap-resumo-linha"><span>Ignorados (desmarcados)</span><b>{fmt(resumoLote.ignorados)}</b></div>}
            </div>
            {resumoLote.conflitos.length > 0 && (
              <p className="stx-ap-error" style={{ marginTop: 10 }}>
                Os dias bloqueados já têm ausência registrada nesse dia/horário para este funcionário — nada foi duplicado nem alterado neles.
              </p>
            )}
            <div className="stx-ap-confirm-actions">
              <button type="button" className="stx-ap-btn-primary" onClick={onFechar}>Fechar</button>
            </div>
          </div>
        </div>
      </div>
    );
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

        {!variosDias ? (
          <div className="stx-ap-field">
            <label className="stx-ap-field-label">Data</label>
            <DatePicker className="stx-ap-input" value={data} onChange={setData} />
          </div>
        ) : (
          <div className="stx-ap-field" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            <div>
              <label className="stx-ap-field-label">De</label>
              <DatePicker className="stx-ap-input" value={data} onChange={(v) => { setData(v); if (!dataFim || dataFim < v) setDataFim(v); }} />
            </div>
            <div>
              <label className="stx-ap-field-label">Até</label>
              <DatePicker className="stx-ap-input" value={dataFim} min={data} onChange={setDataFim} />
            </div>
          </div>
        )}

        <label className="stx-maquina-chip" style={{ marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={variosDias}
            disabled={salvando}
            onChange={(e) => { setVariosDias(e.target.checked); setDataFim(data); setDesmarcados([]); }}
          />
          Lançar vários dias de uma vez
        </label>

        {variosDias && (
          <div className="stx-ap-field">
            {intervalo.erro ? (
              <p className="stx-ap-error">{intervalo.erro}</p>
            ) : (
              <>
                <label className="stx-ap-field-label">Dias que serão criados (um registro por dia)</label>
                <div className="stx-etapa-maquinas">
                  {intervalo.dias.map((d) => (
                    <label className="stx-maquina-chip" key={d}>
                      <input
                        type="checkbox"
                        checked={!desmarcados.includes(d)}
                        disabled={salvando}
                        onChange={() => setDesmarcados((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))}
                      />
                      {isoParaBR(d).slice(0, 5)} · {diaSemanaCurto(d)}
                    </label>
                  ))}
                </div>
                <p className="stx-apr-ref" style={{ margin: "6px 0 0" }}>
                  Feriados e fins de semana não são removidos sozinhos — desmarque o que não deve gerar ausência.
                </p>
              </>
            )}
          </div>
        )}

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
          <span>{variosDias ? "Duração por dia" : "Duração calculada"}</span>
          <b>{resultado ? formatarDuracao(resultado.duracaoMinutos) : "—"}</b>
        </div>
        {variosDias && resultado && diasSelecionados.length > 0 && (
          <div className="stx-ausencia-preview">
            <span>{diasSelecionados.length} dia{diasSelecionados.length === 1 ? "" : "s"} no total</span>
            <b>{formatarDuracao(resultado.duracaoMinutos * diasSelecionados.length)}</b>
          </div>
        )}

        <div className="stx-ap-field">
          <label className="stx-ap-field-label">Observação (opcional)</label>
          <input type="text" className="stx-ap-input" value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Motivo, contexto..." />
        </div>

        {erro && <p className="stx-ap-error">{erro}</p>}

        <div className="stx-ap-actions">
          <button type="button" className="stx-ap-btn-primary" disabled={!podeSalvar} onClick={salvar}>
            {salvando ? "Salvando…" : variosDias ? `Registrar ${diasSelecionados.length} dia${diasSelecionados.length === 1 ? "" : "s"}` : "Registrar ausência"}
          </button>
          <button type="button" className="stx-ap-btn-secondary" onClick={cancelar} disabled={salvando}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
