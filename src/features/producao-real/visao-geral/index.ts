// Visão Geral da Produção Real V1 — orquestrador. Só composição: cada
// número vem de uma função oficial já existente (Indicadores, Paradas,
// Desvios, Validação da Previsão), nunca recalculada aqui. Recebe os
// dados JÁ buscados (mesmo padrão de Desvios/Funcionários/Validação da
// Previsão) — nenhuma chamada de rede nesta camada.
//
// JANELAS (§3, aprovado): Saúde da fábrica e Paradas usam SEMPRE "semana
// atual até agora" (calcularJanelaOperacional(agora).atual — mesma janela
// oficial de Desvios V1, nunca uma janela nova). Desvios usa suas duas
// janelas oficiais internamente (gerarFilaDesvios já resolve isso
// sozinho). Validação da Previsão precisa EXATAMENTE dos últimos 14 dias
// — por isso `apontamentos28dias`/`paradas28dias` são recortados
// EXPLICITAMENTE aqui antes de entrar em gerarValidacaoPrevisao (nunca os
// 28 dias inteiros, isso violaria a amostra mínima já aprovada lá).

import type { Produto, Maquina, PeriodoComDuracao, Previsao } from "@/types/domain";
import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import type { ParadaComContexto } from "@/features/producao-real/paradas/calculations";
import { calcularResumoIndicadores } from "@/features/producao-real/indicadores/calculations";
import { calcularResumoParadas, calcularParetoParadasPorMetrica, agruparParadasPorMaquina } from "@/features/producao-real/paradas/calculations";
import { calcularJanelaOperacional } from "@/features/producao-real/desvios/janelas";
import { gerarFilaDesvios } from "@/features/producao-real/desvios";
import { gerarValidacaoPrevisao } from "@/features/producao-real/validacao-previsao";
import { formatarTempoDecorrido } from "@/lib/tempoDecorrido";
import { toISODate } from "@/lib/date";
import type { OcorrenciaAbertaComMaquina } from "@/hooks/useOcorrenciasAbertas";
import type {
  ResultadoVisaoGeralProducaoReal, JanelaRotulada, FactoryHealth, ForecastSemana,
  OcorrenciaAbertaResumo, DowntimeResumo, RecursoPressionadoResumo,
} from "@/features/producao-real/visao-geral/types";

export * from "@/features/producao-real/visao-geral/types";

export const JANELA_HISTORICA_VALIDACAO_DIAS = 14;

function filtrarPorJanela<T extends { data: string }>(itens: T[], dataInicial: string, dataFinal: string): T[] {
  return itens.filter((i) => i.data >= dataInicial && i.data <= dataFinal);
}

// Recorte EXPLÍCITO dos últimos 14 dias a partir de um array já buscado
// (ex.: os mesmos 28 dias usados por Indicadores/Paradas/Desvios) — nunca
// uma nova chamada de rede, só um filtro client-side. Exportada pra poder
// ser testada isoladamente (garantir que Validação nunca recebe 28 dias).
export function recortarUltimos14Dias<T extends { data: string }>(itens: T[], agora: Date): T[] {
  const dataInicial = toISODate(new Date(agora.getTime() - JANELA_HISTORICA_VALIDACAO_DIAS * 24 * 60 * 60 * 1000));
  const dataFinal = toISODate(agora);
  return filtrarPorJanela(itens, dataInicial, dataFinal);
}

