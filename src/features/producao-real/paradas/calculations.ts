// Paradas V1 — motor de cálculo central. Funções puras, sem I/O.
// Reaproveita o motor de Indicadores V1 (agrupamento, GrupoIndicadores,
// ApontamentoIndicador) e o Motor Econômico V1 (mesma disciplina de
// custo/hora e meta como snapshot congelado) — nenhuma fórmula oficial é
// duplicada aqui, só reorganizada com foco em perda de tempo/capacidade.
//
// ORIGEM (manual x ocorrência): cada linha de apontamento_paradas já é
// única por constraint no banco (migration 9) — somar esta lista nunca
// duplica minutos/custo, independente da origem. `origem` só existe pra
// permitir filtrar/segmentar a visão, nunca pra decidir o que somar.
//
// RATEIO POR PARADA (custo do tempo ocioso / capacidade local perdida):
// dentro de UM apontamento, custo_hora_operacao_vigente e meta_periodo_
// vigente/duracao são CONSTANTES — um apontamento pode ter várias
// paradas de motivos diferentes, mas todas compartilham o mesmo custo/
// hora e a mesma meta/duração. Como as duas fórmulas já são lineares em
// minutos, aplicá-las à duração de CADA parada (em vez de à soma
// agregada do apontamento, como o Motor Econômico V1 já fazia) dá o
// resultado exato — CALCULADO, não aproximação.
//
// "% do tempo apontado perdido" = minutos parados / duração total dos
// apontamentos PRODUZINDO do filtro × 100 — nunca inclui sem_producao no
// denominador (não é parada) e nunca é chamado de "disponibilidade da
// fábrica" (não existe calendário de quando cada máquina deveria rodar).

import type { ApontamentoIndicador, GrupoIndicadores } from "@/features/producao-real/indicadores/calculations";

export type NivelConfianca = "fato" | "calculado";
export type OrigemParada = "manual" | "ocorrencia";

export interface ParadaComContexto {
  paradaId: string;
  apontamentoId: string;
  data: string;
  periodoId: string;
  minutos: number;
  motivoId: string;
  motivoNome: string;
  motivoCategoria: string;
  origem: OrigemParada;
  produtoId: string | null;
  produtoNome: string | null;
  maquinaId: string;
  maquinaNome: string;
  operacaoId: string | null;
  operacaoNome: string | null;
  funcionarioId: string | null;
  funcionarioNome: string | null;
  // Snapshots do apontamento pai (migration 28) — mesma disciplina de
  // congelamento do Motor Econômico V1. Null quando o apontamento pai é
  // 'sem_producao' (nunca deveria ocorrer na prática — paradas só
  // existem hoje em apontamentos 'produzindo' — mas o rateio trata isso
  // com N/A em vez de presumir).
  custoHoraOperacaoVigente: number | null;
  metaPeriodoVigente: number | null;
  duracaoPeriodoHorasVigente: number | null;
  // Texto livre operacional (migration 32) — "problema" vem de
  // apontamento_paradas.descricao (preenchido na abertura da ocorrência,
  // ou no próprio lançamento manual quando o motivo exige descrição).
  // "solução" só existe pra paradas de origem 'ocorrencia' (vem de
  // ocorrencias_maquina.descricao_solucao via join) — null pra paradas
  // manuais, onde esse conceito não existe.
  descricaoProblema: string | null;
  descricaoSolucao: string | null;
  // Migration 34 — pra agrupar segmentos da MESMA ocorrência em um único
  // card na tela (§"Ajuste da regra — exibir como uma única parada").
  // ocorrenciaId é null pra paradas manuais (nada a agrupar).
  ocorrenciaId: string | null;
  // Janela real da ocorrência-mãe (null pra paradas manuais) — usada pra
  // calcular a duração TOTAL exibida no card agrupado a partir de
  // encerradaEm − abertaEm, nunca da soma dos minutos já arredondados de
  // cada segmento.
  ocorrenciaAbertaEm: string | null;
  ocorrenciaEncerradaEm: string | null;
}

