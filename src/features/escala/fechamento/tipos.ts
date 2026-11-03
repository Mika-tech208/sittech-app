// FECHAMENTO FÍSICO ATÔMICO — tipos puros (sem IO). Ver docs/escala-fechamento-fisico-especificacao-v2.md e docs/escala-fechamento-fisico-implantacao.md.
export type ModoFechamento = "desligado" | "sombra" | "ativo";
export type EstadoFechamento = "EM_FECHAMENTO" | "RECALCULANDO" | "CONFIRMADO" | "ERRO_RECALCULO";
/** Estado de um período para a tela (inclui os que não dependem do fechamento). */
export type EstadoPeriodo = "FUTURO" | "EM_EXECUCAO" | EstadoFechamento;

/** Par do motor que um buffer físico representa. `contabil` recebe o total físico; `zero` recebe 0 (mesmo estoque físico, já contado no contábil). */
export interface ParDoBuffer { produtoId: string; etapaOrigemId: string; etapaSeguinteId: string; papel: "contabil" | "zero" }
export interface BufferCatalogo { id: string; chave: string; rotulo: string; ordem: number; pares: ParDoBuffer[] }

export interface EstimativaBuffer { bufferId: string; estimado: number; lo: number; hi: number }
/** Par do estado do fluxo (subconjunto de EstadoWipPar usado aqui). */
export interface ParEstimado { produtoId: string; etapaOrigemId: string; etapaSeguinteId: string; wip: { lo: number; hi: number } }

export type StatusPosto = "pendente" | "produzindo" | "sem_producao";
export interface PostoFechamento { maquinaId: string; nome: string; status: StatusPosto; produzido: number; refugo: number; motivo: string | null }

export interface BufferInformado { bufferId: string; fisico: number | null; motivo?: string | null }
export interface EntradaConfirmacao {
  data: string; periodoId: string;
  chave: string;                       // idempotência (gerada na abertura da tela)
  contadoEmMs?: number;                // padrão: agora
  buffers: BufferInformado[];
  confirmouDiferencaGrande?: boolean;  // dois passos acima de 50%
  excecao?: { motivo: string };        // fechar SEM contagem (perfil superior)
  observacao?: string | null;
  dispositivo?: string | null;
}

export interface ErroValidacao { codigo: string; mensagem: string; bufferId?: string; detalhes?: Record<string, unknown> }

/** Par (produto, etapa→etapa) com estoque intermediário que o motor controla e que NÃO está no catálogo de buffers nem declarado como sem estoque físico. */
export interface ParSemBuffer { produtoId: string; produto: string; etapaOrigemId: string; etapaOrigem: string; etapaSeguinteId: string; etapaDestino: string; rota: string }
export interface ResultadoValidacao { ok: boolean; erros: ErroValidacao[]; exigeConfirmacao: string[] }

export interface TemposFechamento {
  gravacao: number; entrada: number; corte: number; validacao: number; persistencia: number; total: number;
  /** carga do contexto da confirmação, aberta por etapa (ms): estado do banco, montagem do estado do fluxo, catálogo de buffers+estimativas, postos/apontamentos */
  contexto?: { estado: number; montagem: number; buffers: number; postos: number };
}

/** Limites (iguais aos CHECKs do banco). */
export const DIFERENCA_EXIGE_MOTIVO = { absoluta: 500, relativa: 0.15 } as const;
export const DIFERENCA_EXIGE_CONFIRMACAO = 0.5;
export const JANELA_CONTAGEM_ANTES_DO_FIM_MS = 15 * 60_000;
export const TOLERANCIA_FUTURO_MS = 30 * 60_000;
export const VALIDADE_ABERTURA_MIN = 30;
export const VALIDADE_TRAVA_S = 120;
