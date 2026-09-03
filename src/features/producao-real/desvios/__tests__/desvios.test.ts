import { describe, expect, it } from "vitest";
import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import type { ParadaComContexto } from "@/features/producao-real/paradas/calculations";
import type { DesvioDetectado, IncidenteDesvio, Janela } from "@/features/producao-real/desvios/types";
import { avaliarAmostra } from "@/features/producao-real/desvios/amostra";
import { calcularJanelaOperacional } from "@/features/producao-real/desvios/janelas";
import {
  detectarDesviosProdutividade, detectarDesviosParadas, detectarDesviosQualidade,
  detectarDesviosEconomia, detectarDesviosSemProducao, detectarDesviosFluxo,
} from "@/features/producao-real/desvios/deteccao";
import { deduplicarDesvios } from "@/features/producao-real/desvios/deduplicacao";
import { priorizarIncidentes } from "@/features/producao-real/desvios/prioridade";

// ---------------------------------------------------------------------
// Factories — mesmo padrão já usado em Indicadores V1/Paradas V1.
// ---------------------------------------------------------------------

function apontamento(over: Partial<ApontamentoIndicador> = {}): ApontamentoIndicador {
  return {
    apontamentoId: "ap-" + Math.random().toString(36).slice(2),
    data: "2026-09-01", periodoId: "m1", periodoNome: "M1", status: "produzindo", motivoSemProducao: null,
    produtoId: "prod-1", produtoNome: "Produto 1", maquinaId: "maq-1", maquinaNome: "Máquina 1",
    operacaoId: "op-1", operacaoNome: "Operação 1", funcionarioId: "func-1", funcionarioNome: "Funcionário 1",
    etapaId: "etapa-1", etapaOrdem: 0, isUltimaEtapa: true,
    quantidadeProduzida: 100, quantidadeRefugo: 2, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1.5,
    minutosParados: 0, custoHoraOperacaoVigente: 30, custoOperacionalPeriodoVigente: 45,
    custoUnitarioReferenciaPeriodoVigente: 0.45, produtoValorUnitario: 2, etapaMaquinasElegiveis: 1,
    ...over,
  };
}

function parada(over: Partial<ParadaComContexto> = {}): ParadaComContexto {
  return {
    paradaId: "pd-" + Math.random().toString(36).slice(2), apontamentoId: "ap-x", data: "2026-09-01", periodoId: "m1",
    minutos: 5, motivoId: "motivo-1", motivoNome: "Ferramenta", motivoCategoria: "operacional", origem: "manual",
    produtoId: "prod-1", produtoNome: "Produto 1", maquinaId: "maq-1", maquinaNome: "Máquina 1",
    operacaoId: "op-1", operacaoNome: "Operação 1", funcionarioId: "func-1", funcionarioNome: "Funcionário 1",
    custoHoraOperacaoVigente: 30, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1.5,
    ...over,
  };
}

const JANELA_ATUAL: Janela = { dataInicial: "2026-09-08", dataFinal: "2026-09-11" };
const JANELA_REF: Janela = { dataInicial: "2026-09-01", dataFinal: "2026-09-04" };
const JANELAS = { atual: JANELA_ATUAL, referencia: JANELA_REF };

function tresPeriodos(base: Partial<ApontamentoIndicador>, janela: Janela): ApontamentoIndicador[] {
  return [0, 1, 2].map((i) =>
    apontamento({ ...base, data: janela.dataInicial, periodoId: `p${i}`, duracaoPeriodoHorasVigente: 1 })
  );
}