// Trecho (intervalo de tempo) de uma ocorrência de máquina encerrada SEM
// segmento correspondente em apontamento_paradas (migration 34 — substitui
// o desenho anterior "ocorrência inteira órfã", migration 33, nunca
// aplicado). Cobre tanto ocorrência totalmente sem apontamento quanto
// PARCIALMENTE coberta (caso real Rosqueadeira 3: um período com
// apontamento, outro sem) — cada trecho já vem fatiado por período, com a
// meta correta DAQUELE período.
//
// Contexto é ESTIMATIVA, minimizada ao máximo: só produtoEstimadoId/Nome
// são presumidos (apontamento anterior da mesma máquina, em ordem
// OPERACIONAL — nunca criado_em). metaPeriodoEstimada é REAL pro produto
// presumido (vem do cadastro — roteiro —, não é inventada) — só fica null
// quando a elegibilidade produto×máquina é ambígua/inexistente. Não busca
// valor_unitario do produto — capacidade local perdida NÃO é faturamento
// bloqueado (decisão explícita: monetizar perda de uma operação pelo
// preço do produto ACABADO ignora que o produto ainda passa por outras
// etapas do roteiro; essa conta pertence ao Motor Econômico/Intelligence
// futuramente, considerando roteiro completo/gargalos/capacidade
// recuperável). Nenhum snapshot é
// persistido em lugar nenhum — sempre recalculado na consulta; quando um
// apontamento real cobrir esse período, o trecho some sozinho da próxima
// busca (não precisa "substituir" nada).
//
// Deliberadamente NÃO é um ParadaComContexto e NÃO entra em nenhuma
// função de cálculo deste arquivo (Resumo/Pareto/Evolução/Recorrência/
// Recurso/Sem produção continuam exatamente como antes, só recebendo
// ParadaComContexto[]). Só é consumido por agruparParadasPorOcorrencia,
// pra montar o card único da ocorrência no Detalhado.
export interface TrechoOcorrenciaSemApontamento {
  ocorrenciaId: string;
  maquinaId: string;
  maquinaNome: string;
  motivoId: string;
  motivoNome: string;
  motivoCategoria: string;
  ocorrenciaAbertaEm: string;
  ocorrenciaEncerradaEm: string;
  descricaoProblema: string;
  descricaoSolucao: string;
  periodoId: string;
  trechoInicio: string;
  trechoFim: string;
  minutos: number;
  duracaoPeriodoMinutos: number;
  produtoEstimadoId: string | null;
  produtoEstimadoNome: string | null;
  metaPeriodoEstimada: number | null;
  temEstimativa: boolean;
}

// ---------------------------------------------------------------------
// Rateio por parada individual
// ---------------------------------------------------------------------

export function calcularCustoTempoOciosoParada(p: ParadaComContexto): number | null {
  if (p.custoHoraOperacaoVigente === null) return null;
  return p.custoHoraOperacaoVigente * (p.minutos / 60);
}

export function calcularCapacidadePerdidaParada(p: ParadaComContexto): number | null {
  if (p.metaPeriodoVigente === null || p.duracaoPeriodoHorasVigente === null) return null;
  const duracaoMinutos = p.duracaoPeriodoHorasVigente * 60;
  if (duracaoMinutos <= 0) return null;
  return (p.metaPeriodoVigente / duracaoMinutos) * p.minutos;
}

// Mesma fórmula acima, pro trecho ESTIMADO de uma ocorrência sem
// apontamento (migration 34) — usa metaPeriodoEstimada/duracaoPeriodoMinutos
// no lugar dos snapshots do apontamento, porque não existe apontamento
// nesse trecho. Sempre null quando a estimativa não foi possível
// (temEstimativa=false) — nunca um 0 fictício. Deliberadamente NÃO existe
// um "custo do tempo ocioso" pro trecho estimado — custo/hora depende de
// contexto de operação/funcionário que um trecho sem apontamento não tem;
// inventar isso seria o mesmo erro que motivou a remoção do Faturamento
// potencial.
export function calcularCapacidadePerdidaTrecho(t: TrechoOcorrenciaSemApontamento): number | null {
  if (t.metaPeriodoEstimada === null || t.duracaoPeriodoMinutos <= 0) return null;
  return (t.metaPeriodoEstimada / t.duracaoPeriodoMinutos) * t.minutos;
}

