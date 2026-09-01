import { describe, it, expect } from "vitest";
import {
  calcularFuncionariosNecessarios, calcularFuncionariosTotalSemana, calcularPeriodosEtapa, textoDiasPeriodos,
  calcularMaquinasDaEtapa, calcularHorasPorMaquina, calcularAnaliseCapacidadeSemanal, calcularCapacidadeMaximaSemana,
  calcularUsoPorMaquina, calcularCapacidadeMaximaProduto, calcularViabilidadeItem, calcularObservacoesSetup,
  calcularItensSemanaAgregados, calcularCapacidadeInicialPorMaquina, calcularHistoricoSemanas, calcularAlocacaoSemanal,
} from "@/features/capacidade/calculations";
import type { Produto, Maquina, PeriodoComDuracao, PrevisaoItem, RoteiroEtapaMetas, Previsao } from "@/types/domain";

// ---- fixtures ----
// 1 período de 8h -> duracaoMediaPeriodo = 8h, horasPorMaquinaSemana = 8 * diasUteisSemana.
const PERIODO_8H: PeriodoComDuracao = { id: "m1", nome: "M1", inicio: "07:00", fim: "15:00", duracaoHoras: 8 };
const PERIODOS: PeriodoComDuracao[] = [PERIODO_8H];
const DURACAO_MEDIA_PERIODO = 8;
const DIAS_UTEIS_SEMANA = 5;
const HORAS_MAQUINA_SEMANA = DURACAO_MEDIA_PERIODO * DIAS_UTEIS_SEMANA; // 40h

function metas(m1: number): RoteiroEtapaMetas {
  return { m1, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 };
}

function maquina(id: string, nome: string, operacao: string, ativo = true): Maquina {
  return { id, nome, operacao, ativo };
}

function produto(id: string, nome: string, valorUnitario: number, tempoPorPecaHoras: number, operacao = "Corte"): Produto {
  // metas(pecas) tais que totalHoras(8h) / pecas = tempoPorPecaHoras
  const pecas = 8 / tempoPorPecaHoras;
  return {
    id, nome, referencia: "", valorUnitario, ativo: true, prioridade: "media",
    roteiro: [{ id: `${id}-e1`, operacao, metas: metas(pecas), maquinasIds: [] }],
  };
}

function item(id: string, produtoId: string, produtoNome: string, valorUnitario: number, quantidade: number, maquinasPorEtapa: Record<string, string[]>): PrevisaoItem {
  return { id, produtoId, produtoNome, valorUnitario, quantidade, maquinasPorEtapa };
}

// Produto A: 10 peças / 8h -> 0.8h/peça. Produto B: 16 peças / 8h -> 0.5h/peça (mais produtivo).
const produtoA = produto("produtoA", "Produto A", 100, 0.8);
const produtoB = produto("produtoB", "Produto B", 80, 0.5);
const maq1 = maquina("maq1", "Máquina 1", "Corte");

describe("Caso 1 — capacidade dentro do limite", () => {
  it("máquina com carga abaixo da disponível: atingível, sem gargalo", () => {
    const it1 = item("it1", "produtoA", "Produto A", 100, 30, { "produtoA-e1": ["maq1"] });
    const analise = calcularAnaliseCapacidadeSemanal([it1], [produtoA], [maq1], PERIODOS, HORAS_MAQUINA_SEMANA);
    expect(analise.maquinas).toHaveLength(1);
    expect(analise.maquinas[0].horasNecessarias).toBeCloseTo(24, 5); // 30 * 0.8h
    expect(analise.maquinas[0].pct).toBeCloseTo(60, 5);
    expect(analise.maquinas[0].status).toBe("normal");
    expect(analise.atingivel).toBe(true);
    expect(analise.gargalos).toHaveLength(0);
  });
});

describe("Caso 2 — capacidade exatamente no limite (100%)", () => {
  it("carga igual à disponível: atingível, sem excesso", () => {
    const it1 = item("it1", "produtoA", "Produto A", 100, 50, { "produtoA-e1": ["maq1"] }); // 50 * 0.8h = 40h
    const analise = calcularAnaliseCapacidadeSemanal([it1], [produtoA], [maq1], PERIODOS, HORAS_MAQUINA_SEMANA);
    expect(analise.maquinas[0].pct).toBeCloseTo(100, 5);
    expect(analise.maquinas[0].deficit).toBe(0);
    expect(analise.maquinas[0].status).toBe("proximo"); // pct > 100 é que vira "gargalo" — 100 exato não
    expect(analise.atingivel).toBe(true);
    expect(analise.gargalos).toHaveLength(0);
  });
});

