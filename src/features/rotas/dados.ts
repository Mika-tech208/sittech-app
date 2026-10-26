// Dados do modelo de rotas para a página de demonstração (SOMENTE LEITURA): monta estrutura + capacidade a partir de linhas já carregadas.
// Não decide divisão entre rotas, não altera nada. `commitment` (competição por capacidade) vem dos itens das Previsões dos OUTROS produtos.
import { analisarCapacidadeRotas, tempoPorPeca } from "./capacidade";
import { convergenciaDe } from "./estrutura";
import type { AnaliseCapacidadeRotas, ContextoCapacidade, EstruturaProduto, EtapaCadastro, PeriodoId } from "./tipos";

export interface LinhasRotas {
  produtoId: string;
  etapas: { id: string; produto_id: string; operacao_id: string; ordem: number; meta_m1: number; meta_m2: number; meta_m3: number; meta_t1: number; meta_t2: number; meta_t3: number }[];
  etapaMaquinas: { etapa_id: string; maquina_id: string }[];
  operacoes: { id: string; nome: string }[];
  rotas: { id: string; produto_id: string; codigo: string; nome: string; ativa: boolean; preferencia: number }[];
  rotaEtapas: { rota_id: string; etapa_id: string; posicao: number }[];
  poolComum: { produto_id: string; etapa_id: string; posicao: number; final: boolean }[];
}

export function etapasDoProduto(l: LinhasRotas): Map<string, EtapaCadastro> {
  const op = new Map(l.operacoes.map((o) => [o.id, o.nome]));
  const out = new Map<string, EtapaCadastro>();
  l.etapas.filter((e) => e.produto_id === l.produtoId).forEach((e) => out.set(e.id, {
    id: e.id, operacaoId: e.operacao_id, operacao: op.get(e.operacao_id) ?? "", ordem: e.ordem,
    metas: { m1: Number(e.meta_m1), m2: Number(e.meta_m2), m3: Number(e.meta_m3), t1: Number(e.meta_t1), t2: Number(e.meta_t2), t3: Number(e.meta_t3) } as Record<PeriodoId, number>,
    maquinasIds: l.etapaMaquinas.filter((m) => m.etapa_id === e.id).map((m) => m.maquina_id).sort(),
  }));
  return out;
}

export function estruturaDasLinhas(l: LinhasRotas): EstruturaProduto {
  const rotas = l.rotas.filter((r) => r.produto_id === l.produtoId).sort((a, b) => a.preferencia - b.preferencia || (a.codigo < b.codigo ? -1 : 1));
  const pool = l.poolComum.filter((p) => p.produto_id === l.produtoId).sort((a, b) => a.posicao - b.posicao);
  const estr: EstruturaProduto = {
    produtoId: l.produtoId, modelo: "rotas", regraEtapaFinal: "explicita", convergencia: null,
    rotas: rotas.map((r) => ({ id: r.id, codigo: r.codigo, nome: r.nome, ativa: r.ativa, preferencia: r.preferencia, etapas: l.rotaEtapas.filter((x) => x.rota_id === r.id).sort((a, b) => a.posicao - b.posicao).map((x) => x.etapa_id) })),
    poolComum: pool.length ? { etapas: pool.map((p) => p.etapa_id), entradaId: pool[0].etapa_id } : null,
    etapaFinalId: pool.find((p) => p.final)?.etapa_id ?? null,
  };
  return { ...estr, convergencia: convergenciaDe(estr.rotas, estr.poolComum) };
}

// Seleção de máquinas por etapa de F "como a Previsão dos produtos LEGADOS": união das máquinas marcadas, por OPERAÇÃO, nos itens dos legados (P e A) da semana
export function selecaoComoPrevisaoLegada(
  etapasF: Map<string, EtapaCadastro>,
  itens: { produto_id: string; previsao_item_maquinas: { etapa_id: string; maquina_id: string }[] }[],
  legadosIds: Set<string>,
  operacaoDaEtapa: Map<string, string>
): Record<string, string[]> {
  const sel: Record<string, string[]> = {};
  etapasF.forEach((e) => {
    const ms = new Set<string>();
    itens.filter((i) => legadosIds.has(i.produto_id)).forEach((i) => i.previsao_item_maquinas.forEach((m) => { if (operacaoDaEtapa.get(m.etapa_id) === e.operacaoId) ms.add(m.maquina_id); }));
    sel[e.id] = [...ms].filter((m) => e.maquinasIds.includes(m)).sort();
  });
  return sel;
}

// Horas de máquina que OUTROS produtos já comprometem na semana (estimativa: horas da etapa divididas igualmente entre as máquinas selecionadas)
export function horasComprometidasPorOutros(
  itens: { produto_id: string; quantidade: number; previsao_item_maquinas: { etapa_id: string; maquina_id: string }[] }[],
  excluirProdutos: Set<string>,
  etapasPorId: Map<string, { operacaoId: string; metas: Record<PeriodoId, number> }>,
  ctx: Pick<ContextoCapacidade, "periodos">
): Record<string, number> {
  const horas: Record<string, number> = {};
  itens.filter((i) => !excluirProdutos.has(i.produto_id)).forEach((i) => {
    const porEtapa = new Map<string, string[]>();
    i.previsao_item_maquinas.forEach((m) => porEtapa.set(m.etapa_id, [...(porEtapa.get(m.etapa_id) ?? []), m.maquina_id]));
    porEtapa.forEach((maquinas, etapaId) => {
      const e = etapasPorId.get(etapaId);
      if (!e) return;
      const total = Number(i.quantidade) * tempoPorPeca({ metas: e.metas }, ctx);
      maquinas.forEach((m) => { horas[m] = (horas[m] ?? 0) + total / maquinas.length; });
    });
  });
  return horas;
}

export function cenario(estrutura: EstruturaProduto, etapas: Map<string, EtapaCadastro>, demanda: number, ctx: ContextoCapacidade, selecao?: Record<string, string[]>): AnaliseCapacidadeRotas {
  return analisarCapacidadeRotas(estrutura, etapas, demanda, ctx, selecao);
}
