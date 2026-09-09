import { describe, it, expect } from "vitest";
import {
  calcularCustoTempoOciosoParada, calcularCapacidadePerdidaParada, calcularResumoParadas,
  calcularParetoParadasPorMetrica, calcularRecorrenciaParadas, calcularComparativoTendenciaParadas,
  calcularSemProducaoResumo,
  calcularCapacidadePerdidaTrecho, agruparParadasPorOcorrencia,
  type ParadaComContexto, type TrechoOcorrenciaSemApontamento,
} from "@/features/producao-real/paradas/calculations";
import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";

function apontamento(over: Partial<ApontamentoIndicador> & Pick<ApontamentoIndicador, "apontamentoId">): ApontamentoIndicador {
  return {
    data: "2026-09-01",
    periodoId: "m1",
    periodoNome: "M1",
    status: "produzindo",
    motivoSemProducao: null,
    produtoId: "prod-1",
    produtoNome: "Produto 1",
    maquinaId: "maq-1",
    maquinaNome: "Máquina 1",
    operacaoId: "op-1",
    operacaoNome: "Operação 1",
    funcionarioId: "func-1",
    funcionarioNome: "Funcionário 1",
    etapaId: "etapa-1",
    etapaOrdem: 0,
    isUltimaEtapa: true,
    quantidadeProduzida: 100,
    quantidadeRefugo: 0,
    metaPeriodoVigente: 100,
    duracaoPeriodoHorasVigente: 1,
    minutosParados: 0,
    custoHoraOperacaoVigente: 60,
    custoOperacionalPeriodoVigente: 60,
    custoUnitarioReferenciaPeriodoVigente: 0.6,
    produtoValorUnitario: 2,
    etapaMaquinasElegiveis: 1,
    ...over,
  };
}

function parada(over: Partial<ParadaComContexto> & Pick<ParadaComContexto, "paradaId" | "apontamentoId">): ParadaComContexto {
  return {
    data: "2026-09-01",
    periodoId: "m1",
    minutos: 10,
    motivoId: "motivo-1",
    motivoNome: "Setup",
    motivoCategoria: "operacional",
    origem: "manual",
    produtoId: "prod-1",
    produtoNome: "Produto 1",
    maquinaId: "maq-1",
    maquinaNome: "Máquina 1",
    operacaoId: "op-1",
    operacaoNome: "Operação 1",
    funcionarioId: "func-1",
    funcionarioNome: "Funcionário 1",
    custoHoraOperacaoVigente: 60, // R$60/h -> R$1/min
    metaPeriodoVigente: 120, // meta 120/h
    duracaoPeriodoHorasVigente: 1, // 60 min
    descricaoProblema: null,
    descricaoSolucao: null,
    ocorrenciaId: null,
    ocorrenciaAbertaEm: null,
    ocorrenciaEncerradaEm: null,
    ...over,
  };
}

// ---- Caso 1/2/3 — manual, ocorrência, ambas sem duplicação ----
describe("Caso 1/2/3 — manual e ocorrência unificadas sem duplicar", () => {
  it("parada manual e ocorrência no mesmo apontamento somam corretamente, sem duplicar", () => {
    const manual = parada({ paradaId: "p1", apontamentoId: "a1", origem: "manual", minutos: 10 });
    const ocorrencia = parada({ paradaId: "p2", apontamentoId: "a1", origem: "ocorrencia", minutos: 15, motivoId: "motivo-2", motivoNome: "Quebra" });
    const ap = apontamento({ apontamentoId: "a1" });
    const resumo = calcularResumoParadas([manual, ocorrencia], [ap]);
    expect(resumo.minutosParadosTotal).toBe(25);
    expect(resumo.quantidadeParadas).toBe(2);
  });
});

