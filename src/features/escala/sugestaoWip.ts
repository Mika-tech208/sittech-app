// Sugestão de adicional POR ETAPA (acabado + estoque intermediário) — usa o MESMO motor.
//
// Objetivo (nesta ordem): menos pessoas sem posto → mais produto acabado → menos estoque desnecessário.
// A ordem acabado antes de estoque e o pipeline vivem no motor (adicionalWip.ts); aqui só se procura o
// ponto estável:
//   1) roda o motor com teto "ilimitado" nas etapas dos produtos PERMITIDOS (já previstos na semana e com
//      todas as etapas com máquina) — o motor ocupa a capacidade ociosa com cadeias de acabado e depois estoque;
//   2) os tetos passam a ser o que cada etapa realmente absorveu (inteiro) e o motor roda de novo; repete
//      até estabilizar (cada etapa absorve exatamente o seu teto);
//   3) mede "antes/depois" e, por produto, quanto a cobertura cai se ele sair da sugestão.
// O previsto nunca é tocado e nenhum produto fora da Previsão da semana pode aparecer (garantia do motor/pools).

import { calcularCobertura, type CoberturaSemana } from "./cobertura";
import { gerarEscala } from "./gerarEscala";
import { chavePool, type EntradaEscala, type PoolEscala } from "./types";
import { etapasPorProduto } from "./wip";

const TETO_ILIMITADO = 1_000_000_000;
const MAX_ITERACOES = 6;

export interface ItemSugestaoWip {
  produtoId: string;
  etapaId: string;
  ordem: number;
  quantidade: number; // adicional (peças) processado nesta etapa
  tipo: "acabado" | "intermediario"; // última etapa do roteiro = produto acabado
  maquinas: string[]; // máquinas/postos que recebem esse adicional
  estoquePecas: number; // peças desta etapa que ficam aguardando a etapa seguinte (A_k − A_{k+1}); 0 na última
  proximaEtapaId: string | null;
}

export interface ResumoCoberturaWip {
  percentual: number;
  pessoasPeriodoSemPosto: number;
  horasSemPosto: number;
}

export interface SugestaoProdutoWip {
  produtoId: string;
  acabado: number; // adicional de produto acabado (última etapa)
  estoque: { etapaId: string; proximaEtapaId: string; pecas: number }[];
  estoqueTotal: number;
  valorPotencial: number; // acabado × valor unitário — indicador SEPARADO, nunca soma ao previsto
  // cobertura da equipe se este produto saísse da sugestão (o "quanto ele contribui")
  coberturaSemEle: ResumoCoberturaWip;
}

export interface SugestaoWip {
  itens: ItemSugestaoWip[];
  porProduto: SugestaoProdutoWip[];
  acabadoTotal: number;
  estoqueTotal: number;
  valorPotencial: number;
  antes: ResumoCoberturaWip; // só o previsto
  depois: ResumoCoberturaWip; // previsto + sugestão
  iteracoes: number;
}

export interface ResultadoSugestaoWip {
  sugestao: SugestaoWip;
  entradaComSugestao: EntradaEscala;
}

const resumo = (c: CoberturaSemana): ResumoCoberturaWip => ({ percentual: c.percentual, pessoasPeriodoSemPosto: c.pessoasPeriodoSemPosto, horasSemPosto: c.horasSemPosto });

function comTetos(entrada: EntradaEscala, teto: (p: PoolEscala) => number): EntradaEscala {
  return { ...entrada, pools: entrada.pools.map((p) => ({ ...p, adicionalMax: teto(p) })) };
}

