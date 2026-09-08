"use client";

// Fluxo "Sem produção neste período" — máquina e período já definidos,
// só motivo (+ descrição obrigatória quando o motivo é "Outro"). Nunca
// mostra produto, funcionário, meta, Performance, OEE ou custo — esses
// campos não existem em registrar_sem_producao, de propósito.

import { useState } from "react";
import { supabase } from "@/services/supabase-client";
import { mensagemErroRegistrarLancamento } from "./calculations";

export const MOTIVOS: { valor: string; label: string }[] = [
  { valor: "sem_programacao", label: "Sem programação" },
  { valor: "falta_material", label: "Falta de material" },
  { valor: "falta_operador", label: "Falta de operador" },
  { valor: "manutencao_programada", label: "Manutenção programada" },
  { valor: "outro", label: "Outro" },
];

export const LABEL_MOTIVO_SEM_PRODUCAO: Record<string, string> = Object.fromEntries(
  MOTIVOS.map((m) => [m.valor, m.label])
);

export interface SemProducaoModalProps {
  maquinaId: string;
  maquinaNome: string;
  periodoNome: string;
  periodoHorario: string;
  modoRetroativo?: { data: string; periodoId: string } | null;
  onFechar: () => void;
  onRegistrado: (info: { maquinaId: string; motivo: string }) => void;
  onProximaMaquina: () => void;
  temProximaPendente: boolean;
}

type Etapa = "preenchendo" | "salvando" | "confirmado";

export default function SemProducaoModal({
  maquinaId, maquinaNome, periodoNome, periodoHorario, modoRetroativo,
  onFechar, onRegistrado, onProximaMaquina, temProximaPendente,
}: SemProducaoModalProps) {
  // Gerada uma vez, na abertura deste formulário — mesma regra do
  // apontamento de produção: reutilizada em qualquer retry.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [etapa, setEtapa] = useState<Etapa>("preenchendo");
  const [motivo, setMotivo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [motivoSalvo, setMotivoSalvo] = useState("");

  const precisaDescricao = motivo === "outro";
  const podeConfirmar = etapa !== "salvando" && !!motivo && (!precisaDescricao || descricao.trim().length > 0);

  async function confirmar() {
    if (!podeConfirmar) return;
    setEtapa("salvando");
    setErro(null);

    const { error } = modoRetroativo
      ? await supabase.rpc("registrar_sem_producao_retroativo", {
          p_maquina_id: maquinaId,
          p_motivo_sem_producao: motivo,
          p_idempotency_key: idempotencyKey,
          p_data: modoRetroativo.data,
          p_periodo_id: modoRetroativo.periodoId,
          p_descricao_sem_producao: precisaDescricao ? descricao.trim() : null,
        })
      : await supabase.rpc("registrar_sem_producao", {
          p_maquina_id: maquinaId,
          p_motivo_sem_producao: motivo,
          p_idempotency_key: idempotencyKey,
          p_descricao_sem_producao: precisaDescricao ? descricao.trim() : null,
        });

    if (error) {
      setErro(mensagemErroRegistrarLancamento(error.message));
      setEtapa("preenchendo");
      return;
    }

    setMotivoSalvo(motivo);
    setEtapa("confirmado");
    onRegistrado({ maquinaId, motivo });
  }

  return (
    <div className="stx-modal-backdrop" onClick={etapa === "preenchendo" ? onFechar : undefined}>
      <div className="stx-ap-modal-card" onClick={(e) => e.stopPropagation()}>
        {etapa === "confirmado" ? (
          <div className="stx-ap-confirm">
            <p className="stx-ap-confirm-check">✓ Período fechado</p>
            <p className="stx-ap-confirm-detail">Sem produção — {LABEL_MOTIVO_SEM_PRODUCAO[motivoSalvo] || motivoSalvo}</p>
            <div className="stx-ap-confirm-actions">
              {temProximaPendente && (
                <button type="button" className="stx-ap-btn-primary" onClick={onProximaMaquina}>Próxima máquina</button>
              )}
              <button type="button" className="stx-ap-btn-secondary" onClick={onFechar}>Ver todas</button>
            </div>
          </div>
        ) : (
          <>
            <div className="stx-ap-modal-head">
              <div>
                <p className="stx-ap-modal-eyebrow">{maquinaNome} · {periodoNome} · {periodoHorario}</p>
                <p className="stx-ap-modal-title">Sem produção neste período</p>
              </div>
              <button type="button" className="stx-ap-modal-close" onClick={onFechar} aria-label="Fechar">✕</button>
            </div>

            <label className="stx-ap-field-label" style={{ marginTop: 20 }}>Motivo</label>
            <div className="stx-ap-motivo-grid">
              {MOTIVOS.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  className={`stx-ap-motivo-btn ${motivo === m.valor ? "selecionado" : ""}`}
                  onClick={() => setMotivo(m.valor)}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {precisaDescricao && (
              <div className="stx-ap-field" style={{ marginTop: 16 }}>
                <label className="stx-ap-field-label">Descrição</label>
                <input
                  type="text"
                  className="stx-ap-input"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Descreva o motivo"
                />
              </div>
            )}

            {erro && <p className="stx-ap-error">{erro}</p>}

            <div className="stx-ap-actions">
              <button type="button" className="stx-ap-btn-primary" disabled={!podeConfirmar} onClick={confirmar}>
                {etapa === "salvando" ? "Salvando…" : "Confirmar"}
              </button>
              <button type="button" className="stx-ap-btn-secondary" onClick={onFechar} disabled={etapa === "salvando"}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
