// Desvios V1 — motor de detecção. Cada função abaixo é COMPARAÇÃO +
// REGRA DE DECISÃO por cima de fórmulas já existentes (Indicadores V1,
// Motor Econômico V1, Paradas V1) — nenhuma fórmula oficial é
// recalculada ou duplicada aqui. Toda função recebe as DUAS janelas já
// buscadas (uma única chamada de RPC cobrindo ambas, ver useDesviosProducao)
// e devolve os DesvioDetectado[] que já passaram na amostra mínima.

import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import {
  calcularPerformanceAgregada, calcularResumoIndicadores, calcularQuantidadeBoaApontamento, agruparPorProduto,
} from "@/features/producao-real/indicadores/calculations";
import {
  calcularResumoEconomico, calcularMargemProcessamento, calcularDiferencaCustoTeoricoObservadoApontamento,
  detectarPossivelRestricaoOperacional,
} from "@/features/producao-real/indicadores/economico";
import {
  calcularResumoParadas, calcularRecorrenciaParadas, calcularCapacidadePerdidaParada, calcularCustoTempoOciosoParada,
  type ParadaComContexto,
} from "@/features/producao-real/paradas/calculations";
import { avaliarAmostra } from "@/features/producao-real/desvios/amostra";
import { agruparPorContextoMaquina, rotuloContexto, type GrupoContexto } from "@/features/producao-real/desvios/contexto";
import { calcularDelta, calcularPersistencia, avaliarSeveridadeGenerica, avaliarSeveridadePerformance } from "@/features/producao-real/desvios/severidade";
import { LIMIAR_PERSISTENCIA_PCT } from "@/features/producao-real/desvios/thresholds";
import type {
  ContextoDesvio, DesvioDetectado, Evidencia, Impacto, Janela, ParDeJanelas, PossivelFator, TipoDesvio, DominioDesvio,
} from "@/features/producao-real/desvios/types";
import { classificarPerformance } from "@/lib/performance";

// ---------------------------------------------------------------------
// Utilitários compartilhados
// ---------------------------------------------------------------------

function idDesvio(dominio: DominioDesvio, tipo: TipoDesvio, contexto: ContextoDesvio, janela: Janela): string {
  return [dominio, tipo, contexto.produtoId ?? "-", contexto.operacaoId ?? "-", contexto.maquinaId ?? "agregado", janela.dataInicial, janela.dataFinal].join(":");
}

function filtrosDrillDown(contexto: ContextoDesvio, janela: Janela) {
  return {
    dataInicial: janela.dataInicial,
    dataFinal: janela.dataFinal,
    produtoId: contexto.produtoId || undefined,
    operacaoId: contexto.operacaoId || undefined,
    maquinaId: contexto.maquinaId || undefined,
  };
}

function paradasDoContexto(paradas: ParadaComContexto[], contexto: ContextoDesvio): ParadaComContexto[] {
  return paradas.filter(
    (p) => p.produtoId === contexto.produtoId && p.operacaoId === contexto.operacaoId && (contexto.maquinaId === null || p.maquinaId === contexto.maquinaId)
  );
}

function periodosDistintos(itens: { data: string; periodoId: string }[]): number {
  return new Set(itens.map((i) => `${i.data}|${i.periodoId}`)).size;
}

// Evidências/possíveis fatores comuns a Produtividade/Paradas/Qualidade/
// Economia: motivo de parada dominante, mudança de funcionário, presença
// de ocorrência — sempre com rastreabilidade (fonte/contexto/período/valor)
// e tom de hipótese, nunca causalidade afirmada (§11/§12).
function evidenciasEFatoresDoContexto(
  paradasAtual: ParadaComContexto[],
  apontamentosAtual: ApontamentoIndicador[],
  apontamentosReferencia: ApontamentoIndicador[],
  contexto: ContextoDesvio,
  janelaAtual: Janela
): { evidencias: Evidencia[]; fatores: PossivelFator[] } {
  const evidencias: Evidencia[] = [];
  const fatores: PossivelFator[] = [];
  const rotulo = rotuloContexto(contexto);
  const rotuloJanela = `${janelaAtual.dataInicial} a ${janelaAtual.dataFinal}`;

  if (paradasAtual.length > 0) {
    const porMotivo = new Map<string, { nome: string; minutos: number; quantidade: number }>();
    paradasAtual.forEach((p) => {
      const atual = porMotivo.get(p.motivoId);
      if (atual) { atual.minutos += p.minutos; atual.quantidade += 1; }
      else porMotivo.set(p.motivoId, { nome: p.motivoNome, minutos: p.minutos, quantidade: 1 });
    });
    const top = Array.from(porMotivo.values()).sort((a, b) => b.minutos - a.minutos).slice(0, 2);
    top.forEach((m) => {
      const ev: Evidencia = {
        fonte: "Pareto de paradas (Paradas V1)",
        descricao: `Coincidiu com paradas de motivo "${m.nome}" no mesmo contexto e janela.`,
        contexto: rotulo,
        periodo: rotuloJanela,
        valor: `${m.minutos} min em ${m.quantidade} parada(s)`,
      };
      evidencias.push(ev);
      fatores.push({ fator: m.nome, descricao: `Possível fator associado — vale investigar paradas por "${m.nome}" neste contexto.`, evidencia: ev });
    });

    if (paradasAtual.some((p) => p.origem === "ocorrencia")) {
      evidencias.push({
        fonte: "Ocorrências de máquina",
        descricao: "Coincidiu com uma ocorrência de máquina (quebra/manutenção) encerrada no período.",
        contexto: rotulo,
        periodo: rotuloJanela,
        valor: `${paradasAtual.filter((p) => p.origem === "ocorrencia").length} ocorrência(s) vinculada(s)`,
      });
    }
  }

  const funcionariosAtual = new Set(apontamentosAtual.map((a) => a.funcionarioId).filter((v): v is string => v !== null));
  const funcionariosReferencia = new Set(apontamentosReferencia.map((a) => a.funcionarioId).filter((v): v is string => v !== null));
  const trocou = Array.from(funcionariosAtual).some((f) => !funcionariosReferencia.has(f)) && funcionariosReferencia.size > 0;
  if (trocou) {
    evidencias.push({
      fonte: "Apontamentos (funcionário)",
      descricao: "No contexto comparável, houve mudança de operador em relação à janela de referência — não conclui causa.",
      contexto: rotulo,
      periodo: rotuloJanela,
      valor: `${funcionariosAtual.size} funcionário(s) na janela atual vs. ${funcionariosReferencia.size} na referência`,
    });
    fatores.push({
      fator: "Mudança de operador",
      descricao: "Possível fator associado — houve troca de funcionário no mesmo contexto; vale investigar, nunca conclui causa disciplinar.",
      evidencia: evidencias[evidencias.length - 1],
    });
  }

  return { evidencias, fatores };
}