function somarOuNull(valores: (number | null)[]): number | null {
  const validos = valores.filter((v): v is number => v !== null);
  return validos.length > 0 ? validos.reduce((s, v) => s + v, 0) : null;
}

// ---------------------------------------------------------------------
// Resumo — cards principais. `apontamentosDoFiltro` é necessário só pro
// denominador do % de tempo perdido (duração dos apontamentos
// produzindo) — nunca usado pra inventar minutos de parada.
// ---------------------------------------------------------------------

export interface ResumoParadas {
  minutosParadosTotal: number;
  horasParadasTotal: number;
  quantidadeParadas: number;
  duracaoMediaMinutos: number | null;
  maiorParadaMinutos: number | null;
  custoTempoOciosoTotal: number | null;
  capacidadePerdidaTotal: number | null;
  // FATO/CALCULADO (§13): pctTempoApontadoPerdido é CALCULADO, nunca
  // "disponibilidade da fábrica" — só cobre o universo apontado como
  // produzindo no filtro atual.
  pctTempoApontadoPerdido: number | null;
}

export function calcularResumoParadas(paradas: ParadaComContexto[], apontamentosDoFiltro: ApontamentoIndicador[]): ResumoParadas {
  const minutosParadosTotal = paradas.reduce((s, p) => s + p.minutos, 0);
  const quantidadeParadas = paradas.length;
  const duracaoMediaMinutos = quantidadeParadas > 0 ? minutosParadosTotal / quantidadeParadas : null;
  const maiorParadaMinutos = quantidadeParadas > 0 ? Math.max(...paradas.map((p) => p.minutos)) : null;
  const custoTempoOciosoTotal = somarOuNull(paradas.map(calcularCustoTempoOciosoParada));
  const capacidadePerdidaTotal = somarOuNull(paradas.map(calcularCapacidadePerdidaParada));

  const duracaoTotalProduzindoMinutos = apontamentosDoFiltro
    .filter((ap) => ap.status === "produzindo")
    .reduce((s, ap) => s + ap.duracaoPeriodoHorasVigente * 60, 0);
  const pctTempoApontadoPerdido =
    duracaoTotalProduzindoMinutos > 0 ? (minutosParadosTotal / duracaoTotalProduzindoMinutos) * 100 : null;

  return {
    minutosParadosTotal,
    horasParadasTotal: minutosParadosTotal / 60,
    quantidadeParadas,
    duracaoMediaMinutos,
    maiorParadaMinutos,
    custoTempoOciosoTotal,
    capacidadePerdidaTotal,
    pctTempoApontadoPerdido,
  };
}

// ---------------------------------------------------------------------
// Pareto com seletor de métrica — minutos/quantidade sempre confiáveis
// (fato); custo/capacidade marcam `baseConfiavel=false` quando NENHUMA
// parada daquele motivo tinha snapshot válido (nunca vira 0 fictício).
// ---------------------------------------------------------------------

export type MetricaParetoParadas = "minutos" | "quantidade" | "custo" | "capacidade";

export interface ParetoParadasItem {
  motivoId: string;
  motivoNome: string;
  motivoCategoria: string;
  minutos: number;
  quantidadeParadas: number;
  custoTempoOcioso: number | null;
  capacidadePerdida: number | null;
  valor: number;
  baseConfiavel: boolean;
  percentualDoTotal: number;
  percentualAcumulado: number;
}

function valorPorMetrica(item: { minutos: number; quantidadeParadas: number; custoTempoOcioso: number | null; capacidadePerdida: number | null }, metrica: MetricaParetoParadas): number {
  switch (metrica) {
    case "minutos":
      return item.minutos;
    case "quantidade":
      return item.quantidadeParadas;
    case "custo":
      return item.custoTempoOcioso ?? 0;
    case "capacidade":
      return item.capacidadePerdida ?? 0;
  }
}

