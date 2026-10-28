// CAMADA 2 — FINANCEIRO (R$). Valor = PREÇO CONGELADO do item da Previsão (PoolEscala.valorUnitario = previsao_itens.valor_unitario; nunca o cadastro atual).
// R$ produzido = boas da ETAPA FINAL × preço congelado. Intermediárias NÃO geram R$ (geram WIP): cada grupo conta só o seu nó final, sem dupla contagem.
// `pesoComercial` (por produto, default 1) é um multiplicador MANUAL opcional que só entra no PESO de decisão (objetivo "financeiro"); as métricas em R$ usam o preço puro.
import type { CtxFluxo } from "./estado";
import type { FinanceiroPlano, FinanceiroProduto, OpcoesFluxo } from "./tipos";

export const objetivoFinanceiro = (o: OpcoesFluxo) => o.objetivo === "financeiro";

/** Preço médio do grupo (membros do nó final ponderados pela quantidade); `comPeso` multiplica pelo peso comercial manual do produto. */
export function precoDoGrupo(ctx: CtxFluxo, gi: number, comPeso: boolean): number {
  const sink = ctx.grafo.nos[ctx.grafo.grupos[gi].sink];
  let q = 0, v = 0;
  sink.membros.forEach((m) => {
    const p = ctx.poolsPorChave.get(m);
    if (!p) return;
    const w = comPeso ? Math.max(0, ctx.opcoes.pesoComercial?.[p.produtoId] ?? 1) : 1;
    q += p.quantidade;
    v += p.quantidade * Math.max(0, p.valorUnitario) * w;
  });
  return q > 0 ? v / q : 0;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Métricas em R$ por produto e total. `finalPorGrupo`/`maximoPorGrupo` = final (lo) do plano avaliado e máximo possível, chave = id do nó final. */
export function calcularFinanceiro(ctx: CtxFluxo, finalPorGrupo: Record<string, number>, maximoPorGrupo: Record<string, number>): FinanceiroPlano {
  const produtos: FinanceiroProduto[] = [];
  ctx.grafo.grupos.forEach((g) => {
    const sink = ctx.grafo.nos[g.sink];
    const Q = sink.quantidade;
    const B0 = Math.min(Q, ctx.iniAPartirDe.lo.B0[g.sink] ?? 0);
    const F = Math.min(Q, finalPorGrupo[g.sink] ?? 0);
    const M = Math.min(Q, maximoPorGrupo[g.sink] ?? 0);
    sink.membros.forEach((k) => {
      const p = ctx.poolsPorChave.get(k)!;
      const frac = Q > 0 ? p.quantidade / Q : 1 / sink.membros.length;
      const preco = Math.max(0, p.valorUnitario);
      const meta = p.quantidade;
      const prod: FinanceiroProduto = {
        produtoId: p.produtoId, etapaFinalId: p.etapaId, precoCongelado: preco, pesoComercial: ctx.opcoes.pesoComercial?.[p.produtoId] ?? 1,
        meta: r3(meta), realizadoFinal: r3(B0 * frac), restante: r3(meta - B0 * frac), maximoProduzivel: r3(M * frac), metaAtingivel: M >= Q - 0.5,
        faltaInevitavel: r3(Math.max(0, meta - M * frac)), finalProjetado: r3(F * frac), faltaProjetada: r3(Math.max(0, meta - F * frac)),
        rsMeta: r2(meta * preco), rsRealizado: r2(B0 * frac * preco), rsFaltante: r2((meta - B0 * frac) * preco), rsMaximoAtingivel: r2(M * frac * preco),
        rsProjetadoFechamento: r2(F * frac * preco), rsFaltaInevitavel: r2(Math.max(0, meta - M * frac) * preco), rsFaltaProjetada: r2(Math.max(0, meta - F * frac) * preco),
      };
      produtos.push(prod);
    });
  });
  const soma = (f: (p: FinanceiroProduto) => number) => r2(produtos.reduce((s, p) => s + f(p), 0));
  return {
    produtos,
    total: {
      rsMeta: soma((p) => p.rsMeta), rsRealizado: soma((p) => p.rsRealizado), rsFaltante: soma((p) => p.rsFaltante), rsMaximoAtingivel: soma((p) => p.rsMaximoAtingivel),
      rsProjetadoFechamento: soma((p) => p.rsProjetadoFechamento), rsFaltaInevitavel: soma((p) => p.rsFaltaInevitavel), rsFaltaProjetada: soma((p) => p.rsFaltaProjetada),
    },
  };
}