// ---- Caso 4 — duas paradas de motivos diferentes no mesmo período ----
describe("Caso 4 — motivos diferentes no mesmo apontamento/período", () => {
  it("Pareto separa corretamente por motivo, sem misturar", () => {
    const p1 = parada({ paradaId: "p1", apontamentoId: "a1", motivoId: "m-ferramenta", motivoNome: "Ferramenta", minutos: 10 });
    const p2 = parada({ paradaId: "p2", apontamentoId: "a1", motivoId: "m-regulagem", motivoNome: "Regulagem", minutos: 20 });
    const pareto = calcularParetoParadasPorMetrica([p1, p2], "minutos");
    expect(pareto).toHaveLength(2);
    expect(pareto[0].motivoNome).toBe("Regulagem"); // maior minutos primeiro
    expect(pareto[0].minutos).toBe(20);
    expect(pareto[1].minutos).toBe(10);
  });
});

// ---- Caso 5 — rateio exato de custo ----
describe("Caso 5 — rateio exato de custo do tempo ocioso por parada", () => {
  it("custo = custo_hora × minutos/60, usando o snapshot do apontamento pai", () => {
    const p = parada({ paradaId: "p1", apontamentoId: "a1", custoHoraOperacaoVigente: 60, minutos: 15 });
    expect(calcularCustoTempoOciosoParada(p)).toBeCloseTo(60 * (15 / 60), 6); // R$15
  });

  it("apontamento com 2 paradas de motivos diferentes: custo rateado soma exatamente o custo total do apontamento", () => {
    const p1 = parada({ paradaId: "p1", apontamentoId: "a1", custoHoraOperacaoVigente: 60, minutos: 10 });
    const p2 = parada({ paradaId: "p2", apontamentoId: "a1", custoHoraOperacaoVigente: 60, minutos: 20 });
    const custoTotal = calcularCustoTempoOciosoParada(p1)! + calcularCustoTempoOciosoParada(p2)!;
    expect(custoTotal).toBeCloseTo(60 * (30 / 60), 6); // equivalente a aplicar a fórmula na soma dos 30 min
  });
});

// ---- Caso 6 — rateio exato de capacidade ----
describe("Caso 6 — rateio exato de capacidade local perdida por parada", () => {
  it("capacidade perdida = (meta/duração_min) × minutos_parada", () => {
    // meta 120/h, duração 60min -> 2 peças/min. 15 min parado -> 30 peças
    const p = parada({ paradaId: "p1", apontamentoId: "a1", metaPeriodoVigente: 120, duracaoPeriodoHorasVigente: 1, minutos: 15 });
    expect(calcularCapacidadePerdidaParada(p)).toBeCloseTo((120 / 60) * 15, 6);
  });
});

// ---- Caso 7/8/9/10 — Pareto por cada métrica ----
describe("Caso 7/8/9/10 — Pareto por minutos/quantidade/custo/capacidade", () => {
  const p1 = parada({ paradaId: "p1", apontamentoId: "a1", motivoId: "m1", motivoNome: "A", minutos: 10, custoHoraOperacaoVigente: 60, metaPeriodoVigente: 120, duracaoPeriodoHorasVigente: 1 });
  const p2 = parada({ paradaId: "p2", apontamentoId: "a2", motivoId: "m1", motivoNome: "A", minutos: 10, custoHoraOperacaoVigente: 60, metaPeriodoVigente: 120, duracaoPeriodoHorasVigente: 1 });
  const p3 = parada({ paradaId: "p3", apontamentoId: "a3", motivoId: "m2", motivoNome: "B", minutos: 15, custoHoraOperacaoVigente: 60, metaPeriodoVigente: 120, duracaoPeriodoHorasVigente: 1 });

  it("por minutos: motivo B (15min, 1 ocorrência) vs motivo A (20min, 2 ocorrências) -> A na frente por minutos totais", () => {
    const pareto = calcularParetoParadasPorMetrica([p1, p2, p3], "minutos");
    expect(pareto[0].motivoNome).toBe("A"); // 20 min > 15 min
  });

  it("por quantidade: motivo A tem 2 ocorrências vs 1 de B", () => {
    const pareto = calcularParetoParadasPorMetrica([p1, p2, p3], "quantidade");
    expect(pareto[0].motivoNome).toBe("A");
    expect(pareto[0].quantidadeParadas).toBe(2);
  });

  it("por custo: ordena pelo custo do tempo ocioso somado", () => {
    const pareto = calcularParetoParadasPorMetrica([p1, p2, p3], "custo");
    expect(pareto[0].baseConfiavel).toBe(true);
    // A: 2×(60×10/60)=20; B: 60×15/60=15 -> A na frente
    expect(pareto[0].motivoNome).toBe("A");
  });

  it("por capacidade: ordena pela capacidade perdida somada", () => {
    const pareto = calcularParetoParadasPorMetrica([p1, p2, p3], "capacidade");
    expect(pareto[0].baseConfiavel).toBe(true);
    expect(pareto[0].motivoNome).toBe("A");
  });

  it("motivo sem base confiável de custo/capacidade marca baseConfiavel=false, não inventa 0 enganoso", () => {
    const semSnapshot = parada({ paradaId: "p4", apontamentoId: "a4", motivoId: "m3", motivoNome: "C", minutos: 5, custoHoraOperacaoVigente: null, metaPeriodoVigente: null, duracaoPeriodoHorasVigente: null });
    const pareto = calcularParetoParadasPorMetrica([semSnapshot], "custo");
    expect(pareto[0].baseConfiavel).toBe(false);
  });
});

