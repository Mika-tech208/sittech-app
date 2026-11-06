// Estado das telas OPERACIONAIS (tablet/Produção Real) para período de semana em PLANEJAMENTO: sem postos, sem apontamento, sem fechamento, sem botões de ação.
import { EXPLICACAO_PLANO_FUTURO, TEXTO_AGUARDANDO_PROGRAMACAO, TEXTO_PLANO_FUTURO_CURTO } from "../planoFuturo";

export default function BloqueioPlanoFuturo({ comExplicacao = true }: { comExplicacao?: boolean }) {
  return (
    <div className="stx-empty" role="status" data-testid="bloqueio-plano-futuro">
      <p style={{ fontWeight: 800, margin: "0 0 6px" }}>{TEXTO_PLANO_FUTURO_CURTO}</p>
      <p style={{ fontWeight: 700, margin: "0 0 6px" }}>{TEXTO_AGUARDANDO_PROGRAMACAO}</p>
      {comExplicacao && <p style={{ margin: 0 }}>{EXPLICACAO_PLANO_FUTURO}</p>}
    </div>
  );
}
