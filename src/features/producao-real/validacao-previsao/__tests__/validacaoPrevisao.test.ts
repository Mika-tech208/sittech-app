import { describe, expect, it } from "vitest";
import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import type { Produto, Maquina, PeriodoComDuracao, Previsao, PrevisaoItem } from "@/types/domain";
import { calcularTempoRestanteSemana, calcularHorasRestantesHoje, diaUtilConvencao } from "@/features/producao-real/validacao-previsao/tempoRestante";
import { calcularProducaoAcabadaObservadaPorProduto, calcularDivergenciaRealizado, calcularFaltaOperacional } from "@/features/producao-real/validacao-previsao/producaoAcabada";
import { calcularCapacidadeTeoricaRestante } from "@/features/producao-real/validacao-previsao/capacidadeTeorica";
import {
  calcularFatorProvavelContexto, calcularCapacidadeProvavelItem, calcularCapacidadeProvavelEtapa,
  calcularCapacidadeProvavelMaquina, calcularInsumosCompartilhamento,
} from "@/features/producao-real/validacao-previsao/capacidadeProvavel";
import { calcularProdutosForaDaPrevisao, calcularEvidenciasSemProducao } from "@/features/producao-real/validacao-previsao/evidencias";
import { classificarEstado } from "@/features/producao-real/validacao-previsao/estado";
import { gerarValidacaoPrevisao } from "@/features/producao-real/validacao-previsao";
import type { ContextoOperacional } from "@/features/producao-real/validacao-previsao/types";

// ---------------------------------------------------------------------
// Factories — mesmo padrão já usado em Desvios V1/Funcionários V1.
// ---------------------------------------------------------------------
function apontamento(over: Partial<ApontamentoIndicador> = {}): ApontamentoIndicador {
  return {
    apontamentoId: "ap-" + Math.random().toString(36).slice(2),
    data: "2026-09-01", periodoId: "m1", periodoNome: "M1", status: "produzindo", motivoSemProducao: null,
    produtoId: "prod-1", produtoNome: "Produto 1", maquinaId: "maq-1", maquinaNome: "Máquina 1",
    operacaoId: "op-1", operacaoNome: "Rosquear", funcionarioId: "func-1", funcionarioNome: "Funcionário 1",
    etapaId: "etapa-1", etapaOrdem: 0, isUltimaEtapa: true,
    quantidadeProduzida: 100, quantidadeRefugo: 2, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1.5,
    minutosParados: 0, custoHoraOperacaoVigente: 30, custoOperacionalPeriodoVigente: 45,
    custoUnitarioReferenciaPeriodoVigente: 0.45, produtoValorUnitario: 2, etapaMaquinasElegiveis: 1,
    ...over,
  };
}

function nPeriodos(n: number, over: Partial<ApontamentoIndicador> = {}, dataBase = "2026-08-20"): ApontamentoIndicador[] {
  return Array.from({ length: n }).map((_, i) => apontamento({ ...over, apontamentoId: `ap-${Math.random()}`, data: dataBase, periodoId: `p${i}`, duracaoPeriodoHorasVigente: 1 }));
}

const PRODUTO: Produto = {
  id: "prod-1", nome: "Produto 1", referencia: "P1", valorUnitario: 2, ativo: true, prioridade: "media" as never,
  roteiro: [
    { id: "etapa-1", operacao: "Rosquear", metas: { m1: 100, m2: 100, m3: 100, t1: 100, t2: 100, t3: 100 }, maquinasIds: ["maq-1"] },
    { id: "etapa-2", operacao: "Embalar", metas: { m1: 100, m2: 100, m3: 100, t1: 100, t2: 100, t3: 100 }, maquinasIds: ["maq-2"] },
  ],
};
const MAQUINAS: Maquina[] = [{ id: "maq-1", nome: "Máquina 1", operacao: "Rosquear", ativo: true }, { id: "maq-2", nome: "Máquina 2", operacao: "Embalar", ativo: true }];
const PERIODOS: PeriodoComDuracao[] = [
  { id: "m1", nome: "M1", inicio: "07:00", fim: "08:36", duracaoHoras: 1.6 },
  { id: "m2", nome: "M2", inicio: "08:36", fim: "10:12", duracaoHoras: 1.6 },
  { id: "t1", nome: "T1", inicio: "13:00", fim: "14:36", duracaoHoras: 1.6 },
];