interface ContextoComparado {
  contexto: ContextoDesvio;
  apontamentosAtual: ApontamentoIndicador[];
  apontamentosReferencia: ApontamentoIndicador[];
  paradasAtual: ParadaComContexto[];
  paradasReferencia: ParadaComContexto[];
}

// Junta os grupos de contexto (máquina) da janela atual com os
// equivalentes da referência (mesmo produto+operação+máquina) — contexto
// que só existe numa das duas janelas simplesmente não gera desvio
// comparativo (não há baseline).
function combinarContextos(
  apontamentosAtual: ApontamentoIndicador[],
  apontamentosReferencia: ApontamentoIndicador[],
  paradasAtual: ParadaComContexto[],
  paradasReferencia: ParadaComContexto[]
): ContextoComparado[] {
  const gruposAtual = agruparPorContextoMaquina(apontamentosAtual);
  const gruposReferencia = new Map<string, GrupoContexto>(agruparPorContextoMaquina(apontamentosReferencia).map((g) => [g.chave, g]));
  return gruposAtual
    .filter((g) => gruposReferencia.has(g.chave))
    .map((g) => {
      const ref = gruposReferencia.get(g.chave)!;
      return {
        contexto: g.contexto,
        apontamentosAtual: g.apontamentos,
        apontamentosReferencia: ref.apontamentos,
        paradasAtual: paradasDoContexto(paradasAtual, g.contexto),
        paradasReferencia: paradasDoContexto(paradasReferencia, g.contexto),
      };
    });
}

// ---------------------------------------------------------------------
// PRODUTIVIDADE
// ---------------------------------------------------------------------

// Atingimento de meta — NOVA métrica simples (produzida/meta, sem ajuste
// por paradas), deliberadamente distinta de Performance (que ajusta o
// denominador pelo tempo produtivo real). Não duplica calcularPerformance*.
function calcularAtingimentoMeta(apontamentos: ApontamentoIndicador[]): number | null {
  let somaProduzida = 0;
  let somaMeta = 0;
  apontamentos.forEach((ap) => {
    if (ap.metaPeriodoVigente === null || ap.metaPeriodoVigente <= 0) return;
    somaProduzida += ap.quantidadeProduzida;
    somaMeta += ap.metaPeriodoVigente;
  });
  return somaMeta > 0 ? (somaProduzida / somaMeta) * 100 : null;
}

function impactoCapacidadePerdida(paradas: ParadaComContexto[]): number | null {
  const valores = paradas.map(calcularCapacidadePerdidaParada).filter((v): v is number => v !== null);
  return valores.length > 0 ? valores.reduce((s, v) => s + v, 0) : null;
}

function impactoCustoOcioso(paradas: ParadaComContexto[]): number | null {
  const valores = paradas.map(calcularCustoTempoOciosoParada).filter((v): v is number => v !== null);
  return valores.length > 0 ? valores.reduce((s, v) => s + v, 0) : null;
}

