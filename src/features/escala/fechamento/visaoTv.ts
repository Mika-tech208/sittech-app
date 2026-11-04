// Decisão (pura) do que a TV pode mostrar ao chão. Fonte de verdade = fechamento físico CONFIRMADO do período anterior (ver selo.ts → statusLiberacao).
// Só controla a EXIBIÇÃO: o plano interno/estimado continua existindo no banco, mas não é autorização operacional.
import { textoTvNaoLiberada, type StatusLiberacao } from "./selo";

export interface PeriodoTvMin { id: string; nome: string }
export interface BloqueioTv { titulo: string; detalhe: string }
export interface VisaoLiberacaoTv {
  atual: { liberado: boolean; bloqueio: BloqueioTv | null };
  proximo: { liberado: boolean; bloqueio: BloqueioTv | null };
  /** "M3 LIBERADO" logo após a confirmação */
  bannerLiberado: string | null;
}
export const JANELA_BANNER_LIBERADO_MS = 120_000;

export function visaoLiberacaoTv(i: { modo: string | null | undefined; liberacao: Record<string, StatusLiberacao> | null | undefined; atual: PeriodoTvMin | null; proximo: PeriodoTvMin | null; agoraMs: number; ignorar?: boolean }): VisaoLiberacaoTv {
  const livre = { liberado: true, bloqueio: null };
  if (i.ignorar) return { atual: livre, proximo: livre, bannerLiberado: null };
  // estado ainda DESCONHECIDO (1ª leitura / API fora): nunca expõe o PRÓXIMO período; o período em execução segue visível (não deixa a fábrica sem tela por falha de rede)
  if (i.modo === null || i.modo === undefined || i.liberacao === null || i.liberacao === undefined) {
    return { atual: livre, proximo: i.proximo ? { liberado: false, bloqueio: { titulo: "VERIFICANDO LIBERAÇÃO", detalhe: "Aguardando confirmação da programação." } } : livre, bannerLiberado: null };
  }
  if (i.modo !== "ativo") return { atual: livre, proximo: livre, bannerLiberado: null };
  const avalia = (p: PeriodoTvMin | null) => {
    if (!p) return livre;
    const st = i.liberacao![p.id];
    if (!st || st.liberado) return livre;
    return { liberado: false, bloqueio: textoTvNaoLiberada(st, p.nome) };
  };
  const stAtual = i.atual ? i.liberacao[i.atual.id] : undefined;
  const banner = i.atual && stAtual?.liberado && stAtual.motivo === "CONFIRMADO" && stAtual.fechadoEmMs !== null && i.agoraMs >= stAtual.fechadoEmMs && i.agoraMs - stAtual.fechadoEmMs < JANELA_BANNER_LIBERADO_MS ? `${i.atual.nome} LIBERADO` : null;
  return { atual: avalia(i.atual), proximo: avalia(i.proximo), bannerLiberado: banner };
}
