// Escala de Produção — contratos do motor PURO (sem I/O, sem relógio, sem
// banco). Todo o contexto temporal entra como dado (slots já com início/fim
// absolutos), então o motor é determinístico e testável.
//
// Identidade lógica de demanda: pool = (produto_id, etapa_id) — nunca o id
// de previsao_itens, que é recriado a cada save da Previsão.

export interface PeriodoEscala {
  id: string; // "m1".."t3"
  nome: string;
  inicio: string; // "HH:MM"
  fim: string; // "HH:MM"
}

export interface SlotEscala {
  data: string; // "YYYY-MM-DD"
  periodoId: string;
  indice: number; // posição global na semana (0..n-1), em ordem cronológica
  primeiroDoDia: boolean; // T3 -> M1 do dia seguinte reseta o revezamento
  inicioMin: number; // minutos desde 00:00 (comparação com janelas de ausência)
  fimMin: number;
  inicioMs: number; // instante absoluto (comparação com indisponibilidades)
  fimMs: number;
}

export interface PoolEscala {
  produtoId: string;
  etapaId: string;
  operacaoId: string;
  ordemEtapa: number;
  quantidade: number; // Q: peças previstas do produto na semana
  maquinasIds: string[]; // M_P: máquinas selecionadas na Previsão para a etapa
  metas: Record<string, number>; // periodoId -> peças por máquina no período (meta_m1..meta_t3)
  valorUnitario: number; // snapshot do item previsto
  // CARGA ADICIONAL (2ª camada): peças de produto acabado ACIMA do previsto, só para
  // ocupar quem ficaria sem posto. Padrão 0 (= comportamento anterior, idêntico).
  adicionalMax?: number;
  // Máquinas do roteiro compatíveis com a etapa (roteiro_etapa_maquinas). O motor NUNCA usa
  // máquina fora de `maquinasIds`; isto é só para o diagnóstico de cobertura sugerir recursos.
  maquinasCompativeisIds?: string[];
}

export interface FuncionarioEscala {
  id: string;
  nome?: string;
}

// null/null = dia inteiro. Janela [inicioMin, fimMin) em minutos do dia.
export interface JanelaAusenciaEscala {
  funcionarioId: string;
  data: string;
  inicioMin: number | null;
  fimMin: number | null;
}

export interface IndisponibilidadeRecursoEscala {
  maquinaId: string;
  desdeMs: number;
  liberadaEmMs: number | null;
}

export interface AlocacaoEscala {
  data: string;
  periodoId: string;
  funcionarioId: string;
  maquinaId: string | null;
  produtoId: string | null;
  etapaId: string | null;
  operacaoId: string | null;
  pecas: number; // crédito planejado do PREVISTO (snapshot) — 0 quando sem posto ou quando o posto é só de adicional
  pecasAdicional?: number; // crédito da carga ADICIONAL (2ª camada); ausente/0 = posto do previsto
  motivoSemPosto: string | null;
  excecaoRevezamento: boolean;
  motivoExcecao: string | null;
  // "manual" = troca feita por uma pessoa (decisão explícita, entrada canônica do recálculo);
  // ausente/"auto" = saída derivada do motor (NUNCA volta como entrada).
  origem?: "auto" | "manual";
  // Só com o adicional por etapa (WIP) ativo e pecasAdicional > 0: "acabado" = última etapa do roteiro;
  // "intermediario" = etapa anterior (alimenta o acabado ou fica como estoque intermediário).
  tipoAdicional?: "acabado" | "intermediario";
}

// Histórico agregado (janela recente) a partir da escala REALMENTE gravada
// (escala_producao_alocacoes). Interno ao motor — nunca exibido na interface.
// Tudo em MINUTOS (os períodos têm durações diferentes: M1/M2 96, M3 91,
// T1/T2/T3 80 — um M1 NÃO equivale a um T1):
//  - minutosDisponiveis: minutos dos períodos em que a pessoa estava disponível
//    (tinha linha na escala, com ou sem posto; ausência não gera linha, logo
//    não vira "dívida");
//  - porOperacao / porMaquina: minutos expostos (períodos COM posto) na janela.
export interface HistoricoEquidadeFuncionario {
  funcionarioId: string;
  minutosDisponiveis: number;
  porOperacao: Record<string, number>;
  porMaquina: Record<string, number>;
}

