// "Indicadores de Produção" V1 — motor de cálculo central. Funções puras,
// sem I/O — consomem as linhas já resolvidas pelas RPCs
// obter_indicadores_producao/obter_paradas_producao (useIndicadoresProducao)
// e devolvem os agregados. Pensado pra ser reaproveitado por um futuro
// Dashboard Principal sem duplicar fórmula nenhuma — todo componente
// visual (cards, tabelas, Pareto) deve consumir só o que sai daqui, nunca
// recalcular por conta própria.
//
// Regra crítica — Produção Processada x Produção Acabada (nunca misturar):
//   * Produção processada = volume operacional bruto dos apontamentos
//     (quantidade_produzida de QUALQUER etapa do roteiro) — mede
//     atividade da máquina/operação, não produto pronto.
//   * Produção acabada = SÓ quantidade boa (produzida - refugo) de
//     apontamentos cuja etapa é a ÚLTIMA do roteiro daquele produto
//     (produto_id + maior roteiro_etapas.ordem — nunca pelo nome da
//     operação; produto de 1 etapa só = essa etapa já é final). Esse
//     booleano (isUltimaEtapa) já vem calculado pela RPC.
//
// Escopo das métricas de OEE (Performance/Disponibilidade/Qualidade/OEE/
// Capacidade perdida): SEMPRE restritas a apontamentos status='produzindo'
// — são as únicas com meta_periodo_vigente/produto/etapa (sem_producao
// tem esses campos NULL por design, nunca inventados aqui). Um período
// 'sem_producao' com 0 paradas registradas não vira "100% disponível":
// ele simplesmente não entra nesse cálculo — só é contado como registro
// explícito de "sem produção" (períodosSemProducao).
//
// Disponibilidade aqui é sempre "dentro do universo apontado" — nunca
// disponibilidade industrial absoluta da fábrica (não existe, no schema
// atual, um calendário de "máquina deveria estar rodando nesse período").
// A UI precisa deixar isso explícito perto do número.

import { calcularQuantidadeTeorica } from "@/features/producao-real/calculations";

export type StatusApontamento = "produzindo" | "sem_producao";

export interface ApontamentoIndicador {
  apontamentoId: string;
  data: string;
  periodoId: string;
  periodoNome: string;
  status: StatusApontamento;
  motivoSemProducao: string | null;
  produtoId: string | null;
  produtoNome: string | null;
  maquinaId: string;
  maquinaNome: string;
  operacaoId: string | null;
  operacaoNome: string | null;
  funcionarioId: string | null;
  funcionarioNome: string | null;
  etapaId: string | null;
  etapaOrdem: number | null;
  // null (não true nem false) quando o apontamento é sem_producao — não
  // existe "última etapa" de um apontamento sem produto/etapa.
  isUltimaEtapa: boolean | null;
  quantidadeProduzida: number;
  quantidadeRefugo: number;
  metaPeriodoVigente: number | null;
  duracaoPeriodoHorasVigente: number;
  minutosParados: number;
}

export interface ParadaIndicador {
  paradaId: string;
  apontamentoId: string;
  data: string;
  periodoId: string;
  minutos: number;
  motivoId: string;
  motivoNome: string;
  motivoCategoria: string;
  origem: "manual" | "ocorrencia";
  produtoId: string | null;
  produtoNome: string | null;
  maquinaId: string;
  maquinaNome: string;
  operacaoId: string | null;
  operacaoNome: string | null;
  funcionarioId: string | null;
  funcionarioNome: string | null;
}

export interface FiltrosIndicadores {
  dataInicial: string;
  dataFinal: string;
  produtoId?: string;
  maquinaId?: string;
  operacaoId?: string;
  funcionarioId?: string;
  periodoId?: string;
}

// ---------------------------------------------------------------------
// Por apontamento (base de tudo — agregados somam numerador/denominador
// destas mesmas funções, nunca fazem média das % resultantes).
// ---------------------------------------------------------------------

export function calcularQuantidadeBoaApontamento(ap: ApontamentoIndicador): number {
  return ap.quantidadeProduzida - ap.quantidadeRefugo;
}

export function calcularQualidadeApontamento(ap: ApontamentoIndicador): number | null {
  if (ap.status !== "produzindo") return null;
  if (ap.quantidadeProduzida <= 0) return null;
  return (calcularQuantidadeBoaApontamento(ap) / ap.quantidadeProduzida) * 100;
}