export function detectarDesviosProdutividade(
  apontamentosAtual: ApontamentoIndicador[], apontamentosReferencia: ApontamentoIndicador[],
  paradasAtual: ParadaComContexto[], paradasReferencia: ParadaComContexto[],
  janelas: ParDeJanelas, origemJanela: "operacional" | "estrutural"
): DesvioDetectado[] {
  const desvios: Omit<DesvioDetectado, "origemJanela">[] = [];
  const contextos = combinarContextos(apontamentosAtual, apontamentosReferencia, paradasAtual, paradasReferencia);

  contextos.forEach((c) => {
    const amostra = avaliarAmostra(c.apontamentosAtual, c.apontamentosReferencia, false);
    if (!amostra.suficiente) return;

    const { evidencias, fatores } = evidenciasEFatoresDoContexto(c.paradasAtual, c.apontamentosAtual, c.apontamentosReferencia, c.contexto, janelas.atual);
    const impactoCapAtual = impactoCapacidadePerdida(c.paradasAtual);
    const impactoCapReferencia = impactoCapacidadePerdida(c.paradasReferencia);
    const impactoCustoAtual = impactoCustoOcioso(c.paradasAtual);
    const impactos: Impacto[] = [];
    if (impactoCapAtual !== null) impactos.push({ metrica: "Capacidade local perdida", valor: impactoCapAtual, unidade: "peças" });
    if (impactoCustoAtual !== null) impactos.push({ metrica: "Custo do tempo ocioso", valor: impactoCustoAtual, unidade: "R$" });
    const impactoAlto = impactoCapAtual !== null && impactoCapReferencia !== null
      ? calcularDelta(impactoCapAtual, impactoCapReferencia, "aumento_e_pior").magnitude === "forte"
      : false;

    // --- performance_deteriorou ---
    const perfAtual = calcularPerformanceAgregada(c.apontamentosAtual);
    const perfReferencia = calcularPerformanceAgregada(c.apontamentosReferencia);
    if (perfAtual !== null && perfReferencia !== null) {
      const delta = calcularDelta(perfAtual, perfReferencia, "reducao_e_pior");
      if (delta.houvePiora) {
        const comSinal = c.apontamentosAtual.filter((ap) => {
          const p = calcularPerformanceAgregada([ap]);
          return p !== null && p < perfReferencia;
        });
        const persistencia = calcularPersistencia(periodosDistintos(comSinal), c.apontamentosAtual.length);
        const severidade = avaliarSeveridadePerformance(perfAtual, delta.magnitude, persistencia.persistente, impactoAlto);
        desvios.push({
          id: idDesvio("produtividade", "performance_deteriorou", c.contexto, janelas.atual),
          dominio: "produtividade", tipo: "performance_deteriorou",
          titulo: `Performance de ${rotuloContexto(c.contexto)} caiu de ${perfReferencia.toFixed(1)}% para ${perfAtual.toFixed(1)}%`,
          contexto: c.contexto, janelaAtual: janelas.atual, janelaReferencia: janelas.referencia,
          metrica: "Performance", unidade: "%", valorAtual: perfAtual, valorReferencia: perfReferencia,
          deltaAbsoluto: delta.deltaAbsoluto, deltaPercentual: delta.deltaPercentual,
          magnitude: severidade.magnitude, severidade: severidade.severidade, justificativaSeveridade: severidade.justificativa,
          persistente: severidade.persistente, percentualPeriodosAfetados: persistencia.percentual,
          evidencias, impactos, possiveisFatores: fatores, confianca: "calculado", amostra,
          filtrosDrillDown: filtrosDrillDown(c.contexto, janelas.atual), linkSugerido: "produtividade",
        });
      }
    }

    // --- atingimento_meta_deteriorou ---
    const atingAtual = calcularAtingimentoMeta(c.apontamentosAtual);
    const atingReferencia = calcularAtingimentoMeta(c.apontamentosReferencia);
    if (atingAtual !== null && atingReferencia !== null) {
      const delta = calcularDelta(atingAtual, atingReferencia, "reducao_e_pior");
      if (delta.houvePiora) {
        const comSinal = c.apontamentosAtual.filter((ap) => ap.metaPeriodoVigente !== null && ap.metaPeriodoVigente > 0 && (ap.quantidadeProduzida / ap.metaPeriodoVigente) * 100 < atingReferencia);
        const persistencia = calcularPersistencia(periodosDistintos(comSinal), c.apontamentosAtual.length);
        const severidade = avaliarSeveridadeGenerica(delta.magnitude, persistencia.persistente, impactoAlto);
        desvios.push({
          id: idDesvio("produtividade", "atingimento_meta_deteriorou", c.contexto, janelas.atual),
          dominio: "produtividade", tipo: "atingimento_meta_deteriorou",
          titulo: `Atingimento de meta de ${rotuloContexto(c.contexto)} caiu de ${atingReferencia.toFixed(1)}% para ${atingAtual.toFixed(1)}%`,
          contexto: c.contexto, janelaAtual: janelas.atual, janelaReferencia: janelas.referencia,
          metrica: "Atingimento de meta (produzida/meta, sem ajuste por paradas)", unidade: "%", valorAtual: atingAtual, valorReferencia: atingReferencia,
          deltaAbsoluto: delta.deltaAbsoluto, deltaPercentual: delta.deltaPercentual,
          magnitude: severidade.magnitude, severidade: severidade.severidade, justificativaSeveridade: severidade.justificativa,
          persistente: severidade.persistente, percentualPeriodosAfetados: persistencia.percentual,
          evidencias, impactos, possiveisFatores: fatores, confianca: "calculado", amostra,
          filtrosDrillDown: filtrosDrillDown(c.contexto, janelas.atual), linkSugerido: "produtividade",
        });
      }
    }
  });

  return desvios.map((d) => ({ ...d, origemJanela }));
}

// ---------------------------------------------------------------------
// PARADAS
// ---------------------------------------------------------------------

