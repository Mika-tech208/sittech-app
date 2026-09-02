import { describe, it, expect } from "vitest";
import {
  calcularTotalFixoAtivo, calcularCustoMensalFuncionario, calcularTotalCustoFuncionariosAtivos,
  calcularCustoMedioFuncionarioMensal, calcularHorasProdutivasFuncionario, calcularTotalHorasProdutivasEmpresa,
  calcularRateioCustosFixos, calcularCustoHoraEmpresa, calcularCustoHoraIndividual, calcularCustoHoraSittech,
  calcularResumoPorOperacao, calcularCustoHoraEOperacoes, calcularIndicadoresProducao, calcularMargemProduto,
  calcularMetaFaturamento,
} from "@/features/custo-hora/calculations";
import type { FixedCost, Funcionario, PeriodoComDuracao, Produto, RoteiroEtapaMetas } from "@/types/domain";

function metas(m1: number): RoteiroEtapaMetas {
  return { m1, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 };
}

function funcionario(over: Partial<Funcionario> & Pick<Funcionario, "id" | "operacao" | "salarioBase">): Funcionario {
  return { nome: over.id, ativo: true, custos: [], ...over };
}

// ---- Caso A — funcionário com custo normal ----
describe("Caso A — funcionário com custo normal", () => {
  it("calcularCustoMensalFuncionario: só salário base, sem custos adicionais", () => {
    expect(calcularCustoMensalFuncionario({ salarioBase: 2000, custos: [] })).toBe(2000);
  });
});

// ---- Caso B — funcionário com custos adicionais ----
describe("Caso B — funcionário com custos adicionais", () => {
  it("soma salário base + todos os custos adicionais", () => {
    const f = { salarioBase: 2000, custos: [{ id: "1", descricao: "VT", valor: 200 }, { id: "2", descricao: "VR", valor: 300 }] };
    expect(calcularCustoMensalFuncionario(f)).toBe(2500);
  });
});

// ---- Caso C — operação com mais de um funcionário ----
describe("Caso C — operação com mais de um funcionário", () => {
  const funcionarios: Funcionario[] = [
    funcionario({ id: "f1", operacao: "Corte", salarioBase: 2000 }),
    funcionario({ id: "f2", operacao: "Corte", salarioBase: 3000 }),
    funcionario({ id: "f3", operacao: "Solda", salarioBase: 2500, ativo: false }), // inativo
  ];
  const fixedCosts: FixedCost[] = [{ id: "1", descricao: "Aluguel", categoria: "Aluguel", valor: 1000, ativo: true }];

  it("calcularCustoHoraEOperacoes rateia o fixo pelas horas de TODOS os ativos e tira a média por operação", () => {
    // horasPorDia=8, diasUteis=22 -> horasProdutivasFuncionario=176h/mês por funcionário
    // 2 ativos -> totalHorasProdutivasEmpresa=352h ; rateioPorHora = 1000/352
    const resultado = calcularCustoHoraEOperacoes(funcionarios, fixedCosts, 8, 22);
    const rateioEsperado = 1000 / 352;
    expect(resultado.rateioPorHora).toBeCloseTo(rateioEsperado, 6);
    const esperadoCorte = ((2000 / 176 + rateioEsperado) + (3000 / 176 + rateioEsperado)) / 2;
    expect(resultado.custoHoraPorOperacao["Corte"]).toBeCloseTo(esperadoCorte, 6);
    // Solda só tem funcionário inativo -> não entra no mapa (comportamento atual, ver TODO no código)
    expect(resultado.custoHoraPorOperacao["Solda"]).toBeUndefined();
  });

  it("calcularResumoPorOperacao inclui o grupo Solda (com o inativo) mas ativosGrupo fica vazio", () => {
    const resumo = calcularResumoPorOperacao(funcionarios, 176, 1000 / 352);
    const solda = resumo.find((r) => r.operacao === "Solda")!;
    expect(solda.funcionarios).toHaveLength(1);
    expect(solda.ativosGrupo).toHaveLength(0);
    expect(solda.mediaHora).toBe(0);
  });
});

