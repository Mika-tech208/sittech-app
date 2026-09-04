"use client";

// Fluxo "Encerrar ocorrência" — aberto a partir do pill "PARADA AGORA" do
// card (ação independente da ação de período do mesmo card). Mostra o
// contexto congelado na abertura (produto/funcionário/motivo/descrição) e
// só pede a descrição da solução; não pede horário de encerramento — o
// backend usa now(). "Tempo decorrido" é só informativo (recalculado a
// cada render a partir de abertaEm — não é enviado a lugar nenhum).

import { useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { OcorrenciaAberta } from "@/hooks/useProducaoRealPainel";
import { mensagemErroOcorrencia } from "./calculations";
import { formatarTempoDecorrido } from "@/lib/tempoDecorrido";

export interface EncerrarOcorrenciaModalProps {
  maquinaId: string;
  maquinaNome: string;
  ocorrencia: OcorrenciaAberta;
  onFechar: () => void;
  onEncerrada: (maquinaId: string) => void;
}

function formatHorario(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

type Etapa = "resumo" | "salvando" | "confirmado";

export default function EncerrarOcorrenciaModal({ maquinaId, maquinaNome, ocorrencia, onFechar, onEncerrada }: EncerrarOcorrenciaModalProps) {
  const [etapa, setEtapa] = useState<Etapa>("resumo");
  const [descricaoSolucao, setDescricaoSolucao] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const podeEncerrar = etapa !== "salvando" && descricaoSolucao.trim().length > 0;

  async function encerrar() {
    if (!podeEncerrar) return;
    setEtapa("salvando");
    setErro(null);

    const { data, error } = await supabase.rpc("encerrar_ocorrencia_maquina", {
      p_ocorrencia_id: ocorrencia.id,
      p_descricao_solucao: descricaoSolucao.trim(),
    });

    if (error || !data) {
      setErro(mensagemErroOcorrencia(error?.message));
      setEtapa("resumo");
      return;
    }

    setEtapa("confirmado");
    onEncerrada(maquinaId);
  }

  return (
    <div className="stx-modal-backdrop" onClick={etapa === "resumo" ? onFechar : undefined}>
      <div className="stx-modal-card stx-pr-modal" onClick={(e) => e.stopPropagation()}>
        {etapa === "confirmado" ? (
          <div className="stx-pr-confirmacao">
            <p className="stx-pr-confirmacao-check">✓ Parada encerrada</p>
            <p className="stx-pr-confirmacao-produto">{maquinaNome}</p>
            <div className="stx-pr-confirmacao-acoes">
              <button type="button" className="stx-btn-primary" onClick={onFechar}>Fechar</button>
            </div>
          </div>
        ) : (
          <>
            <p className="stx-modal-titulo">{maquinaNome} — 🔴 parada agora</p>

            <div className="stx-pr-resumo-linhas">
              <div className="stx-pr-resumo-linha"><span>Produto</span><b>{ocorrencia.produtoNome}</b></div>
              <div className="stx-pr-resumo-linha"><span>Funcionário</span><b>{ocorrencia.funcionarioNome}</b></div>
              <div className="stx-pr-resumo-linha"><span>Motivo</span><b>{ocorrencia.motivoNome}</b></div>
              <div className="stx-pr-resumo-linha"><span>O que aconteceu</span><b>{ocorrencia.descricao}</b></div>
              <div className="stx-pr-resumo-linha"><span>Parou às</span><b>{formatHorario(ocorrencia.abertaEm)}</b></div>
              <div className="stx-pr-resumo-linha"><span>Tempo decorrido</span><b>{formatarTempoDecorrido(ocorrencia.abertaEm)}</b></div>
            </div>

            <div style={{ marginTop: 16, marginBottom: 16 }}>
              <label className="stx-label">O que foi feito para resolver?</label>
              <input
                type="text"
                className="stx-input"
                value={descricaoSolucao}
                onChange={(e) => setDescricaoSolucao(e.target.value)}
                placeholder="Descreva a solução"
              />
            </div>

            {erro && <p className="stx-save-error" style={{ marginBottom: 12 }}>{erro}</p>}

            <div className="stx-form-actions" style={{ flexDirection: "column" }}>
              <button type="button" className="stx-btn-primary" disabled={!podeEncerrar} onClick={encerrar}>
                {etapa === "salvando" ? "Salvando…" : "ENCERRAR PARADA"}
              </button>
              <button type="button" className="stx-btn-secondary" onClick={onFechar} disabled={etapa === "salvando"}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
