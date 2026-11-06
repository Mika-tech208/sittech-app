"use client";

// "Outro período" — seletor de data+período pra lançamento retroativo.
// Só mostra períodos válidos: dias anteriores (todos os 6 períodos) ou
// períodos de hoje que já terminaram — nunca período futuro nem o de
// hoje ainda em andamento (mesma regra que
// registrar_apontamento_producao_retroativo valida no servidor).

import { useMemo, useState } from "react";
import { dataLocalSP, horaLocalSP } from "@/hooks/useProducaoRealPainel";
import DatePicker from "@/components/shared/DatePicker";
import type { Periodo } from "@/types/domain";
import { TEXTO_PLANO_FUTURO_CURTO } from "@/features/produto-canonico/planoFuturo";

export interface PeriodoSeletorModalProps {
  periodos: Periodo[];
  onSelecionar: (data: string, periodoId: string) => void;
  onFechar: () => void;
  /** datas de semana em PLANEJAMENTO do produto único (plano futuro, NÃO liberado): nenhum período delas pode ser aberto para lançamento */
  dataBloqueada?: (dataIso: string) => boolean;
}

export default function PeriodoSeletorModal({ periodos, onSelecionar, onFechar, dataBloqueada }: PeriodoSeletorModalProps) {
  const hoje = useMemo(() => dataLocalSP(), []);
  const horaAtual = useMemo(() => horaLocalSP().slice(0, 5), []);
  const [data, setData] = useState(hoje);
  const [periodoId, setPeriodoId] = useState("");

  const bloqueada = !!dataBloqueada && dataBloqueada(data);
  const periodosValidos = useMemo(() => {
    if (bloqueada) return [];
    if (data > hoje) return [];
    if (data === hoje) return periodos.filter((p) => p.fim <= horaAtual);
    return periodos;
  }, [periodos, data, hoje, horaAtual, bloqueada]);

  const podeConfirmar = !bloqueada && !!data && !!periodoId && periodosValidos.some((p) => p.id === periodoId);

  return (
    <div className="stx-modal-backdrop" onClick={onFechar}>
      <div className="stx-ap-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="stx-ap-modal-head">
          <p className="stx-ap-modal-title" style={{ margin: 0 }}>Outro período</p>
          <button type="button" className="stx-ap-modal-close" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        <p className="stx-ap-modal-eyebrow" style={{ marginTop: 8 }}>
          Só mostra períodos já encerrados — não é possível lançar um período futuro ou ainda em andamento.
        </p>

        <div className="stx-ap-field" style={{ marginTop: 16 }}>
          <label className="stx-ap-field-label">Data</label>
          <DatePicker
            className="stx-ap-input"
            value={data}
            max={hoje}
            onChange={(v) => { setData(v); setPeriodoId(""); }}
          />
        </div>

        <div className="stx-ap-field">
          <label className="stx-ap-field-label">Período</label>
          <select className="stx-ap-select" value={periodoId} onChange={(e) => setPeriodoId(e.target.value)}>
            <option value="">Selecione…</option>
            {periodosValidos.map((p) => (
              <option key={p.id} value={p.id}>{p.nome} · {p.inicio}–{p.fim}</option>
            ))}
          </select>
          {bloqueada && <p className="stx-ap-error" role="status">{TEXTO_PLANO_FUTURO_CURTO}</p>}
          {!bloqueada && periodosValidos.length === 0 && (
            <p className="stx-ap-error">Nenhum período encerrado nessa data ainda.</p>
          )}
        </div>

        <div className="stx-ap-actions">
          <button
            type="button"
            className="stx-ap-btn-primary"
            disabled={!podeConfirmar}
            onClick={() => onSelecionar(data, periodoId)}
          >
            Ver este período
          </button>
          <button type="button" className="stx-ap-btn-secondary" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