export function calcularParetoParadasPorMetrica(paradas: ParadaComContexto[], metrica: MetricaParetoParadas): ParetoParadasItem[] {
  const porMotivo = new Map<
    string,
    { nome: string; categoria: string; minutos: number; quantidade: number; custos: (number | null)[]; capacidades: (number | null)[] }
  >();

  paradas.forEach((p) => {
    const atual = porMotivo.get(p.motivoId);
    const custo = calcularCustoTempoOciosoParada(p);
    const capacidade = calcularCapacidadePerdidaParada(p);
    if (atual) {
      atual.minutos += p.minutos;
      atual.quantidade += 1;
      atual.custos.push(custo);
      atual.capacidades.push(capacidade);
    } else {
      porMotivo.set(p.motivoId, { nome: p.motivoNome, categoria: p.motivoCategoria, minutos: p.minutos, quantidade: 1, custos: [custo], capacidades: [capacidade] });
    }
  });

  const itensBase = Array.from(porMotivo.entries()).map(([motivoId, v]) => {
    const custoTempoOcioso = somarOuNull(v.custos);
    const capacidadePerdida = somarOuNull(v.capacidades);
    const baseConfiavel = metrica === "custo" ? custoTempoOcioso !== null : metrica === "capacidade" ? capacidadePerdida !== null : true;
    return {
      motivoId,
      motivoNome: v.nome,
      motivoCategoria: v.categoria,
      minutos: v.minutos,
      quantidadeParadas: v.quantidade,
      custoTempoOcioso,
      capacidadePerdida,
      baseConfiavel,
    };
  });

  const comValor = itensBase.map((item) => ({ ...item, valor: valorPorMetrica(item, metrica) }));
  const totalValor = comValor.reduce((s, i) => s + i.valor, 0);
  const ordenado = comValor.sort((a, b) => b.valor - a.valor);

  let acumulado = 0;
  return ordenado.map((item) => {
    const percentualDoTotal = totalValor > 0 ? (item.valor / totalValor) * 100 : 0;
    acumulado += percentualDoTotal;
    return { ...item, percentualDoTotal, percentualAcumulado: acumulado };
  });
}

// ---------------------------------------------------------------------
// Recorrência — unidade oficial: (data, periodo_id). Distingue evento
// isolado longo (quantidade baixa, duração média alta) de problema
// recorrente (períodos distintos afetados altos em relação ao total).
// ---------------------------------------------------------------------

export interface RecorrenciaItem {
  maquinaId: string;
  maquinaNome: string;
  motivoId: string;
  motivoNome: string;
  quantidadeParadas: number;
  periodosDistintosAfetados: number;
  totalPeriodosApontadosMaquina: number;
  percentualPeriodosAfetados: number | null;
  minutosTotais: number;
  duracaoMediaMinutos: number;
}

function chavePeriodo(data: string, periodoId: string): string {
  return `${data}|${periodoId}`;
}

