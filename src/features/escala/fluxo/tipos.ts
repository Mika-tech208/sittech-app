// ESCALA INTELIGENTE (fluxo) — CONTRATO do núcleo puro. Sem IO, sem relógio, sem Supabase: tudo entra por parâmetro.
//
// Todos os tipos de saída (EstadoFluxo, AvaliacaoPlano, DiagnosticoFluxo, ViolacaoDura) são JSON-serializáveis (vão para jsonb):
// só objetos, arrays, strings, números finitos, booleanos e null. Nenhum Map/Set/Infinity/NaN.
//
// Convenções de unidade: tudo em PEÇAS. "lo"/"hi" = limite inferior/superior de uma grandeza INCERTA (produção não confirmada).
// Chave de pool = "produtoId|etapaId" (chavePool). Slot = índice global na semana (SlotEscala.indice).

import type { ApontamentoReal } from "../producaoReal";
import type { AlocacaoEscala, EntradaEscala, ResultadoEscala } from "../types";

export const VERSAO_FLUXO = 2; // v2: plano vigente como candidato, estabilização de pessoas, explicação contra o vigente (aditiva) — ver docs/escala-fluxo-nucleo.md

// ---------------------------------------------------------------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------------------------------------------------------------

/** Flag de rollout (escala_parametros.producao_real_modo). O núcleo não lê a flag; quem chama decide se aplica `resultado`. */
export type ModoProducaoReal = "desligado" | "sombra" | "ativo";

/** Saldo de WIP CONFIRMADO do par origem→seguinte (wipSaldo.ts: confirmadoDisponivelAte(hoje)). Só confirmado entra aqui. */
export interface SaldoWipConfirmadoPar {
  produtoId: string;
  etapaOrigemId: string;
  etapaSeguinteId: string;
  saldo: number; // peças confirmadas ainda disponíveis (≥ 0)
}

/** Contagem FÍSICA aproximada do estoque entre duas etapas consecutivas: `saldo` peças existiam no instante `contadoEmMs` (epoch ms). */
export interface ContagemFisicaPar {
  produtoId: string;
  etapaOrigemId: string;
  etapaSeguinteId: string;
  saldo: number; // ≥ 0
  contadoEmMs: number;
  informadoPor?: string;
  observacao?: string;
}

export interface DadosProducaoReal {
  /** Tudo que existe lançado. O núcleo só enxerga lançamentos com lancadoEmMs ≤ agoraMs (nunca o futuro). */
  apontamentos: ApontamentoReal[];
  /** "Agora" (epoch ms), por parâmetro. Define quais períodos estão FECHADOS (fim + fechamentoMinutos ≤ agora). */
  agoraMs: number;
  /** Minutos após o fim do período para considerá-lo fechado. Default 10 (regra de fechamento.ts). */
  fechamentoMinutos?: number;
  /** Saldos de WIP confirmados por par. Ausente/sem o par ⇒ WIP ESTIMADO (lo/hi pelos apontamentos). */
  wipConfirmado?: SaldoWipConfirmadoPar[];
  /** CONTAGENS FÍSICAS informadas (escala_parametros.producao_real_contagens_fisicas): saldo físico do par no instante `contadoEmMs`. Independente de `wipConfirmado`/wip_controle.
   *  Ausente/vazio ⇒ nenhuma. Item inválido é IGNORADO com diagnóstico `CONTAGEM_FISICA_IGNORADA` (nunca derruba o cálculo). Ver docs/escala-fluxo-contagem-fisica.md. */
  contagensFisicas?: ContagemFisicaPar[];
  /** Linhas gravadas da semana (planejado por máquina/pool nos períodos passados e futuros, base da estabilidade/churn). */
  planoVigente: AlocacaoEscala[];
}

/**
 * Par legado (Conector): produto convencional + produto automática que compartilham pools equivalentes (fundidos SÓ para
 * cálculo de fluxo/demanda). Configurável (escala_parametros.producao_real_pares_legado); nunca altera apontamentos.
 */
export interface ParEtapaComum {
  /** Rótulo livre ("Etiquetar", "Embalar") — só para diagnóstico. */
  rotulo: string;
  etapaConvencionalId: string;
  etapaAutomaticaId: string;
}
export interface ParLegado {
  /** Identificador estável do par (diagnóstico). */
  id: string;
  produtoConvencionalId: string;
  produtoAutomaticaId: string;
  /** Etapas equivalentes (mesma operação, mesmas máquinas, metas compatíveis). Cada uma vira UM pool lógico fundido. */
  etapasComuns: ParEtapaComum[];
  /** Tolerância relativa de compatibilidade das metas entre os dois ramos (default 0,01). */
  toleranciaMeta?: number;
}

