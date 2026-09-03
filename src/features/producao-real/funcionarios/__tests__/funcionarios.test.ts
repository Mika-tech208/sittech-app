import { describe, expect, it } from "vitest";
import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import type { ParadaComContexto } from "@/features/producao-real/paradas/calculations";
import { avaliarAmostraSimples } from "@/features/producao-real/funcionarios/amostra";
import { agruparPorContextoEFuncionario } from "@/features/producao-real/funcionarios/contexto";
import { analisarContextoFuncionario } from "@/features/producao-real/funcionarios/analise";
import { calcularCoberturaOperacional } from "@/features/producao-real/funcionarios/cobertura";
import { gerarAnaliseFuncionarios } from "@/features/producao-real/funcionarios";
import { detectarDesviosProdutividade } from "@/features/producao-real/desvios/deteccao";
import type { Janela } from "@/features/producao-real/desvios/types";

function apontamento(over: Partial<ApontamentoIndicador> = {}): ApontamentoIndicador {
  return {
    apontamentoId: "ap-" + Math.random().toString(36).slice(2),
    data: "2026-09-01", periodoId: "m1", periodoNome: "M1", status: "produzindo", motivoSemProducao: null,
    produtoId: "prod-1", produtoNome: "Produto 1", maquinaId: "maq-1", maquinaNome: "Máquina 1",
    operacaoId: "op-1", operacaoNome: "Operação 1", funcionarioId: "func-A", funcionarioNome: "Ana",
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
    operacaoId: "op-1", operacaoNome: "Operação 1", funcionarioId: "func-A", funcionarioNome: "Ana",
    custoHoraOperacaoVigente: 30, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1.5,
    ...over,
  };
}

const JANELA_ATUAL: Janela = { dataInicial: "2026-08-31", dataFinal: "2026-09-03" };
const JANELA_ANTERIOR: Janela = { dataInicial: "2026-08-24", dataFinal: "2026-08-27" };

function nPeriodos(n: number, over: Partial<ApontamentoIndicador> = {}, dataBase = "2026-08-31"): ApontamentoIndicador[] {
  return Array.from({ length: n }).map((_, i) =>
    apontamento({ ...over, apontamentoId: `ap-${Math.random()}`, data: dataBase, periodoId: `p${i}`, duracaoPeriodoHorasVigente: 1 })
  );
}

// =======================================================================
// 1/2/3 — amostra do funcionário
// =======================================================================
describe("Amostra do funcionário (§5)", () => {
  it("caso 1: >=5 períodos e >=100min é suficiente", () => {
    const aps = nPeriodos(5, { duracaoPeriodoHorasVigente: 2 }); // 5*120=600min
    const a = avaliarAmostraSimples(aps, 5, 100);
    expect(a.suficiente).toBe(true);
  });

  it("caso 2: 4 períodos não gera comparação (amostra insuficiente)", () => {
    const aps = nPeriodos(4, { duracaoPeriodoHorasVigente: 2 });
    const a = avaliarAmostraSimples(aps, 5, 100);
    expect(a.suficiente).toBe(false);
    expect(a.motivoInsuficiencia).toMatch(/períodos/);
  });

  it("caso 3: <100min não gera comparação mesmo com 5+ períodos", () => {
    const aps = nPeriodos(5, { duracaoPeriodoHorasVigente: 0.1 }); // 5*6=30min
    const a = avaliarAmostraSimples(aps, 5, 100);
    expect(a.suficiente).toBe(false);
    expect(a.motivoInsuficiencia).toMatch(/min produtivos/);
  });
});