// =======================================================================
// 1/2/3 — amostra mínima
// =======================================================================
describe("amostra mínima", () => {
  it("caso 1: Performance piora com amostra suficiente gera desvio", () => {
    const atual = tresPeriodos({ quantidadeProduzida: 60, metaPeriodoVigente: 100, minutosParados: 0 }, JANELA_ATUAL);
    const referencia = tresPeriodos({ quantidadeProduzida: 95, metaPeriodoVigente: 100, minutosParados: 0 }, JANELA_REF);
    const desvios = detectarDesviosProdutividade(atual, referencia, [], [], JANELAS, "operacional");
    expect(desvios.some((d) => d.tipo === "performance_deteriorou")).toBe(true);
  });

  it("caso 2: Performance ruim com 1 período não gera alerta", () => {
    const atual = [apontamento({ data: JANELA_ATUAL.dataInicial, quantidadeProduzida: 10, metaPeriodoVigente: 100 })];
    const referencia = tresPeriodos({ quantidadeProduzida: 95, metaPeriodoVigente: 100 }, JANELA_REF);
    const desvios = detectarDesviosProdutividade(atual, referencia, [], [], JANELAS, "operacional");
    expect(desvios).toHaveLength(0);
  });

  it("caso 3: referência insuficiente não gera alerta (marcada internamente)", () => {
    const atualApontamentos = tresPeriodos({ quantidadeProduzida: 60, metaPeriodoVigente: 100 }, JANELA_ATUAL);
    const referenciaApontamentos = [apontamento({ data: JANELA_REF.dataInicial, quantidadeProduzida: 95, metaPeriodoVigente: 100 })];

    const avaliacao = avaliarAmostra(atualApontamentos, referenciaApontamentos, false);
    expect(avaliacao.suficiente).toBe(false);
    expect(avaliacao.motivoInsuficiencia).not.toBeNull();

    const desvios = detectarDesviosProdutividade(atualApontamentos, referenciaApontamentos, [], [], JANELAS, "operacional");
    expect(desvios).toHaveLength(0);
  });
});

// =======================================================================
// 4 — week-to-date
// =======================================================================
describe("janela operacional (week-to-date)", () => {
  it("caso 4: compara mesmo trecho da semana anterior (segunda->quinta vs segunda->quinta)", () => {
    // 2026-09-03 é uma quinta-feira.
    const hoje = new Date(2026, 8, 3);
    const janelas = calcularJanelaOperacional(hoje);
    expect(janelas.atual).toEqual({ dataInicial: "2026-08-31", dataFinal: "2026-09-03" }); // segunda a quinta
    expect(janelas.referencia).toEqual({ dataInicial: "2026-08-24", dataFinal: "2026-08-27" }); // segunda a quinta anterior
  });
});

// =======================================================================
// 5 — Performance > 100%
// =======================================================================
describe("Performance acima de 100%", () => {
  it("caso 5a: melhora de 90% pra 110% não gera desvio", () => {
    const atual = tresPeriodos({ quantidadeProduzida: 110, metaPeriodoVigente: 100 }, JANELA_ATUAL);
    const referencia = tresPeriodos({ quantidadeProduzida: 90, metaPeriodoVigente: 100 }, JANELA_REF);
    const desvios = detectarDesviosProdutividade(atual, referencia, [], [], JANELAS, "operacional");
    expect(desvios.some((d) => d.tipo === "performance_deteriorou")).toBe(false);
  });

  it("caso 5b: queda de 130% pra 108% continua válida (sem teto) e gera desvio", () => {
    const atual = tresPeriodos({ quantidadeProduzida: 108, metaPeriodoVigente: 100 }, JANELA_ATUAL);
    const referencia = tresPeriodos({ quantidadeProduzida: 130, metaPeriodoVigente: 100 }, JANELA_REF);
    const desvios = detectarDesviosProdutividade(atual, referencia, [], [], JANELAS, "operacional");
    const d = desvios.find((x) => x.tipo === "performance_deteriorou");
    expect(d).toBeDefined();
    expect(d!.valorAtual).toBeCloseTo(108, 0);
    expect(d!.valorReferencia).toBeCloseTo(130, 0);
  });
});