// ---- Caso 11/12 — recorrência ----
describe("Caso 11/12 — recorrência usando períodos distintos (data+período)", () => {
  it("3 paradas do mesmo motivo no MESMO período contam como 1 período afetado", () => {
    const p1 = parada({ paradaId: "p1", apontamentoId: "a1", maquinaId: "maq-x", maquinaNome: "Máquina X", motivoId: "m-ferramenta", motivoNome: "Ferramenta", data: "2026-09-01", periodoId: "m1" });
    const p2 = parada({ paradaId: "p2", apontamentoId: "a1", maquinaId: "maq-x", maquinaNome: "Máquina X", motivoId: "m-ferramenta", motivoNome: "Ferramenta", data: "2026-09-01", periodoId: "m1" });
    const p3 = parada({ paradaId: "p3", apontamentoId: "a1", maquinaId: "maq-x", maquinaNome: "Máquina X", motivoId: "m-ferramenta", motivoNome: "Ferramenta", data: "2026-09-01", periodoId: "m1" });
    const ap = apontamento({ apontamentoId: "a1", maquinaId: "maq-x", maquinaNome: "Máquina X", data: "2026-09-01", periodoId: "m1" });
    const recorrencia = calcularRecorrenciaParadas([p1, p2, p3], [ap]);
    expect(recorrencia).toHaveLength(1);
    expect(recorrencia[0].quantidadeParadas).toBe(3);
    expect(recorrencia[0].periodosDistintosAfetados).toBe(1); // não 3
  });

  it("mesmo motivo em 8 de 12 períodos apontados da máquina -> 8/12", () => {
    const paradasDe8Periodos: ParadaComContexto[] = [];
    const apontamentosDe12Periodos: ApontamentoIndicador[] = [];
    for (let i = 0; i < 12; i++) {
      const periodoId = `p${i}`;
      apontamentosDe12Periodos.push(apontamento({ apontamentoId: `ap${i}`, maquinaId: "maq-y", maquinaNome: "Máquina Y", data: "2026-09-01", periodoId }));
      if (i < 8) {
        paradasDe8Periodos.push(parada({ paradaId: `pp${i}`, apontamentoId: `ap${i}`, maquinaId: "maq-y", maquinaNome: "Máquina Y", motivoId: "m-ferramenta", motivoNome: "Ferramenta", data: "2026-09-01", periodoId }));
      }
    }
    const recorrencia = calcularRecorrenciaParadas(paradasDe8Periodos, apontamentosDe12Periodos);
    expect(recorrencia[0].periodosDistintosAfetados).toBe(8);
    expect(recorrencia[0].totalPeriodosApontadosMaquina).toBe(12);
    expect(recorrencia[0].percentualPeriodosAfetados).toBeCloseTo((8 / 12) * 100, 6);
  });
});