export function calcularRecorrenciaParadas(paradas: ParadaComContexto[], apontamentosDoFiltro: ApontamentoIndicador[]): RecorrenciaItem[] {
  // Total de períodos apontados por máquina (qualquer status — é "período
  // apontado", não "período produzindo") no filtro atual.
  const periodosPorMaquina = new Map<string, Set<string>>();
  apontamentosDoFiltro.forEach((ap) => {
    const chave = chavePeriodo(ap.data, ap.periodoId);
    const atual = periodosPorMaquina.get(ap.maquinaId);
    if (atual) atual.add(chave);
    else periodosPorMaquina.set(ap.maquinaId, new Set([chave]));
  });

  const porMaquinaMotivo = new Map<
    string,
    { maquinaId: string; maquinaNome: string; motivoId: string; motivoNome: string; periodos: Set<string>; quantidade: number; minutos: number }
  >();

  paradas.forEach((p) => {
    const chaveGrupo = `${p.maquinaId}::${p.motivoId}`;
    const chaveP = chavePeriodo(p.data, p.periodoId);
    const atual = porMaquinaMotivo.get(chaveGrupo);
    if (atual) {
      atual.periodos.add(chaveP);
      atual.quantidade += 1;
      atual.minutos += p.minutos;
    } else {
      porMaquinaMotivo.set(chaveGrupo, {
        maquinaId: p.maquinaId,
        maquinaNome: p.maquinaNome,
        motivoId: p.motivoId,
        motivoNome: p.motivoNome,
        periodos: new Set([chaveP]),
        quantidade: 1,
        minutos: p.minutos,
      });
    }
  });

  return Array.from(porMaquinaMotivo.values())
    .map((v) => {
      const totalPeriodosApontadosMaquina = periodosPorMaquina.get(v.maquinaId)?.size ?? 0;
      return {
        maquinaId: v.maquinaId,
        maquinaNome: v.maquinaNome,
        motivoId: v.motivoId,
        motivoNome: v.motivoNome,
        quantidadeParadas: v.quantidade,
        periodosDistintosAfetados: v.periodos.size,
        totalPeriodosApontadosMaquina,
        percentualPeriodosAfetados: totalPeriodosApontadosMaquina > 0 ? (v.periodos.size / totalPeriodosApontadosMaquina) * 100 : null,
        minutosTotais: v.minutos,
        duracaoMediaMinutos: v.minutos / v.quantidade,
      };
    })
    .sort((a, b) => b.periodosDistintosAfetados - a.periodosDistintosAfetados);
}

// ---------------------------------------------------------------------
// Tendência — agnóstica de "semana": compara duas janelas quaisquer já
// filtradas pelo chamador. A página decide o recorte (default: últimos 7
// dias vs 7 dias anteriores a esses), mas a função em si não hardcoda
// nenhuma noção de semana — aceita qualquer par de janelas, inclusive
// mais largas no futuro (30 dias etc.).
// ---------------------------------------------------------------------

export interface ComparativoTendenciaParadas {
  janelaAtual: ResumoParadas;
  janelaAnterior: ResumoParadas;
  deltaMinutos: number;
  deltaQuantidade: number;
  deltaDuracaoMedia: number | null;
  deltaCusto: number | null;
  deltaCapacidadePerdida: number | null;
}

export function calcularComparativoTendenciaParadas(
  paradasJanelaAtual: ParadaComContexto[],
  apontamentosJanelaAtual: ApontamentoIndicador[],
  paradasJanelaAnterior: ParadaComContexto[],
  apontamentosJanelaAnterior: ApontamentoIndicador[]
): ComparativoTendenciaParadas {
  const janelaAtual = calcularResumoParadas(paradasJanelaAtual, apontamentosJanelaAtual);
  const janelaAnterior = calcularResumoParadas(paradasJanelaAnterior, apontamentosJanelaAnterior);

  const deltaDuracaoMedia =
    janelaAtual.duracaoMediaMinutos !== null && janelaAnterior.duracaoMediaMinutos !== null
      ? janelaAtual.duracaoMediaMinutos - janelaAnterior.duracaoMediaMinutos
      : null;
  const deltaCusto =
    janelaAtual.custoTempoOciosoTotal !== null && janelaAnterior.custoTempoOciosoTotal !== null
      ? janelaAtual.custoTempoOciosoTotal - janelaAnterior.custoTempoOciosoTotal
      : null;
  const deltaCapacidadePerdida =
    janelaAtual.capacidadePerdidaTotal !== null && janelaAnterior.capacidadePerdidaTotal !== null
      ? janelaAtual.capacidadePerdidaTotal - janelaAnterior.capacidadePerdidaTotal
      : null;

  return {
    janelaAtual,
    janelaAnterior,
    deltaMinutos: janelaAtual.minutosParadosTotal - janelaAnterior.minutosParadosTotal,
    deltaQuantidade: janelaAtual.quantidadeParadas - janelaAnterior.quantidadeParadas,
    deltaDuracaoMedia,
    deltaCusto,
    deltaCapacidadePerdida,
  };
}

