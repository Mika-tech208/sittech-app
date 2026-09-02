// Regras de negócio do domínio "Custo por hora" — extraídas de
// SittechApp.tsx (Fase 1, Etapa de extração de Custo por Hora). Refatoração,
// não revisão matemática: cada função abaixo reproduz exatamente a fórmula
// que já existia, só nomeada e testável isoladamente.
//
// Previsão e Capacidade importam calcularCustoHoraEOperacoes (e
// calcularMargemProduto) DAQUI — não duplicar a fórmula em outro arquivo.

import { toNumber } from "@/lib/format";
import type { FixedCost, Funcionario, Produto, PeriodoComDuracao } from "@/types/domain";
import type { ResumoOperacao, CustoHoraEOperacoes } from "@/features/custo-hora/types";

// ---- custos fixos e de funcionários (entram no rateio) ----

// Documentação do rateio (Etapa "Custo por hora", ver briefing):
// - Custo que entra: soma de TODOS os custos fixos com `ativo: true`
//   (categoria não importa — aluguel, energia, mão de obra indireta etc.
//   todos entram juntos). Custos fixos pausados (ativo: false) NÃO entram.
// - Custos pontuais/variáveis do mês (variableEntries) NÃO entram no
//   rateio de custo/hora — só custos fixos.
// - Denominador: total de horas produtivas de TODA a empresa no mês
//   (calcularTotalHorasProdutivasEmpresa) — não é por operação nem por
//   funcionário individual, é uma média única da empresa inteira.
// - Período considerado: um mês (dias úteis do mês, não da semana).
export function calcularTotalFixoAtivo(fixedCosts: FixedCost[]): number {
  return fixedCosts.filter((f) => f.ativo).reduce((s, f) => s + Number(f.valor || 0), 0);
}

export function calcularCustoMensalFuncionario(f: Pick<Funcionario, "salarioBase" | "custos">): number {
  return toNumber(f.salarioBase) + f.custos.reduce((s, c) => s + Number(c.valor || 0), 0);
}

export function calcularTotalCustoFuncionariosAtivos(funcionariosAtivos: Funcionario[]): number {
  return funcionariosAtivos.reduce((s, f) => s + calcularCustoMensalFuncionario(f), 0);
}

export function calcularCustoMedioFuncionarioMensal(totalCustoFuncionariosAtivos: number, numFuncionariosAtivos: number): number {
  return numFuncionariosAtivos > 0 ? totalCustoFuncionariosAtivos / numFuncionariosAtivos : 0;
}

// ---- horas produtivas (período -> mês) ----
// horasPorDia vem de calcularHorasPorDia (lib/calculations/periodos.ts) —
// mesma cadeia de derivação de tempo usada por Capacidade. Não recriar.

export function calcularHorasProdutivasFuncionario(horasPorDia: number, diasUteis: string | number): number {
  return horasPorDia * toNumber(diasUteis);
}

export function calcularTotalHorasProdutivasEmpresa(horasProdutivasFuncionario: number, numFuncionariosAtivos: number): number {
  return horasProdutivasFuncionario * numFuncionariosAtivos;
}

// ---- rateio do custo fixo por hora produtiva ----

export function calcularRateioCustosFixos(totalFixo: number, totalHorasProdutivasEmpresa: number): number {
  return totalHorasProdutivasEmpresa > 0 ? totalFixo / totalHorasProdutivasEmpresa : 0;
}

export function calcularCustoHoraEmpresa(totalCustoFuncionariosAtivos: number, totalFixo: number, totalHorasProdutivasEmpresa: number): number {
  return totalHorasProdutivasEmpresa > 0 ? (totalCustoFuncionariosAtivos + totalFixo) / totalHorasProdutivasEmpresa : 0;
}

// ---- custo/hora por funcionário ----

export function calcularCustoHoraIndividual(custoMensalFuncionario: number, horasProdutivasFuncionario: number): number {
  return horasProdutivasFuncionario > 0 ? custoMensalFuncionario / horasProdutivasFuncionario : 0;
}

// "Sittech" = individual + rateio do fixo — é o valor usado como custo/hora
// real de cada funcionário em todo o resto do sistema (Produtos, Previsão).
export function calcularCustoHoraSittech(custoHoraIndividual: number, rateioPorHora: number): number {
  return custoHoraIndividual + rateioPorHora;
}

// ---- agrupamento por operação ----

export function agruparFuncionariosPorOperacao(funcionarios: Funcionario[]): [string, Funcionario[]][] {
  const map: Record<string, Funcionario[]> = {};
  funcionarios.forEach((f) => {
    if (!map[f.operacao]) map[f.operacao] = [];
    map[f.operacao].push(f);
  });
  return Object.entries(map);
}