export function calcularPerformanceApontamento(ap: ApontamentoIndicador): number | null {
  if (ap.status !== "produzindo" || ap.metaPeriodoVigente === null) return null;
  const quantidadeTeorica = calcularQuantidadeTeorica({
    metaPeriodoVigente: ap.metaPeriodoVigente,
    duracaoPeriodoHorasVigente: ap.duracaoPeriodoHorasVigente,
    somaParadasMinutos: ap.minutosParados,
  });
  if (quantidadeTeorica === null) return null;
  return (ap.quantidadeProduzida / quantidadeTeorica) * 100;
}

export function calcularDisponibilidadeApontamento(ap: ApontamentoIndicador): number | null {
  if (ap.status !== "produzindo") return null;
  const duracaoMinutos = ap.duracaoPeriodoHorasVigente * 60;
  if (duracaoMinutos <= 0) return null;
  return ((duracaoMinutos - ap.minutosParados) / duracaoMinutos) * 100;
}

export function calcularOEEApontamento(ap: ApontamentoIndicador): number | null {
  const performance = calcularPerformanceApontamento(ap);
  const disponibilidade = calcularDisponibilidadeApontamento(ap);
  const qualidade = calcularQualidadeApontamento(ap);
  if (performance === null || disponibilidade === null || qualidade === null) return null;
  return (performance * disponibilidade * qualidade) / 10000;
}

// meta_periodo_snapshot / duracao_periodo_minutos × minutos_parados —
// fórmula exata pedida, usando só os snapshots já gravados no apontamento
// (meta_periodo_vigente, duracao_periodo_horas_vigente×60). Sem paradas
// -> 0 (nada perdido), não null.
export function calcularCapacidadePerdidaApontamento(ap: ApontamentoIndicador): number | null {
  if (ap.status !== "produzindo" || ap.metaPeriodoVigente === null) return null;
  const duracaoMinutos = ap.duracaoPeriodoHorasVigente * 60;
  if (duracaoMinutos <= 0) return null;
  if (ap.minutosParados <= 0) return 0;
  return (ap.metaPeriodoVigente / duracaoMinutos) * ap.minutosParados;
}

// ---------------------------------------------------------------------
// Resumo agregado — usado no resumo geral e em cada grupo (dia/máquina/
// produto/operação/funcionário). Sempre soma numeradores/denominadores
// antes de dividir; nunca faz média simples de uma lista de percentuais.
// ---------------------------------------------------------------------

export interface ProducaoPorProduto {
  produtoId: string;
  produtoNome: string;
  quantidade: number;
}

export interface ResumoIndicadores {
  producaoAcabadaTotal: number;
  producaoAcabadaPorProduto: ProducaoPorProduto[];
  producaoProcessadaTotal: number;
  producaoProcessadaPorProduto: ProducaoPorProduto[];
  refugoTotal: number;
  qualidadePct: number | null;
  performancePct: number | null;
  disponibilidadePct: number | null;
  oeePct: number | null;
  minutosParadosTotais: number;
  quantidadeParadas: number;
  capacidadePerdidaPecas: number | null;
  periodosProdutivos: number;
  periodosSemProducaoExplicito: number;
}

function somarPorProduto(itens: { produtoId: string | null; produtoNome: string | null; quantidade: number }[]): ProducaoPorProduto[] {
  const porProduto = new Map<string, ProducaoPorProduto>();
  itens.forEach((it) => {
    if (!it.produtoId || it.quantidade === 0) return;
    const atual = porProduto.get(it.produtoId);
    if (atual) atual.quantidade += it.quantidade;
    else porProduto.set(it.produtoId, { produtoId: it.produtoId, produtoNome: it.produtoNome || "", quantidade: it.quantidade });
  });
  return Array.from(porProduto.values()).sort((a, b) => b.quantidade - a.quantidade);
}

