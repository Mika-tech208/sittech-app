// GUARD de listagem/seleção (PURO). Sem vigência (nem cutover nem planejamento) => os canônicos NÃO aparecem em nenhuma lista e a saída é a MESMA referência da entrada (byte-idêntico ao comportamento atual).
import { produtoUnicoAtivo, produtoUnicoPlanejavel } from "./cutover";
import { modoDaSemana, type GuardaProdutos } from "./guardaDb";

export interface ProdutoMinimo { id: string; ativo: boolean }

/** Listagem (Produtos, Previsão, Capacidade, Apontamento…): sem nenhuma vigência (`primeiraVigencia` = null) os canônicos ficam escondidos. Com cutover OU planejamento definido, aparecem. */
export function produtosVisiveis<T extends ProdutoMinimo>(produtos: T[], idsCanonicos: ReadonlySet<string>, vigencia: string | null): T[] {
  if (idsCanonicos.size === 0) return produtos;
  if (vigencia) return produtos;
  return produtos.filter((p) => !idsCanonicos.has(p.id));
}

/** Seleção OPERACIONAL por data (Apontamento): semana >= CUTOVER usa o canônico; anterior (inclusive semana de planejamento) usa os legados. Sem cutover: lista inalterada (canônicos já escondidos por produtosVisiveis). */
export function produtosSelecionaveis<T extends ProdutoMinimo>(produtos: T[], idsCanonicos: ReadonlySet<string>, idsLegadoMapeados: ReadonlySet<string>, dataIso: string, cutover: string | null): T[] {
  if (!cutover) return produtos.filter((p) => !idsCanonicos.has(p.id));
  return produtoUnicoAtivo(dataIso, cutover) ? produtos.filter((p) => !idsLegadoMapeados.has(p.id)) : produtos.filter((p) => !idsCanonicos.has(p.id));
}

/** Seleção de PLANEJAMENTO (Previsão): semana em PLANEJAMENTO ou OPERACIONAL (`modoProdutoUnicoDaSemana`) usa o canônico e esconde os legados mapeados; LEGADO usa os legados e esconde o canônico. */
export function produtosSelecionaveisPrevisao<T extends ProdutoMinimo>(produtos: T[], guarda: GuardaProdutos, semanaInicio: string): T[] {
  if (guarda.canonicos.size === 0) return produtos;
  return produtoUnicoPlanejavel(modoDaSemana(guarda, semanaInicio))
    ? produtos.filter((p) => !guarda.legados.has(p.id))
    : produtos.filter((p) => !guarda.canonicos.has(p.id));
}
