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

  it("sem previsto: percentual fica 0, não NaN/Infinity", () => {
    const resumo = calcularResumoSemana({ itens: [], itensRealizados: [] });
    expect(resumo.valorPrevisto).toBe(0);
    expect(resumo.percentualConcluido).toBe(0);
    expect(Number.isFinite(resumo.percentualConcluido)).toBe(true);
  });
});
