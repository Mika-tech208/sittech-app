// Validação da Previsão V1 — orquestrador. Junta tempo restante +
// capacidade teórica/provável (reaproveitando o motor de Capacidade já
// existente) + evidências + classificação de estado. Nenhuma fórmula
// oficial recalculada — só comparação e composição.

import type { Produto, Maquina, PeriodoComDuracao, Previsao, PrevisaoItem } from "@/types/domain";
import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import type { ParadaComContexto } from "@/features/producao-real/paradas/calculations";
import { calcularAnaliseCapacidadeSemanal } from "@/features/capacidade/calculations";
import { calcularHorasPorDia, filtrarPeriodosValidos } from "@/lib/calculations/periodos";
import { calcularTempoRestanteSemana } from "@/features/producao-real/validacao-previsao/tempoRestante";
import { calcularProducaoAcabadaObservadaPorProduto, calcularDivergenciaRealizado, calcularFaltaOperacional } from "@/features/producao-real/validacao-previsao/producaoAcabada";
import { calcularCapacidadeTeoricaRestante } from "@/features/producao-real/validacao-previsao/capacidadeTeorica";
import { calcularCapacidadeProvavelItem, calcularInsumosCompartilhamento } from "@/features/producao-real/validacao-previsao/capacidadeProvavel";
import { calcularProdutosForaDaPrevisao, calcularEvidenciasSemProducao, calcularRestricoesObservadas } from "@/features/producao-real/validacao-previsao/evidencias";
import { classificarEstado } from "@/features/producao-real/validacao-previsao/estado";
import { toISODate } from "@/lib/date";
import type { ItemValidacaoPrevisao, ResultadoValidacaoPrevisao } from "@/features/producao-real/validacao-previsao/types";

export * from "@/features/producao-real/validacao-previsao/types";
export * from "@/features/producao-real/validacao-previsao/tempoRestante";
export * from "@/features/producao-real/validacao-previsao/thresholds";

function filtrarPorJanela<T extends { data: string }>(itens: T[], dataInicial: string, dataFinal: string): T[] {
  return itens.filter((i) => i.data >= dataInicial && i.data <= dataFinal);
}

function somaRealizadoOficialPorProduto(itensRealizados: PrevisaoItem[]): Map<string, number> {
  const mapa = new Map<string, number>();
  itensRealizados.forEach((it) => mapa.set(it.produtoId, (mapa.get(it.produtoId) || 0) + it.quantidade));
  return mapa;
}