export function sugerirAdicionalWip(entrada: EntradaEscala, opcoes: { produtosPermitidos?: Set<string>; produtosIncompletos?: Set<string> } = {}): ResultadoSugestaoWip {
  if (!entrada.wip) throw new Error("sugerirAdicionalWip exige o adicional por etapa ativo (entrada.wip)");
  const permitidos = opcoes.produtosPermitidos;
  const incompletos = opcoes.produtosIncompletos ?? new Set<string>();
  const elegivel = (p: PoolEscala) => (!permitidos || permitidos.has(p.produtoId)) && !incompletos.has(p.produtoId);
  const etapas = etapasPorProduto(entrada.pools);
  const chave = (p: PoolEscala) => chavePool(p.produtoId, p.etapaId);

  const antesEntrada = comTetos(entrada, () => 0);
  const antes = resumo(calcularCobertura(antesEntrada, gerarEscala(antesEntrada)));

  let tetos = new Map<string, number>(entrada.pools.map((p) => [chave(p), elegivel(p) ? TETO_ILIMITADO : 0]));
  let iteracoes = 0;
  let r = gerarEscala(comTetos(entrada, (p) => tetos.get(chave(p)) as number));
  for (let it = 1; it <= MAX_ITERACOES; it++) {
    iteracoes = it;
    const novos = new Map<string, number>();
    entrada.pools.forEach((p) => novos.set(chave(p), Math.floor((r.adicionalProduzido[chave(p)] ?? 0) + 1e-9)));
    // etapa seguinte nunca acima da anterior (o motor já garante; o arredondamento não pode quebrar isso)
    etapas.forEach((l) => {
      for (let k = 1; k < l.length; k++) novos.set(chave(l[k]), Math.min(novos.get(chave(l[k])) as number, novos.get(chave(l[k - 1])) as number));
    });
    const igual = entrada.pools.every((p) => novos.get(chave(p)) === tetos.get(chave(p)));
    tetos = novos;
    r = gerarEscala(comTetos(entrada, (p) => tetos.get(chave(p)) as number));
    if (igual) break;
  }
  // estado final consistente: o que a etapa de fato absorve com os tetos finais (nunca acima do teto)
  const entradaComSugestao = comTetos(entrada, (p) => Math.min(tetos.get(chave(p)) as number, Math.floor((r.adicionalProduzido[chave(p)] ?? 0) + 1e-9)));
  const rFinal = gerarEscala(entradaComSugestao);
  const depois = resumo(calcularCobertura(entradaComSugestao, rFinal));

  const itens: ItemSugestaoWip[] = [];
  const porProduto: SugestaoProdutoWip[] = [];
  etapas.forEach((l, produtoId) => {
    const A = l.map((p) => Math.floor((rFinal.adicionalProduzido[chave(p)] ?? 0) + 1e-9));
    if (A.every((x) => x <= 0)) return;
    l.forEach((p, k) => {
      if (A[k] <= 0) return;
      const maquinas = [...new Set(rFinal.alocacoes.filter((a) => a.maquinaId && a.produtoId === p.produtoId && a.etapaId === p.etapaId && (a.pecasAdicional ?? 0) > 0).map((a) => a.maquinaId as string))].sort();
      const ultima = k === l.length - 1;
      itens.push({
        produtoId,
        etapaId: p.etapaId,
        ordem: p.ordemEtapa,
        quantidade: A[k],
        tipo: ultima ? "acabado" : "intermediario",
        maquinas,
        estoquePecas: ultima ? 0 : Math.max(0, A[k] - A[k + 1]),
        proximaEtapaId: ultima ? null : l[k + 1].etapaId,
      });
    });
    // contribuição do produto: a mesma sugestão sem ele
    const semEle = comTetos(entradaComSugestao, (p) => (p.produtoId === produtoId ? 0 : (p.adicionalMax ?? 0)));
    const coberturaSemEle = resumo(calcularCobertura(semEle, gerarEscala(semEle)));
    const acabado = A[A.length - 1];
    const estoque = l.slice(0, -1).map((p, k) => ({ etapaId: p.etapaId, proximaEtapaId: l[k + 1].etapaId, pecas: Math.max(0, A[k] - A[k + 1]) })).filter((x) => x.pecas > 0);
    porProduto.push({ produtoId, acabado, estoque, estoqueTotal: estoque.reduce((s, x) => s + x.pecas, 0), valorPotencial: acabado * l[0].valorUnitario, coberturaSemEle });
  });
  porProduto.sort((a, b) => (a.produtoId < b.produtoId ? -1 : 1));
  itens.sort((a, b) => (a.produtoId < b.produtoId ? -1 : a.produtoId > b.produtoId ? 1 : a.ordem - b.ordem));

  return {
    entradaComSugestao,
    sugestao: {
      itens,
      porProduto,
      acabadoTotal: porProduto.reduce((s, x) => s + x.acabado, 0),
      estoqueTotal: porProduto.reduce((s, x) => s + x.estoqueTotal, 0),
      valorPotencial: porProduto.reduce((s, x) => s + x.valorPotencial, 0),
      antes,
      depois,
      iteracoes,
    },
  };
}
