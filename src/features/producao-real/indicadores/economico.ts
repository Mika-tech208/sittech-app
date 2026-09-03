// Motor Econômico de Produção V1 — funções puras, sem I/O. Consome os
// mesmos ApontamentoIndicador[] já buscados por useIndicadoresProducao
// (nenhuma chamada nova ao banco), reaproveitando o motor de agrupamento
// de Indicadores V1 (agruparPorProduto etc.) — nenhuma fórmula é
// duplicada em componente React nem em SQL.
//
// DECISÕES OFICIAIS (ver relatório de análise aprovado):
//   * A Sittech vende o serviço/processamento — a matéria-prima é da
//     Tramontina. produtos.valor_unitario é a receita real por peça do
//     serviço. Não existe (nem deve ser inventado) custo de matéria-prima.
//   * Receita é reconhecida UMA ÚNICA VEZ, só na última etapa do roteiro
//     (isUltimaEtapa=true) — nunca multiplicada pela produção de etapas
//     intermediárias.
//   * Escopo financeiro sempre restrito a status='produzindo' (mesma
//     regra de Indicadores V1) — sem_producao nunca gera custo, receita
//     ou margem inventados.
//   * Custo industrial aproximado do produto acabado e margem de
//     processamento são APROXIMAÇÕES agregadas por período (sem
//     rastreamento de lote/WIP) — nunca apresentar como custo contábil
//     exato. Ver comentário em calcularCustoIndustrialAproximado.
//
// ⚠️ LIMITAÇÃO IMPORTANTE (documentar também no relatório final):
// `produtoValorUnitario` vem de um JOIN AO VIVO com produtos.valor_unitario
// (não é um snapshot gravado no apontamento, ao contrário dos campos de
// custo). Isso significa que uma análise de margem sobre apontamentos
// antigos usa o PREÇO ATUAL do produto, não o preço vigente na época —
// mesma limitação já documentada em Indicadores V1 para nomes de produto/
// máquina/operação, só que aqui afeta um número financeiro diretamente.
//
// ESCOPO DESTA ETAPA (não implementado de propósito, ver relatório):
// throughput final recuperável, faturamento/margem potencial bloqueados,
// score de priorização econômica, projeção futura, WIP/lote.

import {
  calcularQuantidadeBoaApontamento, calcularPerformanceAgregada,
  type ApontamentoIndicador, type GrupoIndicadores,
} from "@/features/producao-real/indicadores/calculations";

export type NivelConfianca = "calculado" | "estimativa" | "aproximacao";

// ---------------------------------------------------------------------
// Por apontamento — base de tudo. Todas restritas a status='produzindo'
// (sem_producao não tem custo/meta gravados, por design).
// ---------------------------------------------------------------------

export function calcularCustoPorPecaProduzidaApontamento(ap: ApontamentoIndicador): number | null {
  if (ap.status !== "produzindo" || ap.custoOperacionalPeriodoVigente === null) return null;
  if (ap.quantidadeProduzida <= 0) return null;
  return ap.custoOperacionalPeriodoVigente / ap.quantidadeProduzida;
}

export function calcularCustoPorPecaBoaApontamento(ap: ApontamentoIndicador): number | null {
  if (ap.status !== "produzindo" || ap.custoOperacionalPeriodoVigente === null) return null;
  const boa = calcularQuantidadeBoaApontamento(ap);
  if (boa <= 0) return null;
  return ap.custoOperacionalPeriodoVigente / boa;
}

export function calcularCustoTempoParadoApontamento(ap: ApontamentoIndicador): number | null {
  if (ap.status !== "produzindo" || ap.custoHoraOperacaoVigente === null) return null;
  if (ap.minutosParados <= 0) return 0;
  return ap.custoHoraOperacaoVigente * (ap.minutosParados / 60);
}

// Diferença entre custo unitário TEÓRICO (baseado na meta, já congelado
// em custo_unitario_referencia_periodo_vigente) e o custo observado por
// peça realmente produzida. Positivo = custou mais que o teórico.
export function calcularDiferencaCustoTeoricoObservadoApontamento(ap: ApontamentoIndicador): number | null {
  const observado = calcularCustoPorPecaProduzidaApontamento(ap);
  if (observado === null || ap.custoUnitarioReferenciaPeriodoVigente === null) return null;
  return observado - ap.custoUnitarioReferenciaPeriodoVigente;
}

export function calcularImpactoRefugoApontamento(ap: ApontamentoIndicador): number | null {
  if (ap.status !== "produzindo" || ap.custoUnitarioReferenciaPeriodoVigente === null) return null;
  if (ap.quantidadeRefugo <= 0) return 0;
  return ap.quantidadeRefugo * ap.custoUnitarioReferenciaPeriodoVigente;
}