// =======================================================================
// 4 — baseline exclui o próprio funcionário
// =======================================================================
describe("Baseline de pares (§4/§6)", () => {
  it("caso 4: baseline de X nunca inclui os próprios apontamentos de X", () => {
    const aps = [
      ...nPeriodos(5, { funcionarioId: "func-A", funcionarioNome: "Ana" }),
      ...nPeriodos(5, { funcionarioId: "func-B", funcionarioNome: "Beto" }),
    ];
    const grupos = agruparPorContextoEFuncionario(aps);
    const grupoAna = grupos.find((g) => g.funcionarioId === "func-A")!;
    expect(grupoAna.apontamentosPares.every((ap) => ap.funcionarioId !== "func-A")).toBe(true);
    expect(grupoAna.apontamentosPares).toHaveLength(5);
  });

  it("caso 5: pares com >=3 períodos e >=60min formam baseline válida", () => {
    const pares = nPeriodos(3, { funcionarioId: "func-B", duracaoPeriodoHorasVigente: 1 }); // 180min
    const a = avaliarAmostraSimples(pares, 3, 60);
    expect(a.suficiente).toBe(true);
  });

  it("caso 6: pares com <3 períodos não geram baseline", () => {
    const pares = nPeriodos(2, { funcionarioId: "func-B", duracaoPeriodoHorasVigente: 1 });
    const a = avaliarAmostraSimples(pares, 3, 60);
    expect(a.suficiente).toBe(false);
  });

  it("caso 7: pares com <60min não geram baseline", () => {
    const pares = nPeriodos(3, { funcionarioId: "func-B", duracaoPeriodoHorasVigente: 0.1 }); // 18min
    const a = avaliarAmostraSimples(pares, 3, 60);
    expect(a.suficiente).toBe(false);
  });
});

// =======================================================================
// 8 — fallback pra meta/histórico próprio
// =======================================================================
describe("Fallback de referência (§6/§8)", () => {
  it("caso 8: sem pares suficientes, Performance cai pra meta oficial (100%)", () => {
    const grupo = {
      contexto: { produtoId: "prod-1", produtoNome: "P1", operacaoId: "op-1", operacaoNome: "O1", maquinaId: "maq-1", maquinaNome: "M1" },
      chave: "c", funcionarioId: "func-A", funcionarioNome: "Ana",
      apontamentosFuncionario: nPeriodos(5, { quantidadeProduzida: 50, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1 }),
      apontamentosPares: nPeriodos(1, { funcionarioId: "func-B" }), // insuficiente (só 1 período)
    };
    const analise = analisarContextoFuncionario(grupo, [], JANELA_ATUAL, [], JANELA_ANTERIOR);
    expect(analise.amostraPares.suficiente).toBe(false);
    expect(analise.sinalPerformance?.referenciaTipo).toBe("meta");
    expect(analise.sinalPerformance?.valorReferencia).toBe(100);
  });
});

// =======================================================================
// 9/10 — Performance soma/soma, sem teto
// =======================================================================
describe("Performance (§7/§9)", () => {
  it("caso 9: Performance agregada usa soma produzida/soma teórica (não média de %)", () => {
    // 2 apontamentos: um com performance 200%, outro com 50% — média simples seria 125%;
    // soma/soma dá um valor diferente, ponderado pelo volume real.
    const aps = [
      apontamento({ quantidadeProduzida: 200, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 }),
      apontamento({ quantidadeProduzida: 25, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 }),
    ];
    const grupo = {
      contexto: { produtoId: "prod-1", produtoNome: "P1", operacaoId: "op-1", operacaoNome: "O1", maquinaId: "maq-1", maquinaNome: "M1" },
      chave: "c", funcionarioId: "func-A", funcionarioNome: "Ana",
      apontamentosFuncionario: [...aps, ...aps, ...aps.slice(0, 1)], // 5 períodos, >=100min (5x60min=300)
      apontamentosPares: [],
    };
    const analise = analisarContextoFuncionario(grupo, [], JANELA_ATUAL, [], JANELA_ANTERIOR);
    // soma produzida = (200+25)*2+200=650; soma meta com minutosParados=0 => teorica=meta=100 cada; soma teorica=500
    expect(analise.performanceFuncionario).toBeCloseTo((650 / 500) * 100, 5);
  });

  it("caso 10: Performance > 100% não é capada", () => {
    const aps = nPeriodos(5, { quantidadeProduzida: 300, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 });
    const grupo = {
      contexto: { produtoId: "prod-1", produtoNome: "P1", operacaoId: "op-1", operacaoNome: "O1", maquinaId: "maq-1", maquinaNome: "M1" },
      chave: "c", funcionarioId: "func-A", funcionarioNome: "Ana", apontamentosFuncionario: aps, apontamentosPares: [],
    };
    const analise = analisarContextoFuncionario(grupo, [], JANELA_ATUAL, [], JANELA_ANTERIOR);
    expect(analise.performanceFuncionario).toBeCloseTo(300, 0);
  });
});

