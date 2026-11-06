"use client";

// Aviso + botão EXPLÍCITO "Unificar em Conector 3/4" na Previsão (semana de PLANEJAMENTO ou OPERACIONAL com itens dos legados). Apresentação pura: o chamador faz a RPC.
import { useState } from "react";
import type { OfertaUnificar } from "../unificarPrevisao";

export interface UnificarConectorBannerProps {
  oferta: OfertaUnificar;
  formatarQuantidade?: (v: number) => string;
  /** devolve null no sucesso ou a mensagem de erro */
  onUnificar: () => Promise<string | null>;
}

export default function UnificarConectorBanner({ oferta, onUnificar, formatarQuantidade = (v) => v.toLocaleString("pt-BR") }: UnificarConectorBannerProps) {
  const [confirmando, setConfirmando] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const planejamento = oferta.modo === "PLANEJAMENTO";
  const partes = oferta.itensLegados.map((i) => `${i.produtoNome}: ${formatarQuantidade(i.quantidade)}`).join(" + ");

  async function confirmar() {
    setExecutando(true);
    setErro(null);
    const r = await onUnificar();
    setExecutando(false);
    if (r) { setErro(r); setConfirmando(false); }
  }

  return (
    <div className="stx-panel" data-testid="unificar-conector">
      <p className="stx-panel-title">{planejamento ? "Conector 3/4: esta semana é de PLANEJAMENTO com o produto único" : "Conector 3/4: esta semana usa o produto único"}</p>
      {planejamento && (
        <p className="stx-panel-sub" data-testid="unificar-planejamento">
          Plano futuro, ainda não liberado para produção: a operação de hoje (apontamento, fechamento, Escala liberada) continua como está. Unificar mexe só na Previsão desta semana.
        </p>
      )}
      <p className="stx-panel-sub">
        A semana ainda tem os itens antigos ({partes}). {planejamento ? "Ao unificar, os itens antigos são retirados da Previsão desta semana (a RPC guarda um backup) e entra um único item de Conector 3/4." : "Eles não podem ser salvos de novo depois do cutover."}
        {oferta.jaTemUnico ? " Já existe um item do Conector 3/4 nesta semana: exclua um dos dois antes de unificar." : ` Unificar cria UM item de Conector 3/4 com ${formatarQuantidade(oferta.total)} peças e leva junto as máquinas escolhidas. Você pode ajustar depois.`}
      </p>
      {erro && <p className="stx-panel-sub" role="alert" style={{ color: "var(--danger, #b00020)" }}>{erro}</p>}
      {!oferta.jaTemUnico && !confirmando && (
        <button className="stx-add-btn blueprint" onClick={() => setConfirmando(true)}>Unificar em Conector 3/4</button>
      )}
      {!oferta.jaTemUnico && confirmando && (
        <div>
          <p className="stx-panel-sub" data-testid="unificar-confirmacao">Confirmar: {partes} = <strong>{formatarQuantidade(oferta.total)}</strong> peças em um único item{planejamento ? ", retirando os dois itens antigos desta Previsão" : ""}?</p>
          <button className="stx-add-btn blueprint" disabled={executando} onClick={() => void confirmar()}>{executando ? "Unificando…" : "Sim, unificar"}</button>
          <button className="stx-add-btn" disabled={executando} onClick={() => setConfirmando(false)}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