// ---- Caso D — custos fixos rateados corretamente ----
describe("Caso D — custos fixos rateados corretamente", () => {
  it("calcularRateioCustosFixos divide o total fixo pelas horas produtivas da empresa inteira", () => {
    expect(calcularRateioCustosFixos(2000, 400)).toBe(5);
  });
  it("sem horas produtivas (nenhum funcionário ativo): rateio é 0, não Infinity", () => {
    expect(calcularRateioCustosFixos(2000, 0)).toBe(0);
  });
  it("calcularTotalFixoAtivo ignora custos fixos pausados", () => {
    const fixedCosts: FixedCost[] = [
      { id: "1", descricao: "Aluguel", categoria: "Aluguel", valor: 1000, ativo: true },
      { id: "2", descricao: "Antigo", categoria: "Outros", valor: 500, ativo: false },
    ];
    expect(calcularTotalFixoAtivo(fixedCosts)).toBe(1000);
  });
  it("calcularCustoHoraEmpresa: (custo funcionários + fixo) / horas produtivas da empresa", () => {
    expect(calcularCustoHoraEmpresa(5000, 2000, 400)).toBeCloseTo((5000 + 2000) / 400, 5);
  });
  it("calcularCustoHoraEmpresa: sem horas produtivas, custo/hora empresa é 0, não Infinity", () => {
    expect(calcularCustoHoraEmpresa(5000, 2000, 0)).toBe(0);
  });
});

// ---- Caso E — alteração de período/hora disponível refletindo no custo/hora ----
describe("Caso E — período/hora disponível refletindo no custo/hora", () => {
  it("mais horas produtivas por dia -> mais horas por funcionário -> custo/hora individual menor", () => {
    const custoMensal = 2000;
    const horasComPeriodoCurto = calcularHorasProdutivasFuncionario(4, 22); // 88h/mês
    const horasComPeriodoLongo = calcularHorasProdutivasFuncionario(8, 22); // 176h/mês
    const custoHoraCurto = calcularCustoHoraIndividual(custoMensal, horasComPeriodoCurto);
    const custoHoraLongo = calcularCustoHoraIndividual(custoMensal, horasComPeriodoLongo);
    expect(horasComPeriodoLongo).toBeGreaterThan(horasComPeriodoCurto);
    expect(custoHoraLongo).toBeLessThan(custoHoraCurto);
    expect(custoHoraCurto).toBeCloseTo(2000 / 88, 5);
    expect(custoHoraLongo).toBeCloseTo(2000 / 176, 5);
  });

  it("calcularTotalHorasProdutivasEmpresa escala com o número de funcionários ativos", () => {
    expect(calcularTotalHorasProdutivasEmpresa(176, 3)).toBe(528);
    expect(calcularTotalHorasProdutivasEmpresa(176, 0)).toBe(0);
  });
});

// ---- Caso F — margem/lucro por hora ----
describe("Caso F — margem/lucro por hora", () => {
  const periodos: PeriodoComDuracao[] = [{ id: "m1", nome: "M1", inicio: "07:00", fim: "15:00", duracaoHoras: 8 }];
  const produto: Pick<Produto, "roteiro" | "valorUnitario"> = {
    valorUnitario: 100,
    roteiro: [{ id: "e1", operacao: "Corte", metas: metas(10), maquinasIds: [] }], // 10 peças/8h -> 0.8h/peça
  };

  it("usa o custo/hora da operação da etapa quando existe", () => {
    const indicadores = calcularIndicadoresProducao(produto, { Corte: 50 }, 20, periodos);
    expect(indicadores.tempoTotalHoras).toBeCloseTo(0.8, 5);
    expect(indicadores.custo).toBeCloseTo(0.8 * 50, 5); // 40
  });

  it("cai pro custoHoraEmpresa quando a operação não tem custo/hora calculado", () => {
    const indicadores = calcularIndicadoresProducao(produto, {}, 20, periodos);
    expect(indicadores.custo).toBeCloseTo(0.8 * 20, 5); // 16
  });

  it("calcula margem em R$, % e lucro/hora", () => {
    const margem = calcularMargemProduto(produto, { Corte: 50 }, 20, periodos);
    expect(margem.custo).toBeCloseTo(40, 5);
    expect(margem.margemRS).toBeCloseTo(60, 5); // 100 - 40
    expect(margem.margemPct).toBeCloseTo(60, 5);
    expect(margem.lucroHora).toBeCloseTo(60 / 0.8, 5); // 75 R$/h
  });

  it("margem negativa (custo maior que o valor recebido) não quebra, só fica negativa", () => {
    const margem = calcularMargemProduto(produto, { Corte: 500 }, 500, periodos); // custo = 0.8*500=400 > valorUnitario 100? não, 400>100
    expect(margem.margemRS).toBeLessThan(0);
    expect(margem.margemPct).toBeLessThan(0);
    expect(margem.lucroHora).toBeLessThan(0);
  });
});