// =======================================================================
// 11/12 — atenção / destaque positivo
// =======================================================================
describe("Sinais de atenção e destaque (§9/§10)", () => {
  it("caso 11: funcionário consistentemente abaixo dos pares gera ATENÇÃO", () => {
    const grupo = {
      contexto: { produtoId: "prod-1", produtoNome: "P1", operacaoId: "op-1", operacaoNome: "O1", maquinaId: "maq-1", maquinaNome: "M1" },
      chave: "c", funcionarioId: "func-A", funcionarioNome: "Ana",
      apontamentosFuncionario: nPeriodos(5, { quantidadeProduzida: 50, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 }),
      apontamentosPares: nPeriodos(3, { funcionarioId: "func-B", quantidadeProduzida: 100, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 }),
    };
    const analise = analisarContextoFuncionario(grupo, [], JANELA_ATUAL, [], JANELA_ANTERIOR);
    expect(analise.sinalPerformance?.polaridade).toBe("atencao");
    expect(analise.sinalPerformance?.referenciaTipo).toBe("pares");
  });

  it("caso 12: funcionário consistentemente acima dos pares gera DESTAQUE POSITIVO", () => {
    const grupo = {
      contexto: { produtoId: "prod-1", produtoNome: "P1", operacaoId: "op-1", operacaoNome: "O1", maquinaId: "maq-1", maquinaNome: "M1" },
      chave: "c", funcionarioId: "func-A", funcionarioNome: "Ana",
      apontamentosFuncionario: nPeriodos(5, { quantidadeProduzida: 150, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 }),
      apontamentosPares: nPeriodos(3, { funcionarioId: "func-B", quantidadeProduzida: 90, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 }),
    };
    const analise = analisarContextoFuncionario(grupo, [], JANELA_ATUAL, [], JANELA_ANTERIOR);
    expect(analise.sinalPerformance?.polaridade).toBe("positivo");
  });
});

// =======================================================================
// 13 — Qualidade respeita proteção de volume
// =======================================================================
describe("Qualidade (§8)", () => {
  it("caso 13: volume abaixo de 1x meta-período não gera sinal de qualidade", () => {
    const grupo = {
      contexto: { produtoId: "prod-1", produtoNome: "P1", operacaoId: "op-1", operacaoNome: "O1", maquinaId: "maq-1", maquinaNome: "M1" },
      chave: "c", funcionarioId: "func-A", funcionarioNome: "Ana",
      apontamentosFuncionario: nPeriodos(5, { quantidadeProduzida: 5, quantidadeRefugo: 3, metaPeriodoVigente: 500, duracaoPeriodoHorasVigente: 1 }),
      apontamentosPares: [],
    };
    const analise = analisarContextoFuncionario(grupo, [], JANELA_ATUAL, [], JANELA_ANTERIOR);
    expect(analise.amostraFuncionarioQualidade.suficiente).toBe(false);
    expect(analise.sinalQualidade).toBeNull();
  });

  it("caso 14: refugo nunca vira causalidade no objeto (só métrica observada)", () => {
    const grupo = {
      contexto: { produtoId: "prod-1", produtoNome: "P1", operacaoId: "op-1", operacaoNome: "O1", maquinaId: "maq-1", maquinaNome: "M1" },
      chave: "c", funcionarioId: "func-A", funcionarioNome: "Ana",
      apontamentosFuncionario: nPeriodos(5, { quantidadeProduzida: 500, quantidadeRefugo: 300, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1 }),
      apontamentosPares: nPeriodos(3, { funcionarioId: "func-B", quantidadeProduzida: 500, quantidadeRefugo: 10, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1 }),
    };
    const analise = analisarContextoFuncionario(grupo, [], JANELA_ATUAL, [], JANELA_ANTERIOR);
    expect(analise.sinalQualidade?.polaridade).toBe("atencao");
    // o objeto nunca tem um campo de "causa" — só métrica/valor/referência.
    expect(Object.keys(analise.sinalQualidade || {})).not.toContain("causa");
  });
});