// =======================================================================
// 6/7/8 — Paradas
// =======================================================================
describe("Paradas", () => {
  it("caso 6: aumento de minutos parados gera desvio", () => {
    const apAtual = tresPeriodos({}, JANELA_ATUAL);
    const apRef = tresPeriodos({}, JANELA_REF);
    const pAtual = apAtual.map((a) => parada({ apontamentoId: a.apontamentoId, data: a.data, periodoId: a.periodoId, minutos: 20 }));
    const pRef = apRef.map((a) => parada({ apontamentoId: a.apontamentoId, data: a.data, periodoId: a.periodoId, minutos: 3 }));
    const desvios = detectarDesviosParadas(apAtual, apRef, pAtual, pRef, JANELAS, "operacional");
    expect(desvios.some((d) => d.tipo === "paradas_minutos_aumentaram")).toBe(true);
  });

  it("caso 7: motivo recorrente é sinalizado quando aparece em >=40% dos períodos", () => {
    // 6 períodos apontados, motivo "Ferramenta" em 3 deles (50%).
    const apAtual = [0, 1, 2, 3, 4, 5].map((i) => apontamento({ data: JANELA_ATUAL.dataInicial, periodoId: `p${i}`, apontamentoId: `ap-${i}` }));
    const pAtual = [0, 1, 2].map((i) => parada({ apontamentoId: `ap-${i}`, data: JANELA_ATUAL.dataInicial, periodoId: `p${i}`, motivoId: "motivo-ferramenta", motivoNome: "Ferramenta", minutos: 10 }));
    const apRef = tresPeriodos({}, JANELA_REF);
    const desvios = detectarDesviosParadas(apAtual, apRef, pAtual, [], JANELAS, "operacional");
    const recorrente = desvios.find((d) => d.tipo === "paradas_motivo_recorrente");
    expect(recorrente).toBeDefined();
    expect(recorrente!.persistente).toBe(true);
  });

  it("caso 8: várias paradas no MESMO período não inflam a recorrência (conta 1 período, não N paradas)", () => {
    const apAtual = [0, 1, 2, 3, 4, 5].map((i) => apontamento({ data: JANELA_ATUAL.dataInicial, periodoId: `p${i}`, apontamentoId: `ap-${i}` }));
    // 3 paradas do mesmo motivo, todas no MESMO período p0 — só isso não deveria bastar pra recorrência (1 de 6 períodos = 16.7%, abaixo de 40%).
    const pAtual = [1, 2, 3].map((n) => parada({ apontamentoId: "ap-0", data: JANELA_ATUAL.dataInicial, periodoId: "p0", motivoId: "motivo-ferramenta", motivoNome: "Ferramenta", minutos: n }));
    const apRef = tresPeriodos({}, JANELA_REF);
    const desvios = detectarDesviosParadas(apAtual, apRef, pAtual, [], JANELAS, "operacional");
    expect(desvios.some((d) => d.tipo === "paradas_motivo_recorrente")).toBe(false);
  });
});

// =======================================================================
// 9 — Refugo
// =======================================================================
describe("Qualidade", () => {
  it("caso 9: aumento de refugo (com volume suficiente) gera desvio", () => {
    const atual = tresPeriodos({ quantidadeProduzida: 100, quantidadeRefugo: 20, metaPeriodoVigente: 100 }, JANELA_ATUAL);
    const referencia = tresPeriodos({ quantidadeProduzida: 100, quantidadeRefugo: 2, metaPeriodoVigente: 100 }, JANELA_REF);
    const desvios = detectarDesviosQualidade(atual, referencia, [], [], JANELAS, "operacional");
    expect(desvios.some((d) => d.tipo === "refugo_aumentou")).toBe(true);
  });

  it("volume insuficiente (< 1 meta-período) não gera desvio de refugo", () => {
    const atual = tresPeriodos({ quantidadeProduzida: 5, quantidadeRefugo: 3, metaPeriodoVigente: 100 }, JANELA_ATUAL);
    const referencia = tresPeriodos({ quantidadeProduzida: 5, quantidadeRefugo: 0, metaPeriodoVigente: 100 }, JANELA_REF);
    const desvios = detectarDesviosQualidade(atual, referencia, [], [], JANELAS, "operacional");
    expect(desvios).toHaveLength(0);
  });
});

// =======================================================================
// 10/11 — Economia
// =======================================================================
describe("Economia", () => {
  it("caso 10: aumento de custo observado/peça gera desvio", () => {
    const atual = tresPeriodos({ quantidadeProduzida: 50, custoOperacionalPeriodoVigente: 100 }, JANELA_ATUAL); // 2/peça
    const referencia = tresPeriodos({ quantidadeProduzida: 100, custoOperacionalPeriodoVigente: 100 }, JANELA_REF); // 1/peça
    const desvios = detectarDesviosEconomia(atual, referencia, [], [], JANELAS, "operacional");
    expect(desvios.some((d) => d.tipo === "custo_peca_aumentou")).toBe(true);
  });

  it("caso 11: margem de processamento deteriorando gera desvio", () => {
    const atual = tresPeriodos({ quantidadeProduzida: 100, quantidadeRefugo: 0, custoOperacionalPeriodoVigente: 180, produtoValorUnitario: 2, isUltimaEtapa: true }, JANELA_ATUAL);
    const referencia = tresPeriodos({ quantidadeProduzida: 100, quantidadeRefugo: 0, custoOperacionalPeriodoVigente: 60, produtoValorUnitario: 2, isUltimaEtapa: true }, JANELA_REF);
    const desvios = detectarDesviosEconomia(atual, referencia, [], [], JANELAS, "operacional");
    expect(desvios.some((d) => d.tipo === "margem_deteriorou")).toBe(true);
  });
});