// ---------------------------------------------------------------------
// Sem produção — SEMPRE separado do Pareto/análise de paradas. Só conta
// registros explícitos (status='sem_producao') — nunca inventa minutos,
// custo ou capacidade perdida pra esses registros (não há snapshot
// confiável: meta/custo_hora ficam NULL por design nesse status).
// ---------------------------------------------------------------------

export type MotivoSemProducao = "sem_programacao" | "falta_material" | "falta_operador" | "manutencao_programada" | "outro";

export interface SemProducaoContagem {
  chave: string;
  rotulo: string;
  quantidade: number;
}

export interface SemProducaoResumo {
  totalRegistros: number;
  porMotivo: SemProducaoContagem[];
  porMaquina: SemProducaoContagem[];
  porPeriodo: SemProducaoContagem[];
}

const LABEL_MOTIVO_SEM_PRODUCAO: Record<string, string> = {
  sem_programacao: "Sem programação",
  falta_material: "Falta de material",
  falta_operador: "Falta de operador",
  manutencao_programada: "Manutenção programada",
  outro: "Outro",
};

function contarPor(itens: { chave: string; rotulo: string }[]): SemProducaoContagem[] {
  const mapa = new Map<string, SemProducaoContagem>();
  itens.forEach(({ chave, rotulo }) => {
    const atual = mapa.get(chave);
    if (atual) atual.quantidade += 1;
    else mapa.set(chave, { chave, rotulo, quantidade: 1 });
  });
  return Array.from(mapa.values()).sort((a, b) => b.quantidade - a.quantidade);
}

// ---------------------------------------------------------------------
// Agrupamento genérico — base de "por dia", "por máquina", "por
// operação", "por produto". Mesma mecânica de agruparIndicadores
// (Indicadores V1), reescrita aqui só porque opera sobre
// ParadaComContexto[] (tipo estendido desta migration) em vez de
// ParadaIndicador[] — a FÓRMULA de resumo continua sendo sempre
// calcularResumoParadas, nunca duplicada.
// ---------------------------------------------------------------------

export interface GrupoParadas {
  chave: string;
  rotulo: string;
  paradas: ParadaComContexto[];
  apontamentos: ApontamentoIndicador[];
  resumo: ResumoParadas;
}

function agruparParadasGenerico(
  paradas: ParadaComContexto[],
  apontamentos: ApontamentoIndicador[],
  chaveFn: (p: ParadaComContexto) => string | null,
  rotuloFn: (p: ParadaComContexto) => string,
  chaveApontamentoFn: (ap: ApontamentoIndicador) => string | null
): GrupoParadas[] {
  const porChave = new Map<string, { rotulo: string; paradas: ParadaComContexto[] }>();
  paradas.forEach((p) => {
    const chave = chaveFn(p);
    if (chave === null) return;
    const atual = porChave.get(chave);
    if (atual) atual.paradas.push(p);
    else porChave.set(chave, { rotulo: rotuloFn(p), paradas: [p] });
  });

  return Array.from(porChave.entries())
    .map(([chave, { rotulo, paradas: paradasDoGrupo }]) => {
      const apontamentosDoGrupo = apontamentos.filter((ap) => chaveApontamentoFn(ap) === chave);
      return {
        chave,
        rotulo,
        paradas: paradasDoGrupo,
        apontamentos: apontamentosDoGrupo,
        resumo: calcularResumoParadas(paradasDoGrupo, apontamentosDoGrupo),
      };
    })
    .sort((a, b) => b.resumo.minutosParadosTotal - a.resumo.minutosParadosTotal);
}

export function agruparParadasPorDia(paradas: ParadaComContexto[], apontamentos: ApontamentoIndicador[]): GrupoParadas[] {
  return agruparParadasGenerico(
    paradas,
    apontamentos,
    (p) => p.data,
    (p) => p.data.split("-").reverse().join("/"),
    (ap) => ap.data
  ).sort((a, b) => a.chave.localeCompare(b.chave));
}