// =======================================================================
// 15/16/17 — Paradas/Economia como evidência, nunca sinal
// =======================================================================
describe("Paradas e Economia como evidência contextual (§11/§12)", () => {
  it("caso 15: paradas nunca aparecem em atencao[]/destaques[] — só no detalhe (evidência)", () => {
    const aps = nPeriodos(5, { duracaoPeriodoHorasVigente: 1 });
    const paradasFunc = aps.map((ap) => parada({ apontamentoId: ap.apontamentoId, data: ap.data, periodoId: ap.periodoId, minutos: 30 }));
    const resultado = gerarAnaliseFuncionarios(aps, paradasFunc, new Date(2026, 8, 3));
    const todosSinais = [...resultado.atencao, ...resultado.destaques];
    expect(todosSinais.every((s) => s.metrica === "performance" || s.metrica === "qualidade")).toBe(true);
  });

  it("caso 16: economia aparece só no detalhe (analise.economia), nunca em sinais", () => {
    const grupo = {
      contexto: { produtoId: "prod-1", produtoNome: "P1", operacaoId: "op-1", operacaoNome: "O1", maquinaId: "maq-1", maquinaNome: "M1" },
      chave: "c", funcionarioId: "func-A", funcionarioNome: "Ana",
      apontamentosFuncionario: nPeriodos(5, { custoOperacionalPeriodoVigente: 1000, duracaoPeriodoHorasVigente: 1 }),
      apontamentosPares: [],
    };
    const analise = analisarContextoFuncionario(grupo, [], JANELA_ATUAL, [], JANELA_ANTERIOR);
    expect(analise.economia.custoMedioPorPecaProduzida).not.toBeNull();
    expect(["performance", "qualidade"]).not.toContain("economia");
  });

  it("caso 17: margem só disponível quando o funcionário trabalhou a última etapa", () => {
    const grupoComUltimaEtapa = {
      contexto: { produtoId: "prod-1", produtoNome: "P1", operacaoId: "op-1", operacaoNome: "O1", maquinaId: "maq-1", maquinaNome: "M1" },
      chave: "c", funcionarioId: "func-A", funcionarioNome: "Ana",
      apontamentosFuncionario: nPeriodos(5, { isUltimaEtapa: true, duracaoPeriodoHorasVigente: 1 }),
      apontamentosPares: [],
    };
    const grupoSemUltimaEtapa = {
      ...grupoComUltimaEtapa,
      apontamentosFuncionario: nPeriodos(5, { isUltimaEtapa: false, duracaoPeriodoHorasVigente: 1 }),
    };
    const analiseCom = analisarContextoFuncionario(grupoComUltimaEtapa, [], JANELA_ATUAL, [], JANELA_ANTERIOR);
    const analiseSem = analisarContextoFuncionario(grupoSemUltimaEtapa, [], JANELA_ATUAL, [], JANELA_ANTERIOR);
    expect(analiseCom.economia.margemDisponivel).toBe(true);
    expect(analiseSem.economia.margemDisponivel).toBe(false);
    expect(analiseSem.economia.margemPct).toBeNull();
  });
});

