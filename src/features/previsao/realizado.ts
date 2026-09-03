// Consolidação por produto — Previsto / Possível / Realizado / Falta / %
// concluído. Funções puras: nenhuma fórmula de capacidade é recalculada
// aqui (Possível vem pronto de calcularCapacidadeMaximaSemana), nenhuma
// fórmula de Performance é usada — só cruza previsão × realizado por
// produto_id.
//
// Falta e % concluído seguem a regra pedida:
// - falta = max(0, previsto - realizado) — nunca negativo.
// - concluidoPct = realizado / previsto * 100, SEM teto em 100 (produção
//   acima do previsto aparece como >100%); previsto 0 -> null (N/A).

import type { PrevisaoItem } from "@/types/domain";
import type { ResultadoItemCapacidadeMaxima } from "@/features/capacidade/types";
import type { RealizadoProdutoSemana } from "@/hooks/useRealizadoPrevisao";

export interface ProdutoProgramado {
  itemId: string;
  produtoId: string;
  produtoNome: string;
  previsto: number;
  possivel: number;
  realizado: number;
  falta: number;
  concluidoPct: number | null;
}

export function calcularProdutosProgramados(
  itens: PrevisaoItem[],
  resultadosCapacidade: ResultadoItemCapacidadeMaxima[],
  realizadoPorProduto: Map<string, number>
): ProdutoProgramado[] {
  return itens.map((it) => {
    const resultado = resultadosCapacidade.find((r) => r.itemId === it.id);
    const possivel = resultado ? resultado.maximoPossivel : it.quantidade;
    const realizado = realizadoPorProduto.get(it.produtoId) || 0;
    const falta = Math.max(0, it.quantidade - realizado);
    const concluidoPct = it.quantidade > 0 ? (realizado / it.quantidade) * 100 : null;
    return { itemId: it.id, produtoId: it.produtoId, produtoNome: it.produtoNome, previsto: it.quantidade, possivel, realizado, falta, concluidoPct };
  });
}

export interface ResumoProgramacaoPecas {
  totalPrevisto: number;
  totalRealizado: number;
  concluidoPct: number | null;
}

// Soma simples de peças dos produtos PREVISTOS (não inclui produção fora
// da previsão — ver calcularProdutosNaoPrevistos) — indicador de
// acompanhamento, não de capacidade (somar peças de produtos diferentes
// não representa uso de capacidade fabril).
export function calcularResumoProgramacaoPecas(produtos: ProdutoProgramado[]): ResumoProgramacaoPecas {
  const totalPrevisto = produtos.reduce((s, p) => s + p.previsto, 0);
  const totalRealizado = produtos.reduce((s, p) => s + p.realizado, 0);
  const concluidoPct = totalPrevisto > 0 ? (totalRealizado / totalPrevisto) * 100 : null;
  return { totalPrevisto, totalRealizado, concluidoPct };
}

export interface ProdutoNaoPrevisto {
  produtoId: string;
  produtoNome: string;
  realizado: number;
}

// Produtos com apontamento na semana que não fazem parte da previsão
// atual — puramente informativo (não atribui, não altera nenhum número
// previsto). Ver relatório final: não existia regra de negócio definida
// pra isso antes desta etapa.
export function calcularProdutosNaoPrevistos(
  itens: PrevisaoItem[],
  realizadoTodos: RealizadoProdutoSemana[]
): ProdutoNaoPrevisto[] {
  const previstosIds = new Set(itens.map((it) => it.produtoId));
  return realizadoTodos
    .filter((r) => !previstosIds.has(r.produtoId) && r.quantidadeBoa > 0)
    .map((r) => ({ produtoId: r.produtoId, produtoNome: r.produtoNome, realizado: r.quantidadeBoa }));
}
