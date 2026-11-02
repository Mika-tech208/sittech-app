// GUARD de listagem/seleção (PURO). Cutover null => os canônicos NÃO aparecem em nenhuma lista e a saída é a MESMA referência da entrada (byte-idêntico ao comportamento atual).
import { produtoUnicoAtivo } from "./cutover";

export interface ProdutoMinimo { id: string; ativo: boolean }

/** Listagem (Produtos, Previsão, Capacidade, Apontamento…): antes do cutover os canônicos ficam escondidos. */
export function produtosVisiveis<T extends ProdutoMinimo>(produtos: T[], idsCanonicos: ReadonlySet<string>, cutover: string | null): T[] {
  if (idsCanonicos.size === 0) return produtos;
  if (cutover) return produtos;
  return produtos.filter((p) => !idsCanonicos.has(p.id));
}

/** Seleção por data (Apontamento/Previsão): semana >= cutover usa o canônico; anterior usa os legados. Sem cutover: lista inalterada (canônicos já escondidos por produtosVisiveis). */
export function produtosSelecionaveis<T extends ProdutoMinimo>(produtos: T[], idsCanonicos: ReadonlySet<string>, idsLegadoMapeados: ReadonlySet<string>, dataIso: string, cutover: string | null): T[] {
  if (!cutover) return produtos.filter((p) => !idsCanonicos.has(p.id));
  return produtoUnicoAtivo(dataIso, cutover) ? produtos.filter((p) => !idsLegadoMapeados.has(p.id)) : produtos.filter((p) => !idsCanonicos.has(p.id));
}