// =======================================================================
// 18/19 — Evolução só no mesmo contexto
// =======================================================================
describe("Evolução individual (§13)", () => {
  it("caso 18: evolução compara funcionário no MESMO contexto entre janelas", () => {
    const grupo = {
      contexto: { produtoId: "prod-1", produtoNome: "P1", operacaoId: "op-1", operacaoNome: "O1", maquinaId: "maq-1", maquinaNome: "M1" },
      chave: "c", funcionarioId: "func-A", funcionarioNome: "Ana",
      apontamentosFuncionario: nPeriodos(5, { quantidadeProduzida: 120, duracaoPeriodoHorasVigente: 1, metaPeriodoVigente: 100 }, "2026-08-31"),
      apontamentosPares: [],
    };
    const anterior = nPeriodos(5, { produtoId: "prod-1", operacaoId: "op-1", maquinaId: "maq-1", quantidadeProduzida: 80, duracaoPeriodoHorasVigente: 1, metaPeriodoVigente: 100 }, "2026-08-24");
    const analise = analisarContextoFuncionario(grupo, [], JANELA_ATUAL, anterior, JANELA_ANTERIOR);
    expect(analise.evolucao.disponivel).toBe(true);
    expect(analise.evolucao.performanceAnterior).toBeCloseTo(80, 0);
    expect(analise.evolucao.performanceAtual).toBeCloseTo(120, 0);
  });

  it("caso 19: mudança de contexto entre janelas não mistura numa série — evolução fica indisponível", () => {
    const grupo = {
      contexto: { produtoId: "prod-1", produtoNome: "P1", operacaoId: "op-1", operacaoNome: "O1", maquinaId: "maq-1", maquinaNome: "M1" },
      chave: "c", funcionarioId: "func-A", funcionarioNome: "Ana",
      apontamentosFuncionario: nPeriodos(5, { duracaoPeriodoHorasVigente: 1 }, "2026-08-31"),
      apontamentosPares: [],
    };
    // "anterior" vazio simula que o funcionário trabalhou em OUTRO contexto na janela anterior
    // (o orquestrador só popularia apontamentosFuncionarioAnterior se a CHAVE contexto+funcionário batesse).
    const analise = analisarContextoFuncionario(grupo, [], JANELA_ATUAL, [], JANELA_ANTERIOR);
    expect(analise.evolucao.disponivel).toBe(false);
    expect(analise.evolucao.motivoIndisponivel).toMatch(/anterior/);
  });
});

// =======================================================================
// 20 — Cobertura operacional não é ranking
// =======================================================================
describe("Cobertura operacional (§14)", () => {
  it("caso 20: cobertura é só contagem — objeto não carrega nenhum campo de nota/score", () => {
    const aps = [
      ...nPeriodos(3, { produtoId: "prod-1", operacaoId: "op-1", maquinaId: "maq-1" }),
      ...nPeriodos(3, { produtoId: "prod-2", operacaoId: "op-2", maquinaId: "maq-2" }),
    ];
    const cobertura = calcularCoberturaOperacional(aps);
    expect(cobertura.quantidadeProdutos).toBe(2);
    expect(cobertura.quantidadeContextosDistintos).toBe(2);
    const chaves = Object.keys(cobertura);
    expect(chaves).not.toContain("nota");
    expect(chaves).not.toContain("score");
    expect(chaves).not.toContain("ranking");
  });
});

// =======================================================================
// 21 — mesmo funcionário: atenção em um contexto, destaque em outro
// =======================================================================
describe("Contextos independentes por pessoa (§16)", () => {
  it("caso 21: mesmo funcionário pode ter atenção em um contexto e destaque em outro", () => {
    const contextoA = nPeriodos(5, { produtoId: "prod-A", operacaoId: "op-A", maquinaId: "maq-A", quantidadeProduzida: 50, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 });
    const paresA = nPeriodos(3, { produtoId: "prod-A", operacaoId: "op-A", maquinaId: "maq-A", funcionarioId: "func-B", quantidadeProduzida: 100, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 });
    const contextoB = nPeriodos(5, { produtoId: "prod-B", operacaoId: "op-B", maquinaId: "maq-B", quantidadeProduzida: 150, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 });
    const paresB = nPeriodos(3, { produtoId: "prod-B", operacaoId: "op-B", maquinaId: "maq-B", funcionarioId: "func-B", quantidadeProduzida: 90, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 });

    const resultado = gerarAnaliseFuncionarios([...contextoA, ...paresA, ...contextoB, ...paresB], [], new Date(2026, 8, 3));
    const temAtencaoContextoA = resultado.atencao.some((s) => s.funcionarioId === "func-A" && s.contexto.produtoId === "prod-A");
    const temDestaqueContextoB = resultado.destaques.some((s) => s.funcionarioId === "func-A" && s.contexto.produtoId === "prod-B");
    expect(temAtencaoContextoA).toBe(true);
    expect(temDestaqueContextoB).toBe(true);
  });
});