// ---- Caso 13 — tendência (semana atual vs anterior) ----
describe("Caso 13 — comparativo de tendência entre duas janelas", () => {
  it("calcula deltas corretamente entre janela atual e anterior", () => {
    const paradaAtual = parada({ paradaId: "p1", apontamentoId: "a1", minutos: 30 });
    const apAtual = apontamento({ apontamentoId: "a1" });
    const paradaAnterior = parada({ paradaId: "p2", apontamentoId: "a2", minutos: 10 });
    const apAnterior = apontamento({ apontamentoId: "a2" });

    const comparativo = calcularComparativoTendenciaParadas([paradaAtual], [apAtual], [paradaAnterior], [apAnterior]);
    expect(comparativo.deltaMinutos).toBe(20); // piorou 20 min
    expect(comparativo.deltaQuantidade).toBe(0); // 1 parada em cada janela
  });
});

// ---- Caso 16 — sem produção separado ----
describe("Caso 16 — sem produção nunca entra no Pareto/resumo de paradas", () => {
  it("calcularSemProducaoResumo só conta registros explícitos, por motivo/máquina/período", () => {
    const semProducao1 = apontamento({
      apontamentoId: "sp1", status: "sem_producao", motivoSemProducao: "falta_material",
      produtoId: null, produtoNome: null, etapaId: null, etapaOrdem: null, isUltimaEtapa: null,
      operacaoId: null, funcionarioId: null, quantidadeProduzida: 0, quantidadeRefugo: 0,
      metaPeriodoVigente: null, custoHoraOperacaoVigente: null, custoOperacionalPeriodoVigente: null,
      custoUnitarioReferenciaPeriodoVigente: null, produtoValorUnitario: null,
    });
    const produzindo = apontamento({ apontamentoId: "a1" });
    const resumo = calcularSemProducaoResumo([semProducao1, produzindo]);
    expect(resumo.totalRegistros).toBe(1);
    expect(resumo.porMotivo).toEqual([{ chave: "falta_material", rotulo: "Falta de material", quantidade: 1 }]);
  });
});

// ---- Caso 17 — N/A em vez de inventar ----
describe("Caso 17 — divisão inválida/dado faltante retorna N/A (null), nunca inventa", () => {
  it("custo do tempo ocioso null quando custo_hora_operacao_vigente é null", () => {
    const p = parada({ paradaId: "p1", apontamentoId: "a1", custoHoraOperacaoVigente: null });
    expect(calcularCustoTempoOciosoParada(p)).toBeNull();
  });

  it("capacidade perdida null quando meta ou duração são null/zero", () => {
    const semMeta = parada({ paradaId: "p1", apontamentoId: "a1", metaPeriodoVigente: null });
    const duracaoZero = parada({ paradaId: "p2", apontamentoId: "a2", duracaoPeriodoHorasVigente: 0 });
    expect(calcularCapacidadePerdidaParada(semMeta)).toBeNull();
    expect(calcularCapacidadePerdidaParada(duracaoZero)).toBeNull();
  });

  it("resumo com 0 apontamentos produzindo -> pctTempoApontadoPerdido null, não Infinity", () => {
    const p = parada({ paradaId: "p1", apontamentoId: "a1" });
    const resumo = calcularResumoParadas([p], []);
    expect(resumo.pctTempoApontadoPerdido).toBeNull();
  });

  it("resumo sem paradas -> duração média e maior parada null, não 0/NaN inventados", () => {
    const resumo = calcularResumoParadas([], []);
    expect(resumo.duracaoMediaMinutos).toBeNull();
    expect(resumo.maiorParadaMinutos).toBeNull();
    expect(resumo.custoTempoOciosoTotal).toBeNull();
    expect(resumo.capacidadePerdidaTotal).toBeNull();
  });
});

// ---- Caso 14 — filtro por origem (comportamento client-side simples) ----
describe("Caso 14 — filtro por origem separa manual de ocorrência sem perder dado", () => {
  it("filtrar por origem='manual' exclui as de ocorrência do resumo", () => {
    const manual = parada({ paradaId: "p1", apontamentoId: "a1", origem: "manual", minutos: 10 });
    const ocorrencia = parada({ paradaId: "p2", apontamentoId: "a1", origem: "ocorrencia", minutos: 15 });
    const todas = [manual, ocorrencia];
    const soManual = todas.filter((p) => p.origem === "manual");
    const resumo = calcularResumoParadas(soManual, [apontamento({ apontamentoId: "a1" })]);
    expect(resumo.minutosParadosTotal).toBe(10);
    expect(resumo.quantidadeParadas).toBe(1);
  });
});