describe("Caso 3 — capacidade acima do limite (130%)", () => {
  it("mostra a utilização real (130%), sem teto artificial em 100%", () => {
    const it1 = item("it1", "produtoA", "Produto A", 100, 65, { "produtoA-e1": ["maq1"] }); // 65 * 0.8h = 52h
    const analise = calcularAnaliseCapacidadeSemanal([it1], [produtoA], [maq1], PERIODOS, HORAS_MAQUINA_SEMANA);
    expect(analise.maquinas[0].pct).toBeCloseTo(130, 5);
    expect(analise.maquinas[0].deficit).toBeCloseTo(12, 5); // 52 - 40
    expect(analise.maquinas[0].status).toBe("gargalo");
    expect(analise.atingivel).toBe(false);
    expect(analise.gargalos).toHaveLength(1);
  });

  it("nunca aplica Math.min(100, pct) — regressão do bug antigo", () => {
    const it1 = item("it1", "produtoA", "Produto A", 100, 100, { "produtoA-e1": ["maq1"] }); // 80h -> 200%
    const analise = calcularAnaliseCapacidadeSemanal([it1], [produtoA], [maq1], PERIODOS, HORAS_MAQUINA_SEMANA);
    expect(analise.maquinas[0].pct).toBeCloseTo(200, 5);
  });
});

describe("Caso 4 — dois produtos disputando a mesma máquina", () => {
  const itA = item("itA", "produtoA", "Produto A", 100, 30, { "produtoA-e1": ["maq1"] }); // 24h
  const itB = item("itB", "produtoB", "Produto B", 80, 40, { "produtoB-e1": ["maq1"] }); // 20h
  const produtos = [produtoA, produtoB];

  it("cada item cabe isoladamente na máquina", () => {
    const viabA = calcularViabilidadeItem(itA, produtos, PERIODOS, HORAS_MAQUINA_SEMANA);
    const viabB = calcularViabilidadeItem(itB, produtos, PERIODOS, HORAS_MAQUINA_SEMANA);
    expect(viabA.atingivel).toBe(true);
    expect(viabA.maxPecas).toBe(50); // 40h / 0.8h
    expect(viabB.atingivel).toBe(true);
    expect(viabB.maxPecas).toBe(80); // 40h / 0.5h
  });

  it("somados excedem a máquina: o resumo por máquina acusa gargalo", () => {
    const analise = calcularAnaliseCapacidadeSemanal([itA, itB], produtos, [maq1], PERIODOS, HORAS_MAQUINA_SEMANA);
    expect(analise.maquinas[0].horasNecessarias).toBeCloseTo(44, 5); // 24 + 20
    expect(analise.maquinas[0].pct).toBeCloseTo(110, 5);
    expect(analise.maquinas[0].status).toBe("gargalo");
    expect(analise.atingivel).toBe(false);
    expect(analise.maquinas[0].produtosConsumidores).toEqual(
      expect.arrayContaining([
        { nome: "Produto A", horas: 24 },
        { nome: "Produto B", horas: 20 },
      ])
    );
  });

  it("calcularCapacidadeMaximaSemana reduz os DOIS itens proporcionalmente ao mesmo fator", () => {
    const resultado = calcularCapacidadeMaximaSemana([itA, itB], produtos, [maq1], PERIODOS, HORAS_MAQUINA_SEMANA);
    expect(resultado.temGargalo).toBe(true);
    const fator = 40 / 44;
    const resA = resultado.resultadosPorItem.find((r) => r.itemId === "itA")!;
    const resB = resultado.resultadosPorItem.find((r) => r.itemId === "itB")!;
    expect(resA.maximoPossivel).toBe(Math.floor(30 * fator)); // 27
    expect(resB.maximoPossivel).toBe(Math.floor(40 * fator)); // 36
  });

  it("calcularAlocacaoSemanal (greedy por lucro/hora) é uma pergunta DIFERENTE: prioriza o item mais lucrativo, não reduz proporcionalmente", () => {
    const itensAgregados = calcularItensSemanaAgregados([itA, itB]);
    const lucroHoraPorProduto: Record<string, number> = { produtoA: 10, produtoB: 50 };
    const resultado = calcularAlocacaoSemanal(
      itensAgregados, produtos, { maq1: 40 }, PERIODOS, [maq1], ["Corte"], HORAS_MAQUINA_SEMANA, DURACAO_MEDIA_PERIODO,
      (p) => lucroHoraPorProduto[p.id]
    );
    const resA = resultado.resultados.find((r) => r.produtoId === "produtoA")!;
    const resB = resultado.resultados.find((r) => r.produtoId === "produtoB")!;
    // Produto B tem lucro/hora maior -> alocado primeiro, integralmente.
    expect(resB.quantidadeAlocada).toBe(40);
    expect(resB.deficit).toBe(0);
    // Produto A fica com o que sobrou da máquina, não uma fração proporcional.
    expect(resA.quantidadeAlocada).toBe(25);
    expect(resA.deficit).toBe(5);
    expect(resA.gargalo).toBe("Corte");
    // Confirma que é uma resposta diferente da redução proporcional (27/36) acima.
    expect([resA.quantidadeAlocada, resB.quantidadeAlocada]).not.toEqual([27, 36]);
  });
});