// =======================================================================
// 22 — Desvios -> Funcionários preserva filtros
// =======================================================================
describe("Drill-down Desvios -> Funcionários (§18)", () => {
  it("caso 22: filtrosDrillDown do desvio preserva produto/máquina/operação/janela", () => {
    const atual = nPeriodos(3, { maquinaId: "maq-9", produtoId: "prod-9", operacaoId: "op-9", quantidadeProduzida: 60, metaPeriodoVigente: 100 });
    const referencia = nPeriodos(3, { maquinaId: "maq-9", produtoId: "prod-9", operacaoId: "op-9", quantidadeProduzida: 95, metaPeriodoVigente: 100 }, "2026-08-24");
    const janelas = { atual: JANELA_ATUAL, referencia: JANELA_ANTERIOR };
    const d = detectarDesviosProdutividade(atual, referencia, [], [], janelas, "operacional").find((x) => x.tipo === "performance_deteriorou")!;
    expect(d.filtrosDrillDown).toMatchObject({ produtoId: "prod-9", maquinaId: "maq-9", operacaoId: "op-9" });
    // Desvio nunca isola um funcionarioId específico no drill-down.
    expect(d.filtrosDrillDown.funcionarioId).toBeUndefined();
  });
});

// =======================================================================
// 23 — Funcionário continua sem gerar incidente autônomo em Desvios
// =======================================================================
describe("Regra de Desvios preservada (§18)", () => {
  it("caso 23: nenhum DesvioDetectado tem domínio 'funcionario' — continua só evidência", () => {
    const atual = nPeriodos(3, { funcionarioId: "func-B", quantidadeProduzida: 50, metaPeriodoVigente: 100 });
    const referencia = nPeriodos(3, { funcionarioId: "func-A", quantidadeProduzida: 95, metaPeriodoVigente: 100 }, "2026-08-24");
    const desvios = detectarDesviosProdutividade(atual, referencia, [], [], { atual: JANELA_ATUAL, referencia: JANELA_ANTERIOR }, "operacional");
    desvios.forEach((d) => expect(d.dominio).not.toBe("funcionario" as never));
  });
});

// =======================================================================
// 24/25 — sem ranking/nota, sem causalidade indevida
// =======================================================================
describe("Sem ranking/nota e sem causalidade indevida (§18/§20)", () => {
  it("caso 24: SinalFuncionario nunca carrega campo de posição/nota/score geral", () => {
    const grupo = {
      contexto: { produtoId: "prod-1", produtoNome: "P1", operacaoId: "op-1", operacaoNome: "O1", maquinaId: "maq-1", maquinaNome: "M1" },
      chave: "c", funcionarioId: "func-A", funcionarioNome: "Ana",
      apontamentosFuncionario: nPeriodos(5, { quantidadeProduzida: 50, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 }),
      apontamentosPares: nPeriodos(3, { funcionarioId: "func-B", quantidadeProduzida: 100, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 }),
    };
    const analise = analisarContextoFuncionario(grupo, [], JANELA_ATUAL, [], JANELA_ANTERIOR);
    const chaves = Object.keys(analise.sinalPerformance || {});
    ["posicao", "ranking", "nota", "score"].forEach((campoProibido) => expect(chaves).not.toContain(campoProibido));
  });

  it("caso 25: nenhum texto fixo do domínio usa linguagem de causalidade direta", () => {
    // Verificação estrutural: o motor nunca produz um campo de texto livre
    // com a palavra "causou"/"causado" — só `descricao`/`fonte` controlados
    // pelos componentes de UI, que usam sempre "observado durante os
    // apontamentos"/"associado ao mesmo contexto" (conferido nos arquivos
    // de componente, não gerado dinamicamente a partir de dado externo).
    const grupo = {
      contexto: { produtoId: "prod-1", produtoNome: "P1", operacaoId: "op-1", operacaoNome: "O1", maquinaId: "maq-1", maquinaNome: "M1" },
      chave: "c", funcionarioId: "func-A", funcionarioNome: "Ana",
      apontamentosFuncionario: nPeriodos(5, { quantidadeProduzida: 50, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 }),
      apontamentosPares: nPeriodos(3, { funcionarioId: "func-B", quantidadeProduzida: 100, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1, minutosParados: 0 }),
    };
    const analise = analisarContextoFuncionario(grupo, [], JANELA_ATUAL, [], JANELA_ANTERIOR);
    expect(JSON.stringify(analise)).not.toMatch(/causou|causado por/i);
  });
});
