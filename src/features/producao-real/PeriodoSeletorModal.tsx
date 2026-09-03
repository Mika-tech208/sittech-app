"use client";

// "Outro período" — seletor de data+período pra lançamento retroativo.
// Só mostra períodos válidos: dias anteriores (todos os 6 períodos) ou
// períodos de hoje que já terminaram — nunca período futuro nem o de
// hoje ainda em andamento (mesma regra que
// registrar_apontamento_producao_retroativo valida no servidor).

import { useMemo, useState } from "react";
import { dataLocalSP, horaLocalSP } from "@/hooks/useProducaoRealPainel";
import type { Periodo } from "@/types/domain";

export interface PeriodoSeletorModalProps {
  periodos: Periodo[];
  onSelecionar: (data: string, periodoId: string) => void;
  onFechar: () => void;
}

export default function PeriodoSeletorModal({ periodos, onSelecionar, onFechar }: PeriodoSeletorModalProps) {
  const hoje = useMemo(() => dataLocalSP(), []);
  const horaAtual = useMemo(() => horaLocalSP().slice(0, 5), []);
  const [data, setData] = useState(hoje);
  const [periodoId, setPeriodoId] = useState("");

  const periodosValidos = useMemo(() => {
    if (data > hoje) return [];
    if (data === hoje) return periodos.filter((p) => p.fim <= horaAtual);
    return periodos;
  }, [periodos, data, hoje, horaAtual]);

  const podeConfirmar = !!data && !!periodoId && periodosValidos.some((p) => p.id === periodoId);

  return (
    <div className="stx-modal-backdrop" onClick={onFechar}>
      <div className="stx-modal-card stx-pr-modal" onClick={(e) => e.stopPropagation()}>
        <p className="stx-modal-titulo">Outro período</p>
        <p className="stx-panel-sub" style={{ marginTop: -10, marginBottom: 16 }}>
          Só mostra períodos já encerrados — não é possível lançar um período futuro ou ainda em andamento.
        </p>

        <div style={{ marginBottom: 12 }}>
          <label className="stx-label">Data</label>
          <input
            type="date"
            className="stx-input"
            value={data}
            max={hoje}
            onChange={(e) => { setData(e.target.value); setPeriodoId(""); }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label className="stx-label">Período</label>
          <select className="stx-select" value={periodoId} onChange={(e) => setPeriodoId(e.target.value)}>
            <option value="">Selecione…</option>
            {periodosValidos.map((p) => (
              <option key={p.id} value={p.id}>{p.nome} · {p.inicio}–{p.fim}</option>
            ))}
          </select>
          {periodosValidos.length === 0 && (
            <p className="stx-save-error" style={{ marginTop: 6 }}>Nenhum período encerrado nessa data ainda.</p>
          )}
        </div>

        <div className="stx-form-actions" style={{ flexDirection: "column" }}>
          <button
            type="button"
            className="stx-btn-primary"
            disabled={!podeConfirmar}
            onClick={() => onSelecionar(data, periodoId)}
          >
            VER ESTE PERÍODO
          </button>
          <button type="button" className="stx-btn-secondary" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