describe("Caso 5 — máquinas diferentes não geram conflito artificial", () => {
  it("produtos em máquinas distintas têm análises independentes", () => {
    const maq2 = maquina("maq2", "Máquina 2", "Solda");
    const produtoC = produto("produtoC", "Produto C", 50, 1, "Solda"); // 1h/peça
    const itA = item("itA", "produtoA", "Produto A", 100, 30, { "produtoA-e1": ["maq1"] }); // 24h em maq1 (60%)
    const itC = item("itC", "produtoC", "Produto C", 50, 10, { "produtoC-e1": ["maq2"] }); // 10h em maq2 (25%)
    const analise = calcularAnaliseCapacidadeSemanal([itA, itC], [produtoA, produtoC], [maq1, maq2], PERIODOS, HORAS_MAQUINA_SEMANA);
    expect(analise.maquinas).toHaveLength(2);
    expect(analise.gargalos).toHaveLength(0);
    expect(analise.atingivel).toBe(true);
    const m1 = analise.maquinas.find((m) => m.maquinaId === "maq1")!;
    const m2 = analise.maquinas.find((m) => m.maquinaId === "maq2")!;
    expect(m1.pct).toBeCloseTo(60, 5);
    expect(m2.pct).toBeCloseTo(25, 5);
  });
});

describe("Caso 6 — produtividade diferente por produto não vaza entre produtos", () => {
  it("a divisão de carga entre máquinas de uma etapa não é sempre 50/50 — a menos carregada absorve mais", () => {
    // etapa D usa 2 máquinas (maq3, maq4); etapa E usa só maq3 (carga extra só nela).
    const produtoD = produto("produtoD", "Produto D", 10, 1, "Fresagem"); // 1h/peça
    const produtoE = produto("produtoE", "Produto E", 10, 2, "Fresagem"); // 2h/peça
    const itD = item("itD", "produtoD", "Produto D", 10, 20, { "produtoD-e1": ["maq3", "maq4"] }); // 20h totais
    const itE = item("itE", "produtoE", "Produto E", 10, 5, { "produtoE-e1": ["maq3"] }); // 10h, só maq3

    const porMaquina = calcularHorasPorMaquina([itD, itE], [produtoD, produtoE], PERIODOS, HORAS_MAQUINA_SEMANA);

    // maq3 já carrega 10h extra (Produto E) -> sobra menos folga pra ela -> recebe MENOS da etapa compartilhada.
    const contribuicaoDemaq3 = porMaquina["maq3"].produtos["Produto D"];
    const contribuicaoDemaq4 = porMaquina["maq4"].produtos["Produto D"];
    expect(contribuicaoDemaq3).toBeCloseTo(60 / 7, 5); // ~8.57h
    expect(contribuicaoDemaq4).toBeCloseTo(80 / 7, 5); // ~11.43h
    expect(contribuicaoDemaq4).toBeGreaterThan(contribuicaoDemaq3); // a mais livre absorve mais
    expect(contribuicaoDemaq3 + contribuicaoDemaq4).toBeCloseTo(20, 5); // soma bate com o total da etapa

    // a produtividade de D não afeta o tempoPorPeca de E, nem vice-versa.
    expect(porMaquina["maq3"].produtos["Produto E"]).toBeCloseTo(10, 5);
  });
});

