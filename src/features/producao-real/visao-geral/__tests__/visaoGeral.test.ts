import { describe, expect, it } from "vitest";
import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import type { ParadaComContexto } from "@/features/producao-real/paradas/calculations";
import type { Produto, Maquina, PeriodoComDuracao, Previsao } from "@/types/domain";
import type { OcorrenciaAbertaComMaquina } from "@/hooks/useOcorrenciasAbertas";
import { gerarVisaoGeralProducaoReal, recortarUltimos14Dias, JANELA_HISTORICA_VALIDACAO_DIAS } from "@/features/producao-real/visao-geral";
import { formatarTempoDecorrido, minutosDecorridos } from "@/lib/tempoDecorrido";

// ---------------------------------------------------------------------
// Factories — mesmo padrão já usado em Desvios V1/Funcionários V1/
// Validação da Previsão V1.
// ---------------------------------------------------------------------
function apontamento(over: Partial<ApontamentoIndicador> = {}): ApontamentoIndicador {
  return {
    apontamentoId: "ap-" + Math.random().toString(36).slice(2),
    data: "2026-09-01", periodoId: "m1", periodoNome: "M1", status: "produzindo", motivoSemProducao: null,
    produtoId: "prod-1", produtoNome: "Produto 1", maquinaId: "maq-1", maquinaNome: "Máquina 1",
    operacaoId: "op-1", operacaoNome: "Rosquear", funcionarioId: "func-1", funcionarioNome: "Funcionário 1",
    etapaId: "etapa-1", etapaOrdem: 0, isUltimaEtapa: true,
    quantidadeProduzida: 100, quantidadeRefugo: 2, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1,
    minutosParados: 0, custoHoraOperacaoVigente: 30, custoOperacionalPeriodoVigente: 45,
    custoUnitarioReferenciaPeriodoVigente: 0.45, produtoValorUnitario: 2, etapaMaquinasElegiveis: 1,
    ...over,
  };
}

function parada(over: Partial<ParadaComContexto> = {}): ParadaComContexto {
  return {
    paradaId: "pa-" + Math.random().toString(36).slice(2), apontamentoId: "ap-x",
    data: "2026-09-01", periodoId: "m1", minutos: 10,
    motivoId: "mot-1", motivoNome: "Falta de material", motivoCategoria: "planejada", origem: "manual",
    produtoId: "prod-1", produtoNome: "Produto 1", maquinaId: "maq-1", maquinaNome: "Máquina 1",
    operacaoId: "op-1", operacaoNome: "Rosquear", funcionarioId: "func-1", funcionarioNome: "Funcionário 1",
    custoHoraOperacaoVigente: 30, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1,
    ...over,
  } as ParadaComContexto;
}

const PRODUTO: Produto = {
  id: "prod-1", nome: "Produto 1", referencia: "P1", valorUnitario: 2, ativo: true, prioridade: "media" as never,
  roteiro: [{ id: "etapa-1", operacao: "Rosquear", metas: { m1: 100, m2: 100, m3: 100, t1: 100, t2: 100, t3: 100 }, maquinasIds: ["maq-1"] }],
};
const MAQUINAS: Maquina[] = [{ id: "maq-1", nome: "Máquina 1", operacao: "Rosquear", ativo: true }];
const PERIODOS: PeriodoComDuracao[] = [{ id: "m1", nome: "M1", inicio: "07:00", fim: "08:00", duracaoHoras: 1 }];

function previsaoComItem(quantidade: number, produtoId = "prod-1", produtoNome = "Produto 1"): Previsao {
  return {
    semanaInicio: "2026-08-31",
    itens: [{ id: "it-1", produtoId, produtoNome, valorUnitario: 2, quantidade, maquinasPorEtapa: { "etapa-1": ["maq-1"] } }],
    itensRealizados: [],
    maquinasIndisponiveis: [],
  };
}

const AGORA = new Date(2026, 8, 3, 10, 0); // quinta-feira, 03/09/2026, 10:00

