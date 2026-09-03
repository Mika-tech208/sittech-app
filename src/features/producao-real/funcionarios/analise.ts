// Funcionários V1 — motor de análise. COMPARAÇÃO + REGRA DE DECISÃO por
// cima de fórmulas já existentes (Indicadores V1, Motor Econômico V1,
// Paradas V1) — nenhuma fórmula oficial recalculada. Reaproveita
// literalmente `classificarMagnitudePercentual`/`calcularPersistencia` de
// Desvios V1 — não redefine magnitude/persistência com outro sentido.
//
// Sinais de atenção/destaque SOMENTE de Performance e Qualidade (§9,
// aprovado) — paradas/economia entram só como evidência contextual,
// nunca geram card autônomo.

import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import { calcularPerformanceAgregada, calcularResumoIndicadores, calcularQuantidadeBoaApontamento } from "@/features/producao-real/indicadores/calculations";
import { calcularResumoEconomico, calcularMargemProcessamento, calcularDiferencaCustoTeoricoObservadoApontamento } from "@/features/producao-real/indicadores/economico";
import { calcularResumoParadas, calcularParetoParadasPorMetrica, calcularRecorrenciaParadas, type ParadaComContexto } from "@/features/producao-real/paradas/calculations";
import { classificarMagnitudePercentual, calcularPersistencia } from "@/features/producao-real/desvios/severidade";
import { avaliarAmostraSimples, avaliarAmostraQualidade } from "@/features/producao-real/funcionarios/amostra";
import {
  AMOSTRA_MINIMA_FUNCIONARIO_PERIODOS, AMOSTRA_MINIMA_FUNCIONARIO_MINUTOS,
  AMOSTRA_MINIMA_PARES_PERIODOS, AMOSTRA_MINIMA_PARES_MINUTOS,
} from "@/features/producao-real/funcionarios/thresholds";
import { rotuloContextoFuncionario, type GrupoContextoFuncionario } from "@/features/producao-real/funcionarios/contexto";
import type {
  AnaliseFuncionarioContexto, ContextoFuncionario, Evidencia, Janela, MetricaFuncionario, SinalFuncionario,
} from "@/features/producao-real/funcionarios/types";

function idSinal(funcionarioId: string, contexto: ContextoFuncionario, metrica: MetricaFuncionario, janela: Janela): string {
  return ["funcionario", funcionarioId, contexto.produtoId, contexto.operacaoId, contexto.maquinaId, metrica, janela.dataInicial, janela.dataFinal].join(":");
}

function filtrosDrillDown(contexto: ContextoFuncionario, funcionarioId: string, janela: Janela) {
  return {
    dataInicial: janela.dataInicial, dataFinal: janela.dataFinal,
    produtoId: contexto.produtoId, maquinaId: contexto.maquinaId, operacaoId: contexto.operacaoId,
    funcionarioId,
  };
}

// direcaoMaiorEhMelhor=true pra Performance/Qualidade (ambas "quanto
// maior, melhor" nas fórmulas oficiais). Nunca capa em 100% — só reporta
// o delta bruto.
function avaliarDelta(valorFuncionario: number, valorReferencia: number) {
  const deltaAbsoluto = valorFuncionario - valorReferencia;
  const deltaPercentual = valorReferencia !== 0 ? (deltaAbsoluto / Math.abs(valorReferencia)) * 100 : null;
  const magnitudePct = deltaPercentual !== null ? Math.abs(deltaPercentual) : (deltaAbsoluto !== 0 ? 100 : 0);
  return {
    deltaAbsoluto, deltaPercentual,
    pior: deltaAbsoluto < 0,
    melhor: deltaAbsoluto > 0,
    magnitude: classificarMagnitudePercentual(magnitudePct),
  };
}

function montarEvidenciaMudancaFuncionario(): Evidencia[] {
  return [];
}

function construirSinal(
  funcionarioId: string, funcionarioNome: string, contexto: ContextoFuncionario, janela: Janela,
  metrica: MetricaFuncionario, valorFuncionario: number, referenciaTipo: SinalFuncionario["referenciaTipo"], valorReferencia: number,
  amostraFuncionario: AnaliseFuncionarioContexto["amostraFuncionario"], amostraPares: AnaliseFuncionarioContexto["amostraPares"] | null,
  periodosComSinal: number, totalPeriodosFuncionario: number
): SinalFuncionario | null {
  const delta = avaliarDelta(valorFuncionario, valorReferencia);
  const persistencia = calcularPersistencia(periodosComSinal, totalPeriodosFuncionario);
  if (delta.magnitude === "leve" || !persistencia.persistente) return null;

  const polaridade = delta.pior ? "atencao" : delta.melhor ? "positivo" : "neutro";
  if (polaridade === "neutro") return null;

  return {
    id: idSinal(funcionarioId, contexto, metrica, janela),
    funcionarioId, funcionarioNome, contexto, janela, metrica,
    valorFuncionario, referenciaTipo, valorReferencia,
    delta: delta.deltaAbsoluto, deltaPercentual: delta.deltaPercentual, magnitude: delta.magnitude,
    persistencia, amostraFuncionario, amostraPares,
    polaridade, evidencias: montarEvidenciaMudancaFuncionario(), confianca: "calculado",
    filtrosDrillDown: filtrosDrillDown(contexto, funcionarioId, janela),
  };
}

