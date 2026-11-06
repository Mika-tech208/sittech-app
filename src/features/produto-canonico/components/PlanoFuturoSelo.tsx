// Selo de plano futuro (semana em PLANEJAMENTO). Apresentação pura.
import { EXPLICACAO_PLANO_FUTURO, TEXTO_PLANO_FUTURO } from "../planoFuturo";

export default function PlanoFuturoSelo({ explicacao = true }: { explicacao?: boolean }) {
  return (
    <div className="stx-esc-banner" role="status" data-testid="plano-futuro-selo" style={{ borderColor: "var(--warning)" }}>
      <b>{TEXTO_PLANO_FUTURO}</b>
      {explicacao && <div style={{ fontWeight: 400, marginTop: 4 }}>{EXPLICACAO_PLANO_FUTURO}</div>}
    </div>
  );
}
