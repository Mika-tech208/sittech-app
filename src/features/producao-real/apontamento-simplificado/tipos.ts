// APONTAMENTO SIMPLIFICADO no fechamento do período — tipos puros (sem IO). Ver docs/apontamento-simplificado.md.
// Regra de ouro: o PLANEJADO (plano oficial do período) é somente leitura; o REAL é o que a pessoa informa e pode divergir de tudo.
// "Operador" é o registro de quem estava no posto (apontamento.funcionario_id) — NÃO é métrica de desempenho individual.

export type Divergencia = "MAQUINA" | "OPERADOR" | "PRODUTO" | "OPERACAO";
export type OrigemLinha = "PROGRAMADO" | "POSTO_NAO_PLANEJADO";
/** De onde a linha veio: NOVA (ainda não gravada), SALVA_FLUXO (gravada por este fluxo; reenvio substitui) ou EXISTENTE_PAINEL (lançada no painel; o fluxo só exibe, nunca altera). */
export type SituacaoLinha = "NOVA" | "SALVA_FLUXO" | "EXISTENTE_PAINEL";
export type MotivoNaoProduziu = "SEM_MATERIAL" | "PARADA" | "AUSENCIA" | "SETUP_REGULAGEM" | "FALTA_COMPONENTE" | "OUTRO";

export interface PlanejadoPosto {
  readonly maquinaId: string; readonly maquinaNome: string;
  readonly funcionarioId: string; readonly funcionarioNome: string;
  readonly produtoId: string; readonly produtoNome: string;
  readonly etapaId: string; readonly operacaoId: string; readonly operacaoNome: string;
  readonly pecas: number;
}

/** Posto da EXECUÇÃO REAL do período (regularização operacional do período atual): o que realmente trabalhou, quando diverge do plano oficial. */
export interface PostoRealInformado {
  readonly maquinaId: string; readonly maquinaNome: string;
  readonly funcionarioId: string; readonly funcionarioNome: string;
  readonly produtoId: string; readonly produtoNome: string;
  readonly etapaId: string | null; readonly operacaoId: string | null; readonly operacaoNome: string;
}

export interface RealPosto { maquinaId: string | null; funcionarioId: string | null; produtoId: string | null }

export interface LinhaApontamento {
  /** execução real do período: a linha é um posto que REALMENTE trabalhou (mesmo sem plano) e precisa estar resolvida para fechar */
  exigida?: boolean;
  chave: string;                          // uuid local: vira linha_chave/idempotência no banco
  origem: OrigemLinha;
  situacao: SituacaoLinha;
  planejado: PlanejadoPosto | null;       // IMUTÁVEL (nenhuma função deste módulo o altera)
  real: RealPosto;
  produzido: number | null;               // null = ainda não informado
  refugo: number | null;                  // null = 0 (igual ao modal de hoje)
  naoProduziu: boolean;
  motivo: MotivoNaoProduziu | null;
  descricao: string;
  apontamentoId: string | null;
}

export interface Opcao { id: string; nome: string }
export interface ElegibilidadeItem { maquinaId: string; produtoId: string; etapaId: string; operacaoId: string }
/** Catálogos para editar o REAL. A operação é DERIVADA do par máquina×produto (roteiro): o banco só aceita uma etapa elegível por par. */
export interface Catalogo { maquinas: Opcao[]; funcionarios: Opcao[]; produtos: Opcao[]; operacoes: Record<string, string>; elegibilidade: ElegibilidadeItem[] }

export interface AlocacaoPlano { maquinaId: string | null; funcionarioId: string; produtoId: string | null; etapaId: string | null; operacaoId: string | null; pecas: number; pecasAdicional?: number }

export interface ApontamentoExistente {
  id: string; maquinaId: string; funcionarioId: string | null; produtoId: string | null; operacaoId: string | null;
  produzido: number; refugo: number; status: "produzindo" | "sem_producao"; motivoSemProducao: string | null; descricaoSemProducao: string | null;
}
export interface VinculoSalvo {
  apontamentoId: string; origem: OrigemLinha; maquinaPlanejadaId: string | null; divergencias: Divergencia[];
  naoProduziu: boolean; motivo: MotivoNaoProduziu | null; linhaChave: string; descricaoInformada: string;
}

export interface ProblemaLinha { codigo: string; mensagem: string; campo?: "maquina" | "produto" | "operador" | "produzido" | "refugo" | "motivo" | "descricao" }

/** Linha pronta para a RPC `registrar_apontamentos_fechamento`. */
export interface LinhaRpc {
  chave: string; maquina_planejada_id: string | null; maquina_id: string; produto_id: string | null; funcionario_id: string | null;
  produzido: number; refugo: number; nao_produziu: boolean; motivo: MotivoNaoProduziu | null; descricao: string;
}