// ---------------------------------------------------------------------
// Resumo econômico agregado — por etapa/produto/período (aplica-se a
// qualquer subconjunto de apontamentos já filtrado por quem chama, ex.:
// via agruparPorProduto/Maquina/Operacao de Indicadores V1). Sempre soma
// os valores calculáveis; null só quando NENHUM apontamento do grupo tem
// base confiável — nunca inventa zero onde o dado não existe.
// ---------------------------------------------------------------------

export interface ResumoEconomico {
  custoOperacionalTotal: number | null;
  custoMedioPorPecaProduzida: number | null;
  custoMedioPorPecaBoa: number | null;
  custoTempoParadoTotal: number | null;
  impactoRefugoTotal: number | null;
}

function somarOuNull(valores: (number | null)[]): number | null {
  const validos = valores.filter((v): v is number => v !== null);
  return validos.length > 0 ? validos.reduce((s, v) => s + v, 0) : null;
}

export function calcularResumoEconomico(apontamentos: ApontamentoIndicador[]): ResumoEconomico {
  const produzindo = apontamentos.filter((ap) => ap.status === "produzindo");

  const custosOperacionais = produzindo.map((ap) => ap.custoOperacionalPeriodoVigente);
  const custoOperacionalTotal = somarOuNull(custosOperacionais);

  const somaProduzida = produzindo.reduce((s, ap) => s + ap.quantidadeProduzida, 0);
  const somaBoa = produzindo.reduce((s, ap) => s + calcularQuantidadeBoaApontamento(ap), 0);

  const custoMedioPorPecaProduzida = custoOperacionalTotal !== null && somaProduzida > 0 ? custoOperacionalTotal / somaProduzida : null;
  const custoMedioPorPecaBoa = custoOperacionalTotal !== null && somaBoa > 0 ? custoOperacionalTotal / somaBoa : null;

  const custoTempoParadoTotal = somarOuNull(produzindo.map(calcularCustoTempoParadoApontamento));
  const impactoRefugoTotal = somarOuNull(produzindo.map(calcularImpactoRefugoApontamento));

  return { custoOperacionalTotal, custoMedioPorPecaProduzida, custoMedioPorPecaBoa, custoTempoParadoTotal, impactoRefugoTotal };
}

// ---------------------------------------------------------------------
// Custo industrial aproximado do produto acabado — APROXIMAÇÃO (não é
// custo contábil exato, ver cabeçalho do arquivo).
//
// Metodologia oficial (decisão aprovada): soma do custo operacional de
// TODAS as etapas do produto no período ÷ produção BOA acabada (só
// última etapa) do MESMO período. Essa razão já embute, de forma
// agregada, o efeito do refugo/perda ao longo do roteiro (cada peça
// acabada "carrega" implicitamente o custo de mais peças iniciadas nas
// etapas anteriores, na proporção agregada observada) — sem precisar de
// rastreamento de lote/WIP. É uma média do período, não um custo por
// peça individual rastreada.
// ---------------------------------------------------------------------

export interface CustoIndustrialAproximado {
  custoIndustrialTotal: number | null;
  producaoBoaAcabada: number;
  custoIndustrialPorPecaAcabada: number | null;
  confianca: NivelConfianca;
}

export function calcularCustoIndustrialAproximado(apontamentosDoProduto: ApontamentoIndicador[]): CustoIndustrialAproximado {
  const produzindo = apontamentosDoProduto.filter((ap) => ap.status === "produzindo");
  const custoIndustrialTotal = somarOuNull(produzindo.map((ap) => ap.custoOperacionalPeriodoVigente));

  const producaoBoaAcabada = produzindo
    .filter((ap) => ap.isUltimaEtapa === true)
    .reduce((s, ap) => s + calcularQuantidadeBoaApontamento(ap), 0);

  const custoIndustrialPorPecaAcabada =
    custoIndustrialTotal !== null && producaoBoaAcabada > 0 ? custoIndustrialTotal / producaoBoaAcabada : null;

  return { custoIndustrialTotal, producaoBoaAcabada, custoIndustrialPorPecaAcabada, confianca: "aproximacao" };
}

// ---------------------------------------------------------------------
// Margem de processamento — receita reconhecida SÓ na última etapa
// (isUltimaEtapa=true), nunca em etapa intermediária. valorUnitario =
// produtos.valor_unitario (preço real do serviço, decisão de negócio
// confirmada — não é preço de matéria-prima, que é da Tramontina).
// ---------------------------------------------------------------------

export interface MargemProcessamento {
  receitaPorPeca: number | null;
  custoIndustrialPorPecaAcabada: number | null;
  margemPorPecaAcabada: number | null;
  margemPct: number | null;
  producaoBoaAcabada: number;
  receitaProducaoAcabada: number | null;
  custoIndustrialTotal: number | null;
  margemTotalAproximada: number | null;
  horasConsumidasTotais: number;
  margemPorHora: number | null;
  confianca: NivelConfianca;
}