export interface OpcoesFluxo {
  paresLegado?: ParLegado[];
  /** θ: ganho mínimo (peças finais) para trocar uma alocação já existente no PRIMEIRO período mutável. Default = 0 (v2): a estabilidade vem da
   *  re-atribuição de pessoas (`estabilizarPessoas`), que não custa peça final; retenção por θ só custa falta (medido no replay, docs/escala-fluxo-criterios-ativacao.md §4). */
  limiarEstabilidadePecas?: number;
  /** Re-atribui as PESSOAS do plano escolhido para manter a pessoa no mesmo posto do plano vigente (mesmos postos, mesma falta). Default true. */
  estabilizarPessoas?: boolean;
  /** Máximo de iterações de valor marginal. Default 4. */
  maxIteracoes?: number;
  /** Fator de desempenho por pool a APLICAR sobre entrada.pools[].metas (ausente = metas já efetivas). Não combinar com fatoresEmbutidos. */
  fatorPorPool?: Record<string, number>;
  /** Fator de desempenho JÁ embutido em entrada.pools[].metas (como a sombra faz). Só serve para recuperar as metas NOMINAIS na checagem de
   *  compatibilidade do Conector legado (metas × f diferentes entre os ramos não tornam os pools incompatíveis). */
  fatoresEmbutidos?: Record<string, number>;
  /** Pondera a falta final por valorUnitario da etapa final (default false: peças). */
  ponderarPorValor?: boolean;
  /** Fluxo entre etapas no MESMO período (consumo ≤ WIP inicial + produção upstream do período). Default true (spec §3). */
  fluxoMesmoPeriodo?: boolean;
  /** Inclui na avaliação a trajetória de WIP por par/slot e os marginais (mais pesado no jsonb). Default true / false. */
  incluirTrajetoria?: boolean;
  incluirMarginais?: boolean;
  /** Máximo de decisões detalhadas no diagnóstico (default 500); `decisoesTotal` e o resumo agregado (com `porSlot`) cobrem SEMPRE 100% das linhas alteradas. */
  maxDecisoes?: number;
  /** Produto único (F#CONV/F#AUTO/F#COMUM): a última etapa de `produtoOrigemId` alimenta a primeira de `produtoDestinoId`. */
  ligacoes?: LigacaoProdutos[];
  /** avaliarPlano: rem explícito (por chave do pool representante) com que o plano avaliado foi gerado (limita a produção do previsto). */
  limitesRemPorPool?: Record<string, number>;
  /** REGRA GERAL de preservação da atingibilidade da meta semanal (tier 1 da função objetivo): antes de maximizar peças finais, mantém os postos MÍNIMOS que
   *  conservam alcançável a meta de cada produto (metas atingíveis primeiro); sem meta atingível ⇒ diagnóstico META_NAO_ATINGIVEL. Default false (byte-idêntico ao anterior).
   *  Lida de escala_parametros `producao_real_atingibilidade` ∈ {desligado, ativo} pela integração. docs/escala-fluxo-atingibilidade.md */
  preservarAtingibilidade?: boolean;
  /** off (padrão) | sombra (só mede e reporta a atingibilidade/R$, não altera o plano) | ativo (= preservarAtingibilidade). Tem precedência sobre `preservarAtingibilidade`. */
  atingibilidadeModo?: "off" | "sombra" | "ativo";
  /** Objetivo da Escala: "pecas" (padrão, comportamento anterior) | "financeiro" (R$ de produto final pelo preço CONGELADO da Previsão; implica `ponderarPorValor`). docs/escala-fluxo-atingibilidade.md */
  objetivo?: "pecas" | "financeiro" | "receita" | "margem";
  /** Provedor de PRODUTIVIDADE esperada por produto×etapa×máquina×período (default: meta nominal × f do pool, como hoje). Substitui as metas do pool (média das máquinas selecionadas); não combinar com `fatoresEmbutidos`. */
  produtividade?: ProdutividadeProvider;
  /** Base da produtividade usada na decisão: "real" (padrão; metas × f, como hoje) ou "nominal" (metas sem f). A ordem de receita/h entre produtos muda com a base. */
  produtividadeBase?: "nominal" | "real";
  /** Provedor de MARGEM de contribuição unitária (objetivo "margem"). Indisponível/não confiável ⇒ cai para RECEITA ("receita marginal", nunca "lucro"). Custo fixo nunca é rateado. */
  margem?: MargemProvider;
  /** Quantos períodos (a partir do primeiro mutável) o diagnóstico `economia` detalha (capacidade por etapa e decisões). Default 6. */
  economiaSlots?: number;
  /** Semana (segunda ISO) para o MargemProvider. */
  semanaInicio?: string;
  /** k do limite econômico da atingibilidade: preservar uma meta atingível só se custo de oportunidade (R$ da semana) ≤ k × valor recuperado (R$). Default 2. */
  atingibilidadeK?: number;
  /** Peso comercial MANUAL por produto (default 1; só entra na decisão do objetivo financeiro; as métricas em R$ usam o preço puro). */
  pesoComercial?: Record<string, number>;
}