export interface EntradaEscala {
  slots: SlotEscala[]; // todos os slots produtivos da semana, em ordem
  aPartirDe: number; // primeiro slot MUTÁVEL (os anteriores estão congelados)
  pools: PoolEscala[];
  funcionarios: FuncionarioEscala[]; // equipe produtiva da semana
  ausencias: JanelaAusenciaEscala[];
  maquinasIndisponiveisPrevisao: string[]; // previsao_maquinas_indisponiveis (semana inteira)
  maquinasInativas?: string[];
  indisponibilidades: IndisponibilidadeRecursoEscala[]; // escala_recurso_indisponivel
  congeladas: AlocacaoEscala[]; // alocações de slots < aPartirDe (consumo planejado + histórico de rotação)
  // Trocas MANUAIS vigentes em slots >= aPartirDe (origem "manual"): única parte do plano futuro
  // que é entrada do motor (preferência suave para manter a decisão de quem trocou). O plano
  // futuro automático anterior NÃO entra — mesmas entradas => mesma escala.
  trocasManuais?: AlocacaoEscala[];
  nomesOperacao?: Record<string, string>;
  // Equidade histórica (opcional). Sem histórico, só a exposição acumulada
  // na própria escala em geração (congeladas + períodos já decididos) conta.
  historicoEquidade?: HistoricoEquidadeFuncionario[];
  // Etapas da Previsão SEM nenhuma máquina selecionada: o motor as ignora (nunca usa máquina fora da
  // Previsão), mas o diagnóstico de cobertura precisa delas para dizer "falta selecionar máquina".
  poolsSemMaquina?: PoolEscala[];
  // Adicional por etapa + estoque intermediário planejado (pipeline). Ausente = comportamento anterior.
  // `limites`: teto de estoque entre a etapa k e a k+1, por chave do pool da etapa k.
  // `saldo0` (Fase 3): estoque intermediário CONFIRMADO que a semana usa, por chave do pool da etapa ORIGEM. Já está descontado da
  // quantidade a produzir da origem; aqui só alimenta o alerta de falta de material (a etapa seguinte pode consumir esse estoque).
  // `estoqueConfirmado` (Fase 3): o MESMO saldo confirmado (disponível na abertura) ocupa o limite de estoque do par: o motor só
  // planeja de WIP adicional o espaço que sobra (limite − confirmado − adicional já planejado), nunca negativo.
  wip?: { limites: Record<string, number>; saldo0?: Record<string, number>; estoqueConfirmado?: Record<string, number> };
  // REVEZAMENTO DURO (Fase 4a): a mesma pessoa NUNCA executa a mesma operacao_id em períodos consecutivos do mesmo dia (qualquer máquina,
  // produto ou posto; M3→T1 conta; o primeiro período do dia zera). Solução que repete é eliminada do espaço de busca: sem solução válida o
  // posto fica sem operador e gera `rotacao_sem_solucao`. Ausente/false = comportamento anterior (repetição "inevitável" vira exceção).
  revezamentoDuro?: boolean;
  // MODO SOMBRA (Fase 4d): adicional/WIP por etapa que a Produção Real JÁ realizou antes de `aPartirDe` e que NÃO está em linhas congeladas
  // (o realizado vem agregado, não por posto). Consome o teto restante e conta no equilíbrio da cadeia e no limite de estoque, exatamente
  // como o adicional congelado. Ausente (Escala oficial) = comportamento anterior, idêntico.
  adicionalRealizado?: Record<string, number>;
  // ESCALA INTELIGENTE (fluxo) — hooks ADITIVOS. Todos ausentes (Escala oficial) = saída BYTE-IDÊNTICA à anterior (golden-master).
  // `remPorPool`: demanda restante EXPLÍCITA (peças) por pool ("produto|etapa") no primeiro slot mutável; substitui Q − créditos congelados
  // (não abate crédito planejado). Pool ausente do mapa = regra anterior.
  remPorPool?: Record<string, number>;
  // `ordemPostos`: valor marginal (peças finais entregues até o fim da semana) do n-ésimo posto (n = 0,1,…) de cada pool em cada slot
  // (índice do slot -> "produto|etapa" -> valores). Passa a ser o 1º critério de seleção de postos (depois, gargalo/folga e o resto).
  ordemPostos?: { valorMarginal: Record<string, Record<string, number[]>> };
  // `bonusContinuidade`: bônus (em peças finais equivalentes) somado ao valor marginal do posto (máquina, pool) que já está ocupado no plano
  // vigente (índice do slot -> "maquinaId|produto|etapa" -> bônus). Só tem efeito junto com `ordemPostos`.
  bonusContinuidade?: Record<string, Record<string, number>>;
}