describe("Caso 7 — períodos/horas disponíveis", () => {
  it("horasDisponiveis de cada máquina é exatamente o horasPorMaquinaSemana passado, não recalculado", () => {
    const it1 = item("it1", "produtoA", "Produto A", 100, 10, { "produtoA-e1": ["maq1"] });
    const analise = calcularAnaliseCapacidadeSemanal([it1], [produtoA], [maq1], PERIODOS, 40);
    expect(analise.maquinas[0].horasDisponiveis).toBe(40);
    const analiseOutraSemana = calcularAnaliseCapacidadeSemanal([it1], [produtoA], [maq1], PERIODOS, 48);
    expect(analiseOutraSemana.maquinas[0].horasDisponiveis).toBe(48);
  });

  it("calcularPeriodosEtapa usa a duração média real do período", () => {
    const resultado = calcularPeriodosEtapa(50, 0.8, 1, DURACAO_MEDIA_PERIODO); // 40h calendário / 8h por período = 5 períodos
    expect(resultado.horasCalendario).toBeCloseTo(40, 5);
    expect(resultado.totalPeriodos).toBe(5);
  });

  it("calcularPeriodosEtapa retorna zeros quando não há máquina, tempo ou período válido", () => {
    expect(calcularPeriodosEtapa(50, 0, 1, 8)).toEqual({ manha: 0, tarde: 0, diasCompletos: 0, restantes: 0, totalPeriodos: 0, horasCalendario: 0 });
    expect(calcularPeriodosEtapa(50, 0.8, 0, 8)).toEqual({ manha: 0, tarde: 0, diasCompletos: 0, restantes: 0, totalPeriodos: 0, horasCalendario: 0 });
    expect(calcularPeriodosEtapa(50, 0.8, 1, 0)).toEqual({ manha: 0, tarde: 0, diasCompletos: 0, restantes: 0, totalPeriodos: 0, horasCalendario: 0 });
  });
});

describe("Caso 8 — dados vazios não quebram", () => {
  it("sem itens: análise de capacidade retorna estado válido e vazio", () => {
    const analise = calcularAnaliseCapacidadeSemanal([], [], [], [], 40);
    expect(analise).toEqual({ maquinas: [], gargalos: [], atingivel: true, maquinaMaisCarregada: null });
  });

  it("sem itens: capacidade máxima da semana não tem dados", () => {
    const resultado = calcularCapacidadeMaximaSemana([], [], [], [], 40);
    expect(resultado.temDados).toBe(false);
    expect(resultado.temGargalo).toBe(false);
    expect(resultado.resultadosPorItem).toEqual([]);
    expect(resultado.previstoTotalReais).toBe(0);
  });

  it("sem itens agregados nem operações: alocação semanal não quebra", () => {
    const resultado = calcularAlocacaoSemanal([], [], {}, [], [], [], 40, 8, () => 0);
    expect(resultado.resultados).toEqual([]);
    expect(resultado.usoPorOperacao).toEqual([]);
    expect(resultado.resumo).toEqual({ atendidos: [], comDeficit: [], operacoesComSobra: [] });
  });

  it("sem previsões: histórico de semanas é uma lista vazia", () => {
    expect(calcularHistoricoSemanas([])).toEqual([]);
  });
});