// =======================================================================
// 12 — Sem produção
// =======================================================================
describe("Sem produção", () => {
  it("caso 12: falta_material recorrente é sinalizado (denominador = períodos apontados da máquina)", () => {
    // 5 períodos apontados na máquina, 3 sem_producao por falta_material (60%).
    const produzindo = [0, 1].map((i) => apontamento({ data: JANELA_ATUAL.dataInicial, periodoId: `p${i}`, maquinaId: "maq-x", maquinaNome: "Máquina X" }));
    const semProducao = [2, 3, 4].map((i) =>
      apontamento({
        data: JANELA_ATUAL.dataInicial, periodoId: `p${i}`, maquinaId: "maq-x", maquinaNome: "Máquina X",
        status: "sem_producao", motivoSemProducao: "falta_material", produtoId: null, operacaoId: null, etapaId: null,
        metaPeriodoVigente: null, custoHoraOperacaoVigente: null, custoOperacionalPeriodoVigente: null,
        custoUnitarioReferenciaPeriodoVigente: null, produtoValorUnitario: null, quantidadeProduzida: 0, quantidadeRefugo: 0,
      })
    );
    const desvios = detectarDesviosSemProducao([...produzindo, ...semProducao], JANELAS, "operacional");
    expect(desvios.some((d) => d.tipo === "sem_producao_recorrente" && d.titulo.includes("Falta de material"))).toBe(true);
  });

  it("nunca inventa minutos/custo/capacidade perdida pra sem_produção", () => {
    const produzindo = [0, 1].map((i) => apontamento({ data: JANELA_ATUAL.dataInicial, periodoId: `p${i}` }));
    const semProducao = [2, 3, 4].map((i) =>
      apontamento({ data: JANELA_ATUAL.dataInicial, periodoId: `p${i}`, status: "sem_producao", motivoSemProducao: "falta_operador", metaPeriodoVigente: null, custoHoraOperacaoVigente: null })
    );
    const desvios = detectarDesviosSemProducao([...produzindo, ...semProducao], JANELAS, "operacional");
    desvios.forEach((d) => expect(d.impactos).toHaveLength(0));
  });
});

// =======================================================================
// 13 — Fluxo (possível restrição operacional)
// =======================================================================
describe("Fluxo", () => {
  it("caso 13: possível restrição aparece sempre como ESTIMATIVA, nunca CRÍTICO", () => {
    // Etapa 2 com performance baixa (sinal 1) + menor produção (sinal 2) -> 2 sinais, deve sinalizar.
    const etapa1 = [0, 1].map((i) => apontamento({ apontamentoId: `e1-${i}`, data: JANELA_ATUAL.dataInicial, etapaId: "etapa-1", etapaOrdem: 0, operacaoId: "op-1", operacaoNome: "Rosquear", maquinaId: "maq-1", quantidadeProduzida: 100, metaPeriodoVigente: 100, minutosParados: 0 }));
    const etapa2 = [0, 1].map((i) => apontamento({ apontamentoId: `e2-${i}`, data: JANELA_ATUAL.dataInicial, etapaId: "etapa-2", etapaOrdem: 1, operacaoId: "op-2", operacaoNome: "Parafusar", maquinaId: "maq-2", quantidadeProduzida: 20, metaPeriodoVigente: 100, minutosParados: 60, duracaoPeriodoHorasVigente: 1 }));
    const todos = [...etapa1, ...etapa2];
    const desvios = detectarDesviosFluxo(todos, JANELAS, "operacional");
    const d = desvios.find((x) => x.tipo === "possivel_restricao_operacional");
    expect(d).toBeDefined();
    expect(d!.confianca).toBe("estimativa");
    expect(d!.severidade).not.toBe("critico");
  });
});