export function agruparParadasPorMaquina(paradas: ParadaComContexto[], apontamentos: ApontamentoIndicador[]): GrupoParadas[] {
  return agruparParadasGenerico(paradas, apontamentos, (p) => p.maquinaId, (p) => p.maquinaNome, (ap) => ap.maquinaId);
}

export function agruparParadasPorOperacao(paradas: ParadaComContexto[], apontamentos: ApontamentoIndicador[]): GrupoParadas[] {
  return agruparParadasGenerico(paradas, apontamentos, (p) => p.operacaoId, (p) => p.operacaoNome || "", (ap) => ap.operacaoId);
}

export function agruparParadasPorProduto(paradas: ParadaComContexto[], apontamentos: ApontamentoIndicador[]): GrupoParadas[] {
  return agruparParadasGenerico(paradas, apontamentos, (p) => p.produtoId, (p) => p.produtoNome || "", (ap) => ap.produtoId);
}

export function calcularSemProducaoResumo(apontamentosDoFiltro: ApontamentoIndicador[]): SemProducaoResumo {
  const semProducao = apontamentosDoFiltro.filter((ap) => ap.status === "sem_producao");

  const porMotivo = contarPor(
    semProducao.map((ap) => ({
      chave: ap.motivoSemProducao || "outro",
      rotulo: LABEL_MOTIVO_SEM_PRODUCAO[ap.motivoSemProducao || "outro"] || ap.motivoSemProducao || "Outro",
    }))
  );
  const porMaquina = contarPor(semProducao.map((ap) => ({ chave: ap.maquinaId, rotulo: ap.maquinaNome })));
  const porPeriodo = contarPor(semProducao.map((ap) => ({ chave: ap.periodoId, rotulo: ap.periodoNome })));

  return { totalRegistros: semProducao.length, porMotivo, porMaquina, porPeriodo };
}

// ---------------------------------------------------------------------
// Agrupamento por ocorrência (migration 34) — "uma ocorrencia_maquina =
// uma parada real" na tela. Usado SÓ pelo Detalhado (DrillDownParadasLista)
// — Resumo/Pareto/Evolução/Recorrência/Recurso/Sem produção continuam
// recebendo ParadaComContexto[] direto, sem passar por aqui, então
// continuam somando por segmento exatamente como antes (nenhuma mudança
// de comportamento nessas 6 visões).
//
// Duração total vem de ocorrenciaEncerradaEm − ocorrenciaAbertaEm (não da
// soma dos minutos já arredondados de cada segmento — evita o
// 18+17=35 ≠ 35,63 real do caso Rosqueadeira 3). Capacidade perdida soma
// os segmentos (reais + estimados, quando houver) — nunca duplica, porque
// cada segmento é uma fatia de tempo disjunta da mesma ocorrência
// (garantido por not exists na RPC de trechos). Custo do tempo ocioso só
// soma segmentos REAIS — um trecho estimado não tem
// custo_hora_operacao_vigente (dependeria de assumir também operação/
// funcionário, não só produto) e fica de fora do total, nunca um 0
// fictício.
//
// Deliberadamente SEM nenhuma métrica monetizando capacidade perdida pelo
// valor do produto acabado — "capacidade local perdida" (peças, numa
// operação) não é "produção final perdida" (o produto ainda passa por
// outras etapas do roteiro; uma perda local não implica perda equivalente
// de faturamento). Qualquer métrica de faturamento/throughput/margem
// bloqueados pertence ao Motor Econômico/Intelligence futuramente,
// considerando o roteiro completo, gargalos, capacidade recuperável e
// recursos compartilhados — não a esta tela.
// ---------------------------------------------------------------------

export interface SegmentoOcorrenciaAgrupada {
  chave: string;
  periodoId: string;
  minutos: number;
  real: boolean;
  produtoNome: string | null;
  capacidadePerdida: number | null;
  custoTempoOcioso: number | null;
}

export interface OcorrenciaAgrupada {
  ocorrenciaId: string;
  maquinaId: string;
  maquinaNome: string;
  motivoNome: string;
  motivoCategoria: string;
  abertaEm: string;
  encerradaEm: string;
  duracaoTotalMinutos: number;
  descricaoProblema: string | null;
  descricaoSolucao: string | null;
  temEstimativa: boolean;
  capacidadePerdidaTotal: number | null;
  custoTempoOciosoTotal: number | null;
  segmentos: SegmentoOcorrenciaAgrupada[];
}