describe("Caso 9 — máquina sem capacidade/dado suficiente", () => {
  it("item aponta pra uma máquina que não existe mais no cadastro: não quebra, mostra 'Máquina removida'", () => {
    const it1 = item("it1", "produtoA", "Produto A", 100, 10, { "produtoA-e1": ["maquina-deletada"] });
    const analise = calcularAnaliseCapacidadeSemanal([it1], [produtoA], [], PERIODOS, HORAS_MAQUINA_SEMANA);
    expect(analise.maquinas).toHaveLength(1);
    expect(analise.maquinas[0].nome).toBe("Máquina removida");
    expect(analise.maquinas[0].operacao).toBe("");
    expect(analise.maquinas[0].horasNecessarias).toBeCloseTo(8, 5); // 10 * 0.8h
  });

  it("etapa sem nenhuma máquina selecionada no item: não contribui para nenhuma máquina", () => {
    const it1 = item("it1", "produtoA", "Produto A", 100, 10, {}); // sem seleção para 'produtoA-e1'
    const porMaquina = calcularHorasPorMaquina([it1], [produtoA], PERIODOS, HORAS_MAQUINA_SEMANA);
    expect(porMaquina).toEqual({});
  });

  it("produto sem roteiro: capacidade máxima é 0 sem gargalo definido", () => {
    const produtoSemRoteiro: Produto = { id: "px", nome: "Sem roteiro", referencia: "", valorUnitario: 10, ativo: true, prioridade: "media", roteiro: [] };
    const resultado = calcularCapacidadeMaximaProduto("px", {}, [produtoSemRoteiro], PERIODOS, HORAS_MAQUINA_SEMANA);
    expect(resultado).toEqual({ maxPecas: 0, gargalo: null });
  });

  it("etapa sem máquina marcada: capacidade da etapa é 0 e vira o gargalo", () => {
    const resultado = calcularCapacidadeMaximaProduto("produtoA", {}, [produtoA], PERIODOS, HORAS_MAQUINA_SEMANA);
    expect(resultado.maxPecas).toBe(0);
    expect(resultado.gargalo).toBe("Corte");
  });
});

describe("calcularUsoPorMaquina", () => {
  it("deriva períodos/status a partir da MESMA análise em horas, sem recalcular pct", () => {
    const it1 = item("it1", "produtoA", "Produto A", 100, 65, { "produtoA-e1": ["maq1"] }); // 130%
    const analise = calcularAnaliseCapacidadeSemanal([it1], [produtoA], [maq1], PERIODOS, HORAS_MAQUINA_SEMANA);
    const uso = calcularUsoPorMaquina(analise, DURACAO_MEDIA_PERIODO);
    expect(uso[0].pct).toBe(Math.round(analise.maquinas[0].pct)); // 130
    expect(uso[0].excedeu).toBe(true); // espelha status === "gargalo"
  });
});

describe("calcularMaquinasDaEtapa", () => {
  const maquinasAtivas = [maquina("m1", "M1", "Corte"), maquina("m2", "M2", "Corte"), maquina("m3", "M3", "Solda", false)];

  it("usa as máquinas explicitamente marcadas no roteiro, se houver", () => {
    const etapa = { maquinasIds: ["m1"], operacao: "Corte" };
    expect(calcularMaquinasDaEtapa(etapa, maquinasAtivas)).toEqual(["m1"]);
  });

  it("sem seleção: usa todas as ativas daquela operação como reserva", () => {
    const etapa = { maquinasIds: [], operacao: "Corte" };
    expect(calcularMaquinasDaEtapa(etapa, maquinasAtivas)).toEqual(["m1", "m2"]);
  });

  it("ignora máquinas inativas mesmo se marcadas", () => {
    const etapa = { maquinasIds: ["m3"], operacao: "Solda" };
    expect(calcularMaquinasDaEtapa(etapa, maquinasAtivas)).toEqual([]);
  });
});

describe("calcularFuncionariosNecessarios / TotalSemana", () => {
  it("conta máquinas únicas usadas por um item", () => {
    const it1 = item("it1", "produtoA", "A", 1, 1, { e1: ["m1", "m2"], e2: ["m1"] });
    expect(calcularFuncionariosNecessarios(it1)).toBe(2); // m1 e m2, m1 repetido não conta 2x
  });

  it("conta máquinas únicas em TODOS os itens da semana, sem contar a mesma máquina 2x entre itens", () => {
    const it1 = item("it1", "produtoA", "A", 1, 1, { e1: ["m1"] });
    const it2 = item("it2", "produtoB", "B", 1, 1, { e1: ["m1", "m2"] });
    expect(calcularFuncionariosTotalSemana([it1, it2])).toBe(2); // m1, m2
  });
});

