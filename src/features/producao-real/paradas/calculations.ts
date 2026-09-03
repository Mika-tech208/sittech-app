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