export interface ProdutividadeEsperada { pecasPorPeriodo: number; fator: number; fonte: string; amostra: number }
/** (produto, etapa, máquina, agora[, período]) → produtividade esperada REAL (pecasPorPeriodo × fator = peças esperadas no período). null ⇒ usa a meta nominal do pool. */
export type ProdutividadeProvider = (a: { produtoId: string; etapaId: string; maquinaId: string; periodoId: string; agoraMs: number; metaNominal: number }) => ProdutividadeEsperada | null;
/** valor = preço − (custo variável ?? 0). Sem custo variável confiável a natureza é "receita" (rótulos "receita marginal", nunca "lucro"/"margem"). */
export interface MargemUnitaria { valor: number | null; natureza?: "receita" | "contribuicao"; fonte: string; confiavel: boolean; versao?: string }
export type MargemProvider = (produtoId: string, semanaInicio: string) => MargemUnitaria;

export interface LigacaoProdutos {
  produtoOrigemId: string;
  produtoDestinoId: string;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Diagnósticos
// ---------------------------------------------------------------------------------------------------------------------------------

export type CodigoDiagnosticoFluxo =
  | "PRODUCAO_NAO_CONFIRMADA" // período fechado, máquina planejada, sem linha: produção ∈ [0, planejado]
  | "WIP_NEGATIVO_ESTIMADO" // estimativa negativa mesmo no melhor caso: piso 0 (estoque inicial desconhecido / apontamento inconsistente / atrasado)
  | "PRODUTO_EM_COMPORTAMENTO_LEGADO" // par do Conector sem condição de fusão: pools ficam separados, explicitamente
  | "AJUSTE_TARDIO" // lançamento após o fechamento do período: entra no estado, não reescreve o passado
  | "SEM_PRODUCAO_FALTA_MATERIAL" // zero confirmado por falta de material: etapa temporariamente inviável
  | "APONTAMENTO_FORA_DO_PLANO" // apontamento em máquina/pool que o plano vigente não previa
  | "ETAPA_FINAL_AMBIGUA" // produto sem etapa final inequívoca (usa a de maior ordem e avisa)
  | "WIP_CONFIRMADO_USADO"
  | "TETO_UTILIDADE_APLICADO" // Allowed_k < D_k: produzir mais upstream seria WIP sem utilidade nesta semana
  | "DEMANDA_FINAL_ATENDIDA" // R_f = 0
  | "PLANO_BASE_MANTIDO" // nenhum plano de fluxo foi melhor que o base pelo simulador
  | "PLANO_FLUXO_ESCOLHIDO"
  | "VIOLACAO_RESTRICAO_DURA" // o candidato violava hard constraint e foi descartado (nunca emitido para o plano escolhido)
  | "ESTABILIDADE_RETEVE_ALOCACAO" // ganho < θ: alocação do plano vigente mantida
  | "PLANO_VIGENTE_MANTIDO"
  | "PLANO_VIGENTE_REATRIBUIDO_BLOCO" // o futuro do plano em vigor foi o candidato escolhido (nenhuma alternativa estritamente melhor): saída = linhas vigentes, sem churn
  | "PLANO_VIGENTE_DESCARTADO" // o futuro do plano em vigor NÃO é candidato válido (violaria restrição dura hoje ou está incompleto)
  | "ESTABILIZACAO_PESSOAS" // pessoas re-atribuídas para manter o posto do plano vigente
  | "ESTABILIZACAO_DESCARTADA" // a re-atribuição piorou a falta ou violou restrição dura: descartada
  | "SEM_PRODUCAO_SEM_PROGRAMACAO" // sem_producao com motivo sem_programacao (fora da spec original): zero confirmado, sem inferir material
  | "CONTAGEM_FISICA_USADA" // contagem física válida usada como saldo inicial CONFIRMADO do par
  | "CONTAGEM_FISICA_IGNORADA" // item de contagem física inválido/substituído: ignorado (nunca derruba o recálculo)
  | "POOL_FUNDIDO" // pools legados fundidos logicamente
  | "META_NAO_ATINGIVEL" // preservarAtingibilidade: nem com todas as máquinas em todos os períodos restantes (físico) ou não cabe junto das outras metas (conflito de recursos)
  | "POSTOS_MINIMOS_APLICADOS"
  | "PRODUTO_SACRIFICADO"
  | "MARGEM_INDISPONIVEL" // objetivo margem sem margem confiável: usa RECEITA marginal
  | "ATINGIBILIDADE_NAO_PRESERVADA_CUSTO" // meta atingível NÃO preservada: custo de oportunidade > k × valor recuperado
  | "SATURADO_POR_POSTO" // todos os postos da etapa ocupados: outra pessoa ali vale 0
  | "GARGALO_PESSOA" // há posto livre com valor, mas não há pessoa elegível
  | "GARGALO_WIP_MATERIAL" // posto livre mas sem material/WIP para produzir
  | "GARGALO_DOWNSTREAM"; // posto livre mas o resto da cadeia/demanda não absorve // objetivo financeiro / conflito: produto com menos peças que na referência (nada silencioso): peças e R$ // preservarAtingibilidade: postos mínimos (tier 1) mantidos no plano

export interface DiagnosticoItem {
  codigo: CodigoDiagnosticoFluxo;
  severidade: "info" | "aviso" | "erro";
  produtoId?: string;
  etapaId?: string;
  slot?: number;
  mensagem: string;
  detalhes?: Record<string, number | string | boolean | null>;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Estado da produção
// ---------------------------------------------------------------------------------------------------------------------------------

export interface Intervalo {
  lo: number;
  hi: number;
}

export type EstadoCelula = "confirmado" | "zero_confirmado" | "nao_confirmado" | "futuro";

/** Uma (período, máquina, pool) em que havia produção planejada ou lançamento. */
export interface CelulaProducao {
  slot: number;
  data: string;
  periodoId: string;
  maquinaId: string;
  produtoId: string;
  etapaId: string;
  estado: EstadoCelula;
  boas: Intervalo; // confirmado: lo = hi = boas; nao_confirmado: [0, planejado]; zero_confirmado: [0, 0]; futuro: [0, 0] (ainda não ocorreu)
  refugo: number;
  planejado: number; // peças do plano vigente nesta célula (pecas + pecasAdicional)
  motivo: string | null; // zero_confirmado: falta_operador | falta_material | outro
  tardio: boolean; // algum lançamento chegou depois do fechamento do período
}

export interface EstadoEtapa {
  produtoId: string;
  etapaId: string;
  ordemEtapa: number;
  final: boolean;
  quantidade: number; // Q do pool (previsto da semana)
  boas: Intervalo; // acumulado real em períodos passados
  refugo: number;
  periodosNaoConfirmados: number;
  periodosZeroConfirmado: number;
  celulasNaoConfirmadas: number;
}

export interface EstadoWipPar {
  produtoId: string;
  etapaOrigemId: string;
  etapaSeguinteId: string;
  origem: "confirmado" | "estimado";
  confianca: "alta" | "media" | "baixa";
  wip: Intervalo; // com piso 0
  bruto: Intervalo; // antes do piso (pode ser negativo)
  negativo: boolean; // bruto.hi < 0 (negativo mesmo no melhor caso)
  /** ADITIVO: de onde vem o saldo confirmado. Ausente quando estimado. */
  fonteConfirmacao?: "wip_controle" | "contagem_fisica";
  /** ADITIVO (contagem física): saldo informado, instante da contagem (ISO UTC) e nº de períodos fechados desde então. */
  contagem?: { saldo: number; contadoEm: string; periodosFechadosDesde: number };
}

export interface EstadoProduto {
  produtoId: string;
  etapaFinalId: string;
  quantidadeFinal: number; // Q_f
  boasFinais: Intervalo;
  /** R_f = max(0, Q_f − B_f,lo) NO CORTE (último período fechado) — conservador: só o confirmado reduz a meta final. */
  demandaFinalRestante: number;
  /** max(0, Q_f − B_f,hi) no corte — limite otimista (para a faixa de falta). */
  demandaFinalRestanteMin: number;
  /** R_f já projetado até aPartirDe (desconta o que as linhas congeladas — período em andamento/comprometido — ainda produzem): o que entra no motor. */
  restanteEmAPartirDe: number;
}

/** Projeção do estado em `aPartirDe`: o fechado + o que as linhas congeladas (período em andamento/comprometido) ainda produzem. */
export interface ProjecaoNoCorte {
  aPartirDe: number;
  boas: Record<string, Intervalo>; // por pool
  wip: Record<string, Intervalo>; // por chave do pool ORIGEM do par ("produto|etapaOrigem")
}

export interface DemandaFluxoPool {
  chave: string;
  produtoId: string;
  etapaId: string;
  final: boolean;
  remLegado: number; // o que o motor atual usaria (Q − Σ créditos congelados)
  demandaFluxo: number; // D_k
  tetoUtilidade: number | null; // Allowed_k (null na etapa final)
  consumoDownstream: number | null;
  tetoPeriodo: number | null; // Teto_k
  pipeline: Intervalo; // Pipe_k
  remFluxo: number; // min(D_k, Allowed_k) — entra no motor
  limitadoPorUtilidade: boolean;
}

export interface EstadoFluxo {
  versao: number;
  agoraMs: number;
  fechamentoMinutos: number;
  /** Índice do último slot FECHADO (-1 = nenhum). */
  ultimoFechado: number;
  aPartirDe: number;
  celulas: CelulaProducao[];
  etapas: EstadoEtapa[];
  produtos: EstadoProduto[];
  pares: EstadoWipPar[];
  projecao: ProjecaoNoCorte;
  demanda: DemandaFluxoPool[];
  /** rem por pool a injetar em EntradaEscala.remPorPool (já com fusão legada aplicada quando houver). */
  remPorPool: Record<string, number>;
  /** Pools lógicos fundidos (Conector legado). */
  poolsFundidos: PoolFundido[];
  diagnosticos: DiagnosticoItem[];
}

export interface PoolFundido {
  parId: string;
  rotulo: string;
  chaveConvencional: string;
  chaveAutomatica: string;
  /** Peças ainda necessárias no pool comum: R_f,total = Q_conv + Q_auto − (boas conv + boas auto). */
  demandaComum: number;
  proporcaoConvencional: number; // s_conv = Q_conv / ΣQ
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Avaliação de plano (simulador de fluxo)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface AvaliacaoProduto {
  produtoId: string;
  etapaFinalId: string;
  quantidadeFinal: number;
  /** Final entregue ao fim da semana (real confirmado + simulado). `lo` = cenário pessimista, `hi` = otimista. */
  finalEntregue: Intervalo;
  /** Falta final esperada: lo ⇒ usa cenário pessimista (maior falta); hi ⇒ otimista. */
  faltaFinal: Intervalo;
  wipFinal: Record<string, Intervalo>; // por chave do pool ORIGEM do par, ao fim da semana
  wipLegadoResidual: Record<string, number>; // quanto do WIP inicial (lo) ainda NÃO foi consumido ao fim (FIFO)
  gargaloFluxo: GargaloFluxo | null;
}

export interface GargaloFluxo {
  produtoId: string;
  etapaId: string;
  /** Capacidade futura da etapa + estoque já além dela = teto de final entregável por esta etapa. */
  potencial: number;
  folga: number; // potencial − demandaFinalRestante (negativo = gargalo real)
}

export interface PostoContribuicao {
  slot: number;
  data: string;
  periodoId: string;
  maquinaId: string;
  funcionarioId: string;
  produtoId: string;
  etapaId: string;
  /** Peças finais atribuíveis a este posto (remoção marginal na re-simulação). Pode ser 0 (posto sem efeito no final). */
  pecasFinais: number;
}

export interface TotaisAvaliacao {
  faltaFinalLo: number;
  faltaFinalHi: number;
  finalEntregueLo: number;
  finalEntregueHi: number;
  faltaPonderada: number; // se ponderarPorValor
  wipFinalLo: number;
  wipFinalHi: number;
  wipLegadoResidual: number;
  excessoWip: number; // Σ max(0, WIP previsto (hi) − teto derivado do par)
  /** Camada 3 (objetivo financeiro): Σ max(0, WIP final (hi) − max(WIP atual, 2 períodos de capacidade da origem)). Só PENALIDADE SECUNDÁRIA (nunca hard limit). */
  excessoWip2p?: number;
  capacidadeGargalo: number;
  capacidadeDesperdicada: number; // capacidade de postos do previsto que não vira peça (sem material, sem demanda ou meta atendida) — desempate
  excessoFinal: number; // peças do produto final que o plano produziria ALÉM da meta (capacidade desperdiçada, cenário pessimista)
}

export interface TrajetoriaWip {
  chave: string; // "produto|etapaOrigem"
  porSlot: { slot: number; lo: number; hi: number }[];
}

/** Atingibilidade da meta semanal de um GRUPO (cadeia até o produto final; o Conector fundido tem os dois produtos). Peças finais acumuladas (cenário pessimista). */
export interface AtingibilidadeGrupo {
  grupo: string; // id do nó final
  produtos: { produtoId: string; etapaFinalId: string; quantidade: number }[];
  meta: number; // Q (semanal previsto) do grupo
  restante: number; // Q − boas finais (lo) projetadas em aPartirDe
  maximoPossivel: number; // final máximo (lo) com TODAS as máquinas disponíveis trabalhando em TODOS os períodos desde aPartirDe (pessoas não limitam; WIP/material limitam)
  atingivel: boolean; // maximoPossivel ≥ meta
  faltaInevitavel: number; // max(0, meta − maximoPossivel)
  finalPrevisto: number; // final (lo) do plano avaliado
  faltaEvitavel: number; // max(0, min(meta, maximoPossivel) − finalPrevisto): o que o plano deixa de entregar do que ainda era possível (informativo para inatingíveis)
  status: "META_ATINGIDA_PELO_PLANO" | "META_NAO_ATINGIVEL" | "META_EM_CONFLITO"; // CONFLITO = atingível sozinha, mas o plano não a entrega (pessoas/máquinas disputadas)
}

export interface AtingibilidadePlano {
  grupos: AtingibilidadeGrupo[];
  /** nº de grupos de meta atingível que o plano NÃO entrega (tier 1a de J) */
  atingiveisPerdidas: number;
  /** Σ faltaEvitavel / meta dos grupos de meta ATINGÍVEL — tier 1b de J (inatingíveis ficam no tier 2, só diagnóstico) */
  deficitRelativo: number;
}

/** Métricas em R$ de UM produto (preço CONGELADO da Previsão; R$ só da etapa final). */
export interface FinanceiroProduto {
  produtoId: string;
  etapaFinalId: string;
  precoCongelado: number;
  /** Valor econômico unitário usado na decisão: receita (= preço congelado) ou margem confiável. */
  valorEconomicoUnitario?: number;
  nivelValor?: "receita" | "margem";
  fonteValor?: string;
  pesoComercial: number;
  meta: number;
  realizadoFinal: number; // boas finais já produzidas (confirmadas + período congelado projetado) em aPartirDe
  restante: number;
  maximoProduzivel: number;
  metaAtingivel: boolean;
  faltaInevitavel: number; // peças
  finalProjetado: number; // do plano avaliado
  faltaProjetada: number;
  rsMeta: number;
  rsRealizado: number;
  rsFaltante: number;
  rsMaximoAtingivel: number;
  rsProjetadoFechamento: number;
  rsFaltaInevitavel: number;
  rsFaltaProjetada: number;
}

export interface FinanceiroTotal {
  rsMeta: number;
  rsRealizado: number;
  rsFaltante: number;
  rsMaximoAtingivel: number;
  rsProjetadoFechamento: number;
  rsFaltaInevitavel: number;
  rsFaltaProjetada: number;
}

export interface FinanceiroPlano {
  produtos: FinanceiroProduto[];
  total: FinanceiroTotal;
}

export interface AvaliacaoPlano {
  versao: number;
  /** Só com objetivo financeiro ou atingibilidade sombra/ativo. */
  financeiro?: FinanceiroPlano;
  /** Só com `preservarAtingibilidade`. */
  atingibilidade?: AtingibilidadePlano;
  produtos: AvaliacaoProduto[];
  totais: TotaisAvaliacao;
  trajetoria: TrajetoriaWip[]; // vazio se incluirTrajetoria=false
  postos: PostoContribuicao[];
  /** Valor marginal do n-ésimo posto do pool no slot (re-simulação). Só com incluirMarginais. */
  marginais: Record<string, Record<string, number[]>>; // slot -> chavePool -> [v0, v1, ...]
  diagnosticos: DiagnosticoItem[];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Restrições duras
// ---------------------------------------------------------------------------------------------------------------------------------

export type TipoViolacaoDura =
  | "maquina_indisponivel"
  | "maquina_inativa"
  | "funcionario_ausente"
  | "funcionario_fora_da_equipe"
  | "revezamento"
  | "duas_pessoas_no_posto"
  | "pessoa_em_dois_postos"
  | "maquina_fora_da_selecao"
  | "maquina_fora_do_roteiro"
  | "passado_alterado";

export interface ViolacaoDura {
  tipo: TipoViolacaoDura;
  data: string;
  periodoId: string;
  funcionarioId?: string;
  maquinaId?: string;
  produtoId?: string;
  etapaId?: string;
  detalhe: string;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Diagnóstico do replanejamento (item 35: ANTES / DECISÃO / MOTIVO / DEPOIS) + churn
// ---------------------------------------------------------------------------------------------------------------------------------

export interface PostoRef {
  maquinaId: string | null;
  produtoId: string | null;
  etapaId: string | null;
  /** true = posto de carga ADICIONAL (2ª camada), não do previsto. Ausente = previsto. */
  adicional?: boolean;
}

export interface DecisaoFluxo {
  data: string;
  periodoId: string;
  slot: number;
  de: PostoRef; // plano de REFERÊNCIA: o plano VIGENTE que o supervisor vê (ou o base, se não há plano vigente — ver DiagnosticoFluxo.referencia)
  para: PostoRef; // plano proposto
  quantidade: number; // nº de alocações (pessoa-período) com esta mesma troca
  funcionarios: string[];
  motivo: {
    /** ADITIVO (v2): variação do produto final previsto (peças, cenário pessimista) ao aplicar ESTA decisão sobre o plano de referência, em ordem
     *  cronológica (marginal sequencial). Σ ganhos + `reconciliacao.residuo` = final previsto do plano − final previsto da referência. */
    ganhoProdutoFinal: number;
    /** = ganhoProdutoFinal (com sinal): redução da falta final. Negativo = esta decisão aumenta a falta (paga por outras que melhoram mais). */
    reducaoFalta: number;
    /** WIP existente (estoque projetado no início da região mutável) consumido a mais por esta decisão (≥ 0). */
    wipConsumido: number;
    /** Excesso de WIP no fim da semana evitado por esta decisão (≥ 0). */
    wipEvitado: number;
    /** Variação do WIP total no fim da semana (peças, pessimista, com sinal; aditivo). */
    wipFinalVariacao: number;
    texto: string;
  };
}

/** Visão compacta das decisões: por (pool de origem → pool de destino), somando todos os slots. */
export interface ResumoDecisao {
  de: { produtoId: string | null; etapaId: string | null };
  para: { produtoId: string | null; etapaId: string | null };
  pessoasPeriodo: number;
  slots: number;
  ganhoProdutoFinal: number;
  /** Por período (slot): pessoas-período movidas e ganho — permite conferir que NENHUMA linha alterada fica sem explicação mesmo com a lista detalhada limitada. */
  porSlot: { slot: number; pessoas: number; ganhoProdutoFinal: number }[];
}

export interface AntesFluxo {
  /** Plano que o ANTES descreve: "vigente" (o que o supervisor vê) ou "base" (quando não há plano vigente futuro). */
  referencia: "vigente" | "base";
  demandaRestante: Record<string, number>; // R_f por produto
  remLegado: Record<string, number>;
  wip: EstadoWipPar[];
  gargalosFluxo: GargaloFluxo[];
  faltaFinal: Intervalo;
}

export interface DepoisFluxo {
  produtoFinalPrevisto: Intervalo;
  wipPrevisto: Intervalo;
  faltaPrevista: Intervalo;
  excessoWip: number;
}

export interface ChurnFluxo {
  linhasAlteradas: number; // alocações futuras (≥ aPartirDe) diferentes do plano vigente
  trocasDePosto: number; // pessoas cujo posto (máquina/produto/etapa) mudou
  postosAlterados: number; // postos (slot,máquina) diferentes do plano vigente
  alteradasNoPrimeiroPeriodo: number;
  retidasPorEstabilidade: number;
}

/** Tupla lexicográfica do objetivo J (menor é melhor em cada componente; ver docs/escala-fluxo-nucleo.md). */
export type TuplaObjetivo = number[];

export interface IteracaoFluxo {
  indice: number; // -2 = plano VIGENTE mantido; -1 = plano base; 0 = P0 (rem de fluxo, ordem legada); 1.. = com valor marginal
  tupla: TuplaObjetivo;
  faltaFinalLo: number;
  violacoes: number;
  escolhida: boolean;
  hashPlano: string;
}

export type PlanoEscolhido = "base" | "fluxo" | "vigente";

/** Reconciliação do ganho: Σ `decisoes[].motivo.ganhoProdutoFinal` (todas, não só as listadas) + residuo = diferenca. */
export interface ReconciliacaoGanho {
  referencia: "vigente" | "base";
  finalReferencia: number; // produto final previsto (lo) do plano de referência
  finalPlano: number; // idem, do plano devolvido (avaliado como no diagnóstico)
  diferenca: number; // finalPlano − finalReferencia
  somaGanhos: number; // Σ ganhos das decisões (aditivos)
  /** diferenca − somaGanhos: efeito do teto de demanda (rem de fluxo) e de diferenças de quantidade em postos mantidos — explícito, nunca escondido. */
  residuo: number;
  explicacaoResiduo: string;
}

export interface SituacaoVigente {
  disponivel: boolean; // há linhas vigentes em slots mutáveis
  valido: boolean; // sem violação dura HOJE e completo (mesmas pessoas/slots que o motor geraria)
  motivo: string | null; // por que não é candidato válido
  violacoes: number;
  falta: Intervalo | null; // falta final do futuro vigente pelo MESMO simulador
}

export interface EstabilizacaoPessoas {
  aplicada: boolean;
  periodosAjustados: number;
  linhasAntes: number; // churn do plano escolhido ANTES da re-atribuição
  linhasDepois: number;
  motivoDescarte: string | null;
}

export type DiagnosticoCapacidade = "OK" | "SATURADO_POR_POSTO" | "GARGALO_PESSOA" | "GARGALO_WIP_MATERIAL" | "GARGALO_DOWNSTREAM";

/** Capacidade física de UMA etapa (nó) num período. CAP_ETAPA = min(capacidade de máquinas, capacidade humana elegível, material/WIP, capacidade útil p/ downstream). */
export interface CapacidadeEtapaSlot {
  slot: number;
  data: string;
  periodoId: string;
  no: string; // chave do pool representante
  produtoId: string;
  etapaId: string;
  postosMaximos: number; // máquinas SELECIONADAS na Previsão, disponíveis (Paradas/bloqueios descontados)
  postosOcupados: number; // no plano avaliado
  postosDisponiveis: number;
  postosMinimos: number; // para preservar a atingibilidade (0 se a meta é inatingível: não reserva postos)
  pessoasElegiveis: number; // pessoas presentes no período (ausências descontadas; o revezamento por bloco é hard no motor)
  pessoasLivres: number; // pessoas presentes − postos ocupados no período (todas as etapas)
  produtividadeNominal: number; // peças/período por posto (meta nominal do pool)
  produtividadeEsperada: number; // peças/período por posto usadas pelo núcleo (meta × f ou provedor)
  receitaPorHoraPosto: number; // R$/h por posto = valor econômico unitário × produtividade esperada ÷ horas do período
  capMaquinas: number; // postosMaximos × produtividade
  capHumana: number; // min(postosMaximos, pessoasElegiveis) × produtividade
  capEtapa: number; // min(capHumana, o que a etapa realmente produz com todos os postos: material/WIP e downstream)
  producaoPlano: number; // produção da etapa no plano (cenário pessimista)
  valorMarginalAdicionar: number; // R$ finais adicionais até o fim da semana por MAIS uma pessoa aqui (0 se saturado)
  valorMarginalUltimo: number; // R$ finais que o último posto ocupado gera
  diagnostico: DiagnosticoCapacidade;
}

/** "Pessoa X → posto Y porque: há posto, há material, downstream absorve, produtividade esperada N, receita marginal R$ A, alternativa seguinte R$ B, ganho líquido R$ C". */
export interface DecisaoEconomica {
  slot: number;
  data: string;
  periodoId: string;
  funcionarioId: string;
  maquinaId: string;
  no: string;
  produtoId: string;
  etapaId: string;
  ordemPosto: number; // k-ésimo posto da etapa no período
  postosMaximos: number;
  produtividadeEsperada: number;
  receitaMarginal: number; // R$ (valor econômico) do k-ésimo posto até o fim da semana
  alternativa: { no: string | null; valor: number }; // melhor posto livre alternativo no período
  ganhoLiquido: number; // receitaMarginal − alternativa (custo de oportunidade)
  haMaterial: boolean;
  downstreamAbsorve: boolean;
  texto: string;
}

export interface DiagnosticoEconomia {
  nivel: "receita" | "margem";
  capacidade: CapacidadeEtapaSlot[];
  decisoes: DecisaoEconomica[];
  /** Avaliação do limite econômico da atingibilidade (objetivo financeiro + atingibilidade ativa): por candidato, custo × valor recuperado. */
  limiteEconomico?: { k: number; referencia: number; candidatos: { indice: number; atingiveisPerdidas: number; custoRs: number; valorRecuperadoRs: number; razao: number | null; justificado: boolean }[] };
}

/** Postos mínimos de preservação da atingibilidade num período (tier 1), por nó (chave do pool representante). */
export interface PostoMinimoSlot {
  slot: number;
  data: string;
  periodoId: string;
  grupo: string; // id do nó final
  alvo: number; // final máximo alcançável (lo) com tudo no máximo desde este período
  meta: number;
  atingivel: boolean;
  producaoObrigatoria: number; // peças finais que se perderiam sem nenhum posto aqui
  minimos: Record<string, number>; // nó -> postos mínimos
  noPlano: Record<string, number>; // nó -> postos que o plano escolhido tem
  atendido: boolean;
}

export interface DiagnosticoAtingibilidade {
  /** Atingibilidade do plano de REFERÊNCIA (vigente, ou base se não há vigente) e do plano escolhido, pelo mesmo simulador. */
  antes: AtingibilidadePlano;
  depois: AtingibilidadePlano;
  postosMinimos: PostoMinimoSlot[];
}

/** Variação em R$ e peças de um produto entre a referência e o plano escolhido (nada silencioso: sacrifícios aparecem aqui e em `PRODUTO_SACRIFICADO`). */
export interface VariacaoProduto {
  produtoId: string;
  pecas: number; // escolhido − referência (final projetado)
  rs: number;
}

export interface DiagnosticoFinanceiro {
  antes: FinanceiroPlano; // plano de referência (vigente, ou base)
  depois: FinanceiroPlano;
  variacao: VariacaoProduto[];
  deltaRsProjetado: number;
}

export interface DiagnosticoFluxo {
  versao: number;
  /** Só com objetivo econômico ou atingibilidade sombra/ativo. */
  economia?: DiagnosticoEconomia;
  /** Só com objetivo financeiro ou atingibilidade sombra/ativo. */
  financeiro?: DiagnosticoFinanceiro;
  /** Só com `preservarAtingibilidade`. */
  atingibilidade?: DiagnosticoAtingibilidade;
  planoEscolhido: PlanoEscolhido;
  /** Plano contra o qual `decisoes`, `antes` e `reconciliacao` são descritos. */
  referencia: "vigente" | "base";
  vigente: SituacaoVigente;
  estabilizacao: EstabilizacaoPessoas;
  reconciliacao: ReconciliacaoGanho;
  iteracaoEscolhida: number | null;
  theta: number;
  antes: AntesFluxo;
  decisoes: DecisaoFluxo[]; // até `maxDecisoes` (default 500; cobre todas nos casos reais), as de maior |ganho| se limitado; ordem cronológica
  decisoesTotal: number; // total antes do corte
  resumoDecisoes: ResumoDecisao[]; // completo, agregado por pool de origem → destino
  depois: DepoisFluxo;
  /** Resumo do plano base avaliado pelo MESMO simulador (régua do critério E). */
  depoisBase: DepoisFluxo;
  /** Futuro do plano VIGENTE avaliado pelo MESMO simulador (null se não há plano vigente futuro). */
  depoisVigente: DepoisFluxo | null;
  churn: ChurnFluxo;
  iteracoes: IteracaoFluxo[];
  violacoes: ViolacaoDura[];
  estado: EstadoFluxo;
  avaliacaoBase: AvaliacaoPlano;
  avaliacaoFluxo: AvaliacaoPlano;
  diagnosticos: DiagnosticoItem[];
}

export interface ResultadoFluxo {
  /** Entrada com os hooks aditivos preenchidos (remPorPool, ordemPostos, bonusContinuidade) que gerou `resultado`. */
  entradaFluxo: EntradaEscala;
  resultado: ResultadoEscala;
  diagnostico: DiagnosticoFluxo;
}