// ---- Caso 18 — trecho estimado (ocorrência sem apontamento) ----
function trecho(over: Partial<TrechoOcorrenciaSemApontamento> & Pick<TrechoOcorrenciaSemApontamento, "ocorrenciaId" | "periodoId">): TrechoOcorrenciaSemApontamento {
  return {
    maquinaId: "maq-1",
    maquinaNome: "Máquina 1",
    motivoId: "motivo-1",
    motivoNome: "Quebra",
    motivoCategoria: "operacional",
    ocorrenciaAbertaEm: "2026-09-09T11:29:31.000Z",
    ocorrenciaEncerradaEm: "2026-09-09T12:05:08.000Z",
    descricaoProblema: "Sensor soltou",
    descricaoSolucao: "Trocado o sensor",
    trechoInicio: "2026-09-09T11:29:31.000Z",
    trechoFim: "2026-09-09T11:48:00.000Z",
    minutos: 18,
    duracaoPeriodoMinutos: 96,
    produtoEstimadoId: "prod-1",
    produtoEstimadoNome: "Produto 1",
    metaPeriodoEstimada: 1600,
    temEstimativa: true,
    ...over,
  };
}

describe("Caso 18 — trecho estimado de ocorrência sem apontamento", () => {
  it("capacidade do trecho usa meta real do produto estimado — nunca monetiza pelo valor do produto acabado", () => {
    const t = trecho({ ocorrenciaId: "oc-1", periodoId: "m1" });
    // capacidade = (1600/96)*18 = 300 peças — só isso, sem conversão pra R$
    expect(calcularCapacidadePerdidaTrecho(t)).toBeCloseTo(300, 5);
  });

  it("sem produto estimado (temEstimativa=false) -> capacidade null, nunca inventada", () => {
    const t = trecho({
      ocorrenciaId: "oc-1", periodoId: "m1",
      produtoEstimadoId: null, produtoEstimadoNome: null, metaPeriodoEstimada: null, temEstimativa: false,
    });
    expect(calcularCapacidadePerdidaTrecho(t)).toBeNull();
  });
});