export function calcularMargemProcessamento(apontamentosDoProduto: ApontamentoIndicador[]): MargemProcessamento {
  const produzindo = apontamentosDoProduto.filter((ap) => ap.status === "produzindo");
  const { custoIndustrialTotal, producaoBoaAcabada, custoIndustrialPorPecaAcabada } =
    calcularCustoIndustrialAproximado(apontamentosDoProduto);

  // valorUnitario é o mesmo pra todos os apontamentos do produto (join
  // ao vivo com produtos.valor_unitario) — pega do primeiro que tiver.
  const receitaPorPeca = produzindo.find((ap) => ap.produtoValorUnitario !== null)?.produtoValorUnitario ?? null;

  const margemPorPecaAcabada =
    receitaPorPeca !== null && custoIndustrialPorPecaAcabada !== null ? receitaPorPeca - custoIndustrialPorPecaAcabada : null;
  const margemPct =
    margemPorPecaAcabada !== null && receitaPorPeca !== null && receitaPorPeca > 0 ? (margemPorPecaAcabada / receitaPorPeca) * 100 : null;

  // Sem produção acabada -> receita é 0 de verdade (fato), nunca N/A
  // fictício, desde que o preço do produto seja conhecido.
  const receitaProducaoAcabada = receitaPorPeca !== null ? producaoBoaAcabada * receitaPorPeca : null;
  const margemTotalAproximada =
    receitaProducaoAcabada !== null && custoIndustrialTotal !== null ? receitaProducaoAcabada - custoIndustrialTotal : null;

  // "Hora de capacidade consumida" = soma da duração de TODOS os
  // apontamentos produzindo do produto, todas as etapas (o produto usou
  // essa capacidade inteira do roteiro pra gerar a receita da última
  // etapa) — não é só a hora da etapa final.
  const horasConsumidasTotais = produzindo.reduce((s, ap) => s + ap.duracaoPeriodoHorasVigente, 0);
  const margemPorHora =
    margemTotalAproximada !== null && horasConsumidasTotais > 0 ? margemTotalAproximada / horasConsumidasTotais : null;

  return {
    receitaPorPeca,
    custoIndustrialPorPecaAcabada,
    margemPorPecaAcabada,
    margemPct,
    producaoBoaAcabada,
    receitaProducaoAcabada,
    custoIndustrialTotal,
    margemTotalAproximada,
    horasConsumidasTotais,
    margemPorHora,
    confianca: "aproximacao",
  };
}

// ---------------------------------------------------------------------
// "Possível restrição operacional" — ESTIMATIVA conservadora. NUNCA
// "gargalo confirmado". Combina 3 sinais independentes (nunca só volume
// relativo, conforme decisão): (a) menor produção boa relativa entre as
// etapas do roteiro no período, (b) presença de registros 'sem_producao'
// nas máquinas que executaram aquela etapa no mesmo período, (c)
// Performance agregada da etapa abaixo de 90% (mesmo limiar já usado em
// classificarPerformance, src/lib/performance.ts). Uma etapa só é
// sinalizada se acumular PELO MENOS 2 desses 3 sinais — evita apontar
// por causa de um único sinal isolado (a simplificação "menor volume =
// gargalo" foi explicitamente rejeitada). Contagem de máquinas elegíveis
// (etapaMaquinasElegiveis) é reportada só como CONTEXTO estrutural, nunca
// soma pro score.
// ---------------------------------------------------------------------

export interface EtapaRestricaoSinais {
  etapaId: string;
  etapaOrdem: number;
  operacaoNome: string;
  producaoBoaEtapa: number;
  performancePct: number | null;
  temSemProducaoNaMaquina: boolean;
  maquinasElegiveis: number;
  sinais: number;
}

export interface RestricaoOperacionalProduto {
  produtoId: string;
  produtoNome: string;
  etapas: EtapaRestricaoSinais[];
  etapaSinalizada: EtapaRestricaoSinais | null;
  observacao: string;
  confianca: NivelConfianca;
}

const LIMIAR_PERFORMANCE_BAIXA = 90;
const MINIMO_SINAIS_PARA_SINALIZAR = 2;