// ---- Caso G — meta semanal ----
describe("Caso G — meta de faturamento / semanal", () => {
  it("calcula faturamento mensal/semanal necessário pra margem desejada, com 9% de imposto", () => {
    const resultado = calcularMetaFaturamento(10000, 20); // divisor = 1 - 0.09 - 0.20 = 0.71
    expect(resultado.metaInvalida).toBe(false);
    expect(resultado.faturamentoMensalNecessario).toBeCloseTo(10000 / 0.71, 5);
    expect(resultado.faturamentoSemanalNecessario).toBeCloseTo(resultado.faturamentoMensalNecessario / (52 / 12), 5);
    expect(resultado.impostoMeta).toBeCloseTo(resultado.faturamentoMensalNecessario * 0.09, 5);
    expect(resultado.lucroMeta).toBeCloseTo(resultado.faturamentoMensalNecessario - resultado.impostoMeta - 10000, 5);
  });

  it("margem + imposto >= 100%: meta inválida, tudo zerado (não Infinity/NaN)", () => {
    const resultado = calcularMetaFaturamento(10000, 95); // 0.09 + 0.95 > 1
    expect(resultado.metaInvalida).toBe(true);
    expect(resultado.faturamentoMensalNecessario).toBe(0);
    expect(resultado.faturamentoSemanalNecessario).toBe(0);
  });
});

// ---- Caso H — dados vazios ----
describe("Caso H — dados vazios", () => {
  it("sem funcionários nem custos fixos: tudo zerado, sem crash", () => {
    const resultado = calcularCustoHoraEOperacoes([], [], 8, 22);
    expect(resultado.custoHoraEmpresa).toBe(0);
    expect(resultado.rateioPorHora).toBe(0);
    expect(resultado.custoHoraPorOperacao).toEqual({});
    expect(resultado.resumoPorOperacao).toEqual([]);
    expect(resultado.custoMedioFuncionarioMensal).toBe(0);
  });

  it("calcularTotalCustoFuncionariosAtivos de lista vazia é 0", () => {
    expect(calcularTotalCustoFuncionariosAtivos([])).toBe(0);
  });
});

// ---- Caso I — valor zero ----
describe("Caso I — valores zero", () => {
  it("diasUteis '0': horas produtivas por funcionário ficam 0, custo/hora individual 0 (não Infinity)", () => {
    const horas = calcularHorasProdutivasFuncionario(8, "0");
    expect(horas).toBe(0);
    expect(calcularCustoHoraIndividual(2000, horas)).toBe(0);
  });

  it("funcionário com salário 0 e sem custos: custo mensal 0", () => {
    expect(calcularCustoMensalFuncionario({ salarioBase: 0, custos: [] })).toBe(0);
  });
});

// ---- Caso J — casos extremos do código real ----
describe("Caso J — casos extremos", () => {
  it("diasUteis como string com vírgula decimal (digitação manual) é convertido corretamente", () => {
    // toNumber troca vírgula por ponto — comportamento já testado em lib/format,
    // aqui só confirma que calcularHorasProdutivasFuncionario usa toNumber por baixo.
    expect(calcularHorasProdutivasFuncionario(8, "22,5")).toBeCloseTo(180, 5);
  });

  it("calcularCustoHoraSittech = individual + rateio, nunca um substitui o outro", () => {
    expect(calcularCustoHoraSittech(10, 2)).toBe(12);
    expect(calcularCustoHoraSittech(0, 2)).toBe(2);
    expect(calcularCustoHoraSittech(10, 0)).toBe(10);
  });

  it("calcularCustoMedioFuncionarioMensal com 0 funcionários ativos não divide por zero", () => {
    expect(calcularCustoMedioFuncionarioMensal(5000, 0)).toBe(0);
  });
});
