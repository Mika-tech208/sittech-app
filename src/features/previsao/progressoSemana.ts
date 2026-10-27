// Progresso da semana na Previsão — Previsto / Possível / APONTADO REAL / Falta / % concluído / valores em R$. Funções puras.
//
// FONTE ÚNICA DO ANDAMENTO: o APONTADO REAL (Produção Real; só a produção boa da ÚLTIMA etapa válida do produto — ver apontadoReal.ts). O "Realizado" digitado à mão
// (previsao_itens, tipo='realizado') NÃO entra em nenhum número daqui — nunca se soma um ao outro (uma peça final apontada entra uma única vez).
// Possível (capacidade/atingibilidade) é outro conceito: vem pronto de calcularCapacidadeMaximaSemana e nunca se mistura com andamento.
//
// - falta = max(previsto - apontado, 0) (nunca negativo); % = apontado / previsto, SEM teto em 100 (produção acima do previsto aparece >100%).
// - Falta total = Σ das faltas POR PRODUTO (cada uma max(previsto - apontado, 0)): excesso de um produto NÃO compensa a falta de outro. O % geral continua
//   Σ apontado / Σ previsto (pode passar de 100%). Excedente (apontado acima do previsto) é reportado à parte, por item e no total.
// - R$: usa o valor_unitario CONGELADO no item da Previsão (nunca o preço atual do cadastro): o histórico da semana não muda se o preço mudar depois.
// - Mesmo produto em dois itens da mesma semana: o apontado do produto é distribuído em sequência (cada item até o seu previsto; o excesso fica no último) — soma uma única vez.
// - apontado indisponível (carregando/erro) => null: a tela mostra "—", nunca um 0 inventado.

import type { PrevisaoItem } from "@/types/domain";
import type { ResultadoItemCapacidadeMaxima } from "@/features/capacidade/types";

export type ApontadoPorProduto = Map<string, { apontadoReal: number; ambiguoPecas: number }>;

export interface ProdutoProgramado {
  itemId: string;
  produtoId: string;
  produtoNome: string;
  previsto: number;
  possivel: number;
  valorUnitario: number; // congelado no item da Previsão
  apontadoReal: number | null; // peças boas da etapa final atribuídas a ESTE item; null = indisponível
  apontadoAmbiguoPecas: number; // peças de apontamentos com roteiro alterado (NÃO contadas); só no 1º item do produto
  falta: number | null;
  excedente: number | null; // apontado acima do previsto deste item (aviso); 0 quando não passou
  concluidoPct: number | null; // sem teto; null = N/A (previsto 0) ou apontado indisponível
  valorPrevisto: number;
  valorRealizado: number | null;
  valorFalta: number | null; // falta do item × preço congelado
}

// distribui o apontado de cada produto pelos itens dele (ordem da lista): cada item até o seu previsto, o excesso no último
function alocarApontado(itens: PrevisaoItem[], apontado: ApontadoPorProduto): Map<string, number> {
  const porItem = new Map<string, number>();
  const restante = new Map<string, number>();
  const ultimoDoProduto = new Map<string, string>();
  itens.forEach((it) => ultimoDoProduto.set(it.produtoId, it.id));
  itens.forEach((it) => {
    const resto = restante.get(it.produtoId) ?? apontado.get(it.produtoId)?.apontadoReal ?? 0;
    const parte = ultimoDoProduto.get(it.produtoId) === it.id ? resto : Math.min(resto, Math.max(it.quantidade, 0));
    porItem.set(it.id, parte);
    restante.set(it.produtoId, resto - parte);
  });
  return porItem;
}

export function calcularProdutosProgramados(
  itens: PrevisaoItem[],
  resultadosCapacidade: ResultadoItemCapacidadeMaxima[],
  apontadoPorProduto: ApontadoPorProduto | null
): ProdutoProgramado[] {
  const alocado = apontadoPorProduto ? alocarApontado(itens, apontadoPorProduto) : null;
  const primeiroDoProduto = new Map<string, string>();
  itens.forEach((it) => { if (!primeiroDoProduto.has(it.produtoId)) primeiroDoProduto.set(it.produtoId, it.id); });
  return itens.map((it) => {
    const resultado = resultadosCapacidade.find((r) => r.itemId === it.id);
    const possivel = resultado ? resultado.maximoPossivel : it.quantidade;
    const ap = alocado ? alocado.get(it.id) ?? 0 : null;
    return {
      itemId: it.id, produtoId: it.produtoId, produtoNome: it.produtoNome, previsto: it.quantidade, possivel, valorUnitario: it.valorUnitario,
      apontadoReal: ap,
      apontadoAmbiguoPecas: apontadoPorProduto && primeiroDoProduto.get(it.produtoId) === it.id ? (apontadoPorProduto.get(it.produtoId)?.ambiguoPecas ?? 0) : 0,
      falta: ap === null ? null : Math.max(it.quantidade - ap, 0),
      excedente: ap === null ? null : Math.max(ap - it.quantidade, 0),
      concluidoPct: ap === null || it.quantidade <= 0 ? null : (ap / it.quantidade) * 100,
      valorPrevisto: it.quantidade * it.valorUnitario,
      valorRealizado: ap === null ? null : ap * it.valorUnitario,
      valorFalta: ap === null ? null : Math.max(it.quantidade - ap, 0) * it.valorUnitario,
    };
  });
}

