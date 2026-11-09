import { describe, it, expect } from "vitest";
import { selecionarSemana, calcularResumoSemana } from "@/features/capacidade/selectors";
import type { Previsao } from "@/types/domain";

describe("selecionarSemana", () => {
  it("acha a semana existente pela data de início", () => {
    const previsoes: Previsao[] = [{ semanaInicio: "2026-09-01", itens: [], itensRealizados: [] }];
    expect(selecionarSemana(previsoes, "2026-09-01")).toBe(previsoes[0]);
  });

  it("retorna uma semana vazia válida quando a semana ainda não existe (sem crash)", () => {
    const semana = selecionarSemana([], "2026-09-01");
    expect(semana).toEqual({ semanaInicio: "2026-09-01", itens: [], itensRealizados: [], maquinasIndisponiveis: [] });
  });
});

describe("calcularResumoSemana", () => {
  it("calcula previsto, realizado, percentual e diferença", () => {
    const semana = {
      itens: [{ id: "i1", produtoId: "p", produtoNome: "P", valorUnitario: 10, quantidade: 5, maquinasPorEtapa: {} }],
      itensRealizados: [{ id: "r1", produtoId: "p", produtoNome: "P", valorUnitario: 10, quantidade: 3, maquinasPorEtapa: {} }],
    };
    const resumo = calcularResumoSemana(semana);
    expect(resumo.valorPrevisto).toBe(50);
    expect(resumo.valorRealizado).toBe(30);
    expect(resumo.percentualConcluido).toBe(60);
    expect(resumo.diferenca).toBe(-20);
  });

  it("PREVISTO ORIGINAL: produto encerrado na semana continua no valor previsto (quantidade operacional 0, meta original 56.400 × R$ 0,217)", () => {
    const encerrado = { id: "e", produtoId: "4x2", produtoNome: "Caixa Amarela 4x2", valorUnitario: 0.217, quantidade: 0, maquinasPorEtapa: {}, encerrado: { quantidadeOriginal: 56400, adicionalOriginal: 0, encerradoEm: "2026-11-06T15:30:00Z", motivo: null } };
    const ativo = { id: "a", produtoId: "x", produtoNome: "X", valorUnitario: 0.1, quantidade: 1000, maquinasPorEtapa: {} };
    const resumo = calcularResumoSemana({ itens: [encerrado, ativo], itensRealizados: [] });
    expect(resumo.valorPrevisto).toBeCloseTo(56400 * 0.217 + 1000 * 0.1, 6);
    // sem produto encerrado: idêntico à regra de sempre
    expect(calcularResumoSemana({ itens: [ativo], itensRealizados: [] }).valorPrevisto).toBe(100);
  });

  it("sem previsto: percentual fica 0, não NaN/Infinity", () => {
    const resumo = calcularResumoSemana({ itens: [], itensRealizados: [] });
    expect(resumo.valorPrevisto).toBe(0);
    expect(resumo.percentualConcluido).toBe(0);
    expect(Number.isFinite(resumo.percentualConcluido)).toBe(true);
  });
});
