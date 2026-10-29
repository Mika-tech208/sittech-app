// FONTE ÚNICA (função pura) da economia operacional de um produto: "Valor recebido", "Custo de produção",
// "Margem" e "Lucro/hora" exatamente como a tela Produtos os mostra. NÃO existe fórmula nova aqui: tudo delega a
// `calcularCustoHoraEOperacoes` e `calcularMargemProduto` (src/features/custo-hora/calculations.ts), as mesmas
// funções que Produtos, Previsão e Capacidade já usam. Este módulo só (1) empacota entradas, (2) devolve a origem
// e a fórmula por escrito e (3) acrescenta campos DERIVADOS (receita/hora, custo/hora aplicado, avisos) para o
// motor da Escala consumir sem reescrever nada. Não grava nada e não lê banco: o chamador entrega os dados já no
// formato de domínio (os mesmos mapeadores dos hooks / de `custoHoraDados.ts` na branch das rotas).
//
// ATENÇÃO (ver docs/escala-economia-fonte-produtos.md): "custo de produção" aqui = Σ(tempo/peça de cada etapa ×
// custo/hora da operação) e o custo/hora é (folha + custos fixos) / horas produtivas. É custo de ABSORÇÃO (fixo +
// folha), não custo variável. "Lucro/hora" = margem / Σ tempo/peça = receita/hora − custo/hora médio aplicado.

import {
  calcularCustoHoraEOperacoes, calcularMargemProduto, type MargemProduto,
} from "@/features/custo-hora/calculations";
import type { CustoHoraEOperacoes } from "@/features/custo-hora/types";
import { calcularHorasPorDia, calcularPeriodosComDuracao, filtrarPeriodosValidos } from "@/lib/calculations/periodos";
import type { FixedCost, Funcionario, Periodo, PeriodoComDuracao, Produto } from "@/types/domain";

export const VERSAO_ECONOMIA_PRODUTO = "economia-produto-1.0";

export const FORMULA_ECONOMIA_PRODUTO = {
  valorRecebido: "produtos.valor_unitario (vivo); na Escala/Previsão o congelado é previsao_itens.valor_unitario",
  custoHoraEmpresa: "(Σ(salário_base + funcionario_custos) dos ativos + Σ fixed_costs ativos) / (Σ horas dos períodos × dias_uteis × nº ativos)",
  custoHoraOperacao: "média dos (custo individual/h + rateio fixo/h) dos ativos da operação; operação sem ativo => custoHoraEmpresa",
  tempoPorPecaEtapa: "Σ duração dos períodos com meta>0 / Σ metas desses períodos (roteiro_etapas.meta_m1..t3)",
  custoProducao: "Σ etapas (tempoPorPeca × custoHoraDaOperacao)",
  margem: "valorRecebido − custoProducao; % = margem / valorRecebido",
  lucroHora: "margem / Σ tempoPorPeca = (valorRecebido / Σ tempoPorPeca) − custoHora médio aplicado",
} as const;

/** Entrada: dados no formato de domínio (os mesmos que os hooks entregam à tela). */
export interface ContextoEconomia {
  produtos: Produto[];
  funcionarios: Funcionario[];
  fixedCosts: FixedCost[];
  periodos: Periodo[];
  diasUteis: string | number;
}

/** Parte do contexto que não depende do produto (calcular uma vez e reutilizar; memoizável). */
export interface BaseEconomia {
  custoHora: CustoHoraEOperacoes;
  periodosComDuracao: PeriodoComDuracao[];
}

export function prepararBaseEconomia(ctx: Pick<ContextoEconomia, "funcionarios" | "fixedCosts" | "periodos" | "diasUteis">): BaseEconomia {
  const periodosComDuracao = calcularPeriodosComDuracao(ctx.periodos);
  const horasPorDia = calcularHorasPorDia(filtrarPeriodosValidos(periodosComDuracao)); // mesma cadeia da tela (Produtos/Previsão)
  return { custoHora: calcularCustoHoraEOperacoes(ctx.funcionarios, ctx.fixedCosts, horasPorDia, ctx.diasUteis), periodosComDuracao };
}