describe("textoDiasPeriodos", () => {
  it("sem demanda", () => expect(textoDiasPeriodos(0, 0)).toBe("sem demanda calculada"));
  it("dias completos exatos", () => expect(textoDiasPeriodos(3, 3)).toBe("totalizando 1 dia completo"));
  it("períodos parciais", () => expect(textoDiasPeriodos(1, 0)).toBe("totalizando 1 período de manhã"));
});

describe("calcularItensSemanaAgregados", () => {
  it("soma quantidades do mesmo produto em itens diferentes", () => {
    const it1 = item("it1", "produtoA", "Produto A", 100, 10, {});
    const it2 = item("it2", "produtoA", "Produto A", 100, 5, {});
    const agregados = calcularItensSemanaAgregados([it1, it2]);
    expect(agregados).toEqual([{ produtoId: "produtoA", produtoNome: "Produto A", quantidade: 15 }]);
  });
});

describe("calcularCapacidadeInicialPorMaquina", () => {
  it("exclui máquinas inativas e as marcadas indisponíveis na semana", () => {
    const maquinas = [maquina("m1", "M1", "Corte"), maquina("m2", "M2", "Corte", false), maquina("m3", "M3", "Corte")];
    const resultado = calcularCapacidadeInicialPorMaquina(maquinas, ["m3"], 40);
    expect(resultado).toEqual({ m1: 40 });
  });
});

describe("calcularHistoricoSemanas", () => {
  it("filtra semanas vazias e ordena por data", () => {
    const previsoes: Previsao[] = [
      { semanaInicio: "2026-09-08", itens: [{ id: "i1", produtoId: "p", produtoNome: "P", valorUnitario: 10, quantidade: 5, maquinasPorEtapa: {} }], itensRealizados: [] },
      { semanaInicio: "2026-09-01", itens: [], itensRealizados: [] }, // vazia -> filtrada
      { semanaInicio: "2026-09-15", itens: [{ id: "i2", produtoId: "p", produtoNome: "P", valorUnitario: 10, quantidade: 4, maquinasPorEtapa: {} }], itensRealizados: [{ id: "r1", produtoId: "p", produtoNome: "P", valorUnitario: 10, quantidade: 2, maquinasPorEtapa: {} }] },
    ];
    const historico = calcularHistoricoSemanas(previsoes);
    expect(historico).toHaveLength(2);
    expect(historico[0].semanaInicio).toBe("2026-09-08");
    expect(historico[1].semanaInicio).toBe("2026-09-15");
    expect(historico[1].previsto).toBe(40);
    expect(historico[1].realizado).toBe(20);
    expect(historico[1].pct).toBe(50);
  });
});

describe("calcularObservacoesSetup", () => {
  it("ordena os produtos que disputam uma máquina por lucro/hora (usa getLucroHora passado)", () => {
    const itA = item("itA", "produtoA", "Produto A", 100, 30, { "produtoA-e1": ["maq1"] });
    const itB = item("itB", "produtoB", "Produto B", 80, 40, { "produtoB-e1": ["maq1"] });
    const analise = calcularAnaliseCapacidadeSemanal([itA, itB], [produtoA, produtoB], [maq1], PERIODOS, HORAS_MAQUINA_SEMANA);
    const lucroHoraPorProduto: Record<string, number> = { produtoA: 5, produtoB: 50 };
    const observacoes = calcularObservacoesSetup(analise, [produtoA, produtoB], (p) => lucroHoraPorProduto[p.id]);
    expect(observacoes).toHaveLength(1);
    expect(observacoes[0].ordenados.map((o) => o.nome)).toEqual(["Produto B", "Produto A"]);
  });

  it("máquina com só 1 produto consumidor não entra na lista (precisa de disputa)", () => {
    const itA = item("itA", "produtoA", "Produto A", 100, 30, { "produtoA-e1": ["maq1"] });
    const analise = calcularAnaliseCapacidadeSemanal([itA], [produtoA], [maq1], PERIODOS, HORAS_MAQUINA_SEMANA);
    const observacoes = calcularObservacoesSetup(analise, [produtoA], () => 10);
    expect(observacoes).toEqual([]);
  });
});
