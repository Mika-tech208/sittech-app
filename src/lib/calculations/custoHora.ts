// Extração mínima do domínio "Custo por hora" — só o necessário pra Previsão
// Semanal / Capacidade poder calcular lucro/hora por produto sem duplicar a
// fórmula. O domínio de Custo por hora em si (tela, estado, CRUD de
// funcionários/custos fixos) continua em SittechApp.tsx nesta etapa; aqui só
// as fórmulas puras, para reuso sem risco de divergência.

import type { FixedCost, Funcionario, Produto, PeriodoComDuracao } from "@/types/domain";
import { toNumber } from "@/lib/format";

export function calcularTotalFixoAtivo(fixedCosts: FixedCost[]): number {
  return fixedCosts.filter((f) => f.ativo).reduce((s, f) => s + Number(f.valor || 0), 0);
}

export function calcularCustoMensalFuncionario(f: Pick<Funcionario, "salarioBase" | "custos">): number {
  return toNumber(f.salarioBase) + f.custos.reduce((s, c) => s + Number(c.valor || 0), 0);
}

export function calcularTotalCustoFuncionariosAtivos(funcionariosAtivos: Funcionario[]): number {
  return funcionariosAtivos.reduce((s, f) => s + calcularCustoMensalFuncionario(f), 0);
}

export interface CustoHoraPorOperacaoResultado {
  custoHoraPorOperacao: Record<string, number>;
  custoHoraEmpresa: number;
  rateioPorHora: number;
}

// horasPorDia vem de calcularHorasPorDia (lib/calculations/periodos.ts) — a
// mesma cadeia de derivação de tempo usada por Capacidade.
export function calcularCustoHoraPorOperacao(
  funcionarios: Funcionario[],
  fixedCosts: FixedCost[],
  horasPorDia: number,
  diasUteis: string | number
): CustoHoraPorOperacaoResultado {
  const funcionariosAtivos = funcionarios.filter((f) => f.ativo);
  const totalFixo = calcularTotalFixoAtivo(fixedCosts);
  const totalCustoFuncionariosAtivos = calcularTotalCustoFuncionariosAtivos(funcionariosAtivos);

  const horasProdutivasFuncionario = horasPorDia * toNumber(diasUteis);
  const totalHorasProdutivasEmpresa = horasProdutivasFuncionario * funcionariosAtivos.length;
  const rateioPorHora = totalHorasProdutivasEmpresa > 0 ? totalFixo / totalHorasProdutivasEmpresa : 0;
  const custoHoraEmpresa = totalHorasProdutivasEmpresa > 0 ? (totalCustoFuncionariosAtivos + totalFixo) / totalHorasProdutivasEmpresa : 0;

  function custoHoraIndividual(f: Funcionario): number {
    return horasProdutivasFuncionario > 0 ? calcularCustoMensalFuncionario(f) / horasProdutivasFuncionario : 0;
  }
  function custoHoraSittech(f: Funcionario): number {
    return custoHoraIndividual(f) + rateioPorHora;
  }

  const porOperacao: Record<string, Funcionario[]> = {};
  funcionarios.forEach((f) => {
    if (!porOperacao[f.operacao]) porOperacao[f.operacao] = [];
    porOperacao[f.operacao].push(f);
  });

  const custoHoraPorOperacao: Record<string, number> = {};
  Object.entries(porOperacao).forEach(([op, lista]) => {
    const ativosGrupo = lista.filter((f) => f.ativo);
    if (ativosGrupo.length === 0) return;
    const total = ativosGrupo.reduce((s, f) => s + custoHoraSittech(f), 0);
    custoHoraPorOperacao[op] = total / ativosGrupo.length;
  });

  return { custoHoraPorOperacao, custoHoraEmpresa, rateioPorHora };
}

export interface IndicadoresProducao {
  custo: number;
  tempoTotalHoras: number;
}

export function calcularIndicadoresProducao(
  produto: Pick<Produto, "roteiro">,
  custoHoraPorOperacao: Record<string, number>,
  custoHoraEmpresa: number,
  periodosComDuracao: PeriodoComDuracao[]
): IndicadoresProducao {
  const roteiro = produto.roteiro || [];
  let custo = 0;
  let tempoTotalHoras = 0;
  roteiro.forEach((etapa) => {
    const custoHoraOp = custoHoraPorOperacao[etapa.operacao] ?? custoHoraEmpresa;
    const metas = (etapa.metas || {}) as unknown as Record<string, number>;
    let totalPecas = 0;
    let totalHoras = 0;
    periodosComDuracao.forEach((p) => {
      const meta = Number(metas[p.id] || 0);
      if (meta > 0 && p.duracaoHoras > 0) {
        totalPecas += meta;
        totalHoras += p.duracaoHoras;
      }
    });
    if (totalPecas <= 0) return;
    const tempoPorPeca = totalHoras / totalPecas;
    custo += tempoPorPeca * custoHoraOp;
    tempoTotalHoras += tempoPorPeca;
  });
  return { custo, tempoTotalHoras };
}

export interface MargemProduto {
  custo: number;
  margemRS: number;
  margemPct: number;
  tempoTotalHoras: number;
  lucroHora: number;
}

export function calcularMargemProduto(
  produto: Pick<Produto, "roteiro" | "valorUnitario">,
  custoHoraPorOperacao: Record<string, number>,
  custoHoraEmpresa: number,
  periodosComDuracao: PeriodoComDuracao[]
): MargemProduto {
  const { custo, tempoTotalHoras } = calcularIndicadoresProducao(produto, custoHoraPorOperacao, custoHoraEmpresa, periodosComDuracao);
  const margemRS = Number(produto.valorUnitario || 0) - custo;
  const margemPct = produto.valorUnitario > 0 ? (margemRS / produto.valorUnitario) * 100 : 0;
  const lucroHora = tempoTotalHoras > 0 ? margemRS / tempoTotalHoras : 0;
  return { custo, margemRS, margemPct, tempoTotalHoras, lucroHora };
}
