// PRODUTO ENCERRADO NA SEMANA (08/11/2026). Funções puras.
//
// A Previsão guarda, por produto, a META ORIGINAL que havia sido prevista e o carimbo do encerramento (tabela previsao_encerramentos). Enquanto o produto está encerrado, o BANCO mantém
// quantidade = 0 e adicional = 0 nos itens previstos — é isso que o motor lê (demanda restante operacional = 0, nunca programa, não ocupa máquina/pessoa, não gera WIP). A produção REAL
// continua vindo dos apontamentos: é fato histórico e não depende de o produto continuar na Previsão.
//
// DEFINIÇÕES (usadas em toda a tela da Previsão):
//   previsto ORIGINAL   = a meta que havia sido prevista (item ativo: `quantidade`; item encerrado: `quantidadeOriginal`).
//   previsto OPERACIONAL = o que ainda é obrigação: item ativo = `quantidade`; item ENCERRADO = min(original, apontado) — o que foi produzido conta como cumprido e o SALDO CANCELADO sai da obrigação.
//   falta operacional   = max(previsto operacional − apontado, 0)  (0 para encerrado: o saldo cancelado NÃO é falta)
//   cancelado           = max(original − apontado, 0) de produto encerrado (informativo: "27.930 produzidas antes do encerramento")
//   % concluído         = apontado real total ÷ previsto operacional total (sem teto). Produto encerrado entra com o que produziu nos dois lados; o cancelado não pesa.
import type { PrevisaoItem } from "@/types/domain";

export interface EncerramentoProduto {
  produtoId: string;
  quantidadeOriginal: number;
  adicionalOriginal: number;
  encerradoEm: string;
  motivo: string | null;
}

interface LinhaEncerramento {
  produto_id?: string; quantidade_original?: number | string | null; adicional_original?: number | string | null; encerrado_em?: string | null; motivo?: string | null; reaberto_em?: string | null;
}

/** Linhas de previsao_encerramentos (ignora as REABERTAS) no formato do app. */
export function lerEncerramentos(linhas: LinhaEncerramento[] | null | undefined): EncerramentoProduto[] {
  return (linhas ?? [])
    .filter((l) => l && l.produto_id && !l.reaberto_em)
    .map((l) => ({ produtoId: String(l.produto_id), quantidadeOriginal: Number(l.quantidade_original ?? 0), adicionalOriginal: Number(l.adicional_original ?? 0), encerradoEm: String(l.encerrado_em ?? ""), motivo: l.motivo ?? null }));
}

/** Marca os itens dos produtos encerrados. A meta original (soma do produto na semana) fica no PRIMEIRO item do produto; os demais itens do mesmo produto carregam 0 (a soma não duplica). */
export function aplicarEncerramentosAosItens<T extends PrevisaoItem>(itens: T[], encerramentos: EncerramentoProduto[]): T[] {
  if (encerramentos.length === 0) return itens;
  const porProduto = new Map(encerramentos.map((e) => [e.produtoId, e]));
  const jaAtribuido = new Set<string>();
  return itens.map((it) => {
    const e = porProduto.get(it.produtoId);
    if (!e) return it;
    const primeiro = !jaAtribuido.has(it.produtoId);
    jaAtribuido.add(it.produtoId);
    return { ...it, encerrado: { quantidadeOriginal: primeiro ? e.quantidadeOriginal : 0, adicionalOriginal: primeiro ? e.adicionalOriginal : 0, encerradoEm: e.encerradoEm, motivo: e.motivo } };
  });
}

export const itemEncerrado = (it: Pick<PrevisaoItem, "encerrado">): boolean => !!it.encerrado;
/** previsto ORIGINAL do item (meta que havia sido prevista). */
export const previstoOriginalDoItem = (it: Pick<PrevisaoItem, "quantidade" | "encerrado">): number => (it.encerrado ? it.encerrado.quantidadeOriginal : it.quantidade);
/** previsto OPERACIONAL do item dado o apontado dele (null = apontado indisponível). */
export function previstoOperacionalDoItem(it: Pick<PrevisaoItem, "quantidade" | "encerrado">, apontado: number | null): number | null {
  if (!it.encerrado) return it.quantidade;
  return apontado === null ? null : Math.min(it.encerrado.quantidadeOriginal, apontado);
}