export interface ResumoProgramacaoPecas {
  totalPrevisto: number;
  totalPossivel: number;
  totalApontadoReal: number | null;
  totalFalta: number | null; // soma das faltas por produto (excesso de um produto não compensa falta de outro)
  concluidoPct: number | null; // apontado total / previsto total (sem teto)
  totalApontadoAmbiguoPecas: number;
  totalExcedente: number | null; // peças apontadas acima do previsto, somadas por item (aviso)
  itensComExcedente: number;
  // R$ (preço congelado dos itens)
  valorPrevisto: number;
  valorRealizado: number | null;
  valorFalta: number | null; // soma das faltas financeiras por produto (falta × preço congelado)
  concluidoValorPct: number | null; // R$ realizado / R$ previsto
}

// Soma simples de peças dos produtos PREVISTOS — indicador de acompanhamento, não de capacidade fabril.
export function calcularResumoProgramacaoPecas(produtos: ProdutoProgramado[]): ResumoProgramacaoPecas {
  const totalPrevisto = produtos.reduce((s, p) => s + p.previsto, 0);
  const totalPossivel = produtos.reduce((s, p) => s + p.possivel, 0);
  const disponivel = produtos.length > 0 && produtos.every((p) => p.apontadoReal !== null);
  const totalApontadoReal = disponivel ? produtos.reduce((s, p) => s + (p.apontadoReal ?? 0), 0) : null;
  const valorPrevisto = produtos.reduce((s, p) => s + p.valorPrevisto, 0);
  const valorRealizado = disponivel ? produtos.reduce((s, p) => s + (p.valorRealizado ?? 0), 0) : null;
  return {
    totalPrevisto, totalPossivel, totalApontadoReal,
    totalFalta: disponivel ? produtos.reduce((s, p) => s + (p.falta ?? 0), 0) : null,
    concluidoPct: totalApontadoReal === null || totalPrevisto <= 0 ? null : (totalApontadoReal / totalPrevisto) * 100,
    totalApontadoAmbiguoPecas: produtos.reduce((s, p) => s + p.apontadoAmbiguoPecas, 0),
    totalExcedente: disponivel ? produtos.reduce((s, p) => s + (p.excedente ?? 0), 0) : null,
    itensComExcedente: produtos.filter((p) => (p.excedente ?? 0) > 0).length,
    valorPrevisto, valorRealizado,
    valorFalta: disponivel ? produtos.reduce((s, p) => s + (p.valorFalta ?? 0), 0) : null,
    concluidoValorPct: valorRealizado === null || valorPrevisto <= 0 ? null : (valorRealizado / valorPrevisto) * 100,
  };
}

export interface ProdutoNaoPrevisto {
  produtoId: string;
  produtoNome: string;
  apontadoReal: number;
}

// Produtos com apontado real na semana que não fazem parte da previsão — puramente informativo (não entra em nenhum total).
export function calcularProdutosNaoPrevistos(
  itensPrevistos: PrevisaoItem[],
  apontadoPorProduto: ApontadoPorProduto | null,
  nomePorProduto: Map<string, string>
): ProdutoNaoPrevisto[] {
  if (!apontadoPorProduto) return [];
  const previstos = new Set(itensPrevistos.map((it) => it.produtoId));
  return [...apontadoPorProduto.entries()]
    .filter(([id, v]) => !previstos.has(id) && v.apontadoReal > 0)
    .map(([id, v]) => ({ produtoId: id, produtoNome: nomePorProduto.get(id) ?? "Produto removido", apontadoReal: v.apontadoReal }))
    .sort((a, b) => a.produtoNome.localeCompare(b.produtoNome, "pt-BR"));
}

export interface HistoricoSemanaApontado {
  semanaInicio: string;
  previsto: number; // R$
  realizado: number | null; // R$ (apontado real × preço congelado); null = ainda carregando/indisponível
  pct: number | null; // R$ realizado / R$ previsto
}

// Histórico semanal: mesma regra da semana atual, semana a semana, com o preço congelado de cada semana.
export function calcularHistoricoApontado(
  semanas: { semanaInicio: string; itens: PrevisaoItem[] }[],
  apontadoPorSemana: Map<string, ApontadoPorProduto>
): HistoricoSemanaApontado[] {
  return [...semanas]
    .filter((s) => s.itens.length > 0)
    .sort((a, b) => a.semanaInicio.localeCompare(b.semanaInicio))
    .map((s) => {
      const previsto = s.itens.reduce((t, it) => t + it.quantidade * it.valorUnitario, 0);
      const mapa = apontadoPorSemana.get(s.semanaInicio);
      if (!mapa) return { semanaInicio: s.semanaInicio, previsto, realizado: null, pct: null };
      const alocado = alocarApontado(s.itens, mapa);
      const realizado = s.itens.reduce((t, it) => t + (alocado.get(it.id) ?? 0) * it.valorUnitario, 0);
      return { semanaInicio: s.semanaInicio, previsto, realizado, pct: previsto > 0 ? (realizado / previsto) * 100 : null };
    });
}