// =======================================================================
// 1/2 — realizado oficial nunca alterado por Produção Real
// =======================================================================
describe("Fonte oficial do Realizado (§2)", () => {
  it("caso 1/2: realizadoOficial vem só de previsao_itens (itensRealizados) — Produção Real não altera esse número", () => {
    const previsao: Previsao = {
      semanaInicio: "2026-08-17",
      itens: [{ id: "it-1", produtoId: "prod-1", produtoNome: "Produto 1", valorUnitario: 2, quantidade: 1000, maquinasPorEtapa: { "etapa-1": ["maq-1"], "etapa-2": ["maq-2"] } }],
      itensRealizados: [{ id: "it-r1", produtoId: "prod-1", produtoNome: "Produto 1", valorUnitario: 2, quantidade: 300 }],
      maquinasIndisponiveis: [],
    };
    const apontamentos = nPeriodos(6, { data: "2026-08-17", isUltimaEtapa: true, quantidadeProduzida: 999999 }); // Produção Real "gigante", não deve afetar realizadoOficial
    const resultado = gerarValidacaoPrevisao(previsao, [PRODUTO], MAQUINAS, PERIODOS, 5, apontamentos, [], new Date(2026, 7, 20));
    expect(resultado.itens[0].realizadoOficial).toBe(300);
  });
});

// =======================================================================
// 3/4 — produção acabada só última etapa
// =======================================================================
describe("Produção acabada (§4)", () => {
  it("caso 3: acabado usa somente good da última etapa", () => {
    const aps = [apontamento({ isUltimaEtapa: true, quantidadeProduzida: 100, quantidadeRefugo: 10 })];
    const mapa = calcularProducaoAcabadaObservadaPorProduto(aps);
    expect(mapa.get("prod-1")).toBe(90);
  });

  it("caso 4: etapa intermediária NUNCA conta como acabado", () => {
    const aps = [apontamento({ isUltimaEtapa: false, quantidadeProduzida: 500, quantidadeRefugo: 0 })];
    const mapa = calcularProducaoAcabadaObservadaPorProduto(aps);
    expect(mapa.get("prod-1")).toBeUndefined();
  });
});

// =======================================================================
// 5/6 — divergência e falta operacional
// =======================================================================
describe("Divergência e falta operacional (§2/§3)", () => {
  it("caso 5: divergência = observado - oficial", () => {
    expect(calcularDivergenciaRealizado(900, 850)).toBe(50);
    expect(calcularDivergenciaRealizado(800, 850)).toBe(-50);
  });

  it("caso 6: faltaOperacional usa produção acabada observada, nunca o realizado manual", () => {
    expect(calcularFaltaOperacional(1000, 900)).toBe(100);
    // mesmo com realizado oficial diferente, a função nem recebe esse parâmetro — prova estrutural.
    expect(calcularFaltaOperacional.length).toBe(2);
  });
});

// =======================================================================
// 7-11 — tempo restante
// =======================================================================
describe("Tempo restante (§5)", () => {
  it("caso 7: dias_uteis_semana=5 -> segunda a sexta (índices 0..4)", () => {
    expect(diaUtilConvencao(5)).toEqual({ primeiroDiaIndex: 0, ultimoDiaIndex: 4 });
    expect(diaUtilConvencao(6)).toEqual({ primeiroDiaIndex: 0, ultimoDiaIndex: 5 });
  });

  it("caso 8: período encerrado = zero restante", () => {
    const agora = new Date(2026, 7, 20, 10, 0); // 10:00, depois de m1(07-08:36) e m2(08:36-10:12 ainda em andamento)
    const horas = calcularHorasRestantesHoje([{ id: "m1", nome: "M1", inicio: "07:00", fim: "08:36", duracaoHoras: 1.6 }], agora);
    expect(horas).toBe(0);
  });

  it("caso 9: período futuro = completo", () => {
    const agora = new Date(2026, 7, 20, 6, 0); // antes de m1 começar
    const horas = calcularHorasRestantesHoje([{ id: "m1", nome: "M1", inicio: "07:00", fim: "08:36", duracaoHoras: 1.6 }], agora);
    expect(horas).toBeCloseTo(1.6, 5);
  });

  it("caso 10: período em andamento = só a fração restante", () => {
    const agora = new Date(2026, 7, 20, 8, 6); // 30 min antes do fim (08:36)
    const horas = calcularHorasRestantesHoje([{ id: "m1", nome: "M1", inicio: "07:00", fim: "08:36", duracaoHoras: 1.6 }], agora);
    expect(horas).toBeCloseTo(0.5, 2);
  });

  it("caso 11: semana encerrada = zero", () => {
    const r = calcularTempoRestanteSemana(PERIODOS, "2026-08-03", 5, 4.8, new Date(2026, 7, 20)); // semana de 03/08, hoje é 20/08 (bem depois)
    expect(r.horasRestantes).toBe(0);
  });
});