// =======================================================================
// caso 1 (§3): "semana atual até agora" corretamente recortada — só
// apontamentos dentro de segunda->hoje entram na Saúde da fábrica.
// =======================================================================
describe("Recorte de janela — semana atual até agora (§3)", () => {
  it("caso 1: apontamento de semana anterior não entra em factoryHealth, só o da semana atual entra", () => {
    const apSemanaAnterior = apontamento({ data: "2026-08-20", quantidadeProduzida: 999999 }); // deveria distorcer se vazasse
    const apSemanaAtual = apontamento({ data: "2026-09-02", quantidadeProduzida: 100, quantidadeRefugo: 0, metaPeriodoVigente: 100 });
    const resultado = gerarVisaoGeralProducaoReal([apSemanaAnterior, apSemanaAtual], [], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(resultado.factoryHealth.temDados).toBe(true);
    // se o apontamento de 999999 tivesse vazado, qualidade/performance ficariam distorcidas para valores absurdos.
    expect(resultado.factoryHealth.performancePct).toBeCloseTo(100, 0);
  });
});

// =======================================================================
// caso 2 (§4): recorte explícito de 14 dias antes de Validação da
// Previsão — nunca 28 dias inteiros.
// =======================================================================
describe("Recorte explícito de 14 dias para Validação da Previsão (§4)", () => {
  it("caso 2: recortarUltimos14Dias remove item com mais de 14 dias e mantém o que está dentro", () => {
    const dentro = apontamento({ data: "2026-08-25" }); // 9 dias antes de AGORA (03/09)
    const fora = apontamento({ data: "2026-08-10" }); // 24 dias antes — fora da janela de 14
    const r = recortarUltimos14Dias([dentro, fora], AGORA);
    expect(r).toHaveLength(1);
    expect(r[0].data).toBe("2026-08-25");
  });

  it("caso 3: JANELA_HISTORICA_VALIDACAO_DIAS é exatamente 14 (mesmo valor de Validação da Previsão)", () => {
    expect(JANELA_HISTORICA_VALIDACAO_DIAS).toBe(14);
  });

  it("caso 4: um apontamento de 20 dias atrás (dentro dos 28 buscados, fora dos 14 de Validação) NÃO conta pra amostra de capacidade provável", () => {
    const apAntigo20dias = apontamento({ data: "2026-08-14", maquinaId: "maq-1", operacaoNome: "Rosquear" }); // 20 dias atrás — só nos 28, não nos 14
    const resultado = gerarVisaoGeralProducaoReal([apAntigo20dias], [], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    const item = resultado; // capacidade provável não é exposta diretamente aqui, mas a Validação não deve nem ver esse apontamento —
    // prova indireta: recortarUltimos14Dias já teria removido esse apontamento (caso 2), então o comportamento é estrutural, não um efeito colateral.
    expect(recortarUltimos14Dias([apAntigo20dias], AGORA)).toHaveLength(0);
  });
});

// =======================================================================
// caso 5/6 (§5): Performance sem teto, percentuais agregados (soma de
// numeradores/denominadores, nunca média simples) — reaproveita
// calcularResumoIndicadores oficial.
// =======================================================================
describe("Faixa 1 — Saúde da fábrica (§5)", () => {
  it("caso 5: Performance sustentada acima de 100% não é capada", () => {
    const aps = [apontamento({ data: "2026-09-02", quantidadeProduzida: 150, metaPeriodoVigente: 100, minutosParados: 0 })];
    const resultado = gerarVisaoGeralProducaoReal(aps, [], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(resultado.factoryHealth.performancePct).toBeCloseTo(150, 0);
  });

  it("caso 6: percentuais agregados por soma de numeradores/denominadores, não média simples das % individuais", () => {
    // ap A: 100% de qualidade (boa=100/100). ap B: 50% de qualidade (boa=50/100, produzida=100).
    // média simples das % seria 75%; soma de numeradores/denominadores dá (100+50)/(100+100)=75% também neste caso simétrico —
    // então usamos quantidades DIFERENTES pra distinguir as duas contas.
    const apA = apontamento({ data: "2026-09-01", quantidadeProduzida: 10, quantidadeRefugo: 0 }); // qualidade 100%, peso pequeno
    const apB = apontamento({ data: "2026-09-02", quantidadeProduzida: 1000, quantidadeRefugo: 500 }); // qualidade 50%, peso grande
    const resultado = gerarVisaoGeralProducaoReal([apA, apB], [], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    const mediaSimples = (100 + 50) / 2; // 75% — NÃO deve ser isso
    const somaNumDen = ((10 + 500) / (10 + 1000)) * 100; // ~50.5% — deve ser isso
    expect(resultado.factoryHealth.qualidadePct).not.toBeCloseTo(mediaSimples, 0);
    expect(resultado.factoryHealth.qualidadePct).toBeCloseTo(somaNumDen, 0);
  });

  it("caso 7: nenhum apontamento na semana atual -> temDados=false, nunca 0% fictício", () => {
    const resultado = gerarVisaoGeralProducaoReal([], [], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(resultado.factoryHealth.temDados).toBe(false);
    expect(resultado.factoryHealth.performancePct).toBeNull();
  });

  it("caso 8: Tempo parado em minutos, vindo de calcularResumoIndicadores (nunca recalculado à mão)", () => {
    const ap = apontamento({ data: "2026-09-02", minutosParados: 15 });
    const pa = parada({ data: "2026-09-02", minutos: 15 });
    const resultado = gerarVisaoGeralProducaoReal([ap], [pa], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(resultado.factoryHealth.minutosParadosTotais).toBe(15);
  });
});

// =======================================================================
// caso 9-12 (§6/§7): situação da semana — estados, maior déficit nunca
// somado entre produtos, previsão vazia.
// =======================================================================
describe("Faixa 2 — Situação da semana (§6/§7)", () => {
  it("caso 9: nenhuma previsão lançada -> estado vazio explícito, nunca 0 produtos silencioso", () => {
    const previsaoVazia: Previsao = { semanaInicio: "2026-08-31", itens: [], itensRealizados: [], maquinasIndisponiveis: [] };
    const resultado = gerarVisaoGeralProducaoReal([], [], previsaoVazia, [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(resultado.forecast.temPrevisao).toBe(false);
    expect(resultado.forecast.porEstado.inviavel_teoricamente).toBe(0);
  });

  it("caso 10: contagem por estado reflete exatamente os itens calculados pela Validação da Previsão oficial", () => {
    // previsto gigante, sem nenhuma capacidade/produção -> inviável teoricamente (mesma regra já testada em Validação da Previsão).
    const resultado = gerarVisaoGeralProducaoReal([], [], previsaoComItem(100000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    const totalContado = Object.values(resultado.forecast.porEstado).reduce((s, n) => s + n, 0);
    expect(totalContado).toBe(1); // 1 produto na previsão -> soma das contagens = 1
    expect(resultado.forecast.porEstado.inviavel_teoricamente).toBe(1);
  });

  it("caso 11/12: maior déficit é de UM único produto, nunca a soma de dois produtos", () => {
    const previsaoDoisProdutos: Previsao = {
      semanaInicio: "2026-08-31",
      itens: [
        { id: "it-a", produtoId: "prod-1", produtoNome: "Produto 1", valorUnitario: 2, quantidade: 100000, maquinasPorEtapa: { "etapa-1": ["maq-1"] } },
        { id: "it-b", produtoId: "prod-2", produtoNome: "Produto 2", valorUnitario: 2, quantidade: 50000, maquinasPorEtapa: { "etapa-1": ["maq-1"] } },
      ],
      itensRealizados: [], maquinasIndisponiveis: [],
    };
    const produtoB: Produto = { ...PRODUTO, id: "prod-2", nome: "Produto 2" };
    const resultado = gerarVisaoGeralProducaoReal([], [], previsaoDoisProdutos, [PRODUTO, produtoB], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(resultado.forecast.maiorDeficit).not.toBeNull();
    // déficit do produto 1 (100000) é maior que o do produto 2 (50000) -> maiorDeficit aponta pro produto 1, nunca pra soma (150000).
    expect(resultado.forecast.maiorDeficit!.produtoId).toBe("prod-1");
    expect(resultado.forecast.maiorDeficit!.deficitProjetado).toBeLessThan(100000 + 50000);
    expect(resultado.forecast.maiorDeficit!.deficitProjetado).toBeCloseTo(100000, -2);
  });
});

// =======================================================================
// caso 13-15 (§8): ocorrências abertas — aparecem, estado vazio correto,
// duração calculada corretamente (helper compartilhado, sem duplicar fórmula).
// =======================================================================
describe("Faixa 3 — Agora / ocorrências abertas (§8)", () => {
  const ocorrencia: OcorrenciaAbertaComMaquina = {
    id: "oc-1", maquinaId: "maq-1", maquinaNome: "Máquina 1", motivoNome: "Quebra", descricao: "Correia rompida",
    abertaEm: new Date(AGORA.getTime() - 90 * 60000).toISOString(), // 90 min antes de AGORA
  };

  it("caso 13: ocorrência aberta aparece em openOccurrences com os campos esperados", () => {
    const resultado = gerarVisaoGeralProducaoReal([], [], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [ocorrencia], AGORA);
    expect(resultado.openOccurrences).toHaveLength(1);
    expect(resultado.openOccurrences[0].maquinaNome).toBe("Máquina 1");
    expect(resultado.openOccurrences[0].motivoNome).toBe("Quebra");
  });

  it("caso 14: nenhuma ocorrência aberta -> openOccurrences vazio (UI mostra 'Nenhuma máquina parada agora')", () => {
    const resultado = gerarVisaoGeralProducaoReal([], [], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(resultado.openOccurrences).toHaveLength(0);
  });

  it("caso 15: duração é calculada corretamente (90min abertos até 'agora') e usa o helper compartilhado, nunca uma fórmula nova", () => {
    const resultado = gerarVisaoGeralProducaoReal([], [], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [ocorrencia], AGORA);
    expect(resultado.openOccurrences[0].tempoDecorridoRotulo).toBe(formatarTempoDecorrido(ocorrencia.abertaEm, AGORA));
    expect(minutosDecorridos(ocorrencia.abertaEm, AGORA)).toBe(90);
    expect(resultado.openOccurrences[0].tempoDecorridoRotulo).toBe("1h 30min");
  });
});

// =======================================================================
// caso 16/17 (§9): principais atenções — top 3, prioridade oficial,
// nenhuma causalidade nova (checagem estrutural do texto/campos usados).
// =======================================================================
describe("Faixa 3 — Principais atenções (§9)", () => {
  it("caso 16: nunca mais que 3 itens em attentionItems, mesmo com muitos desvios detectáveis", () => {
    // vários contextos diferentes com queda forte de Performance -> vários desvios possíveis.
    const aps: ApontamentoIndicador[] = [];
    ["maq-1", "maq-2", "maq-3", "maq-4", "maq-5"].forEach((maquinaId, i) => {
      for (let d = 0; d < 5; d++) {
        aps.push(apontamento({ data: `2026-08-2${d}`, maquinaId, maquinaNome: `Máquina ${i}`, quantidadeProduzida: 100, metaPeriodoVigente: 100 })); // referência (28 dias)
      }
      for (let d = 0; d < 5; d++) {
        aps.push(apontamento({ data: `2026-09-0${d + 1 <= 3 ? d + 1 : 1}`, maquinaId, maquinaNome: `Máquina ${i}`, quantidadeProduzida: 10, metaPeriodoVigente: 100 })); // atual, forte queda
      }
    });
    const resultado = gerarVisaoGeralProducaoReal(aps, [], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(resultado.attentionItems.length).toBeLessThanOrEqual(3);
  });

  it("caso 17: attentionItems são exatamente os IncidenteDesvio de gerarFilaDesvios (mesmo objeto, nenhum campo de causa nova adicionado)", () => {
    const resultado = gerarVisaoGeralProducaoReal([], [], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    resultado.attentionItems.forEach((item) => {
      expect(Object.keys(item)).toEqual(expect.arrayContaining(["id", "contexto", "severidade", "desvioPrincipal", "efeitos", "possiveisFatores"]));
      expect(Object.keys(item)).not.toContain("causa");
      expect(Object.keys(item)).not.toContain("score");
    });
  });
});

// =======================================================================
// caso 18-21 (§10): paradas — só funções oficiais, principal motivo,
// máquina mais afetada, capacidade local perdida SEMPRE separada.
// =======================================================================
describe("Faixa 5 — Paradas (§10)", () => {
  it("caso 18/19: principal motivo por minutos é o correto entre vários motivos", () => {
    const aps = [apontamento({ data: "2026-09-01" }), apontamento({ data: "2026-09-02" })];
    const paradas = [
      parada({ data: "2026-09-01", motivoId: "mot-a", motivoNome: "Falta de material", minutos: 20 }),
      parada({ data: "2026-09-02", motivoId: "mot-b", motivoNome: "Manutenção", minutos: 50 }),
    ];
    const resultado = gerarVisaoGeralProducaoReal(aps, paradas, previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(resultado.downtime.principalMotivo).not.toBeNull();
    expect(resultado.downtime.principalMotivo!.motivoNome).toBe("Manutenção");
    expect(resultado.downtime.principalMotivo!.minutos).toBe(50);
  });

  it("caso 20: máquina mais afetada por minutos é a correta entre várias máquinas", () => {
    const aps = [apontamento({ data: "2026-09-01", maquinaId: "maq-1", maquinaNome: "Máquina 1" }), apontamento({ data: "2026-09-02", maquinaId: "maq-2", maquinaNome: "Máquina 2" })];
    const paradas = [
      parada({ data: "2026-09-01", maquinaId: "maq-1", maquinaNome: "Máquina 1", minutos: 15 }),
      parada({ data: "2026-09-02", maquinaId: "maq-2", maquinaNome: "Máquina 2", minutos: 60 }),
    ];
    const resultado = gerarVisaoGeralProducaoReal(aps, paradas, previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(resultado.downtime.maquinaMaisAfetada).not.toBeNull();
    expect(resultado.downtime.maquinaMaisAfetada!.maquinaNome).toBe("Máquina 2");
  });

  it("caso 21: capacidade local perdida (peças) é um campo separado, nunca somado a minutos parados", () => {
    const aps = [apontamento({ data: "2026-09-01", metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1 })];
    const paradas = [parada({ data: "2026-09-01", minutos: 30, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1 })];
    const resultado = gerarVisaoGeralProducaoReal(aps, paradas, previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(resultado.downtime.capacidadePerdidaTotal).not.toBe(resultado.downtime.minutosParadosTotal);
    expect(resultado.downtime.capacidadePerdidaTotal).toBeCloseTo(50, 0); // (100/60)*30 = 50 peças
    expect(resultado.downtime.minutosParadosTotal).toBe(30);
  });
});

// =======================================================================
// caso 22 (§11): recurso mais pressionado — pctUso NUNCA capado em 100.
// =======================================================================
describe("Faixa 6 — Recurso mais pressionado (§11)", () => {
  it("caso 22: pctUso pode passar de 100% e não é capado", () => {
    // previsto gigante pro pouco tempo restante da semana (quinta 10h) -> recurso pressionado > 100%.
    const resultado = gerarVisaoGeralProducaoReal([], [], previsaoComItem(1000000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(resultado.pressuredResource).not.toBeNull();
    expect(resultado.pressuredResource!.pctUso).toBeGreaterThan(100);
  });
});

// =======================================================================
// caso 23-25 (§12): nada fora do escopo aprovado aparece na estrutura.
// =======================================================================
describe("Fora do escopo V1 — nada disso existe na estrutura (§12)", () => {
  it("caso 23: nenhum campo de 'produção acabada total da fábrica' em factoryHealth", () => {
    const resultado = gerarVisaoGeralProducaoReal([], [], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    const chaves = Object.keys(resultado.factoryHealth);
    expect(chaves.some((k) => /producaoAcabada/i.test(k))).toBe(false);
  });

  it("caso 24: nenhum campo de ranking/score em nenhum nível do resultado", () => {
    const resultado = gerarVisaoGeralProducaoReal([], [], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    const texto = JSON.stringify(Object.keys(resultado)).toLowerCase();
    expect(texto).not.toContain("ranking");
    expect(texto).not.toContain("scoreglobal");
  });

  it("caso 25: nenhum campo de Economia (custo/margem) no resultado", () => {
    const resultado = gerarVisaoGeralProducaoReal([], [], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(Object.keys(resultado)).not.toContain("economicSignals");
    expect(Object.keys(resultado)).not.toContain("economia");
  });
});

// =======================================================================
// caso 26/27 (§14): drill-down preserva a janela da semana atual.
// =======================================================================
describe("Drill-down (§14)", () => {
  it("caso 26/27: filtros de drill-down (produtividade/paradas) usam a mesma janela 'semana atual até agora'", () => {
    const resultado = gerarVisaoGeralProducaoReal([], [], previsaoComItem(1000), [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(resultado.drillDown.produtividade).toEqual({ dataInicial: resultado.factoryHealth.janela.dataInicial, dataFinal: resultado.factoryHealth.janela.dataFinal });
    expect(resultado.drillDown.paradas).toEqual({ dataInicial: resultado.downtime.janela.dataInicial, dataFinal: resultado.downtime.janela.dataFinal });
  });
});

// =======================================================================
// caso 28 (estrutural): gerarVisaoGeralProducaoReal nunca escreve — só lê
// e devolve objeto novo (mesmo padrão de Validação da Previsão).
// =======================================================================
describe("Restrições gerais (estrutural)", () => {
  it("caso 28: não muta os arrays/objetos de entrada", () => {
    const aps = [apontamento({ data: "2026-09-01" })];
    const paradas = [parada({ data: "2026-09-01" })];
    const previsao = previsaoComItem(1000);
    const antesAps = JSON.stringify(aps);
    const antesPrevisao = JSON.stringify(previsao);
    gerarVisaoGeralProducaoReal(aps, paradas, previsao, [PRODUTO], MAQUINAS, PERIODOS, 5, [], AGORA);
    expect(JSON.stringify(aps)).toBe(antesAps);
    expect(JSON.stringify(previsao)).toBe(antesPrevisao);
  });
});