export function detectarDesviosParadas(
  apontamentosAtual: ApontamentoIndicador[], apontamentosReferencia: ApontamentoIndicador[],
  paradasAtual: ParadaComContexto[], paradasReferencia: ParadaComContexto[],
  janelas: ParDeJanelas, origemJanela: "operacional" | "estrutural"
): DesvioDetectado[] {
  const desvios: Omit<DesvioDetectado, "origemJanela">[] = [];
  const contextos = combinarContextos(apontamentosAtual, apontamentosReferencia, paradasAtual, paradasReferencia);

  contextos.forEach((c) => {
    const amostra = avaliarAmostra(c.apontamentosAtual, c.apontamentosReferencia, false);
    if (!amostra.suficiente) return;

    const resumoAtual = calcularResumoParadas(c.paradasAtual, c.apontamentosAtual);
    const resumoReferencia = calcularResumoParadas(c.paradasReferencia, c.apontamentosReferencia);
    const { evidencias, fatores } = evidenciasEFatoresDoContexto(c.paradasAtual, c.apontamentosAtual, c.apontamentosReferencia, c.contexto, janelas.atual);
    const periodosApontadosAtual = c.apontamentosAtual.length;
    const periodosComParadaAtual = periodosDistintos(c.paradasAtual);
    const persistenciaGeral = calcularPersistencia(periodosComParadaAtual, periodosApontadosAtual);

    function pushSinal(
      tipo: TipoDesvio, metrica: string, unidade: "min" | "R$" | "peças",
      valorAtual: number, valorReferencia: number, impactos: Impacto[]
    ) {
      const delta = calcularDelta(valorAtual, valorReferencia, "aumento_e_pior");
      if (!delta.houvePiora) return;
      const impactoAlto = impactos.some((i) => i.metrica === "Custo do tempo ocioso" || i.metrica === "Capacidade local perdida");
      const severidade = avaliarSeveridadeGenerica(delta.magnitude, persistenciaGeral.persistente, impactoAlto);
      desvios.push({
        id: idDesvio("paradas", tipo, c.contexto, janelas.atual),
        dominio: "paradas", tipo,
        titulo: `${metrica} de ${rotuloContexto(c.contexto)} aumentou`,
        contexto: c.contexto, janelaAtual: janelas.atual, janelaReferencia: janelas.referencia,
        metrica, unidade, valorAtual, valorReferencia,
        deltaAbsoluto: delta.deltaAbsoluto, deltaPercentual: delta.deltaPercentual,
        magnitude: severidade.magnitude, severidade: severidade.severidade, justificativaSeveridade: severidade.justificativa,
        persistente: severidade.persistente, percentualPeriodosAfetados: persistenciaGeral.percentual,
        evidencias, impactos, possiveisFatores: fatores, confianca: "calculado", amostra,
        filtrosDrillDown: filtrosDrillDown(c.contexto, janelas.atual), linkSugerido: "paradas",
      });
    }

    pushSinal("paradas_minutos_aumentaram", "Minutos parados", "min", resumoAtual.minutosParadosTotal, resumoReferencia.minutosParadosTotal, []);
    pushSinal("paradas_frequencia_aumentou", "Quantidade de paradas", "min", resumoAtual.quantidadeParadas, resumoReferencia.quantidadeParadas, []);
    if (resumoAtual.duracaoMediaMinutos !== null && resumoReferencia.duracaoMediaMinutos !== null) {
      pushSinal("paradas_duracao_media_aumentou", "Duração média da parada", "min", resumoAtual.duracaoMediaMinutos, resumoReferencia.duracaoMediaMinutos, []);
    }
    if (resumoAtual.capacidadePerdidaTotal !== null && resumoReferencia.capacidadePerdidaTotal !== null) {
      pushSinal("paradas_capacidade_perdida_aumentou", "Capacidade local perdida", "peças", resumoAtual.capacidadePerdidaTotal, resumoReferencia.capacidadePerdidaTotal, [
        { metrica: "Capacidade local perdida", valor: resumoAtual.capacidadePerdidaTotal, unidade: "peças" },
      ]);
    }
    if (resumoAtual.custoTempoOciosoTotal !== null && resumoReferencia.custoTempoOciosoTotal !== null) {
      pushSinal("paradas_custo_ocioso_aumentou", "Custo do tempo ocioso", "R$", resumoAtual.custoTempoOciosoTotal, resumoReferencia.custoTempoOciosoTotal, [
        { metrica: "Custo do tempo ocioso", valor: resumoAtual.custoTempoOciosoTotal, unidade: "R$" },
      ]);
    }

    // --- paradas_motivo_recorrente — reaproveita calcularRecorrenciaParadas
    // já restrita ao contexto (máquina única aqui, produto+operação
    // implícitos porque paradasAtual/apontamentosAtual já vêm filtrados). ---
    const recorrencias = calcularRecorrenciaParadas(c.paradasAtual, c.apontamentosAtual);
    recorrencias
      .filter((r) => r.percentualPeriodosAfetados !== null && r.percentualPeriodosAfetados >= LIMIAR_PERSISTENCIA_PCT && r.quantidadeParadas >= 2)
      .forEach((r) => {
        const minutosReferenciaMotivo = c.paradasReferencia.filter((p) => p.motivoId === r.motivoId).reduce((s, p) => s + p.minutos, 0);
        const magnitude = classificarMagnitudeRecorrencia(r.percentualPeriodosAfetados ?? 0);
        const severidade = avaliarSeveridadeGenerica(magnitude, true, false);
        const evidenciaEspecifica: Evidencia = {
          fonte: "Recorrência de motivo (Paradas V1)",
          descricao: `Motivo "${r.motivoNome}" apareceu em ${r.periodosDistintosAfetados} de ${r.totalPeriodosApontadosMaquina} períodos apontados.`,
          contexto: rotuloContexto(c.contexto), periodo: `${janelas.atual.dataInicial} a ${janelas.atual.dataFinal}`,
          valor: `${(r.percentualPeriodosAfetados ?? 0).toFixed(0)}% dos períodos`,
        };
        desvios.push({
          id: idDesvio("paradas", "paradas_motivo_recorrente", c.contexto, janelas.atual),
          dominio: "paradas", tipo: "paradas_motivo_recorrente",
          titulo: `Motivo "${r.motivoNome}" recorrente em ${rotuloContexto(c.contexto)}`,
          contexto: c.contexto, janelaAtual: janelas.atual, janelaReferencia: janelas.referencia,
          metrica: `Recorrência do motivo "${r.motivoNome}"`, unidade: "%",
          valorAtual: r.percentualPeriodosAfetados ?? 0, valorReferencia: 0,
          deltaAbsoluto: r.minutosTotais - minutosReferenciaMotivo, deltaPercentual: null,
          magnitude, severidade: severidade.severidade, justificativaSeveridade: severidade.justificativa,
          persistente: true, percentualPeriodosAfetados: r.percentualPeriodosAfetados,
          evidencias: [...evidencias, evidenciaEspecifica],
          impactos: [], possiveisFatores: [...fatores, { fator: r.motivoNome, descricao: `Possível fator associado — motivo "${r.motivoNome}" recorrente neste contexto.`, evidencia: evidenciaEspecifica }],
          confianca: "calculado", amostra,
          filtrosDrillDown: filtrosDrillDown(c.contexto, janelas.atual), linkSugerido: "paradas",
        });
      });
  });

  return desvios.map((d) => ({ ...d, origemJanela }));
}