export function gerarValidacaoPrevisao(
  previsaoSemana: Previsao,
  produtos: Produto[],
  maquinas: Maquina[],
  periodosComDuracao: PeriodoComDuracao[],
  diasUteisSemana: number,
  apontamentosJanelaHistorica: ApontamentoIndicador[], // já cobre os últimos 14 dias até agora (uma única busca, fatiada aqui)
  paradasJanelaHistorica: ParadaComContexto[],
  agora: Date = new Date()
): ResultadoValidacaoPrevisao {
  const maquinasIndisponiveis = previsaoSemana.maquinasIndisponiveis || [];
  const maquinaNomePorId = new Map(maquinas.map((m) => [m.id, m.nome]));

  const horasPorDia = calcularHorasPorDia(filtrarPeriodosValidos(periodosComDuracao));
  const { horasRestantes } = calcularTempoRestanteSemana(periodosComDuracao, previsaoSemana.semanaInicio, diasUteisSemana, horasPorDia, agora);

  const hojeISO = toISODate(agora);
  const apontamentosSemanaAtual = filtrarPorJanela(apontamentosJanelaHistorica, previsaoSemana.semanaInicio, hojeISO);

  const realizadoOficialPorProduto = somaRealizadoOficialPorProduto(previsaoSemana.itensRealizados || []);
  const producaoAcabadaPorProduto = calcularProducaoAcabadaObservadaPorProduto(apontamentosSemanaAtual);

  // ---- falta operacional por item -> alimenta o motor de capacidade já existente ----
  const itensComFalta: PrevisaoItem[] = previsaoSemana.itens.map((it) => {
    const producaoAcabadaObservada = producaoAcabadaPorProduto.get(it.produtoId) || 0;
    const faltaOperacional = calcularFaltaOperacional(it.quantidade, producaoAcabadaObservada);
    return { ...it, quantidade: faltaOperacional };
  });

  const capacidadeTeorica = calcularCapacidadeTeoricaRestante(itensComFalta, produtos, maquinas, periodosComDuracao, horasRestantes, maquinasIndisponiveis);

  // ---- recursos pressionados (visão fábrica) — reaproveita calcularAnaliseCapacidadeSemanal tal como está ----
  const itensFiltradosIndisponiveis = itensComFalta.map((it) => ({
    ...it,
    maquinasPorEtapa: Object.fromEntries(Object.entries(it.maquinasPorEtapa || {}).map(([etapaId, ids]) => [etapaId, (ids || []).filter((id) => !maquinasIndisponiveis.includes(id))])),
  }));
  const analiseFabrica = calcularAnaliseCapacidadeSemanal(itensFiltradosIndisponiveis, produtos, maquinas, periodosComDuracao, horasRestantes);
  const recursosPressionados = analiseFabrica.maquinas.map((m) => ({
    maquinaId: m.maquinaId, maquinaNome: m.nome, horasRestantes: m.horasDisponiveis, horasNecessariasRestantes: m.horasNecessarias,
    pctUso: m.pct, gargalo: m.status === "gargalo",
  }));

  // Insumos de compartilhamento (§8, corrigido) — mesmos itens já filtrados
  // de indisponíveis usados acima pra "recursos pressionados"; base pra
  // capacidade provável EM PEÇAS por máquina, nunca recalcula
  // fatorItem/etapaLimitante/maximoPossivel (isso continua só em capacidadeTeorica.ts).
  const { porMaquina, fatorReducaoPorMaquina } = calcularInsumosCompartilhamento(itensFiltradosIndisponiveis, produtos, periodosComDuracao, horasRestantes);

  const produtosIdsPrevistos = new Set(previsaoSemana.itens.map((it) => it.produtoId));
  const produtosForaDaPrevisao = calcularProdutosForaDaPrevisao(apontamentosSemanaAtual, produtosIdsPrevistos);
  const evidenciasSemProducaoTodas = calcularEvidenciasSemProducao(apontamentosSemanaAtual);

  const itens: ItemValidacaoPrevisao[] = previsaoSemana.itens.map((it) => {
    const produto = produtos.find((p) => p.id === it.produtoId);
    const producaoAcabadaObservada = producaoAcabadaPorProduto.get(it.produtoId) || 0;
    const realizadoOficial = realizadoOficialPorProduto.get(it.produtoId) || 0;
    const divergenciaRealizado = calcularDivergenciaRealizado(producaoAcabadaObservada, realizadoOficial);
    const faltaOperacional = calcularFaltaOperacional(it.quantidade, producaoAcabadaObservada);

    const resultadoCap = capacidadeTeorica.resultadosPorItem.find((r) => r.itemId === it.id);
    const capacidadeTeoricaRestanteItem = resultadoCap ? resultadoCap.maximoPossivel : 0;
    const restricaoTeorica = resultadoCap?.etapaLimitante ? { etapaOuMaquina: resultadoCap.etapaLimitante, fonte: "capacidadeMaximaSemana" as const } : null;

    // Capacidade provável já vem EM PEÇAS (§8, corrigido): soma de máquinas
    // paralelas dentro de cada etapa, depois MIN entre etapas sequenciais —
    // nunca um fator único aplicado sobre `capacidadeTeoricaRestanteItem`
    // (teórica e provável apuram sua própria etapa limitante de forma
    // independente, podem divergir).
    const resultadoProvavel = produto
      ? calcularCapacidadeProvavelItem(it, produto, maquinaNomePorId, maquinasIndisponiveis, apontamentosJanelaHistorica, porMaquina, fatorReducaoPorMaquina, periodosComDuracao)
      : { capacidadePecas: null, etapasAvaliadas: [], fatoresUsados: [] };
    const capacidadeProvavelRestante = resultadoProvavel.capacidadePecas;

    const estado = classificarEstado(faltaOperacional, capacidadeTeoricaRestanteItem, capacidadeProvavelRestante);
    const projecaoFinal = capacidadeProvavelRestante !== null ? producaoAcabadaObservada + capacidadeProvavelRestante : null;
    const deficitProjetado = projecaoFinal !== null ? Math.max(0, it.quantidade - projecaoFinal) : null;

    const performanceAcimaMeta = resultadoProvavel.fatoresUsados.some((f) => f.performanceSustentadaAcimaDeMeta);
    const confianca: ItemValidacaoPrevisao["confianca"] = capacidadeProvavelRestante === null ? "indisponivel" : performanceAcimaMeta ? "estimativa" : "calculado";

    const restricoesObservadas = calcularRestricoesObservadas(it.produtoId, it.produtoNome, apontamentosJanelaHistorica, paradasJanelaHistorica);

    return {
      itemId: it.id, produtoId: it.produtoId, produtoNome: it.produtoNome, semanaInicio: previsaoSemana.semanaInicio,
      previsto: it.quantidade, realizadoOficial, producaoAcabadaObservada, divergenciaRealizado, faltaOperacional,
      tempoRestanteHoras: horasRestantes,
      capacidadeTeoricaRestante: capacidadeTeoricaRestanteItem, capacidadeProvavelRestante, fatoresProvaveisUsados: resultadoProvavel.fatoresUsados,
      projecaoFinal, deficitProjetado,
      estado, confianca,
      restricaoTeorica, restricoesObservadas,
      wipLimitacaoAplicavel: (produto?.roteiro || []).length > 1,
      filtrosDrillDown: { dataInicial: previsaoSemana.semanaInicio, dataFinal: hojeISO, produtoId: it.produtoId },
    };
  });

  return {
    semanaInicio: previsaoSemana.semanaInicio, tempoRestanteHoras: horasRestantes, itens, recursosPressionados,
    produtosForaDaPrevisao, evidenciasSemProducao: evidenciasSemProducaoTodas,
  };
}
