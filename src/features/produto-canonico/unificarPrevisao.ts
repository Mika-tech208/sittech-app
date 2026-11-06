// "Unificar em Conector 3/4" (PURO): quando a semana já é do produto único (PLANEJAMENTO ou OPERACIONAL, `modoProdutoUnicoDaSemana`) mas a Previsão ainda tem itens dos legados
// (Convencional/Automática), a soma 64.800 + 28.500 = 93.300 só acontece quando o USUÁRIO pede (botão). Nunca automática. A transação é produto_unico_unificar_previsao (banco):
// cria o item único e remove os itens legados DA PREVISÃO daquela semana (com backup). Na semana de PLANEJAMENTO nada operacional muda.
import { modoDaSemana, type GuardaProdutos } from "./guardaDb";
import { produtoUnicoPlanejavel, type ModoProdutoUnico } from "./cutover";

export interface ItemMinimo { id: string; produtoId: string; produtoNome: string; quantidade: number }

export interface OfertaUnificar {
  itensLegados: ItemMinimo[];
  total: number;
  /** a semana já tem o item do produto único (a soma criaria um segundo; o banco recusa) */
  jaTemUnico: boolean;
  /** PLANEJAMENTO (plano futuro, operação inalterada) ou OPERACIONAL (cutover) */
  modo: ModoProdutoUnico;
}

/** null = não oferecer (semana LEGADO, sem produto canônico, ou nenhum item legado). */
export function ofertaUnificar(itens: ItemMinimo[], guarda: GuardaProdutos, semanaInicio: string): OfertaUnificar | null {
  const modo = modoDaSemana(guarda, semanaInicio);
  if (guarda.canonicos.size === 0 || !produtoUnicoPlanejavel(modo)) return null;
  const itensLegados = itens.filter((i) => guarda.legados.has(i.produtoId));
  if (itensLegados.length === 0) return null;
  return { itensLegados, total: itensLegados.reduce((s, i) => s + (Number(i.quantidade) || 0), 0), jaTemUnico: itens.some((i) => guarda.canonicos.has(i.produtoId)), modo };
}

/** Mensagem do banco -> texto para o usuário (códigos F2_*). */
export function mensagemErroUnificar(msg: string): string {
  if (msg.includes("F2_ADICIONAL_NAO_SUPORTADO")) return "Há carga adicional nos itens: o produto único ainda não suporta carga adicional por etapa. Zere a carga adicional e tente de novo.";
  if (msg.includes("F2_REALIZADO_LEGADO")) return "Há 'realizado' manual dos produtos legados nesta semana. Trate-o antes de unificar.";
  if (msg.includes("F2_APONTAMENTO_LEGADO_NA_SEMANA")) return "Já há apontamento dos produtos legados nesta semana: o cutover tem que acontecer no início da semana.";
  if (msg.includes("F2_SEM_CUTOVER") || msg.includes("F2_CUTOVER_POSTERIOR") || msg.includes("F2_SEM_PLANEJAMENTO")) return "O produto único não está ativo (nem em planejamento) para esta semana.";
  if (msg.includes("PRODUTO_UNICO_SEM_PERMISSAO")) return "Sem permissão para alterar a Previsão.";
  return "Não foi possível unificar. Nada foi alterado.";
}
