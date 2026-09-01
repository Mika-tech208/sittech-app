import { describe, it, expect } from "vitest";
import {
  calcularTotalFixoAtivo, calcularCustoMensalFuncionario, calcularTotalCustoFuncionariosAtivos,
  calcularCustoHoraPorOperacao, calcularIndicadoresProducao, calcularMargemProduto,
} from "@/lib/calculations/custoHora";
import type { FixedCost, Funcionario, PeriodoComDuracao, Produto, RoteiroEtapaMetas } from "@/types/domain";

function metas(m1: number): RoteiroEtapaMetas {
  return { m1, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 };
}

describe("calcularTotalFixoAtivo", () => {
  it("soma só os custos fixos ativos", () => {
    const fixedCosts: FixedCost[] = [
      { id: "1", descricao: "Aluguel", categoria: "Aluguel", valor: 1000, ativo: true },
      { id: "2", descricao: "Antigo", categoria: "Outros", valor: 500, ativo: false },
    ];
    expect(calcularTotalFixoAtivo(fixedCosts)).toBe(1000);
  });
});

describe("calcularTotalCustoFuncionariosAtivos", () => {
  it("soma o custo mensal de todos os funcionários ativos passados", () => {
    const ativos: Funcionario[] = [
      { id: "f1", nome: "A", operacao: "Corte", salarioBase: 2000, ativo: true, custos: [] },
      { id: "f2", nome: "B", operacao: "Corte", salarioBase: 3000, ativo: true, custos: [{ id: "1", descricao: "VT", valor: 100 }] },
    ];
    expect(calcularTotalCustoFuncionariosAtivos(ativos)).toBe(5100);
  });

  it("lista vazia soma 0", () => {
    expect(calcularTotalCustoFuncionariosAtivos([])).toBe(0);
  });
});

describe("calcularCustoMensalFuncionario", () => {
  it("soma salário base + custos adicionais", () => {
    const f: Pick<Funcionario, "salarioBase" | "custos"> = {
      salarioBase: 2000,
      custos: [{ id: "1", descricao: "VT", valor: 200 }, { id: "2", descricao: "VR", valor: 300 }],
    };
    expect(calcularCustoMensalFuncionario(f)).toBe(2500);
  });
});

describe("calcularCustoHoraPorOperacao", () => {
  const funcionarios: Funcionario[] = [
    { id: "f1", nome: "A", operacao: "Corte", salarioBase: 2000, ativo: true, custos: [] },
    { id: "f2", nome: "B", operacao: "Corte", salarioBase: 3000, ativo: true, custos: [] },
    { id: "f3", nome: "C", operacao: "Solda", salarioBase: 2500, ativo: false, custos: [] }, // inativo
  ];
  const fixedCosts: FixedCost[] = [{ id: "1", descricao: "Aluguel", categoria: "Aluguel", valor: 1000, ativo: true }];

  it("rateia o custo fixo pelas horas produtivas de TODOS os ativos e soma no custo/hora de cada operação", () => {
    // horasPorDia=8, diasUteis=22 -> horasProdutivasFuncionario=176h/mês por funcionário
    // 2 funcionários ativos -> totalHorasProdutivasEmpresa=352h
    // rateioPorHora = 1000/352
    const resultado = calcularCustoHoraPorOperacao(funcionarios, fixedCosts, 8, 22);
    const rateioEsperado = 1000 / 352;
    expect(resultado.rateioPorHora).toBeCloseTo(rateioEsperado, 6);
    // custoHoraIndividual(f1) = 2000/176 ; custoHoraSittech(f1) = 2000/176 + rateio
    // custoHoraIndividual(f2) = 3000/176 ; custoHoraSittech(f2) = 3000/176 + rateio
    // média dos dois de Corte:
    const esperadoCorte = ((2000 / 176 + rateioEsperado) + (3000 / 176 + rateioEsperado)) / 2;
    expect(resultado.custoHoraPorOperacao["Corte"]).toBeCloseTo(esperadoCorte, 6);
    // Solda só tem funcionário inativo -> não entra no mapa
    expect(resultado.custoHoraPorOperacao["Solda"]).toBeUndefined();
  });

  it("sem funcionários ativos: custoHoraEmpresa e rateio ficam 0, sem crash (divisão por zero evitada)", () => {
    const resultado = calcularCustoHoraPorOperacao([], fixedCosts, 8, 22);
    expect(resultado.custoHoraEmpresa).toBe(0);
    expect(resultado.rateioPorHora).toBe(0);
    expect(resultado.custoHoraPorOperacao).toEqual({});
  });
});

describe("calcularIndicadoresProducao / calcularMargemProduto", () => {
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
});