// =======================================================================
// 14 — Funcionário só como evidência
// =======================================================================
describe("Funcionário", () => {
  it("caso 14: mudança de funcionário aparece só como evidência/possível fator, nunca como desvio próprio", () => {
    const atual = tresPeriodos({ funcionarioId: "func-B", quantidadeProduzida: 60, metaPeriodoVigente: 100 }, JANELA_ATUAL);
    const referencia = tresPeriodos({ funcionarioId: "func-A", quantidadeProduzida: 95, metaPeriodoVigente: 100 }, JANELA_REF);
    const desvios = detectarDesviosProdutividade(atual, referencia, [], [], JANELAS, "operacional");
    const d = desvios.find((x) => x.tipo === "performance_deteriorou");
    expect(d).toBeDefined();
    // domínio nunca é "funcionário" — não existe esse domínio no motor.
    expect(d!.dominio).not.toBe("funcionario" as never);
    const evidenciaFuncionario = d!.evidencias.find((e) => e.fonte.includes("funcionário"));
    expect(evidenciaFuncionario).toBeDefined();
    expect(evidenciaFuncionario!.descricao).not.toMatch(/causad|culpa/i);
  });
});

// =======================================================================
// 15/16 — Deduplicação
// =======================================================================
function desvioMock(over: Partial<DesvioDetectado>): DesvioDetectado {
  return {
    id: "id-" + Math.random(), dominio: "paradas", tipo: "paradas_minutos_aumentaram", titulo: "t",
    contexto: { produtoId: "prod-1", produtoNome: "P1", operacaoId: "op-1", operacaoNome: "O1", maquinaId: "maq-1", maquinaNome: "M1" },
    janelaAtual: JANELA_ATUAL, janelaReferencia: JANELA_REF, metrica: "m", unidade: "min",
    valorAtual: 10, valorReferencia: 5, deltaAbsoluto: 5, deltaPercentual: 100,
    magnitude: "forte", severidade: "atencao", justificativaSeveridade: "j", persistente: true, percentualPeriodosAfetados: 50,
    evidencias: [], impactos: [], possiveisFatores: [], confianca: "calculado",
    amostra: { suficiente: true, periodosJanelaAtual: 3, periodosJanelaReferencia: 3, minutosProdutivosJanelaAtual: 100, minutosProdutivosJanelaReferencia: 100, volumeProduzidoJanelaAtual: null, metaPeriodoMediaContexto: null, motivoInsuficiencia: null },
    filtrosDrillDown: { dataInicial: JANELA_ATUAL.dataInicial, dataFinal: JANELA_ATUAL.dataFinal }, linkSugerido: "paradas",
    origemJanela: "operacional",
    ...over,
  };
}

describe("Deduplicação", () => {
  it("caso 15: dois efeitos do mesmo incidente (fator dominante compartilhado) são deduplicados em 1 card", () => {
    const evidenciaFerramenta = { fonte: "Pareto de paradas", descricao: "d", contexto: "c", periodo: "p", valor: "v" };
    const d1 = desvioMock({ tipo: "paradas_minutos_aumentaram", possiveisFatores: [{ fator: "Ferramenta", descricao: "x", evidencia: evidenciaFerramenta }] });
    const d2 = desvioMock({ tipo: "performance_deteriorou", dominio: "produtividade", possiveisFatores: [{ fator: "Ferramenta", descricao: "x", evidencia: evidenciaFerramenta }] });
    const incidentes = deduplicarDesvios([d1, d2]);
    expect(incidentes).toHaveLength(1);
    expect(incidentes[0].chaveFatorDominante).toBe("Ferramenta");
    expect(incidentes[0].efeitos).toHaveLength(1);
  });

  it("caso 16: ausência de fator dominante confiável NÃO inventa causa — vira 2 incidentes", () => {
    const d1 = desvioMock({ tipo: "paradas_minutos_aumentaram", possiveisFatores: [{ fator: "Ferramenta", descricao: "x", evidencia: { fonte: "f", descricao: "d", contexto: "c", periodo: "p", valor: "v" } }] });
    const d2 = desvioMock({ tipo: "performance_deteriorou", dominio: "produtividade", possiveisFatores: [{ fator: "Regulagem", descricao: "x", evidencia: { fonte: "f", descricao: "d", contexto: "c", periodo: "p", valor: "v" } }] });
    const incidentes = deduplicarDesvios([d1, d2]);
    expect(incidentes).toHaveLength(2);
    incidentes.forEach((inc) => expect(inc.chaveFatorDominante).toBeNull());
  });
});

// =======================================================================
// 17 — Prioridade
// =======================================================================
function incidenteMock(over: Partial<IncidenteDesvio>): IncidenteDesvio {
  const principal = desvioMock({});
  return {
    id: "inc-" + Math.random(), contexto: principal.contexto, janelaAtual: JANELA_ATUAL, janelaReferencia: JANELA_REF,
    chaveFatorDominante: null, desvioPrincipal: principal, efeitos: [], severidade: "atencao", possiveisFatores: [],
    ...over,
  };
}

