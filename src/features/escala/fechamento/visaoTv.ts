// Decisão (pura) do que a TV pode mostrar ao chão. A FONTE DE VERDADE é o banco (escala_periodo_liberacao → snapshot.liberacao da RPC da TV):
// fechamento do período ANTERIOR CONFIRMADO + plano gerado por ele. Aqui só se traduz isso em tela. FAIL-CLOSED: sem informação ⇒ não mostra.
import { EXPLICACAO_PLANO_FUTURO, TEXTO_PLANO_FUTURO_CURTO } from "@/features/produto-canonico/planoFuturo";

export interface LiberacaoPeriodo { liberado: boolean; motivo: string; predecessor?: { data: string; periodo: string; rotulo: string }; confirmado_em?: string | null }
export type LiberacaoDia = Record<string, LiberacaoPeriodo>;
export interface PeriodoTvMin { id: string; nome: string }
export interface BloqueioTv { titulo: string; detalhe: string }
export interface VisaoLiberacaoTv {
  atual: { liberado: boolean; bloqueio: BloqueioTv | null };
  proximo: { liberado: boolean; bloqueio: BloqueioTv | null };
  /** "M3 LIBERADO" logo após a confirmação */
  bannerLiberado: string | null;
}
export const JANELA_BANNER_LIBERADO_MS = 120_000;
const livre = { liberado: true, bloqueio: null };

export function textoTvNaoLiberada(st: LiberacaoPeriodo | undefined, rotuloPeriodo: string): BloqueioTv {
  const ant = st?.predecessor?.rotulo ?? "período anterior";
  switch (st?.motivo) {
    case "MODO_MANUAL": return { titulo: "PROGRAMAÇÃO AUTOMÁTICA DESATIVADA", detalhe: "Os apontamentos de produção são lançados manualmente. Esta tela não indica postos nem pessoas." };
    case "ERRO_RECALCULO": return { titulo: "PROGRAMAÇÃO NÃO LIBERADA", detalhe: "Estoque salvo. Aguardando correção do recálculo." };
    case "RECALCULANDO": return { titulo: `RECALCULANDO ${rotuloPeriodo}…`, detalhe: `Fechamento físico de ${ant} concluído. Gerando a programação de ${rotuloPeriodo}.` };
    case "AGUARDANDO_FECHAMENTO":
    case "CONFIRMADO_SEM_PLANO": return { titulo: "AGUARDANDO NOVA PROGRAMAÇÃO", detalhe: `${ant} encerrado. Fechamento físico de ${ant} em andamento — aguarde a programação de ${rotuloPeriodo}.` };
    default: return { titulo: "AGUARDANDO PROGRAMAÇÃO CONFIRMADA", detalhe: "Não foi possível confirmar a programação. Aguarde." };   // sem informação do banco: FAIL-CLOSED
  }
}

export function visaoLiberacaoTv(i: { liberacao: LiberacaoDia | null | undefined; atual: PeriodoTvMin | null; proximo: PeriodoTvMin | null; agoraMs: number; ignorar?: boolean; planoFuturo?: boolean }): VisaoLiberacaoTv {
  // semana em PLANEJAMENTO do produto único: o plano é FUTURO e NÃO LIBERADO, não importa o que a liberação do snapshot diga (nem a simulação de relógio)
  if (i.planoFuturo) { const b = { liberado: false, bloqueio: { titulo: TEXTO_PLANO_FUTURO_CURTO, detalhe: EXPLICACAO_PLANO_FUTURO } }; return { atual: b, proximo: b, bannerLiberado: null }; }
  if (i.ignorar) return { atual: livre, proximo: livre, bannerLiberado: null };
  const avalia = (p: PeriodoTvMin | null) => {
    if (!p) return livre;
    const st = i.liberacao?.[p.id];                       // sem a liberação deste período no snapshot ⇒ BLOQUEADO (fail-closed)
    return st?.liberado === true ? livre : { liberado: false, bloqueio: textoTvNaoLiberada(st, p.nome) };
  };
  const stAtual = i.atual ? i.liberacao?.[i.atual.id] : undefined;
  const confMs = stAtual?.confirmado_em ? Date.parse(stAtual.confirmado_em) : NaN;
  const banner = i.atual && stAtual?.liberado === true && stAtual.motivo === "CONFIRMADO" && Number.isFinite(confMs) && i.agoraMs >= confMs && i.agoraMs - confMs < JANELA_BANNER_LIBERADO_MS ? `${i.atual.nome} LIBERADO` : null;
  return { atual: avalia(i.atual), proximo: avalia(i.proximo), bannerLiberado: banner };
}