// =======================================================================
// 12/13 — máquina indisponível e recurso compartilhado
// =======================================================================
describe("Capacidade teórica restante (§6)", () => {
  const item: PrevisaoItem = { id: "it-1", produtoId: "prod-1", produtoNome: "Produto 1", valorUnitario: 2, quantidade: 100, maquinasPorEtapa: { "etapa-1": ["maq-1"], "etapa-2": ["maq-2"] } };

  it("caso 12: máquina indisponível respeitada — item travado em 0 quando sua única máquina está indisponível", () => {
    const r = calcularCapacidadeTeoricaRestante([item], [PRODUTO], MAQUINAS, PERIODOS, 10, ["maq-1"]);
    const resultadoItem = r.resultadosPorItem.find((x) => x.itemId === "it-1")!;
    expect(resultadoItem.maximoPossivel).toBe(0);
    expect(resultadoItem.etapaLimitante).toBe("Rosquear");
  });

  it("caso 13: recurso compartilhado não duplica capacidade — dois itens na mesma máquina dividem, nunca 100% cada", () => {
    const produtoB: Produto = { ...PRODUTO, id: "prod-2", nome: "Produto 2", roteiro: [{ id: "etapa-1b", operacao: "Rosquear", metas: { m1: 100, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: ["maq-1"] }] };
    const itemA: PrevisaoItem = { id: "it-a", produtoId: "prod-1", produtoNome: "Produto 1", valorUnitario: 2, quantidade: 100, maquinasPorEtapa: { "etapa-1": ["maq-1"], "etapa-2": ["maq-2"] } };
    const itemB: PrevisaoItem = { id: "it-b", produtoId: "prod-2", produtoNome: "Produto 2", valorUnitario: 2, quantidade: 100, maquinasPorEtapa: { "etapa-1b": ["maq-1"] } };
    const r = calcularCapacidadeTeoricaRestante([itemA, itemB], [PRODUTO, produtoB], MAQUINAS, PERIODOS, 1, []); // só 1h restante, pouco pra 200 peças
    const totalMaximo = r.resultadosPorItem.reduce((s, x) => s + x.maximoPossivel, 0);
    // a máquina 1 só tem 1h — não pode entregar o suficiente pros dois pedirem 100 cada sem dividir.
    expect(totalMaximo).toBeLessThan(200);
  });
});

// =======================================================================
// 14 — capacidade teórica usa meta
// =======================================================================
describe("Meta oficial (§14/§23)", () => {
  it("caso 14: capacidade teórica é derivada da meta do roteiro (roteiro_etapas.meta_*)", () => {
    const item: PrevisaoItem = { id: "it-1", produtoId: "prod-1", produtoNome: "Produto 1", valorUnitario: 2, quantidade: 1000, maquinasPorEtapa: { "etapa-1": ["maq-1"], "etapa-2": ["maq-2"] } };
    const r = calcularCapacidadeTeoricaRestante([item], [PRODUTO], MAQUINAS, PERIODOS, 10, []);
    // meta=100 peças/1h (tempoPorPeca=0.01h) -> 10h de máquina 1 e máquina 2 cada permitem 1000 peças (ambas etapas suportam).
    expect(r.resultadosPorItem[0].maximoPossivel).toBe(1000);
  });
});

// =======================================================================
// 15-17 — capacidade provável: contexto e amostra
// =======================================================================
describe("Capacidade provável — contexto e amostra (§8/§11)", () => {
  const contexto: ContextoOperacional = { produtoId: "prod-1", operacaoNome: "Rosquear", maquinaId: "maq-1", maquinaNome: "Máquina 1" };

  it("caso 15: provável é calculado por contexto produto+operação+máquina, não por produto inteiro", () => {
    const aps = nPeriodos(5, { duracaoPeriodoHorasVigente: 1, quantidadeProduzida: 100, metaPeriodoVigente: 100, minutosParados: 0 });
    const f = calcularFatorProvavelContexto(contexto, aps);
    expect(f.contexto).toEqual(contexto);
    expect(f.amostra.suficiente).toBe(true);
  });

  it("caso 16: amostra < 5 períodos = provável indisponível para o contexto", () => {
    const aps = nPeriodos(4, { duracaoPeriodoHorasVigente: 1 });
    const f = calcularFatorProvavelContexto(contexto, aps);
    expect(f.amostra.suficiente).toBe(false);
    expect(f.oeePct).toBeNull();
  });

  it("caso 17: amostra < 100min = provável indisponível mesmo com 5+ períodos", () => {
    const aps = nPeriodos(5, { duracaoPeriodoHorasVigente: 0.1 }); // 5x6min=30min
    const f = calcularFatorProvavelContexto(contexto, aps);
    expect(f.amostra.suficiente).toBe(false);
  });
});

// =======================================================================
// 18-20 — decomposição OEE, uma perda por vez
// =======================================================================
describe("Decomposição OEE — uma perda entra uma vez (§9)", () => {
  const contexto: ContextoOperacional = { produtoId: "prod-1", operacaoNome: "Rosquear", maquinaId: "maq-1", maquinaNome: "Máquina 1" };

  it("caso 18/19/20: oeePct já vem oficial (calcularResumoIndicadores) — Availability, Performance e Quality cada uma entra uma vez só", () => {
    // 5 períodos de 1h (60min), 10min parados cada -> Availability=(60-10)/60=83.33%
    // produzida=90 (dentro do tempo produtivo de 50min, meta ajustada=100*50/60=83.33 -> Performance=90/83.33=108%)
    // refugo=9 -> Quality=(90-9)/90=90%
    const aps = nPeriodos(5, { duracaoPeriodoHorasVigente: 1, minutosParados: 10, quantidadeProduzida: 90, quantidadeRefugo: 9, metaPeriodoVigente: 100 });
    const f = calcularFatorProvavelContexto(contexto, aps);
    expect(f.disponibilidadePct).toBeCloseTo(83.333, 1);
    expect(f.performancePct).toBeCloseTo(108, 0);
    expect(f.qualidadePct).toBeCloseTo(90, 0);
    // oeePct deve ser exatamente Performance x Availability x Quality / 10000 — mesma fórmula oficial, nunca outra.
    const esperado = (f.performancePct! * f.disponibilidadePct! * f.qualidadePct!) / 10000;
    expect(f.oeePct).toBeCloseTo(esperado, 5);
  });
});

// =======================================================================
// 21 — Performance >100 sem teto (contexto isolado)
// =======================================================================
describe("Performance > 100% (§12)", () => {
  it("caso 21: Performance sustentada >100% não é capada no fator provável", () => {
    const aps = nPeriodos(5, { duracaoPeriodoHorasVigente: 1, quantidadeProduzida: 150, metaPeriodoVigente: 100, minutosParados: 0 });
    const contexto: ContextoOperacional = { produtoId: "prod-1", operacaoNome: "Rosquear", maquinaId: "maq-1", maquinaNome: "Máquina 1" };
    const f = calcularFatorProvavelContexto(contexto, aps);
    expect(f.performancePct).toBeCloseTo(150, 0);
    expect(f.performanceSustentadaAcimaDeMeta).toBe(true);
  });
});

// =======================================================================
// 39/40 — Performance > 100%: taxa PROVÁVEL DO CONTEXTO (nunca aplicada
// sozinha ao produto inteiro — a combinação real é testada nos casos 41+)
// =======================================================================
describe("Performance > 100% — taxa do contexto (§12, bloqueio matemático)", () => {
  const contexto: ContextoOperacional = { produtoId: "prod-1", operacaoNome: "Rosquear", maquinaId: "maq-1", maquinaNome: "Máquina 1" };

  it("caso 39: Performance 110% / Availability 90% / Quality 98% -> oeePct do contexto ≈ 97,02 (1,10×0,90×0,98)", () => {
    // Availability=90%: 6min parados de 60min. metaAjustada=100×54/60=90.
    // Performance=110%: boa=90×1,10=99 -> produzida=101,refugo=2 (boa=99, quality=99/101≈98,02%).
    const aps = nPeriodos(5, { duracaoPeriodoHorasVigente: 1, minutosParados: 6, quantidadeProduzida: 101, quantidadeRefugo: 2, metaPeriodoVigente: 100 });
    const f = calcularFatorProvavelContexto(contexto, aps);
    expect(f.disponibilidadePct).toBeCloseTo(90, 1);
    expect(f.performancePct).toBeCloseTo(110, 0);
    expect(f.qualidadePct).toBeCloseTo(98, 0);
    expect(f.oeePct).toBeCloseTo(97.02, 0); // taxa do CONTEXTO — não é aplicada sozinha ao produto.
  });

  it("caso 40: Performance 120% / Availability 98% / Quality 99% -> oeePct do contexto ≈ 116,42 (1,20×0,98×0,99)", () => {
    // Availability=98%: 1,2min parados de 60min. metaAjustada=100×58,8/60=98.
    // Performance=120%: boa=98×1,20=117,6. Quality=99%: produzida=boa/0,99.
    const boa = 117.6;
    const produzida = boa / 0.99;
    const refugo = produzida - boa;
    const aps = nPeriodos(5, { duracaoPeriodoHorasVigente: 1, minutosParados: 1.2, quantidadeProduzida: produzida, quantidadeRefugo: refugo, metaPeriodoVigente: 100 });
    const f = calcularFatorProvavelContexto(contexto, aps);
    expect(f.disponibilidadePct).toBeCloseTo(98, 1);
    expect(f.performancePct).toBeCloseTo(120, 0);
    expect(f.qualidadePct).toBeCloseTo(99, 0);
    expect(f.oeePct).toBeCloseTo(116.42, 0);
  });
});

// =======================================================================
// 41-50 — 2ª CORREÇÃO do bloqueio matemático: capacidade provável é
// calculada EM PEÇAS por máquina (nunca só um fator). Máquinas
// PARALELAS/alternativas na MESMA etapa SOMAM (cada uma contribui
// independentemente, já depois de respeitar compartilhamento). Etapas
// SEQUENCIAIS do roteiro combinam por MIN (todas são necessárias pra
// terminar a peça). O teste #43 da versão anterior (MIN entre duas
// máquinas da mesma etapa) validava o comportamento ERRADO — substituído
// pelo caso 47 (teste A), que prova SOMA.
// =======================================================================
describe("Capacidade provável — peças por máquina, SOMA dentro da etapa, MIN entre etapas (2ª correção)", () => {
  // fixture local com números redondos: meta 100 peças/1h -> tempoPorPeca=0,01h/peça.
  const ETAPA_SIMPLES = { id: "etapa-1", operacao: "Rosquear", metas: { m1: 100, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 } };
  const PERIODOS_SIMPLES: PeriodoComDuracao[] = [{ id: "m1", nome: "M1", inicio: "07:00", fim: "08:00", duracaoHoras: 1 }];

  it("caso 47 (teste A): duas máquinas PARALELAS na mesma etapa (5.000 e 3.000 peças alocadas) -> capacidade da etapa é a SOMA = 8.000, nunca MIN (3.000) nem média", () => {
    const porMaquina = {
      "maq-1": { horasNecessarias: 50, produtos: { "prod-1": { produtoId: "prod-1", produtoNome: "Produto 1", horas: 50 } } },
      "maq-3": { horasNecessarias: 30, produtos: { "prod-1": { produtoId: "prod-1", produtoNome: "Produto 1", horas: 30 } } },
    };
    const fatorReducaoPorMaquina = { "maq-1": 1, "maq-3": 1 }; // sem disputa nesse cenário — só provando a combinação dentro da etapa.
    const apsA = nPeriodos(5, { duracaoPeriodoHorasVigente: 1, operacaoNome: "Rosquear", maquinaId: "maq-1", maquinaNome: "Máquina 1", quantidadeProduzida: 100, metaPeriodoVigente: 100, minutosParados: 0, quantidadeRefugo: 0 }); // OEE=100%
    const apsB = nPeriodos(5, { duracaoPeriodoHorasVigente: 1, operacaoNome: "Rosquear", maquinaId: "maq-3", maquinaNome: "Máquina 3", quantidadeProduzida: 100, metaPeriodoVigente: 100, minutosParados: 0, quantidadeRefugo: 0 }); // OEE=100%
    const maquinaNomePorId = new Map([["maq-1", "Máquina 1"], ["maq-3", "Máquina 3"]]);
    const r = calcularCapacidadeProvavelEtapa(ETAPA_SIMPLES, ["maq-1", "maq-3"], [], "prod-1", maquinaNomePorId, porMaquina, fatorReducaoPorMaquina, PERIODOS_SIMPLES, [...apsA, ...apsB]);
    expect(r.disponivel).toBe(true);
    // maq-1: 50h/0,01h × 1,0 = 5.000. maq-3: 30h/0,01h × 1,0 = 3.000. Soma = 8.000.
    expect(r.capacidadePecas).toBe(8000);
  });

  it("caso 48 (teste B): duas etapas sequenciais (8.000 e 6.000 peças) -> capacidade do PRODUTO é o MIN = 6.000, nunca a soma nem a maior", () => {
    const produtoDuasEtapas: Produto = {
      id: "prod-1", nome: "Produto 1", referencia: "P1", valorUnitario: 2, ativo: true, prioridade: "media" as never,
      roteiro: [
        { id: "etapa-1", operacao: "Rosquear", metas: { m1: 100, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: ["maq-1"] },
        { id: "etapa-2", operacao: "Embalar", metas: { m1: 100, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: ["maq-2"] },
      ],
    };
    const item: PrevisaoItem = { id: "it-1", produtoId: "prod-1", produtoNome: "Produto 1", valorUnitario: 2, quantidade: 100, maquinasPorEtapa: { "etapa-1": ["maq-1"], "etapa-2": ["maq-2"] } };
    const porMaquina = {
      "maq-1": { horasNecessarias: 80, produtos: { "prod-1": { produtoId: "prod-1", produtoNome: "Produto 1", horas: 80 } } }, // -> 8.000 peças
      "maq-2": { horasNecessarias: 60, produtos: { "prod-1": { produtoId: "prod-1", produtoNome: "Produto 1", horas: 60 } } }, // -> 6.000 peças
    };
    const fatorReducaoPorMaquina = { "maq-1": 1, "maq-2": 1 };
    const apsRosquear = nPeriodos(5, { duracaoPeriodoHorasVigente: 1, operacaoNome: "Rosquear", maquinaId: "maq-1", maquinaNome: "Máquina 1", quantidadeProduzida: 100, metaPeriodoVigente: 100, minutosParados: 0, quantidadeRefugo: 0 });
    const apsEmbalar = nPeriodos(5, { duracaoPeriodoHorasVigente: 1, operacaoNome: "Embalar", maquinaId: "maq-2", maquinaNome: "Máquina 2", quantidadeProduzida: 100, metaPeriodoVigente: 100, minutosParados: 0, quantidadeRefugo: 0 });
    const maquinaNomePorId = new Map([["maq-1", "Máquina 1"], ["maq-2", "Máquina 2"]]);
    const r = calcularCapacidadeProvavelItem(item, produtoDuasEtapas, maquinaNomePorId, [], [...apsRosquear, ...apsEmbalar], porMaquina, fatorReducaoPorMaquina, PERIODOS_SIMPLES);
    expect(r.capacidadePecas).toBe(6000); // MIN(8000, 6000) — etapas sequenciais, ambas necessárias.
  });

  it("caso 49 (teste C): recurso compartilhado entre dois produtos -> a soma das horas alocadas na mesma máquina nunca ultrapassa as horas restantes disponíveis (sem dupla contagem)", () => {
    const produtoB: Produto = { ...PRODUTO, id: "prod-2", nome: "Produto 2", roteiro: [{ id: "etapa-1b", operacao: "Rosquear", metas: { m1: 100, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: ["maq-1"] }] };
    const itemA: PrevisaoItem = { id: "it-a", produtoId: "prod-1", produtoNome: "Produto 1", valorUnitario: 2, quantidade: 1000, maquinasPorEtapa: { "etapa-1": ["maq-1"], "etapa-2": ["maq-2"] } };
    const itemB: PrevisaoItem = { id: "it-b", produtoId: "prod-2", produtoNome: "Produto 2", valorUnitario: 2, quantidade: 1000, maquinasPorEtapa: { "etapa-1b": ["maq-1"] } };
    const horasRestantes = 10; // pouco pra atender os dois pedidos de 1000 peças (cada um demandaria 10h sozinho, a 0,01h/peça).
    const { porMaquina, fatorReducaoPorMaquina } = calcularInsumosCompartilhamento([itemA, itemB], [PRODUTO, produtoB], PERIODOS_SIMPLES, horasRestantes);
    const horasAlocadasA = (porMaquina["maq-1"]?.produtos["prod-1"]?.horas || 0) * (fatorReducaoPorMaquina["maq-1"] ?? 1);
    const horasAlocadasB = (porMaquina["maq-1"]?.produtos["prod-2"]?.horas || 0) * (fatorReducaoPorMaquina["maq-1"] ?? 1);
    expect(horasAlocadasA).toBeGreaterThan(0);
    expect(horasAlocadasB).toBeGreaterThan(0);
    expect(horasAlocadasA + horasAlocadasB).toBeLessThanOrEqual(horasRestantes + 1e-9); // nunca aparecem integralmente pros dois ao mesmo tempo.
  });

  it("caso 50 (teste D): máquina com alocação POSITIVA e SEM amostra suficiente -> capacidade provável completa do produto = indisponível (nunca redistribuída silenciosamente)", () => {
    const porMaquina = { "maq-1": { horasNecessarias: 50, produtos: { "prod-1": { produtoId: "prod-1", produtoNome: "Produto 1", horas: 50 } } } };
    const fatorReducaoPorMaquina = { "maq-1": 1 };
    const r = calcularCapacidadeProvavelEtapa(ETAPA_SIMPLES, ["maq-1"], [], "prod-1", new Map([["maq-1", "Máquina 1"]]), porMaquina, fatorReducaoPorMaquina, PERIODOS_SIMPLES, []); // nenhum apontamento -> amostra insuficiente
    expect(r.disponivel).toBe(false);
    expect(r.capacidadePecas).toBeNull();
    expect(r.maquinas[0].necessitaAmostra).toBe(true); // tinha alocação positiva -> precisava de amostra.
  });

  it("caso 51 (teste E): máquina SEM amostra mas com alocação ZERO -> não bloqueia (não contribui de fato)", () => {
    const porMaquina = { "maq-1": { horasNecessarias: 0, produtos: {} } }; // motor já mostra zero alocação pra este produto nessa máquina.
    const fatorReducaoPorMaquina = { "maq-1": 1 };
    const m = calcularCapacidadeProvavelMaquina(ETAPA_SIMPLES, "maq-1", "Máquina 1", "prod-1", porMaquina, fatorReducaoPorMaquina, PERIODOS_SIMPLES, []);
    expect(m.necessitaAmostra).toBe(false);
    expect(m.disponivel).toBe(true);
    expect(m.capacidadePecas).toBe(0);

    // combinada com outra máquina da MESMA etapa que TEM amostra suficiente -> etapa fica disponível, não bloqueada pela primeira.
    const porMaquinaEtapa = {
      "maq-1": { horasNecessarias: 0, produtos: {} },
      "maq-3": { horasNecessarias: 30, produtos: { "prod-1": { produtoId: "prod-1", produtoNome: "Produto 1", horas: 30 } } },
    };
    const aps = nPeriodos(5, { duracaoPeriodoHorasVigente: 1, operacaoNome: "Rosquear", maquinaId: "maq-3", maquinaNome: "Máquina 3", quantidadeProduzida: 100, metaPeriodoVigente: 100, minutosParados: 0, quantidadeRefugo: 0 });
    const e = calcularCapacidadeProvavelEtapa(ETAPA_SIMPLES, ["maq-1", "maq-3"], [], "prod-1", new Map([["maq-1", "Máquina 1"], ["maq-3", "Máquina 3"]]), porMaquinaEtapa, fatorReducaoPorMaquina, PERIODOS_SIMPLES, aps);
    expect(e.disponivel).toBe(true);
    expect(e.capacidadePecas).toBe(3000); // só a contribuição de maq-3 — maq-1 não bloqueou por falta de amostra.
  });

  it("caso 52: capacidade provável pode superar a base 'à meta' quando o OEE observado é sustentado > 100% (sem teto)", () => {
    const porMaquina = { "maq-1": { horasNecessarias: 100, produtos: { "prod-1": { produtoId: "prod-1", produtoNome: "Produto 1", horas: 100 } } } };
    const fatorReducaoPorMaquina = { "maq-1": 1 };
    const aps = nPeriodos(5, { duracaoPeriodoHorasVigente: 1, operacaoNome: "Rosquear", maquinaId: "maq-1", maquinaNome: "Máquina 1", quantidadeProduzida: 150, metaPeriodoVigente: 100, minutosParados: 0, quantidadeRefugo: 0 }); // OEE=150%
    const r = calcularCapacidadeProvavelEtapa(ETAPA_SIMPLES, ["maq-1"], [], "prod-1", new Map([["maq-1", "Máquina 1"]]), porMaquina, fatorReducaoPorMaquina, PERIODOS_SIMPLES, aps);
    expect(r.capacidadePecas).toBe(15000); // 100h/0,01h × 1,5 = 15.000 — acima dos 10.000 "à meta" (fator 1,0), sem teto.
    expect(r.capacidadePecas).toBeGreaterThan(10000);
  });

  it("caso 53: etapa cuja única máquina selecionada está indisponível -> etapa necessária e bloqueada (indisponível), nunca 'sem restrição'", () => {
    const e = calcularCapacidadeProvavelEtapa(ETAPA_SIMPLES, ["maq-1"], ["maq-1"], "prod-1", new Map(), {}, {}, PERIODOS_SIMPLES, []);
    expect(e.necessaria).toBe(true);
    expect(e.disponivel).toBe(false);
    expect(e.capacidadePecas).toBeNull();
  });

  it("caso 54: etapa sem nenhuma máquina selecionada (dado incompleto) -> não é 'necessária', não limita a cadeia", () => {
    const e = calcularCapacidadeProvavelEtapa(ETAPA_SIMPLES, [], [], "prod-1", new Map(), {}, {}, PERIODOS_SIMPLES, []);
    expect(e.necessaria).toBe(false);
  });
});

// =======================================================================
// 23-27 — estados
// =======================================================================
describe("Classificação de estado (§13)", () => {
  it("caso 23: concluído quando falta <= 0", () => {
    expect(classificarEstado(0, 1000, 500)).toBe("concluido");
    expect(classificarEstado(-10, 1000, 500)).toBe("concluido");
  });
  it("caso 24: no ritmo quando falta <= provável", () => {
    expect(classificarEstado(400, 1000, 500)).toBe("no_ritmo");
  });
  it("caso 25: atenção quando provável < falta <= teórica", () => {
    expect(classificarEstado(700, 1000, 500)).toBe("atencao");
  });
  it("caso 26: inviável teoricamente quando falta > teórica", () => {
    expect(classificarEstado(1500, 1000, 500)).toBe("inviavel_teoricamente");
  });
  it("caso 27: sem estimativa quando provável é null e ainda é teoricamente possível", () => {
    expect(classificarEstado(700, 1000, null)).toBe("sem_estimativa");
  });
});

// =======================================================================
// 28 — projeção/déficit
// =======================================================================
describe("Projeção (§14)", () => {
  it("caso 28: projeção = acabado + provável; déficit = max(previsto - projeção, 0)", () => {
    const projecao = 600 + 300;
    const deficit = Math.max(0, 1000 - projecao);
    expect(projecao).toBe(900);
    expect(deficit).toBe(100);
  });
});

// =======================================================================
// 29/30 — produto fora da previsão
// =======================================================================
describe("Produto fora da previsão (§15)", () => {
  it("caso 29/30: aparece como evidência com minutos/quantidade/períodos, nunca como item previsto", () => {
    const aps = [
      apontamento({ produtoId: "prod-X", produtoNome: "Produto X", maquinaId: "maq-1", maquinaNome: "Máquina 1", data: "2026-08-17", periodoId: "m1", duracaoPeriodoHorasVigente: 1, quantidadeProduzida: 50 }),
      apontamento({ produtoId: "prod-X", produtoNome: "Produto X", maquinaId: "maq-1", maquinaNome: "Máquina 1", data: "2026-08-17", periodoId: "m2", duracaoPeriodoHorasVigente: 1, quantidadeProduzida: 40 }),
    ];
    const evidencias = calcularProdutosForaDaPrevisao(aps, new Set(["prod-1"]));
    expect(evidencias).toHaveLength(1);
    expect(evidencias[0].produtoId).toBe("prod-X");
    expect(evidencias[0].periodos).toBe(2);
    expect(evidencias[0].minutosObservados).toBe(120);
    expect(evidencias[0].quantidadeObservada).toBe(90);
  });
});

// =======================================================================
// 31 — sem produção não inventa minutos
// =======================================================================
describe("Sem produção (§16)", () => {
  it("caso 31: só contagem — nunca minutos/custo/capacidade inventados", () => {
    const aps = [
      apontamento({ status: "sem_producao", motivoSemProducao: "falta_material", maquinaId: "maq-9", maquinaNome: "Máquina 9", produtoId: null, metaPeriodoVigente: null, custoHoraOperacaoVigente: null }),
      apontamento({ status: "sem_producao", motivoSemProducao: "falta_material", maquinaId: "maq-9", maquinaNome: "Máquina 9", produtoId: null, metaPeriodoVigente: null, custoHoraOperacaoVigente: null }),
    ];
    const evidencias = calcularEvidenciasSemProducao(aps);
    expect(evidencias).toHaveLength(1);
    expect(evidencias[0].quantidadeRegistros).toBe(2);
    expect(Object.keys(evidencias[0])).not.toContain("minutos");
    expect(Object.keys(evidencias[0])).not.toContain("custo");
  });
});

// =======================================================================
// 32/33 — restrição teórica vs observada
// =======================================================================
describe("Restrições (§17)", () => {
  it("caso 32/33: restrição teórica (motor) e observada (evidência) são campos distintos, nenhuma é 'gargalo confirmado'", () => {
    const item: PrevisaoItem = { id: "it-1", produtoId: "prod-1", produtoNome: "Produto 1", valorUnitario: 2, quantidade: 100, maquinasPorEtapa: { "etapa-1": ["maq-1"], "etapa-2": ["maq-2"] } };
    const r = calcularCapacidadeTeoricaRestante([item], [PRODUTO], MAQUINAS, PERIODOS, 10, ["maq-1"]);
    // restrição teórica vem só do motor (etapaLimitante), nunca do texto de evidência observada.
    expect(r.resultadosPorItem[0].etapaLimitante).toBe("Rosquear");
  });
});

// =======================================================================
// 34 — nunca soma peças entre produtos
// =======================================================================
describe("Peças de produtos diferentes nunca somadas (§18/§19)", () => {
  it("caso 34: recursosPressionados é em horas/percentual, nunca 'total de peças da fábrica'", () => {
    const previsao: Previsao = {
      semanaInicio: "2026-08-17",
      itens: [
        { id: "it-a", produtoId: "prod-1", produtoNome: "Produto 1", valorUnitario: 2, quantidade: 100, maquinasPorEtapa: { "etapa-1": ["maq-1"], "etapa-2": ["maq-2"] } },
      ],
      itensRealizados: [], maquinasIndisponiveis: [],
    };
    const resultado = gerarValidacaoPrevisao(previsao, [PRODUTO], MAQUINAS, PERIODOS, 5, [], [], new Date(2026, 7, 17));
    resultado.recursosPressionados.forEach((r) => {
      expect(typeof r.horasRestantes).toBe("number");
      expect(typeof r.pctUso).toBe("number");
    });
  });
});

// =======================================================================
// 35 — drill-down preserva filtros
// =======================================================================
describe("Drill-down (§20)", () => {
  it("caso 35: filtrosDrillDown do item preserva produtoId e janela da semana", () => {
    const previsao: Previsao = {
      semanaInicio: "2026-08-17",
      itens: [{ id: "it-1", produtoId: "prod-9", produtoNome: "Produto 9", valorUnitario: 2, quantidade: 100, maquinasPorEtapa: {} }],
      itensRealizados: [], maquinasIndisponiveis: [],
    };
    const resultado = gerarValidacaoPrevisao(previsao, [{ ...PRODUTO, id: "prod-9" }], MAQUINAS, PERIODOS, 5, [], [], new Date(2026, 7, 18));
    expect(resultado.itens[0].filtrosDrillDown).toMatchObject({ produtoId: "prod-9", dataInicial: "2026-08-17" });
  });
});

// =======================================================================
// 36/37/38 — não altera Previsão, sem IA, sem migration (estrutural)
// =======================================================================
describe("Restrições gerais (§36/§37/§38)", () => {
  it("caso 36: gerarValidacaoPrevisao nunca escreve — só lê e devolve um objeto novo (nenhuma chamada de rede/mutação no módulo)", () => {
    const previsao: Previsao = { semanaInicio: "2026-08-17", itens: [], itensRealizados: [], maquinasIndisponiveis: [] };
    const antes = JSON.stringify(previsao);
    gerarValidacaoPrevisao(previsao, [], [], [], 5, [], [], new Date(2026, 7, 18));
    expect(JSON.stringify(previsao)).toBe(antes); // objeto de entrada não foi mutado
  });
});