function classificarMagnitudeRecorrencia(percentualPeriodosAfetados: number): "leve" | "relevante" | "forte" {
  if (percentualPeriodosAfetados >= 2 * LIMIAR_PERSISTENCIA_PCT) return "forte"; // ex.: >=80% quando limiar é 40%
  if (percentualPeriodosAfetados >= LIMIAR_PERSISTENCIA_PCT) return "relevante";
  return "leve";
}

// ---------------------------------------------------------------------
// QUALIDADE
// ---------------------------------------------------------------------

export function detectarDesviosQualidade(
  apontamentosAtual: ApontamentoIndicador[], apontamentosReferencia: ApontamentoIndicador[],
  paradasAtual: ParadaComContexto[], paradasReferencia: ParadaComContexto[],
  janelas: ParDeJanelas, origemJanela: "operacional" | "estrutural"
): DesvioDetectado[] {
  const desvios: Omit<DesvioDetectado, "origemJanela">[] = [];
  const contextos = combinarContextos(apontamentosAtual, apontamentosReferencia, paradasAtual, paradasReferencia);

  contextos.forEach((c) => {
    const amostra = avaliarAmostra(c.apontamentosAtual, c.apontamentosReferencia, true);
    if (!amostra.suficiente) return;

    const resumoAtual = calcularResumoIndicadores(c.apontamentosAtual, []);
    const resumoReferencia = calcularResumoIndicadores(c.apontamentosReferencia, []);
    const { evidencias, fatores } = evidenciasEFatoresDoContexto(c.paradasAtual, c.apontamentosAtual, c.apontamentosReferencia, c.contexto, janelas.atual);
    const impactoRefugoAtual = c.apontamentosAtual.filter((a) => a.status === "produzindo").reduce((s, a) => s + (a.custoUnitarioReferenciaPeriodoVigente ?? 0) * a.quantidadeRefugo, 0);
    const impactos: Impacto[] = impactoRefugoAtual > 0 ? [{ metrica: "Impacto econômico do refugo", valor: impactoRefugoAtual, unidade: "R$" }] : [];

    const taxaRefugoAtual = resumoAtual.producaoProcessadaTotal > 0 ? (resumoAtual.refugoTotal / resumoAtual.producaoProcessadaTotal) * 100 : null;
    const taxaRefugoReferencia = resumoReferencia.producaoProcessadaTotal > 0 ? (resumoReferencia.refugoTotal / resumoReferencia.producaoProcessadaTotal) * 100 : null;
    if (taxaRefugoAtual !== null && taxaRefugoReferencia !== null) {
      const delta = calcularDelta(taxaRefugoAtual, taxaRefugoReferencia, "aumento_e_pior");
      if (delta.houvePiora) {
        const comSinal = c.apontamentosAtual.filter((ap) => ap.quantidadeProduzida > 0 && (ap.quantidadeRefugo / ap.quantidadeProduzida) * 100 > taxaRefugoReferencia);
        const persistencia = calcularPersistencia(periodosDistintos(comSinal), c.apontamentosAtual.length);
        const severidade = avaliarSeveridadeGenerica(delta.magnitude, persistencia.persistente, impactoRefugoAtual > 0);
        desvios.push({
          id: idDesvio("qualidade", "refugo_aumentou", c.contexto, janelas.atual),
          dominio: "qualidade", tipo: "refugo_aumentou",
          titulo: `Taxa de refugo de ${rotuloContexto(c.contexto)} subiu de ${taxaRefugoReferencia.toFixed(1)}% para ${taxaRefugoAtual.toFixed(1)}%`,
          contexto: c.contexto, janelaAtual: janelas.atual, janelaReferencia: janelas.referencia,
          metrica: "Taxa de refugo", unidade: "%", valorAtual: taxaRefugoAtual, valorReferencia: taxaRefugoReferencia,
          deltaAbsoluto: delta.deltaAbsoluto, deltaPercentual: delta.deltaPercentual,
          magnitude: severidade.magnitude, severidade: severidade.severidade, justificativaSeveridade: severidade.justificativa,
          persistente: severidade.persistente, percentualPeriodosAfetados: persistencia.percentual,
          evidencias, impactos, possiveisFatores: fatores, confianca: "calculado", amostra,
          filtrosDrillDown: filtrosDrillDown(c.contexto, janelas.atual), linkSugerido: "produtividade",
        });
      }
    }

    if (resumoAtual.qualidadePct !== null && resumoReferencia.qualidadePct !== null) {
      const delta = calcularDelta(resumoAtual.qualidadePct, resumoReferencia.qualidadePct, "reducao_e_pior");
      if (delta.houvePiora) {
        const comSinal = c.apontamentosAtual.filter((ap) => {
          const q = ap.quantidadeProduzida > 0 ? (calcularQuantidadeBoaApontamento(ap) / ap.quantidadeProduzida) * 100 : null;
          return q !== null && q < (resumoReferencia.qualidadePct as number);
        });
        const persistencia = calcularPersistencia(periodosDistintos(comSinal), c.apontamentosAtual.length);
        const severidade = avaliarSeveridadeGenerica(delta.magnitude, persistencia.persistente, impactoRefugoAtual > 0);
        desvios.push({
          id: idDesvio("qualidade", "qualidade_deteriorou", c.contexto, janelas.atual),
          dominio: "qualidade", tipo: "qualidade_deteriorou",
          titulo: `Qualidade de ${rotuloContexto(c.contexto)} caiu de ${resumoReferencia.qualidadePct.toFixed(1)}% para ${resumoAtual.qualidadePct.toFixed(1)}%`,
          contexto: c.contexto, janelaAtual: janelas.atual, janelaReferencia: janelas.referencia,
          metrica: "Qualidade", unidade: "%", valorAtual: resumoAtual.qualidadePct, valorReferencia: resumoReferencia.qualidadePct,
          deltaAbsoluto: delta.deltaAbsoluto, deltaPercentual: delta.deltaPercentual,
          magnitude: severidade.magnitude, severidade: severidade.severidade, justificativaSeveridade: severidade.justificativa,
          persistente: severidade.persistente, percentualPeriodosAfetados: persistencia.percentual,
          evidencias, impactos, possiveisFatores: fatores, confianca: "calculado", amostra,
          filtrosDrillDown: filtrosDrillDown(c.contexto, janelas.atual), linkSugerido: "produtividade",
        });
      }
    }
  });

  return desvios.map((d) => ({ ...d, origemJanela }));
}