export function agruparParadasPorOcorrencia(
  paradasOcorrencia: ParadaComContexto[],
  trechos: TrechoOcorrenciaSemApontamento[]
): OcorrenciaAgrupada[] {
  const porOcorrencia = new Map<string, { reais: ParadaComContexto[]; estimados: TrechoOcorrenciaSemApontamento[] }>();

  paradasOcorrencia.forEach((p) => {
    if (!p.ocorrenciaId) return;
    const atual = porOcorrencia.get(p.ocorrenciaId);
    if (atual) atual.reais.push(p);
    else porOcorrencia.set(p.ocorrenciaId, { reais: [p], estimados: [] });
  });

  trechos.forEach((t) => {
    const atual = porOcorrencia.get(t.ocorrenciaId);
    if (atual) atual.estimados.push(t);
    else porOcorrencia.set(t.ocorrenciaId, { reais: [], estimados: [t] });
  });

  const resultado: OcorrenciaAgrupada[] = [];

  porOcorrencia.forEach((grupo, ocorrenciaId) => {
    const real = grupo.reais[0] ?? null;
    const estimado = grupo.estimados[0] ?? null;
    if (!real && !estimado) return;

    const maquinaId = real ? real.maquinaId : estimado!.maquinaId;
    const maquinaNome = real ? real.maquinaNome : estimado!.maquinaNome;
    const motivoNome = real ? real.motivoNome : estimado!.motivoNome;
    const motivoCategoria = real ? real.motivoCategoria : estimado!.motivoCategoria;
    const abertaEm = real ? real.ocorrenciaAbertaEm! : estimado!.ocorrenciaAbertaEm;
    const encerradaEm = real ? real.ocorrenciaEncerradaEm! : estimado!.ocorrenciaEncerradaEm;
    const descricaoProblema = real ? real.descricaoProblema : estimado!.descricaoProblema;
    const descricaoSolucao = real ? real.descricaoSolucao : estimado!.descricaoSolucao;

    const duracaoTotalMinutos = (new Date(encerradaEm).getTime() - new Date(abertaEm).getTime()) / 60000;

    const segmentosReais: SegmentoOcorrenciaAgrupada[] = grupo.reais.map((p) => ({
      chave: p.paradaId,
      periodoId: p.periodoId,
      minutos: p.minutos,
      real: true,
      produtoNome: p.produtoNome,
      capacidadePerdida: calcularCapacidadePerdidaParada(p),
      custoTempoOcioso: calcularCustoTempoOciosoParada(p),
    }));

    const segmentosEstimados: SegmentoOcorrenciaAgrupada[] = grupo.estimados.map((t) => ({
      chave: `${t.ocorrenciaId}-${t.periodoId}`,
      periodoId: t.periodoId,
      minutos: t.minutos,
      real: false,
      produtoNome: t.produtoEstimadoNome,
      capacidadePerdida: calcularCapacidadePerdidaTrecho(t),
      custoTempoOcioso: null,
    }));

    const segmentos = [...segmentosReais, ...segmentosEstimados].sort((a, b) => a.periodoId.localeCompare(b.periodoId));

    resultado.push({
      ocorrenciaId,
      maquinaId,
      maquinaNome,
      motivoNome,
      motivoCategoria,
      abertaEm,
      encerradaEm,
      duracaoTotalMinutos,
      descricaoProblema,
      descricaoSolucao,
      temEstimativa: segmentosEstimados.length > 0,
      capacidadePerdidaTotal: somarOuNull(segmentos.map((s) => s.capacidadePerdida)),
      custoTempoOciosoTotal: somarOuNull(segmentosReais.map((s) => s.custoTempoOcioso)),
      segmentos,
    });
  });

  return resultado.sort((a, b) => b.duracaoTotalMinutos - a.duracaoTotalMinutos);
}
