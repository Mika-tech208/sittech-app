"use client";

// REABRIR PERÍODO — aparece quando uma edição/exclusão é recusada porque o período já está CONFIRMADO.
// Abre uma janela de correção de 60 min (auditada, com motivo). Depois o usuário repete a ação que foi recusada. Não recalcula o plano.
import { useState } from "react";
import { reabrirPeriodoApi } from "../apontamento-simplificado/api";

export function erroDePeriodoConfirmado(mensagem: string | undefined | null): boolean {
  return (mensagem ?? "").includes("FECHAMENTO_PERIODO_EM_FECHAMENTO");
}

export default function ReabrirPeriodo({ data, periodoId, rotuloPeriodo, onReaberto }: { data: string; periodoId: string; rotuloPeriodo?: string; onReaberto: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const dataBr = data.split("-").reverse().join("/");

  async function reabrir() {
    if (enviando || motivo.trim().length < 3) return;
    setEnviando(true); setErro(null);
    try {
      const r = await reabrirPeriodoApi(data, periodoId, motivo.trim());
      if (r.status === 200 && r.corpo.ok) { setOk(true); onReaberto(); }
      else setErro(r.corpo.erro ?? "Não foi possível reabrir o período.");
    } catch {
      setErro("Não foi possível reabrir o período. Tente de novo.");
    } finally { setEnviando(false); }
  }

  if (ok) return <p className="stx-ap-confirm-check">✓ Período reaberto por 60 minutos. Repita a alteração agora.</p>;
  return (
    <div className="stx-ap-reabrir" style={{ border: "1px solid #d97706", borderRadius: 8, padding: 12, margin: "8px 0" }}>
      <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Este período ({rotuloPeriodo ?? periodoId.toUpperCase()} de {dataBr}) já está confirmado.</p>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>Para corrigir o lançamento, reabra o período. A correção fica registrada e a janela dura 60 minutos.</p>
      <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo da reabertura (obrigatório)" maxLength={500} style={{ width: "100%", boxSizing: "border-box", marginBottom: 8 }} />
      {erro && <p className="stx-ap-error">{erro}</p>}
      <button type="button" className="stx-ap-btn-primary" onClick={reabrir} disabled={enviando || motivo.trim().length < 3}>{enviando ? "Reabrindo…" : "REABRIR PERÍODO"}</button>
    </div>
  );
}