// ---------------------------------------------------------------------
// ECONOMIA
// ---------------------------------------------------------------------

export function detectarDesviosEconomia(
  apontamentosAtual: ApontamentoIndicador[], apontamentosReferencia: ApontamentoIndicador[],
  paradasAtual: ParadaComContexto[], paradasReferencia: ParadaComContexto[],
  janelas: ParDeJanelas, origemJanela: "operacional" | "estrutural"
): DesvioDetectado[] {
  const desvios: Omit<DesvioDetectado, "origemJanela">[] = [];
  const contextos = combinarContextos(apontamentosAtual, apontamentosReferencia, paradasAtual, paradasReferencia);

  contextos.forEach((c) => {
    const amostra = avaliarAmostra(c.apontamentosAtual, c.apontamentosReferencia, false);
    if (!amostra.suficiente) return;

    const { evidencias, fatores } = evidenciasEFatoresDoContexto(c.paradasAtual, c.apontamentosAtual, c.apontamentosReferencia, c.contexto, janelas.atual);
    const econAtual = calcularResumoEconomico(c.apontamentosAtual);
    const econReferencia = calcularResumoEconomico(c.apontamentosReferencia);

    if (econAtual.custoMedioPorPecaProduzida !== null && econReferencia.custoMedioPorPecaProduzida !== null) {
      const delta = calcularDelta(econAtual.custoMedioPorPecaProduzida, econReferencia.custoMedioPorPecaProduzida, "aumento_e_pior");
      if (delta.houvePiora) {
        const comSinal = c.apontamentosAtual.filter((ap) => {
          if (ap.custoOperacionalPeriodoVigente === null || ap.quantidadeProduzida <= 0) return false;
          return ap.custoOperacionalPeriodoVigente / ap.quantidadeProduzida > (econReferencia.custoMedioPorPecaProduzida as number);
        });
        const persistencia = calcularPersistencia(periodosDistintos(comSinal), c.apontamentosAtual.length);
        const severidade = avaliarSeveridadeGenerica(delta.magnitude, persistencia.persistente, false);
        desvios.push({
          id: idDesvio("economia", "custo_peca_aumentou", c.contexto, janelas.atual),
          dominio: "economia", tipo: "custo_peca_aumentou",
          titulo: `Custo observado/peça de ${rotuloContexto(c.contexto)} aumentou`,
          contexto: c.contexto, janelaAtual: janelas.atual, janelaReferencia: janelas.referencia,
          metrica: "Custo observado por peça produzida", unidade: "R$",
          valorAtual: econAtual.custoMedioPorPecaProduzida, valorReferencia: econReferencia.custoMedioPorPecaProduzida,
          deltaAbsoluto: delta.deltaAbsoluto, deltaPercentual: delta.deltaPercentual,
          magnitude: severidade.magnitude, severidade: severidade.severidade, justificativaSeveridade: severidade.justificativa,
          persistente: severidade.persistente, percentualPeriodosAfetados: persistencia.percentual,
          evidencias, impactos: [], possiveisFatores: fatores, confianca: "calculado", amostra,
          filtrosDrillDown: filtrosDrillDown(c.contexto, janelas.atual), linkSugerido: "produtividade",
        });
      }
    }

    const diferencasAtual = c.apontamentosAtual.map(calcularDiferencaCustoTeoricoObservadoApontamento).filter((v): v is number => v !== null);
    const diferencasReferencia = c.apontamentosReferencia.map(calcularDiferencaCustoTeoricoObservadoApontamento).filter((v): v is number => v !== null);
    if (diferencasAtual.length > 0 && diferencasReferencia.length > 0) {
      const mediaAtual = diferencasAtual.reduce((s, v) => s + v, 0) / diferencasAtual.length;
      const mediaReferencia = diferencasReferencia.reduce((s, v) => s + v, 0) / diferencasReferencia.length;
      const delta = calcularDelta(mediaAtual, mediaReferencia, "aumento_e_pior");
      if (delta.houvePiora) {
        const persistencia = calcularPersistencia(diferencasAtual.filter((v) => v > mediaReferencia).length, c.apontamentosAtual.length);
        const severidade = avaliarSeveridadeGenerica(delta.magnitude, persistencia.persistente, false);
        desvios.push({
          id: idDesvio("economia", "diferenca_custo_teorico_observado_aumentou", c.contexto, janelas.atual),
          dominio: "economia", tipo: "diferenca_custo_teorico_observado_aumentou",
          titulo: `Diferença entre custo teórico e observado de ${rotuloContexto(c.contexto)} aumentou`,
          contexto: c.contexto, janelaAtual: janelas.atual, janelaReferencia: janelas.referencia,
          metrica: "Diferença custo teórico × observado (média por período)", unidade: "R$",
          valorAtual: mediaAtual, valorReferencia: mediaReferencia,
          deltaAbsoluto: delta.deltaAbsoluto, deltaPercentual: delta.deltaPercentual,
          magnitude: severidade.magnitude, severidade: severidade.severidade, justificativaSeveridade: severidade.justificativa,
          persistente: severidade.persistente, percentualPeriodosAfetados: persistencia.percentual,
          evidencias, impactos: [], possiveisFatores: fatores, confianca: "calculado", amostra,
          filtrosDrillDown: filtrosDrillDown(c.contexto, janelas.atual), linkSugerido: "produtividade",
        });
      }
    }

    const margemAtual = calcularMargemProcessamento(c.apontamentosAtual);
    const margemReferencia = calcularMargemProcessamento(c.apontamentosReferencia);
    if (margemAtual.margemPct !== null && margemReferencia.margemPct !== null) {
      const delta = calcularDelta(margemAtual.margemPct, margemReferencia.margemPct, "reducao_e_pior");
      if (delta.houvePiora) {
        const severidade = avaliarSeveridadeGenerica(delta.magnitude, false, false);
        desvios.push({
          id: idDesvio("economia", "margem_deteriorou", c.contexto, janelas.atual),
          dominio: "economia", tipo: "margem_deteriorou",
          titulo: `Margem de processamento de ${rotuloContexto(c.contexto)} deteriorou`,
          contexto: c.contexto, janelaAtual: janelas.atual, janelaReferencia: janelas.referencia,
          metrica: "Margem de processamento (aproximação)", unidade: "%",
          valorAtual: margemAtual.margemPct, valorReferencia: margemReferencia.margemPct,
          deltaAbsoluto: delta.deltaAbsoluto, deltaPercentual: delta.deltaPercentual,
          magnitude: severidade.magnitude, severidade: severidade.severidade, justificativaSeveridade: severidade.justificativa,
          persistente: severidade.persistente, percentualPeriodosAfetados: null,
          evidencias, impactos: [], possiveisFatores: fatores, confianca: "estimativa", amostra,
          filtrosDrillDown: filtrosDrillDown(c.contexto, janelas.atual), linkSugerido: "produtividade",
        });
      }
    }
  });

  return desvios.map((d) => ({ ...d, origemJanela }));
}