describe("Prioridade", () => {
  it("caso 17: ordena por severidade > recência > impacto > persistência, sem soma ponderada", () => {
    const critico = incidenteMock({ id: "critico", severidade: "critico" });
    const atencaoRecente = incidenteMock({ id: "atencao-op", severidade: "atencao", desvioPrincipal: desvioMock({ origemJanela: "operacional" }) });
    const atencaoAntiga = incidenteMock({ id: "atencao-estrutural", severidade: "atencao", desvioPrincipal: desvioMock({ origemJanela: "estrutural" }) });
    const informativo = incidenteMock({ id: "informativo", severidade: "informativo" });

    const ordenado = priorizarIncidentes([informativo, atencaoAntiga, critico, atencaoRecente]);
    expect(ordenado.map((i) => i.id)).toEqual(["critico", "atencao-op", "atencao-estrutural", "informativo"]);
  });

  it("dentro da mesma severidade/recência, maior impacto (R$) vem primeiro", () => {
    const altoImpacto = incidenteMock({ id: "alto", desvioPrincipal: desvioMock({ impactos: [{ metrica: "Custo do tempo ocioso", valor: 500, unidade: "R$" }] }) });
    const baixoImpacto = incidenteMock({ id: "baixo", desvioPrincipal: desvioMock({ impactos: [{ metrica: "Custo do tempo ocioso", valor: 10, unidade: "R$" }] }) });
    const ordenado = priorizarIncidentes([baixoImpacto, altoImpacto]);
    expect(ordenado.map((i) => i.id)).toEqual(["alto", "baixo"]);
  });
});

// =======================================================================
// 18 — Drill-down preserva contexto/filtros
// =======================================================================
describe("Drill-down", () => {
  it("caso 18: filtrosDrillDown preserva produto/máquina/operação/janela do desvio", () => {
    const atual = tresPeriodos({ maquinaId: "maq-9", produtoId: "prod-9", operacaoId: "op-9", quantidadeProduzida: 60, metaPeriodoVigente: 100 }, JANELA_ATUAL);
    const referencia = tresPeriodos({ maquinaId: "maq-9", produtoId: "prod-9", operacaoId: "op-9", quantidadeProduzida: 95, metaPeriodoVigente: 100 }, JANELA_REF);
    const d = detectarDesviosProdutividade(atual, referencia, [], [], JANELAS, "operacional").find((x) => x.tipo === "performance_deteriorou")!;
    expect(d.filtrosDrillDown).toMatchObject({
      dataInicial: JANELA_ATUAL.dataInicial, dataFinal: JANELA_ATUAL.dataFinal,
      produtoId: "prod-9", maquinaId: "maq-9", operacaoId: "op-9",
    });
  });
});

// =======================================================================
// 19/20 — Nunca faturamento perdido / throughput recuperável
// =======================================================================
describe("Fora de escopo (nunca implementado)", () => {
  it("caso 19/20: nenhuma métrica gerada menciona faturamento perdido ou throughput recuperável", () => {
    const apAtual = tresPeriodos({ quantidadeProduzida: 50, quantidadeRefugo: 10, custoOperacionalPeriodoVigente: 150, metaPeriodoVigente: 100 }, JANELA_ATUAL);
    const apRef = tresPeriodos({ quantidadeProduzida: 95, quantidadeRefugo: 1, custoOperacionalPeriodoVigente: 60, metaPeriodoVigente: 100 }, JANELA_REF);
    const pAtual = apAtual.map((a) => parada({ apontamentoId: a.apontamentoId, data: a.data, periodoId: a.periodoId, minutos: 30 }));

    const todos = [
      ...detectarDesviosProdutividade(apAtual, apRef, pAtual, [], JANELAS, "operacional"),
      ...detectarDesviosParadas(apAtual, apRef, pAtual, [], JANELAS, "operacional"),
      ...detectarDesviosQualidade(apAtual, apRef, pAtual, [], JANELAS, "operacional"),
      ...detectarDesviosEconomia(apAtual, apRef, pAtual, [], JANELAS, "operacional"),
    ];
    todos.forEach((d) => {
      expect(d.metrica.toLowerCase()).not.toMatch(/faturamento|throughput/);
      d.impactos.forEach((i) => expect(i.metrica.toLowerCase()).not.toMatch(/faturamento|throughput/));
    });
  });
});