/** Exatamente o que a tela Produtos chama (`calcularMargem`): sem campos novos, sem arredondar. */
export function margemDoProduto(
  produto: Pick<Produto, "roteiro" | "valorUnitario">,
  base: { custoHoraPorOperacao: Record<string, number>; custoHoraEmpresa: number; periodosComDuracao: PeriodoComDuracao[] }
): MargemProduto {
  return calcularMargemProduto(produto, base.custoHoraPorOperacao, base.custoHoraEmpresa, base.periodosComDuracao);
}

export interface EconomiaProduto {
  produtoId: string;
  /** false => a tela mostra "—" e os campos numéricos abaixo são null (nunca 0 inventado). */
  calculavel: boolean;
  valorRecebido: number;
  custoProducao: number | null;
  margem: { rs: number; pct: number } | null;
  lucroHora: number | null;
  /** Derivados (não aparecem na tela): */
  tempoTotalHoras: number | null; // Σ horas de operador por peça final
  receitaHora: number | null; // valorRecebido / tempoTotalHoras (R$ por hora de operador da cadeia)
  custoHoraAplicado: number | null; // custoProducao / tempoTotalHoras (média ponderada)
  usaFallbackEmpresa: boolean; // alguma etapa usou o custo/hora da empresa (operação sem ativo)
  avisos: string[];
  origem: { fonte: "tela_produtos"; funcoes: string[]; tabelas: string[] };
  formula: typeof FORMULA_ECONOMIA_PRODUTO;
  versao: string;
}

const ORIGEM = {
  fonte: "tela_produtos" as const,
  funcoes: ["calcularCustoHoraEOperacoes", "calcularIndicadoresProducao", "calcularMargemProduto"],
  tabelas: [
    "produtos.valor_unitario", "roteiro_etapas.meta_m1..meta_t3", "periodos", "configuracoes_empresa.dias_uteis",
    "funcionarios.salario_base+ativo", "funcionario_custos.valor", "fixed_costs.valor+ativo",
  ],
};

export function economiaProdutoCom(produto: Produto, base: BaseEconomia): EconomiaProduto {
  const roteiro = produto.roteiro || [];
  const avisos: string[] = [];
  const comum = { produtoId: produto.id, valorRecebido: produto.valorUnitario, origem: ORIGEM, formula: FORMULA_ECONOMIA_PRODUTO, versao: VERSAO_ECONOMIA_PRODUTO };
  if (roteiro.length === 0) {
    return { ...comum, calculavel: false, custoProducao: null, margem: null, lucroHora: null, tempoTotalHoras: null, receitaHora: null, custoHoraAplicado: null, usaFallbackEmpresa: false, avisos: ["sem_roteiro"] };
  }
  const m = margemDoProduto(produto, { custoHoraPorOperacao: base.custoHora.custoHoraPorOperacao, custoHoraEmpresa: base.custoHora.custoHoraEmpresa, periodosComDuracao: base.periodosComDuracao });
  const usaFallbackEmpresa = roteiro.some((e) => !(e.operacao in base.custoHora.custoHoraPorOperacao));
  // etapa sem nenhuma meta>0 nos períodos válidos é ignorada pela fórmula da tela (custo 0 e tempo 0): sinalizar, nunca esconder
  roteiro.forEach((e) => {
    const metas = (e.metas || {}) as unknown as Record<string, number>;
    if (!base.periodosComDuracao.some((p) => Number(metas[p.id] || 0) > 0 && p.duracaoHoras > 0)) avisos.push(`etapa_sem_meta:${e.operacao}`);
  });
  if (usaFallbackEmpresa) avisos.push("custo_hora_fallback_empresa");
  const t = m.tempoTotalHoras;
  return {
    ...comum, calculavel: t > 0, custoProducao: m.custo, margem: { rs: m.margemRS, pct: m.margemPct }, lucroHora: m.lucroHora,
    tempoTotalHoras: t, receitaHora: t > 0 ? produto.valorUnitario / t : null, custoHoraAplicado: t > 0 ? m.custo / t : null,
    usaFallbackEmpresa, avisos,
  };
}

/** API pedida: `economiaProduto(produtoId, contexto)`. Para vários produtos, use `prepararBaseEconomia` + `economiaProdutoCom`. */
export function economiaProduto(produtoId: string, ctx: ContextoEconomia): EconomiaProduto | null {
  const produto = ctx.produtos.find((p) => p.id === produtoId);
  if (!produto) return null;
  return economiaProdutoCom(produto, prepararBaseEconomia(ctx));
}