// ---------------------------------------------------------------------
// SEM PRODUÇÃO — sempre separado de paradas (§16). Denominador defensável
// = todos os períodos apontados da máquina (qualquer status) na janela
// atual. Nunca inventa minutos/custo/capacidade perdida.
// ---------------------------------------------------------------------

const LABEL_MOTIVO: Record<string, string> = {
  sem_programacao: "Sem programação", falta_material: "Falta de material",
  falta_operador: "Falta de operador", manutencao_programada: "Manutenção programada", outro: "Outro",
};

export function detectarDesviosSemProducao(apontamentosAtual: ApontamentoIndicador[], janelas: ParDeJanelas, origemJanela: "operacional" | "estrutural"): DesvioDetectado[] {
  const desvios: DesvioDetectado[] = [];
  const porMaquina = new Map<string, ApontamentoIndicador[]>();
  apontamentosAtual.forEach((ap) => {
    const atual = porMaquina.get(ap.maquinaId);
    if (atual) atual.push(ap);
    else porMaquina.set(ap.maquinaId, [ap]);
  });

  porMaquina.forEach((apsDaMaquina) => {
    const totalPeriodosApontados = periodosDistintos(apsDaMaquina); // qualquer status — período fechado da máquina
    if (totalPeriodosApontados < 3) return; // mesma ordem de grandeza da amostra mínima geral

    const semProducao = apsDaMaquina.filter((ap) => ap.status === "sem_producao");
    const porMotivo = new Map<string, ApontamentoIndicador[]>();
    semProducao.forEach((ap) => {
      const chave = ap.motivoSemProducao || "outro";
      const atual = porMotivo.get(chave);
      if (atual) atual.push(ap);
      else porMotivo.set(chave, [ap]);
    });

    porMotivo.forEach((regs, motivo) => {
      const periodosAfetados = periodosDistintos(regs);
      const persistencia = calcularPersistencia(periodosAfetados, totalPeriodosApontados);
      if (!persistencia.persistente || persistencia.percentual === null) return;

      const magnitude = classificarMagnitudeRecorrencia(persistencia.percentual);
      const severidade = avaliarSeveridadeGenerica(magnitude, true, false);
      const contexto: ContextoDesvio = {
        produtoId: null, produtoNome: null, operacaoId: null, operacaoNome: null,
        maquinaId: regs[0].maquinaId, maquinaNome: regs[0].maquinaNome,
      };
      const evidencia: Evidencia = {
        fonte: "Sem produção (Paradas V1)",
        descricao: `Registros explícitos de "${LABEL_MOTIVO[motivo] || motivo}" nesta máquina — sem minutos/custo/capacidade inventados.`,
        contexto: regs[0].maquinaNome, periodo: `${janelas.atual.dataInicial} a ${janelas.atual.dataFinal}`,
        valor: `${periodosAfetados} de ${totalPeriodosApontados} períodos apontados`,
      };
      desvios.push({
        id: idDesvio("sem_producao", "sem_producao_recorrente", contexto, janelas.atual),
        dominio: "sem_producao", tipo: "sem_producao_recorrente",
        titulo: `"${LABEL_MOTIVO[motivo] || motivo}" recorrente em ${regs[0].maquinaNome}`,
        contexto, janelaAtual: janelas.atual, janelaReferencia: janelas.atual,
        metrica: `Períodos com "${LABEL_MOTIVO[motivo] || motivo}"`, unidade: "%",
        valorAtual: persistencia.percentual, valorReferencia: 0,
        deltaAbsoluto: periodosAfetados, deltaPercentual: null,
        magnitude, severidade: severidade.severidade, justificativaSeveridade: severidade.justificativa,
        persistente: true, percentualPeriodosAfetados: persistencia.percentual,
        evidencias: [evidencia], impactos: [], possiveisFatores: [], confianca: "calculado",
        amostra: {
          suficiente: true, periodosJanelaAtual: totalPeriodosApontados, periodosJanelaReferencia: totalPeriodosApontados,
          minutosProdutivosJanelaAtual: 0, minutosProdutivosJanelaReferencia: 0,
          volumeProduzidoJanelaAtual: null, metaPeriodoMediaContexto: null, motivoInsuficiencia: null,
        },
        filtrosDrillDown: { dataInicial: janelas.atual.dataInicial, dataFinal: janelas.atual.dataFinal, maquinaId: contexto.maquinaId || undefined },
        linkSugerido: "paradas",
        origemJanela,
      });
    });
  });

  return desvios;
}

