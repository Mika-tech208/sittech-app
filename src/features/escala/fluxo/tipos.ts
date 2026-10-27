// ESCALA INTELIGENTE (fluxo) — CONTRATO do núcleo puro. Sem IO, sem relógio, sem Supabase: tudo entra por parâmetro.
//
// Todos os tipos de saída (EstadoFluxo, AvaliacaoPlano, DiagnosticoFluxo, ViolacaoDura) são JSON-serializáveis (vão para jsonb):
// só objetos, arrays, strings, números finitos, booleanos e null. Nenhum Map/Set/Infinity/NaN.
//
// Convenções de unidade: tudo em PEÇAS. "lo"/"hi" = limite inferior/superior de uma grandeza INCERTA (produção não confirmada).
// Chave de pool = "produtoId|etapaId" (chavePool). Slot = índice global na semana (SlotEscala.indice).

import type { ApontamentoReal } from "../producaoReal";
import type { AlocacaoEscala, EntradaEscala, ResultadoEscala } from "../types";

export const VERSAO_FLUXO = 1;

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

export interface DadosProducaoReal {
  /** Tudo que existe lançado. O núcleo só enxerga lançamentos com lancadoEmMs ≤ agoraMs (nunca o futuro). */
  apontamentos: ApontamentoReal[];
  /** "Agora" (epoch ms), por parâmetro. Define quais períodos estão FECHADOS (fim + fechamentoMinutos ≤ agora). */
  agoraMs: number;
  /** Minutos após o fim do período para considerá-lo fechado. Default 10 (regra de fechamento.ts). */
  fechamentoMinutos?: number;
  /** Saldos de WIP confirmados por par. Ausente/sem o par ⇒ WIP ESTIMADO (lo/hi pelos apontamentos). */
  wipConfirmado?: SaldoWipConfirmadoPar[];
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
  /** θ: ganho mínimo (peças finais) para trocar uma alocação já existente no PRIMEIRO período mutável. Default derivado (spec §4). */
  limiarEstabilidadePecas?: number;
  /** Máximo de iterações de valor marginal. Default 4. */
  maxIteracoes?: number;
  /** Fator de desempenho por pool (metas futuras × f). Ausente = metas de entrada.pools já são as efetivas. */
  fatorPorPool?: Record<string, number>;
  /** Pondera a falta final por valorUnitario da etapa final (default false: peças). */
  ponderarPorValor?: boolean;
  /** Fluxo entre etapas no MESMO período (consumo ≤ WIP inicial + produção upstream do período). Default true (spec §3). */
  fluxoMesmoPeriodo?: boolean;
  /** Inclui na avaliação a trajetória de WIP por par/slot e os marginais (mais pesado no jsonb). Default true / false. */
  incluirTrajetoria?: boolean;
  incluirMarginais?: boolean;
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
  | "POOL_FUNDIDO"; // pools legados fundidos logicamente

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
}

export interface EstadoProduto {
  produtoId: string;
  etapaFinalId: string;
  quantidadeFinal: number; // Q_f
  boasFinais: Intervalo;
  /** R_f = max(0, Q_f − B_f,lo) — conservador: só o confirmado reduz a meta final. */
  demandaFinalRestante: number;
  /** max(0, Q_f − B_f,hi) — limite otimista (para a faixa de falta). */
  demandaFinalRestanteMin: number;
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
  capacidadeGargalo: number;
}

export interface TrajetoriaWip {
  chave: string; // "produto|etapaOrigem"
  porSlot: { slot: number; lo: number; hi: number }[];
}

export interface AvaliacaoPlano {
  versao: number;
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
}

export interface DecisaoFluxo {
  data: string;
  periodoId: string;
  slot: number;
  de: PostoRef; // plano base (oficial)
  para: PostoRef; // plano de fluxo
  quantidade: number; // nº de alocações (pessoa-período) com esta mesma troca
  funcionarios: string[];
  motivo: {
    ganhoProdutoFinal: number; // estimativa (peças finais) = contribuição(para) − contribuição(de); não é aditiva
    reducaoFalta: number;
    wipConsumido: number;
    wipEvitado: number;
    texto: string;
  };
}

export interface AntesFluxo {
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
  indice: number; // 0 = P0 (rem de fluxo, ordem legada); 1.. = com valor marginal
  tupla: TuplaObjetivo;
  faltaFinalLo: number;
  violacoes: number;
  escolhida: boolean;
  hashPlano: string;
}

export type PlanoEscolhido = "base" | "fluxo";

export interface DiagnosticoFluxo {
  versao: number;
  planoEscolhido: PlanoEscolhido;
  iteracaoEscolhida: number | null;
  theta: number;
  antes: AntesFluxo;
  decisoes: DecisaoFluxo[];
  depois: DepoisFluxo;
  /** Resumo do plano base avaliado pelo MESMO simulador (régua do critério E). */
  depoisBase: DepoisFluxo;
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