export function detectarPossivelRestricaoOperacional(
  apontamentosDoProduto: ApontamentoIndicador[],
  todosApontamentosDoPeriodo: ApontamentoIndicador[]
): RestricaoOperacionalProduto | null {
  const produzindo = apontamentosDoProduto.filter((ap) => ap.status === "produzindo" && ap.etapaId !== null);
  if (produzindo.length === 0) return null;

  const produtoId = produzindo[0].produtoId;
  const produtoNome = produzindo[0].produtoNome || "";
  if (!produtoId) return null;

  const porEtapa = new Map<string, ApontamentoIndicador[]>();
  produzindo.forEach((ap) => {
    const etapaId = ap.etapaId as string;
    const atual = porEtapa.get(etapaId);
    if (atual) atual.push(ap);
    else porEtapa.set(etapaId, [ap]);
  });

  // Só faz sentido comparar "restrição relativa" com pelo menos 2 etapas
  // no período — produto de etapa única não tem com o que competir.
  if (porEtapa.size < 2) return null;

  const semProducaoDoPeriodo = todosApontamentosDoPeriodo.filter((ap) => ap.status === "sem_producao");

  const etapas: EtapaRestricaoSinais[] = Array.from(porEtapa.entries()).map(([etapaId, aps]) => {
    const producaoBoaEtapa = aps.reduce((s, ap) => s + calcularQuantidadeBoaApontamento(ap), 0);
    const maquinasDaEtapa = new Set(aps.map((ap) => ap.maquinaId));
    const temSemProducaoNaMaquina = semProducaoDoPeriodo.some((sp) => maquinasDaEtapa.has(sp.maquinaId));
    return {
      etapaId,
      etapaOrdem: aps[0].etapaOrdem ?? 0,
      operacaoNome: aps[0].operacaoNome || "",
      producaoBoaEtapa,
      performancePct: calcularPerformanceAgregada(aps),
      temSemProducaoNaMaquina,
      maquinasElegiveis: aps[0].etapaMaquinasElegiveis,
      sinais: 0,
    };
  });

  // Sinal A — menor produção boa relativa: só marca se houver um mínimo
  // ÚNICO (empate não gera sinal, é inconclusivo).
  const minProducao = Math.min(...etapas.map((e) => e.producaoBoaEtapa));
  const etapasComMinimo = etapas.filter((e) => e.producaoBoaEtapa === minProducao);
  if (etapasComMinimo.length === 1) etapasComMinimo[0].sinais += 1;

  etapas.forEach((e) => {
    if (e.temSemProducaoNaMaquina) e.sinais += 1;
    if (e.performancePct !== null && e.performancePct < LIMIAR_PERFORMANCE_BAIXA) e.sinais += 1;
  });

  const maxSinais = Math.max(...etapas.map((e) => e.sinais));
  const etapasComMaxSinais = etapas.filter((e) => e.sinais === maxSinais);

  let etapaSinalizada: EtapaRestricaoSinais | null = null;
  let observacao: string;
  if (maxSinais < MINIMO_SINAIS_PARA_SINALIZAR) {
    observacao = "Sem restrição operacional clara identificada neste período — nenhuma etapa acumulou sinais suficientes.";
  } else if (etapasComMaxSinais.length > 1) {
    observacao = `Mais de uma etapa (${etapasComMaxSinais.map((e) => e.operacaoNome).join(", ")}) acumulou o mesmo número de sinais — sem uma restrição clara única neste período.`;
  } else {
    etapaSinalizada = etapasComMaxSinais[0];
    observacao = `${etapaSinalizada.operacaoNome} concentra ${etapaSinalizada.sinais} sinal(is) de possível restrição neste período (menor produção relativa, Performance baixa e/ou registros de "sem produção" na(s) máquina(s) — ver detalhe). Estimativa, não é um gargalo confirmado.`;
  }

  return { produtoId, produtoNome, etapas, etapaSinalizada, observacao, confianca: "estimativa" };
}

// ---------------------------------------------------------------------
// Conveniência — junta custo industrial, margem e possível restrição
// operacional por produto, a partir dos grupos já calculados por
// agruparPorProduto (Indicadores V1). Não recalcula agrupamento nenhum.
// ---------------------------------------------------------------------

export interface EconomicoProduto {
  produtoId: string;
  produtoNome: string;
  custoIndustrial: CustoIndustrialAproximado;
  margem: MargemProcessamento;
  restricao: RestricaoOperacionalProduto | null;
}

export function calcularEconomicoPorProduto(
  gruposProduto: GrupoIndicadores[],
  todosApontamentosDoPeriodo: ApontamentoIndicador[]
): EconomicoProduto[] {
  return gruposProduto
    .filter((g) => g.chave) // ignora o grupo de produto_id null (não deveria existir aqui, é defensivo)
    .map((g) => ({
      produtoId: g.chave,
      produtoNome: g.rotulo,
      custoIndustrial: calcularCustoIndustrialAproximado(g.apontamentos),
      margem: calcularMargemProcessamento(g.apontamentos),
      restricao: detectarPossivelRestricaoOperacional(g.apontamentos, todosApontamentosDoPeriodo),
    }));
}