export function gerarVisaoGeralProducaoReal(
  apontamentos28dias: ApontamentoIndicador[],
  paradas28dias: ParadaComContexto[],
  previsaoSemanaAtual: Previsao | null,
  produtos: Produto[],
  maquinas: Maquina[],
  periodosComDuracao: PeriodoComDuracao[],
  diasUteisSemana: number,
  ocorrenciasAbertas: OcorrenciaAbertaComMaquina[],
  agora: Date = new Date()
): ResultadoVisaoGeralProducaoReal {
  // ---- janela "semana atual até agora" — mesma fonte oficial de Desvios V1 ----
  const janelaOperacional = calcularJanelaOperacional(agora).atual;
  const janelaSemanaRotulada: JanelaRotulada = { ...janelaOperacional, rotulo: "Semana atual até agora" };

  const apontamentosSemana = filtrarPorJanela(apontamentos28dias, janelaOperacional.dataInicial, janelaOperacional.dataFinal);
  const paradasSemana = filtrarPorJanela(paradas28dias, janelaOperacional.dataInicial, janelaOperacional.dataFinal);

  // ---- Faixa 1 — Saúde da fábrica (§5): calcularResumoIndicadores, nunca recalculado ----
  const resumoSemana = calcularResumoIndicadores(apontamentosSemana, paradasSemana);
  const factoryHealth: FactoryHealth = {
    janela: janelaSemanaRotulada,
    performancePct: resumoSemana.performancePct,
    disponibilidadePct: resumoSemana.disponibilidadePct,
    qualidadePct: resumoSemana.qualidadePct,
    oeePct: resumoSemana.oeePct,
    minutosParadosTotais: resumoSemana.minutosParadosTotais,
    temDados: apontamentosSemana.length > 0,
  };

  // ---- Faixa 2 — Situação da semana (§6/§7): reaproveita Validação da Previsão, SÓ com os últimos 14 dias ----
  const apontamentos14dias = recortarUltimos14Dias(apontamentos28dias, agora);
  const paradas14dias = recortarUltimos14Dias(paradas28dias, agora);

  const temPrevisao = !!previsaoSemanaAtual && previsaoSemanaAtual.itens.length > 0;
  const resultadoValidacao = temPrevisao
    ? gerarValidacaoPrevisao(previsaoSemanaAtual as Previsao, produtos, maquinas, periodosComDuracao, diasUteisSemana, apontamentos14dias, paradas14dias, agora)
    : null;

  const porEstado = { concluido: 0, no_ritmo: 0, atencao: 0, inviavel_teoricamente: 0, sem_estimativa: 0 };
  let maiorDeficit: ForecastSemana["maiorDeficit"] = null;
  if (resultadoValidacao) {
    resultadoValidacao.itens.forEach((it) => {
      porEstado[it.estado] += 1;
      if (it.deficitProjetado !== null && it.deficitProjetado > 0) {
        if (!maiorDeficit || it.deficitProjetado > maiorDeficit.deficitProjetado) {
          maiorDeficit = { produtoId: it.produtoId, produtoNome: it.produtoNome, deficitProjetado: it.deficitProjetado };
        }
      }
    });
  }
  const forecast: ForecastSemana = {
    temPrevisao,
    porEstado,
    maiorDeficit,
    filtrosDrillDown: { dataInicial: janelaOperacional.dataInicial, dataFinal: janelaOperacional.dataFinal },
  };

  // ---- Faixa 3 — Agora (§8): ocorrências abertas, já buscadas ----
  const openOccurrences: OcorrenciaAbertaResumo[] = ocorrenciasAbertas.map((o) => ({
    id: o.id, maquinaId: o.maquinaId, maquinaNome: o.maquinaNome, motivoNome: o.motivoNome,
    descricao: o.descricao, abertaEm: o.abertaEm,
    tempoDecorridoRotulo: formatarTempoDecorrido(o.abertaEm, agora),
  }));

  // ---- Faixa 3 — Principais atenções (§9): gerarFilaDesvios já prioriza, top 3 ----
  const { incidentes } = gerarFilaDesvios(apontamentos28dias, paradas28dias, agora);
  const attentionItems = incidentes.slice(0, 3);

  // ---- Faixa 5 — Paradas (§10): mesma janela "semana atual", só funções oficiais ----
  const resumoParadasSemana = calcularResumoParadas(paradasSemana, apontamentosSemana);
  const paretoMinutos = calcularParetoParadasPorMetrica(paradasSemana, "minutos");
  const porMaquina = agruparParadasPorMaquina(paradasSemana, apontamentosSemana); // já vem ordenado desc por minutos
  const downtime: DowntimeResumo = {
    janela: janelaSemanaRotulada,
    temDados: paradasSemana.length > 0,
    minutosParadosTotal: resumoParadasSemana.minutosParadosTotal,
    principalMotivo: paretoMinutos.length > 0 ? { motivoNome: paretoMinutos[0].motivoNome, minutos: paretoMinutos[0].minutos } : null,
    maquinaMaisAfetada: porMaquina.length > 0 ? { maquinaNome: porMaquina[0].rotulo, minutos: porMaquina[0].resumo.minutosParadosTotal } : null,
    capacidadePerdidaTotal: resumoParadasSemana.capacidadePerdidaTotal,
  };

  // ---- Faixa 6 — Recurso mais pressionado (§11): reaproveita recursosPressionados, sem capar pctUso ----
  let pressuredResource: RecursoPressionadoResumo | null = null;
  if (resultadoValidacao && resultadoValidacao.recursosPressionados.length > 0) {
    const maisPressionado = [...resultadoValidacao.recursosPressionados].sort((a, b) => b.pctUso - a.pctUso)[0];
    pressuredResource = {
      maquinaId: maisPressionado.maquinaId, maquinaNome: maisPressionado.maquinaNome,
      horasNecessariasRestantes: maisPressionado.horasNecessariasRestantes, horasRestantes: maisPressionado.horasRestantes,
      pctUso: maisPressionado.pctUso, gargalo: maisPressionado.gargalo,
    };
  }

  return {
    geradoEm: agora.toISOString(),
    factoryHealth,
    forecast,
    openOccurrences,
    attentionItems,
    downtime,
    pressuredResource,
    dataQuality: {
      apontamentosSemanaAtual: apontamentosSemana.length > 0,
      previsaoLancada: temPrevisao,
      ocorrenciasCarregadas: true, // o chamador só passa ocorrenciasAbertas depois de buscou=true
    },
    drillDown: {
      produtividade: { dataInicial: janelaOperacional.dataInicial, dataFinal: janelaOperacional.dataFinal },
      paradas: { dataInicial: janelaOperacional.dataInicial, dataFinal: janelaOperacional.dataFinal },
    },
  };
}