export function calcularResumoPorOperacao(funcionarios: Funcionario[], horasProdutivasFuncionario: number, rateioPorHora: number): ResumoOperacao[] {
  return agruparFuncionariosPorOperacao(funcionarios).map(([operacao, lista]) => {
    const ativosGrupo = lista.filter((f) => f.ativo);
    const totalMensalGrupo = ativosGrupo.reduce((s, f) => s + calcularCustoMensalFuncionario(f), 0);
    const totalHoraGrupo = ativosGrupo.reduce((s, f) => {
      const individual = calcularCustoHoraIndividual(calcularCustoMensalFuncionario(f), horasProdutivasFuncionario);
      return s + calcularCustoHoraSittech(individual, rateioPorHora);
    }, 0);
    const totalHorasGrupo = horasProdutivasFuncionario * ativosGrupo.length;
    const mediaMensal = ativosGrupo.length ? totalMensalGrupo / ativosGrupo.length : 0;
    const mediaHora = ativosGrupo.length ? totalHoraGrupo / ativosGrupo.length : 0;
    return { operacao, funcionarios: lista, ativosGrupo, totalMensalGrupo, totalHoraGrupo, totalHorasGrupo, mediaMensal, mediaHora };
  });
}

// ---- FONTE ÚNICA DE VERDADE: custo/hora por operação + custo/hora empresa ----
// Usada pela tela de Custo por Hora E por Previsão/Capacidade (via
// calcularMargemProduto) para achar o lucro/hora de cada produto. Não
// duplicar esta função em outro arquivo — importar daqui.
//
// TODO / COMPORTAMENTO ATUAL A REVISAR: uma operação sem NENHUM funcionário
// ativo simplesmente não aparece em `custoHoraPorOperacao` (nem com 0) — o
// código que consome esse mapa cai no fallback custoHoraEmpresa nesse caso
// (ver calcularIndicadoresProducao). Preservado assim de propósito.
export function calcularCustoHoraEOperacoes(
  funcionarios: Funcionario[],
  fixedCosts: FixedCost[],
  horasPorDia: number,
  diasUteis: string | number
): CustoHoraEOperacoes {
  const funcionariosAtivos = funcionarios.filter((f) => f.ativo);
  const totalFixo = calcularTotalFixoAtivo(fixedCosts);
  const totalCustoFuncionariosAtivos = calcularTotalCustoFuncionariosAtivos(funcionariosAtivos);
  const custoMedioFuncionarioMensal = calcularCustoMedioFuncionarioMensal(totalCustoFuncionariosAtivos, funcionariosAtivos.length);

  const horasProdutivasFuncionario = calcularHorasProdutivasFuncionario(horasPorDia, diasUteis);
  const totalHorasProdutivasEmpresa = calcularTotalHorasProdutivasEmpresa(horasProdutivasFuncionario, funcionariosAtivos.length);
  const rateioPorHora = calcularRateioCustosFixos(totalFixo, totalHorasProdutivasEmpresa);
  const custoHoraEmpresa = calcularCustoHoraEmpresa(totalCustoFuncionariosAtivos, totalFixo, totalHorasProdutivasEmpresa);

  const resumoPorOperacao = calcularResumoPorOperacao(funcionarios, horasProdutivasFuncionario, rateioPorHora);
  const custoHoraPorOperacao: Record<string, number> = {};
  resumoPorOperacao.forEach((r) => {
    if (r.ativosGrupo.length === 0) return; // ver TODO acima
    custoHoraPorOperacao[r.operacao] = r.mediaHora;
  });

  return {
    custoHoraPorOperacao, custoHoraEmpresa, rateioPorHora, totalFixo, totalCustoFuncionariosAtivos,
    horasProdutivasFuncionario, totalHorasProdutivasEmpresa, custoMedioFuncionarioMensal, resumoPorOperacao,
  };
}

// ---- custo/margem de produção de um produto (consome o custo/hora acima) ----

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

// ---- meta de faturamento (painel "Meta de faturamento" da Previsão e card "Meta semanal" do menu) ----

export interface MetaFaturamento {
  metaInvalida: boolean;
  faturamentoMensalNecessario: number;
  faturamentoSemanalNecessario: number;
  impostoMeta: number;
  lucroMeta: number;
}

const SEMANAS_POR_MES = 52 / 12;
const ALIQUOTA_IMPOSTO = 0.09;

export function calcularMetaFaturamento(custoTotalMensal: number, margemDesejadaPct: number): MetaFaturamento {
  const margemDesejadaNum = margemDesejadaPct / 100;
  const divisorMeta = 1 - ALIQUOTA_IMPOSTO - margemDesejadaNum;
  const metaInvalida = divisorMeta <= 0;
  const faturamentoMensalNecessario = !metaInvalida ? custoTotalMensal / divisorMeta : 0;
  const faturamentoSemanalNecessario = faturamentoMensalNecessario / SEMANAS_POR_MES;
  const impostoMeta = faturamentoMensalNecessario * ALIQUOTA_IMPOSTO;
  const lucroMeta = faturamentoMensalNecessario - impostoMeta - custoTotalMensal;
  return { metaInvalida, faturamentoMensalNecessario, faturamentoSemanalNecessario, impostoMeta, lucroMeta };
}