export function analisarContextoFuncionario(
  grupo: GrupoContextoFuncionario,
  paradasFuncionario: ParadaComContexto[],
  janelaAtual: Janela,
  apontamentosFuncionarioAnterior: ApontamentoIndicador[],
  janelaAnterior: Janela
): AnaliseFuncionarioContexto {
  const { funcionarioId, funcionarioNome, contexto, apontamentosFuncionario, apontamentosPares } = grupo;

  const amostraFuncionario = avaliarAmostraSimples(apontamentosFuncionario, AMOSTRA_MINIMA_FUNCIONARIO_PERIODOS, AMOSTRA_MINIMA_FUNCIONARIO_MINUTOS);
  const amostraPares = avaliarAmostraSimples(apontamentosPares, AMOSTRA_MINIMA_PARES_PERIODOS, AMOSTRA_MINIMA_PARES_MINUTOS);

  // ---- Performance (§7): pares -> meta (100%) sempre disponível como fallback ----
  const performanceFuncionario = amostraFuncionario.suficiente ? calcularPerformanceAgregada(apontamentosFuncionario) : null;
  const performancePares = amostraPares.suficiente ? calcularPerformanceAgregada(apontamentosPares) : null;

  let sinalPerformance: SinalFuncionario | null = null;
  if (performanceFuncionario !== null) {
    const referenciaTipo = performancePares !== null ? "pares" : "meta";
    const valorReferencia = performancePares !== null ? performancePares : 100;
    const referenciaComparacao = performancePares !== null ? performancePares : 100;
    const comSinal = apontamentosFuncionario.filter((ap) => {
      const p = calcularPerformanceAgregada([ap]);
      return p !== null && Math.sign(p - referenciaComparacao) === Math.sign(performanceFuncionario - referenciaComparacao) && p !== referenciaComparacao;
    });
    sinalPerformance = construirSinal(
      funcionarioId, funcionarioNome, contexto, janelaAtual, "performance",
      performanceFuncionario, referenciaTipo, valorReferencia,
      amostraFuncionario, referenciaTipo === "pares" ? amostraPares : null,
      comSinal.length, apontamentosFuncionario.length
    );
  }

  // ---- Qualidade (§8): pares -> histórico próprio (não existe "meta" de qualidade no schema) ----
  const amostraFuncionarioQualidade = avaliarAmostraQualidade(apontamentosFuncionario, AMOSTRA_MINIMA_FUNCIONARIO_PERIODOS, AMOSTRA_MINIMA_FUNCIONARIO_MINUTOS);
  const amostraParesQualidade = avaliarAmostraQualidade(apontamentosPares, AMOSTRA_MINIMA_PARES_PERIODOS, AMOSTRA_MINIMA_PARES_MINUTOS);
  const qualidadeFuncionario = amostraFuncionarioQualidade.suficiente ? calcularResumoIndicadores(apontamentosFuncionario, []).qualidadePct : null;
  const qualidadePares = amostraParesQualidade.suficiente ? calcularResumoIndicadores(apontamentosPares, []).qualidadePct : null;

  const amostraFuncionarioQualidadeAnterior = avaliarAmostraQualidade(apontamentosFuncionarioAnterior, AMOSTRA_MINIMA_FUNCIONARIO_PERIODOS, AMOSTRA_MINIMA_FUNCIONARIO_MINUTOS);
  const qualidadeHistoricoProprio = amostraFuncionarioQualidadeAnterior.suficiente ? calcularResumoIndicadores(apontamentosFuncionarioAnterior, []).qualidadePct : null;

  let sinalQualidade: SinalFuncionario | null = null;
  if (qualidadeFuncionario !== null) {
    const referenciaTipo = qualidadePares !== null ? "pares" : qualidadeHistoricoProprio !== null ? "historico_proprio" : null;
    if (referenciaTipo !== null) {
      const valorReferencia = qualidadePares !== null ? qualidadePares : (qualidadeHistoricoProprio as number);
      const comSinal = apontamentosFuncionario.filter((ap) => {
        if (ap.status !== "produzindo" || ap.quantidadeProduzida <= 0) return false;
        const q = (calcularQuantidadeBoaApontamento(ap) / ap.quantidadeProduzida) * 100;
        return Math.sign(q - valorReferencia) === Math.sign(qualidadeFuncionario - valorReferencia) && q !== valorReferencia;
      });
      sinalQualidade = construirSinal(
        funcionarioId, funcionarioNome, contexto, janelaAtual, "qualidade",
        qualidadeFuncionario, referenciaTipo, valorReferencia,
        amostraFuncionarioQualidade, referenciaTipo === "pares" ? amostraParesQualidade : null,
        comSinal.length, apontamentosFuncionario.length
      );
    }
  }

  // ---- Paradas — SEMPRE evidência contextual, nunca sinal (§11) ----
  const paretoMinutos = calcularParetoParadasPorMetrica(paradasFuncionario, "minutos");
  const recorrencias = calcularRecorrenciaParadas(paradasFuncionario, apontamentosFuncionario);
  const resumoParadas = calcularResumoParadas(paradasFuncionario, apontamentosFuncionario);
  const motivoRecorrente = recorrencias.find((r) => r.percentualPeriodosAfetados !== null && r.percentualPeriodosAfetados >= 40) || null;

  const paradas = {
    minutosParados: resumoParadas.minutosParadosTotal,
    quantidadeParadas: resumoParadas.quantidadeParadas,
    duracaoMediaMinutos: resumoParadas.duracaoMediaMinutos,
    principaisMotivos: paretoMinutos.slice(0, 3).map((m) => ({ motivoNome: m.motivoNome, minutos: m.minutos, quantidade: m.quantidadeParadas })),
    motivoRecorrente: motivoRecorrente ? { motivoNome: motivoRecorrente.motivoNome, percentualPeriodosAfetados: motivoRecorrente.percentualPeriodosAfetados ?? 0 } : null,
    custoTempoOciosoTotal: resumoParadas.custoTempoOciosoTotal,
    capacidadePerdidaTotal: resumoParadas.capacidadePerdidaTotal,
  };

  // ---- Economia — SEMPRE evidência contextual, nunca sinal (§12) ----
  const resumoEcon = calcularResumoEconomico(apontamentosFuncionario);
  const diferencas = apontamentosFuncionario.map(calcularDiferencaCustoTeoricoObservadoApontamento).filter((v): v is number => v !== null);
  const diferencaMedia = diferencas.length > 0 ? diferencas.reduce((s, v) => s + v, 0) / diferencas.length : null;
  const margem = calcularMargemProcessamento(apontamentosFuncionario);
  const trabalhouUltimaEtapa = apontamentosFuncionario.some((ap) => ap.isUltimaEtapa === true);

  const economia = {
    custoMedioPorPecaProduzida: resumoEcon.custoMedioPorPecaProduzida,
    diferencaCustoTeoricoObservadoMedia: diferencaMedia,
    custoTempoParadoTotal: resumoEcon.custoTempoParadoTotal,
    impactoRefugoTotal: resumoEcon.impactoRefugoTotal,
    margemPct: trabalhouUltimaEtapa ? margem.margemPct : null,
    margemDisponivel: trabalhouUltimaEtapa && margem.margemPct !== null,
  };

  // ---- Evolução (§13): SOMENTE mesmo contexto, funcionário vs si mesmo ----
  const amostraFuncionarioAnterior = avaliarAmostraSimples(apontamentosFuncionarioAnterior, AMOSTRA_MINIMA_FUNCIONARIO_PERIODOS, AMOSTRA_MINIMA_FUNCIONARIO_MINUTOS);
  const evolucaoDisponivel = amostraFuncionario.suficiente && amostraFuncionarioAnterior.suficiente;
  const performanceAnterior = amostraFuncionarioAnterior.suficiente ? calcularPerformanceAgregada(apontamentosFuncionarioAnterior) : null;
  const qualidadeAnterior = amostraFuncionarioQualidadeAnterior.suficiente ? calcularResumoIndicadores(apontamentosFuncionarioAnterior, []).qualidadePct : null;
  const resumoParadasAnterior = calcularResumoParadas([], apontamentosFuncionarioAnterior);
  const econAnterior = calcularResumoEconomico(apontamentosFuncionarioAnterior);

  const evolucao = {
    disponivel: evolucaoDisponivel,
    motivoIndisponivel: evolucaoDisponivel ? null : (!amostraFuncionario.suficiente ? "amostra insuficiente na janela atual" : "amostra insuficiente na janela anterior neste mesmo contexto"),
    janelaAtual, janelaAnterior,
    performanceAtual: performanceFuncionario, performanceAnterior,
    qualidadeAtual: qualidadeFuncionario, qualidadeAnterior,
    minutosParadosAtual: resumoParadas.minutosParadosTotal, minutosParadosAnterior: resumoParadasAnterior.minutosParadosTotal,
    custoPecaAtual: resumoEcon.custoMedioPorPecaProduzida, custoPecaAnterior: econAnterior.custoMedioPorPecaProduzida,
  };

  return {
    funcionarioId, funcionarioNome, contexto, janelaAtual,
    amostraFuncionario, amostraPares,
    performanceFuncionario, performancePares, sinalPerformance,
    qualidadeFuncionario, qualidadePares, amostraFuncionarioQualidade, amostraParesQualidade, sinalQualidade,
    paradas, economia, evolucao,
    filtrosDrillDown: filtrosDrillDown(contexto, funcionarioId, janelaAtual),
  };
}

export { rotuloContextoFuncionario };