export function calcularResumoIndicadores(
  apontamentos: ApontamentoIndicador[],
  paradas: ParadaIndicador[]
): ResumoIndicadores {
  const produzindo = apontamentos.filter((ap) => ap.status === "produzindo");
  const semProducao = apontamentos.filter((ap) => ap.status === "sem_producao");
  const acabados = produzindo.filter((ap) => ap.isUltimaEtapa === true);

  const producaoAcabadaPorProduto = somarPorProduto(
    acabados.map((ap) => ({ produtoId: ap.produtoId, produtoNome: ap.produtoNome, quantidade: calcularQuantidadeBoaApontamento(ap) }))
  );
  const producaoProcessadaPorProduto = somarPorProduto(
    produzindo.map((ap) => ({ produtoId: ap.produtoId, produtoNome: ap.produtoNome, quantidade: ap.quantidadeProduzida }))
  );

  const refugoTotal = produzindo.reduce((s, ap) => s + ap.quantidadeRefugo, 0);
  const producaoProcessadaTotal = produzindo.reduce((s, ap) => s + ap.quantidadeProduzida, 0);
  const producaoAcabadaTotal = producaoAcabadaPorProduto.reduce((s, p) => s + p.quantidade, 0);

  // Qualidade agregada = soma(boa) / soma(produzida) × 100 — sobre TODAS
  // as etapas produzindo (qualidade é métrica operacional, não filtrada
  // pra última etapa).
  const somaProduzida = produzindo.reduce((s, ap) => s + ap.quantidadeProduzida, 0);
  const somaBoa = produzindo.reduce((s, ap) => s + calcularQuantidadeBoaApontamento(ap), 0);
  const qualidadePct = somaProduzida > 0 ? (somaBoa / somaProduzida) * 100 : null;

  // Performance agregada = soma(produzida) / soma(teórica) × 100 — nunca
  // média simples das % de cada apontamento (regra confirmada).
  let somaProduzidaComTeorica = 0;
  let somaTeorica = 0;
  produzindo.forEach((ap) => {
    if (ap.metaPeriodoVigente === null) return;
    const teorica = calcularQuantidadeTeorica({
      metaPeriodoVigente: ap.metaPeriodoVigente,
      duracaoPeriodoHorasVigente: ap.duracaoPeriodoHorasVigente,
      somaParadasMinutos: ap.minutosParados,
    });
    if (teorica === null) return;
    somaProduzidaComTeorica += ap.quantidadeProduzida;
    somaTeorica += teorica;
  });
  const performancePct = somaTeorica > 0 ? (somaProduzidaComTeorica / somaTeorica) * 100 : null;

  // Disponibilidade agregada = (soma duração - soma parados) / soma
  // duração × 100 — só sobre apontamentos produzindo com duração válida.
  let somaDuracaoMin = 0;
  let somaParadosMin = 0;
  produzindo.forEach((ap) => {
    const duracaoMin = ap.duracaoPeriodoHorasVigente * 60;
    if (duracaoMin <= 0) return;
    somaDuracaoMin += duracaoMin;
    somaParadosMin += ap.minutosParados;
  });
  const disponibilidadePct = somaDuracaoMin > 0 ? ((somaDuracaoMin - somaParadosMin) / somaDuracaoMin) * 100 : null;

  const oeePct =
    performancePct !== null && disponibilidadePct !== null && qualidadePct !== null
      ? (performancePct * disponibilidadePct * qualidadePct) / 10000
      : null;

  const capacidadePerdidaValores = produzindo.map(calcularCapacidadePerdidaApontamento).filter((v): v is number => v !== null);
  const capacidadePerdidaPecas = capacidadePerdidaValores.length > 0 ? capacidadePerdidaValores.reduce((s, v) => s + v, 0) : null;

  const minutosParadosTotais = paradas.reduce((s, p) => s + p.minutos, 0);

  return {
    producaoAcabadaTotal,
    producaoAcabadaPorProduto,
    producaoProcessadaTotal,
    producaoProcessadaPorProduto,
    refugoTotal,
    qualidadePct,
    performancePct,
    disponibilidadePct,
    oeePct,
    minutosParadosTotais,
    quantidadeParadas: paradas.length,
    capacidadePerdidaPecas,
    periodosProdutivos: produzindo.length,
    periodosSemProducaoExplicito: semProducao.length,
  };
}

// ---------------------------------------------------------------------
// Agrupamento genérico — base de "evolução por dia", "por máquina", "por
// produto", "por operação" e "por funcionário". Mantém os apontamentos/
// paradas brutos de cada grupo (não só o resumo) pra permitir drill-down
// (reagrupar o próprio grupo por outra dimensão, client-side, sem nova
// chamada ao banco).
// ---------------------------------------------------------------------

export interface GrupoIndicadores {
  chave: string;
  rotulo: string;
  apontamentos: ApontamentoIndicador[];
  paradas: ParadaIndicador[];
  resumo: ResumoIndicadores;
}