// ---------------------------------------------------------------------
// FLUXO — reusa detectarPossivelRestricaoOperacional sem recalcular nada.
// Sempre confiança "estimativa", severidade nunca escala pra crítico no
// V1 (a própria função já é conservadora — "2 de 3 sinais" — não temos
// base pra empilhar outro nível de certeza em cima dela).
// ---------------------------------------------------------------------

export function detectarDesviosFluxo(apontamentosAtual: ApontamentoIndicador[], janelas: ParDeJanelas, origemJanela: "operacional" | "estrutural"): DesvioDetectado[] {
  const desvios: DesvioDetectado[] = [];
  const gruposProduto = agruparPorProduto(apontamentosAtual, []);

  gruposProduto.forEach((g) => {
    const resultado = detectarPossivelRestricaoOperacional(g.apontamentos, apontamentosAtual);
    if (!resultado || !resultado.etapaSinalizada) return;

    const etapa = resultado.etapaSinalizada;
    const contexto: ContextoDesvio = {
      produtoId: resultado.produtoId, produtoNome: resultado.produtoNome,
      operacaoId: null, operacaoNome: etapa.operacaoNome, maquinaId: null, maquinaNome: null,
    };
    const evidencia: Evidencia = {
      fonte: "detectarPossivelRestricaoOperacional (Motor Econômico V1)",
      descricao: resultado.observacao,
      contexto: `${resultado.produtoNome} — ${etapa.operacaoNome}`,
      periodo: `${janelas.atual.dataInicial} a ${janelas.atual.dataFinal}`,
      valor: `${etapa.sinais} sinal(is) de 3 possíveis`,
    };
    desvios.push({
      id: idDesvio("fluxo", "possivel_restricao_operacional", contexto, janelas.atual),
      dominio: "fluxo", tipo: "possivel_restricao_operacional",
      titulo: `Possível restrição operacional em ${resultado.produtoNome} — ${etapa.operacaoNome}`,
      contexto, janelaAtual: janelas.atual, janelaReferencia: janelas.atual,
      metrica: "Sinais de possível restrição operacional", unidade: "%",
      valorAtual: etapa.sinais, valorReferencia: 0, deltaAbsoluto: etapa.sinais, deltaPercentual: null,
      magnitude: "relevante", severidade: "atencao",
      justificativaSeveridade: "Estimativa conservadora (2+ de 3 sinais independentes) — nunca escala pra Crítico no V1 sem mais uma camada de confirmação.",
      persistente: false, percentualPeriodosAfetados: null,
      evidencias: [evidencia], impactos: [], possiveisFatores: [{ fator: etapa.operacaoNome, descricao: "Possível fator associado — vale investigar esta etapa como restrição do fluxo.", evidencia }],
      confianca: "estimativa",
      amostra: {
        suficiente: true, periodosJanelaAtual: g.apontamentos.length, periodosJanelaReferencia: g.apontamentos.length,
        minutosProdutivosJanelaAtual: 0, minutosProdutivosJanelaReferencia: 0,
        volumeProduzidoJanelaAtual: null, metaPeriodoMediaContexto: null, motivoInsuficiencia: null,
      },
      filtrosDrillDown: { dataInicial: janelas.atual.dataInicial, dataFinal: janelas.atual.dataFinal, produtoId: contexto.produtoId || undefined },
      linkSugerido: "produtividade",
      origemJanela,
    });
  });

  return desvios;
}