// ---- Caso 19 — agrupamento por ocorrência (migration 34) ----
describe("Caso 19 — agruparParadasPorOcorrencia: uma ocorrência = um card", () => {
  it("ocorrência com 2 segmentos reais (M1+M2) vira 1 card, duração real (não soma arredondada)", () => {
    const abertaEm = "2026-09-09T11:29:31.259Z";
    const encerradaEm = "2026-09-09T12:05:08.998Z"; // ~35,63 min reais
    const segM1 = parada({
      paradaId: "seg-m1", apontamentoId: "ap-m1", origem: "ocorrencia", periodoId: "m1", minutos: 18,
      metaPeriodoVigente: 1600, duracaoPeriodoHorasVigente: 1.6, custoHoraOperacaoVigente: 60,
      ocorrenciaId: "oc-1", ocorrenciaAbertaEm: abertaEm, ocorrenciaEncerradaEm: encerradaEm,
      descricaoProblema: "Sensor soltou", descricaoSolucao: "Trocado o sensor",
    });
    const segM2 = parada({
      paradaId: "seg-m2", apontamentoId: "ap-m2", origem: "ocorrencia", periodoId: "m2", minutos: 17,
      metaPeriodoVigente: 1600, duracaoPeriodoHorasVigente: 1.6, custoHoraOperacaoVigente: 60,
      ocorrenciaId: "oc-1", ocorrenciaAbertaEm: abertaEm, ocorrenciaEncerradaEm: encerradaEm,
      descricaoProblema: "Sensor soltou", descricaoSolucao: "Trocado o sensor",
    });

    const grupos = agruparParadasPorOcorrencia([segM1, segM2], []);
    expect(grupos).toHaveLength(1);
    const g = grupos[0];
    expect(g.ocorrenciaId).toBe("oc-1");
    expect(g.segmentos).toHaveLength(2);
    // duração real: (encerradaEm - abertaEm) em minutos, não 18+17=35
    expect(g.duracaoTotalMinutos).toBeCloseTo(35.629, 2);
    expect(g.duracaoTotalMinutos).not.toBe(35);
    expect(g.temEstimativa).toBe(false);
    // capacidade: (1600/96)*18 + (1600/96)*17 = 300+283,33 = 583,33 — soma sem duplicar
    expect(g.capacidadePerdidaTotal).toBeCloseTo(583.33, 1);
    expect(g.custoTempoOciosoTotal).toBeCloseTo(60 * (18 / 60) + 60 * (17 / 60), 5);
  });

  it("ocorrência com 1 segmento real (M1) + 1 trecho estimado (M2) -> mesmo card, custo ocioso só do real, capacidade soma os dois", () => {
    const abertaEm = "2026-09-09T11:29:31.259Z";
    const encerradaEm = "2026-09-09T12:05:08.998Z";
    const segM1 = parada({
      paradaId: "seg-m1", apontamentoId: "ap-m1", origem: "ocorrencia", periodoId: "m1", minutos: 18,
      metaPeriodoVigente: 1600, duracaoPeriodoHorasVigente: 1.6, custoHoraOperacaoVigente: 60,
      ocorrenciaId: "oc-1", ocorrenciaAbertaEm: abertaEm, ocorrenciaEncerradaEm: encerradaEm,
      descricaoProblema: "Sensor soltou", descricaoSolucao: "Trocado o sensor",
    });
    const trechoM2 = trecho({ ocorrenciaId: "oc-1", periodoId: "m2", minutos: 17, ocorrenciaAbertaEm: abertaEm, ocorrenciaEncerradaEm: encerradaEm });

    const grupos = agruparParadasPorOcorrencia([segM1], [trechoM2]);
    expect(grupos).toHaveLength(1);
    const g = grupos[0];
    expect(g.segmentos).toHaveLength(2);
    expect(g.temEstimativa).toBe(true);
    expect(g.duracaoTotalMinutos).toBeCloseTo(35.629, 2);
    // custo ocioso só do segmento real (M1) — trecho estimado não tem custo/hora
    expect(g.custoTempoOciosoTotal).toBeCloseTo(60 * (18 / 60), 5);
    // capacidade perdida soma real (M1) + estimado (M2)
    const capEsperada = (1600 / 96) * 18 + calcularCapacidadePerdidaTrecho(trechoM2)!;
    expect(g.capacidadePerdidaTotal).toBeCloseTo(capEsperada, 1);
  });

  it("duas ocorrências diferentes nunca se misturam num único card", () => {
    const seg1 = parada({ paradaId: "s1", apontamentoId: "a1", origem: "ocorrencia", ocorrenciaId: "oc-1", ocorrenciaAbertaEm: "2026-09-09T10:00:00Z", ocorrenciaEncerradaEm: "2026-09-09T10:10:00Z" });
    const seg2 = parada({ paradaId: "s2", apontamentoId: "a2", origem: "ocorrencia", ocorrenciaId: "oc-2", ocorrenciaAbertaEm: "2026-09-09T14:00:00Z", ocorrenciaEncerradaEm: "2026-09-09T14:20:00Z" });
    const grupos = agruparParadasPorOcorrencia([seg1, seg2], []);
    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.ocorrenciaId).sort()).toEqual(["oc-1", "oc-2"]);
  });

  it("paradas manuais (sem ocorrenciaId) não geram card — devem ser filtradas antes de chamar a função", () => {
    // ParadaComContexto de origem manual sempre tem ocorrenciaId null — a
    // função ignora silenciosamente (nada a agrupar), mas o padrão
    // correto (ver DrillDownParadasLista) é nunca passar paradas manuais
    // pra cá.
    const manual = parada({ paradaId: "p1", apontamentoId: "a1", origem: "manual", ocorrenciaId: null });
    const grupos = agruparParadasPorOcorrencia([manual], []);
    expect(grupos).toHaveLength(0);
  });

  it("ocorrência atravessando 3 períodos, cobertura só no 1º e no 3º: só o intervalo do meio vira trecho estimado, sem duplicar nem perder minuto", () => {
    const abertaEm = "2026-09-09T10:00:00.000Z";
    const encerradaEm = "2026-09-09T11:30:00.000Z"; // 90 min exatos, de propósito (sem ambiguidade de arredondamento)

    const segM1 = parada({
      paradaId: "seg-m1", apontamentoId: "ap-m1", origem: "ocorrencia", periodoId: "m1", minutos: 30,
      metaPeriodoVigente: 900, duracaoPeriodoHorasVigente: 1.6, custoHoraOperacaoVigente: 60,
      ocorrenciaId: "oc-3p", ocorrenciaAbertaEm: abertaEm, ocorrenciaEncerradaEm: encerradaEm,
      descricaoProblema: "Falha X", descricaoSolucao: "Reparo Y",
    });
    const trechoM2 = trecho({
      ocorrenciaId: "oc-3p", periodoId: "m2", minutos: 30, duracaoPeriodoMinutos: 96,
      ocorrenciaAbertaEm: abertaEm, ocorrenciaEncerradaEm: encerradaEm,
      metaPeriodoEstimada: 900,
    });
    const segM3 = parada({
      paradaId: "seg-m3", apontamentoId: "ap-m3", origem: "ocorrencia", periodoId: "m3", minutos: 30,
      metaPeriodoVigente: 900, duracaoPeriodoHorasVigente: 1.6, custoHoraOperacaoVigente: 60,
      ocorrenciaId: "oc-3p", ocorrenciaAbertaEm: abertaEm, ocorrenciaEncerradaEm: encerradaEm,
      descricaoProblema: "Falha X", descricaoSolucao: "Reparo Y",
    });

    // segM1/segM3 vêm de obter_paradas_producao (segmentos reais);
    // trechoM2 vem de obter_trechos_ocorrencia_sem_apontamento (só o
    // período do meio, que é o único sem apontamento) — a mesma
    // reconstrução que a RPC faria fatiando pelo catálogo de períodos.
    const grupos = agruparParadasPorOcorrencia([segM1, segM3], [trechoM2]);

    expect(grupos).toHaveLength(1); // 1 única ocorrência, nunca 3
    const g = grupos[0];

    expect(g.segmentos).toHaveLength(3);
    expect(g.segmentos.map((s) => s.periodoId)).toEqual(["m1", "m2", "m3"]);
    expect(g.segmentos.filter((s) => s.real).map((s) => s.periodoId)).toEqual(["m1", "m3"]);
    expect(g.segmentos.filter((s) => !s.real).map((s) => s.periodoId)).toEqual(["m2"]); // só o intervalo realmente descoberto
    expect(g.temEstimativa).toBe(true);

    // duração total vem da janela real da ocorrência, não da soma dos
    // segmentos (mesma checagem do caso Rosqueadeira 3, agora com 3
    // segmentos em vez de 2)
    expect(g.duracaoTotalMinutos).toBeCloseTo(90, 5);

    // soma dos minutos dos 3 segmentos (cobertura real + trecho sem
    // cobertura) corresponde à janela temporal real — desconsiderando só
    // a regra de arredondamento de exibição (aqui os números foram
    // escolhidos exatos, então a tolerância é praticamente zero)
    const somaMinutosSegmentos = g.segmentos.reduce((soma, s) => soma + s.minutos, 0);
    expect(somaMinutosSegmentos).toBeCloseTo(g.duracaoTotalMinutos, 5);

    // capacidade perdida soma os 3 segmentos, sem duplicar — (900/96)*30
    // por segmento × 3
    expect(g.capacidadePerdidaTotal).toBeCloseTo((900 / 96) * 30 * 3, 1);

    // custo do tempo ocioso só soma os 2 segmentos REAIS (m1+m3) — o
    // trecho estimado (m2) não entra
    expect(g.custoTempoOciosoTotal).toBeCloseTo(60 * (30 / 60) * 2, 5);
  });
});
