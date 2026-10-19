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
  pecas: number; // crédito planejado (snapshot) — 0 quando sem posto
  motivoSemPosto: string | null;
  excecaoRevezamento: boolean;
  motivoExcecao: string | null;
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
  alocacoesAtuais?: AlocacaoEscala[]; // plano vigente em slots >= aPartirDe (só para minimizar mudanças)
  nomesOperacao?: Record<string, string>;
}

export type TipoAlerta =
  | "demanda_nao_atendida"
  | "subcarga_previsao"
  | "gargalo_sem_operador"
  | "risco_falta_material"
  | "sem_funcionarios";

export interface AlertaEscala {
  tipo: TipoAlerta;
  data?: string;
  periodoId?: string;
  produtoId?: string;
  etapaId?: string;
  etapaAnteriorId?: string;
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
}

export const MOTIVO_DEMANDA_ESGOTADA = "Demanda da Previsão esgotada";
export const MOTIVO_JA_COBERTA = "Demanda restante já coberta neste período";
export const MOTIVO_RECURSOS_INDISPONIVEIS = "Recursos com demanda restante indisponíveis";
export const MOTIVO_POSTOS_OCUPADOS = "Todos os postos da Previsão com demanda já estão ocupados neste período";

export const AVISO_PRIMEIRA_GERACAO =
  "Primeira geração iniciada com a semana em andamento. A Escala não desconta produção realizada antes da geração.";

export function chavePool(produtoId: string, etapaId: string): string {
  return `${produtoId}|${etapaId}`;
}
