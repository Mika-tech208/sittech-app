// PRODUTO DE ROTAS nas contas de CAPACIDADE LEGADAS (Previsão, Capacidade, PDF, validação): essas funções tratam o roteiro como cadeia linear e aplicam a quantidade do item em TODAS as etapas.
// Para o produto de rotas isso duplicaria a demanda (CONV + AUTO + comum). Este módulo troca, SÓ para o cálculo, o item F por cadeias virtuais consistentes com o planejador:
//   rota CONV  = [Rosquear, Parafusar]  com a entrega planejada da CONV        (valor R$ 0: a receita é do produto final)
//   rota AUTO  = [Rosquear + Parafusar] com a entrega planejada da AUTO        (valor R$ 0)
//   fluxo comum= [Etiquetar, Embalar]   com o produto final possível           (valor = preço do produto)
// Assim horas por máquina, uso de máquina, alocação semanal e capacidade máxima (R$) somam cada etapa UMA vez, e a máquina compartilhada com outros itens é contada uma só vez.
// Sem produto de rotas na lista: devolve as MESMAS referências (nenhum efeito sobre produtos lineares).
import type { ResultadoItemCapacidadeMaxima } from "@/features/capacidade/types";
import type { PeriodoComDuracao, PrevisaoItem, Produto, RoteiroEtapa } from "@/types/domain";
import { CADEIA_COMUM, cadeiasDe, idVirtual, ROTULO_CADEIA } from "./adaptador";
import { previaComCompartilhamento, type ItemSelecionado, type MetasDaEtapa, type PreviaRotas } from "./compartilhada";
import type { ContextoCusto } from "./custo";
import type { EtapaCadastro, PeriodoId } from "./tipos";

export interface ExpansaoRotas { itens: PrevisaoItem[]; produtos: Produto[]; resultados: ResultadoItemCapacidadeMaxima[]; previas: Map<string, PreviaRotas> }
export const ehItemVirtual = (id: string) => id.includes("#");

export interface EntradaExpansao {
  itens: PrevisaoItem[]; produtos: Produto[]; periodosComDuracao: PeriodoComDuracao[]; diasProdutivos: number; maquinasIndisponiveis?: string[];
  custoHoraPorOperacao?: Record<string, number>; custoHoraEmpresa?: number;
}

export function expandirItensDeRotas(e: EntradaExpansao): ExpansaoRotas {
  const deRotas = (it: PrevisaoItem) => !!e.produtos.find((p) => p.id === it.produtoId)?.estruturaRotas;
  if (!e.itens.some(deRotas)) return { itens: e.itens, produtos: e.produtos, resultados: [], previas: new Map() };

  const periodos = e.periodosComDuracao.map((p) => ({ id: p.id as PeriodoId, minutos: Math.round(p.duracaoHoras * 60) }));
  const etapasDosOutros = new Map<string, MetasDaEtapa>(e.produtos.flatMap((pr) => pr.roteiro.map((x) => [x.id, { operacaoId: x.operacao, metas: x.metas as Record<PeriodoId, number> }] as const)));
  const custo: ContextoCusto | undefined = e.custoHoraPorOperacao ? { periodos, custoHoraPorOperacao: e.custoHoraPorOperacao, custoHoraPadrao: e.custoHoraEmpresa ?? 0 } : undefined;
  const itens: PrevisaoItem[] = []; const produtos = [...e.produtos]; const resultados: ResultadoItemCapacidadeMaxima[] = []; const previas = new Map<string, PreviaRotas>();

  e.itens.forEach((it) => {
    const produto = e.produtos.find((p) => p.id === it.produtoId);
    const estrutura = produto?.estruturaRotas;
    if (!produto || !estrutura) { itens.push(it); return; }
    const etapas = new Map<string, EtapaCadastro>(produto.roteiro.map((x, i) => [x.id, { id: x.id, operacaoId: x.operacao, operacao: x.operacao, ordem: i, metas: x.metas as Record<PeriodoId, number>, maquinasIds: [...x.maquinasIds] }]));
    const outros: ItemSelecionado[] = e.itens.filter((o) => o.id !== it.id && !deRotas(o)).map((o) => ({ itemId: o.id, produtoNome: o.produtoNome, quantidade: o.quantidade, selecao: o.maquinasPorEtapa ?? {} }));
    const previa = previaComCompartilhamento({
      itemId: it.id, estrutura, etapas, demanda: it.quantidade, ctx: { periodos, diasProdutivos: e.diasProdutivos, maquinasIndisponiveis: e.maquinasIndisponiveis ?? [] },
      selecao: it.maquinasPorEtapa ?? {}, outros, etapasDosOutros, custo, valorUnitario: it.valorUnitario,
    });
    previas.set(it.id, previa);
    const plano = previa.plano;
    const roteiroDe = (ids: string[]): RoteiroEtapa[] => ids.map((id) => produto.roteiro.find((x) => x.id === id)).filter((x): x is RoteiroEtapa => !!x);
    cadeiasDe(estrutura).forEach((c) => {
      const quantidade = c.cadeia === CADEIA_COMUM ? plano.finalAtingivel : plano.alvo[c.cadeia] ?? 0;
      if (quantidade <= 1e-9) return;
      const vid = idVirtual(produto.id, c.cadeia);
      const maquinasPorEtapa = Object.fromEntries(c.etapas.filter((id) => (it.maquinasPorEtapa?.[id] ?? []).length > 0).map((id) => [id, (it.maquinasPorEtapa ?? {})[id]]));
      if (!produtos.some((p) => p.id === vid)) produtos.push({ ...produto, id: vid, nome: `${produto.nome} · ${ROTULO_CADEIA[c.cadeia] ?? c.cadeia}`, roteiro: roteiroDe(c.etapas), estruturaRotas: undefined });
      itens.push({ ...it, id: `${it.id}#${c.cadeia}`, produtoId: vid, produtoNome: `${it.produtoNome} · ${ROTULO_CADEIA[c.cadeia] ?? c.cadeia}`, quantidade, valorUnitario: c.cadeia === CADEIA_COMUM ? it.valorUnitario : 0, maquinasPorEtapa });
    });
    resultados.push({ itemId: it.id, produtoNome: it.produtoNome, valorUnitario: it.valorUnitario, previsto: it.quantidade, maximoPossivel: Math.floor(plano.finalAtingivel), etapaLimitante: plano.gargalo?.tipo === "comum" ? plano.gargalo.operacao : plano.gargalo ? plano.gargalo.limitantes[0]?.operacao ?? null : null });
  });
  return { itens, produtos, resultados, previas };
}

// resultados por item sem as cadeias virtuais, mais o resultado do item de rotas inteiro
export const resultadosVisiveis = (res: ResultadoItemCapacidadeMaxima[], exp: ExpansaoRotas) => [...res.filter((r) => !ehItemVirtual(r.itemId)), ...exp.resultados];