export function agruparIndicadores(
  apontamentos: ApontamentoIndicador[],
  paradas: ParadaIndicador[],
  chaveFn: (ap: ApontamentoIndicador) => string | null,
  rotuloFn: (ap: ApontamentoIndicador) => string
): GrupoIndicadores[] {
  const porChave = new Map<string, { rotulo: string; apontamentos: ApontamentoIndicador[] }>();
  apontamentos.forEach((ap) => {
    const chave = chaveFn(ap);
    if (chave === null) return;
    const atual = porChave.get(chave);
    if (atual) atual.apontamentos.push(ap);
    else porChave.set(chave, { rotulo: rotuloFn(ap), apontamentos: [ap] });
  });

  return Array.from(porChave.entries())
    .map(([chave, { rotulo, apontamentos: aps }]) => {
      const idsDoGrupo = new Set(aps.map((ap) => ap.apontamentoId));
      const paradasDoGrupo = paradas.filter((p) => idsDoGrupo.has(p.apontamentoId));
      return { chave, rotulo, apontamentos: aps, paradas: paradasDoGrupo, resumo: calcularResumoIndicadores(aps, paradasDoGrupo) };
    })
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

export function agruparPorDia(apontamentos: ApontamentoIndicador[], paradas: ParadaIndicador[]): GrupoIndicadores[] {
  return agruparIndicadores(
    apontamentos,
    paradas,
    (ap) => ap.data,
    (ap) => ap.data.split("-").reverse().join("/")
  ).sort((a, b) => a.chave.localeCompare(b.chave)); // ordem cronológica, não alfabética do rótulo
}

export function agruparPorMaquina(apontamentos: ApontamentoIndicador[], paradas: ParadaIndicador[]): GrupoIndicadores[] {
  return agruparIndicadores(apontamentos, paradas, (ap) => ap.maquinaId, (ap) => ap.maquinaNome);
}

export function agruparPorProduto(apontamentos: ApontamentoIndicador[], paradas: ParadaIndicador[]): GrupoIndicadores[] {
  return agruparIndicadores(apontamentos, paradas, (ap) => ap.produtoId, (ap) => ap.produtoNome || "");
}

export function agruparPorOperacao(apontamentos: ApontamentoIndicador[], paradas: ParadaIndicador[]): GrupoIndicadores[] {
  return agruparIndicadores(apontamentos, paradas, (ap) => ap.operacaoId, (ap) => ap.operacaoNome || "");
}

// Funcionário — NUNCA usado como ranking. Devolve o mesmo shape genérico
// (resumo + apontamentos brutos), que a UI usa pra permitir abrir o
// contexto produto/operação/máquina/período por trás do número — nunca
// uma lista ordenada por Performance sozinha.
export function agruparPorFuncionario(apontamentos: ApontamentoIndicador[], paradas: ParadaIndicador[]): GrupoIndicadores[] {
  return agruparIndicadores(apontamentos, paradas, (ap) => ap.funcionarioId, (ap) => ap.funcionarioNome || "");
}

// ---------------------------------------------------------------------
// Pareto de motivos de parada — soma minutos por motivo, ordenado desc,
// com % do total e % acumulado. origem (manual/ocorrência) não é
// distinguida aqui de propósito — cada linha de apontamento_paradas já é
// única (constraint no banco), somar esta lista nunca conta 2x.
// ---------------------------------------------------------------------

export interface ParetoMotivoItem {
  motivoId: string;
  motivoNome: string;
  motivoCategoria: string;
  minutos: number;
  quantidadeParadas: number;
  percentualDoTotal: number;
  percentualAcumulado: number;
}

export function calcularParetoParadas(paradas: ParadaIndicador[]): ParetoMotivoItem[] {
  const totalMinutos = paradas.reduce((s, p) => s + p.minutos, 0);
  const porMotivo = new Map<string, { nome: string; categoria: string; minutos: number; quantidade: number }>();
  paradas.forEach((p) => {
    const atual = porMotivo.get(p.motivoId);
    if (atual) {
      atual.minutos += p.minutos;
      atual.quantidade += 1;
    } else {
      porMotivo.set(p.motivoId, { nome: p.motivoNome, categoria: p.motivoCategoria, minutos: p.minutos, quantidade: 1 });
    }
  });

  const ordenado = Array.from(porMotivo.entries())
    .map(([motivoId, v]) => ({ motivoId, motivoNome: v.nome, motivoCategoria: v.categoria, minutos: v.minutos, quantidadeParadas: v.quantidade }))
    .sort((a, b) => b.minutos - a.minutos);

  let acumulado = 0;
  return ordenado.map((item) => {
    const percentualDoTotal = totalMinutos > 0 ? (item.minutos / totalMinutos) * 100 : 0;
    acumulado += percentualDoTotal;
    return { ...item, percentualDoTotal, percentualAcumulado: acumulado };
  });
}