export type TipoAlerta =
  | "demanda_nao_atendida"
  | "subcarga_previsao"
  | "gargalo_sem_operador"
  | "risco_falta_material"
  | "wip_acima_do_limite"
  | "rotacao_sem_solucao"
  | "compromisso_inviavel"
  | "conflito_rotacao_comprometido"
  | "compromisso_nao_reparavel"
  | "compromisso_inviavel_reparavel"
  | "compromisso_inviavel_nao_reparavel"
  | "contingencia_possivel"
  | "selecao_maquina_invalida" // Previsão com máquina que o roteiro ATUAL não torna elegível para a etapa (ignorada pelo motor; a Previsão NÃO é corrigida em silêncio)
  | "sem_funcionarios";

export interface AlertaEscala {
  tipo: TipoAlerta;
  data?: string;
  periodoId?: string;
  produtoId?: string;
  etapaId?: string;
  etapaAnteriorId?: string;
  maquinaId?: string; // selecao_maquina_invalida
  operacaoId?: string; // idem: operação da etapa no roteiro atual
  pecas?: number;
  quantidade?: number; // ex.: nº de funcionários sem posto
  motivo?: string;
}

export interface ResumoSlot {
  data: string;
  periodoId: string;
  funcionariosDisponiveis: number;
  postosComDemanda: number; // máquinas candidatas (demanda restante, disponíveis)
  postosPreenchidos: number;
  semPosto: number;
}

export interface ResultadoEscala {
  alocacoes: AlocacaoEscala[]; // só slots >= aPartirDe
  alertas: AlertaEscala[];
  resumoSlots: ResumoSlot[];
  // Primeira geração com a semana em andamento: nenhuma alocação congelada
  // existe e o primeiro slot mutável não é o primeiro da semana. A demanda
  // semanal é tratada como ainda restante (V1 não desconta Produção Real).
  primeiraGeracaoComSemanaEmAndamento: boolean;
  pecasRestantes: Record<string, number>; // "produto|etapa" -> peças não atendidas no fim da semana
  adicionalProduzido: Record<string, number>; // "produto|etapa" -> peças da carga adicional alocadas (só quando há adicional)
}

export const MOTIVO_DEMANDA_ESGOTADA = "Demanda da Previsão esgotada";
export const MOTIVO_REVEZAMENTO = "Revezamento obrigatório: sem posto livre que não repita a operação do período anterior";
export const MOTIVO_JA_COBERTA = "Demanda restante já coberta neste período";
export const MOTIVO_RECURSOS_INDISPONIVEIS = "Recursos com demanda restante indisponíveis";
export const MOTIVO_POSTOS_OCUPADOS = "Todos os postos da Previsão com demanda já estão ocupados neste período";

export const AVISO_PRIMEIRA_GERACAO =
  "Primeira geração iniciada com a semana em andamento. A Escala não desconta produção realizada antes da geração.";

export function chavePool(produtoId: string, etapaId: string): string {
  return `${produtoId}|${etapaId}`;
}
