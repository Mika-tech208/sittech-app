// Sittech Intelligence V1 — tipos centrais. Nenhuma fórmula mora aqui —
// só o vocabulário estruturado que amarra tools/evidências/confiança/
// permissões em cima dos motores determinísticos já existentes (ver
// dataFetchers.ts/tools/*). Read-only: nada aqui escreve no banco de
// negócio (só a auditoria própria da Intelligence).

import type { Permissao } from "@/lib/permissoes";

// ---------------------------------------------------------------------
// Confiança (§8/§9 da análise aprovada) — reaproveita literalmente o
// vocabulário já usado nos motores (paradas: "fato"|"calculado";
// economico/desvios: "calculado"|"estimativa"|"aproximacao"). Nunca
// promovida pela IA — ver confidence.ts.
// ---------------------------------------------------------------------
export type IntelligenceConfidence = "FATO" | "CALCULADO" | "ESTIMATIVA" | "APROXIMACAO";

export interface IntelligenceEvidenceContext {
  produtoId?: string;
  produtoNome?: string;
  maquinaId?: string;
  maquinaNome?: string;
  operacaoId?: string;
  operacaoNome?: string;
  funcionarioId?: string;
  funcionarioNome?: string;
}

export interface IntelligenceEvidencePeriod {
  start: string; // ISO date
  end: string; // ISO date
  label: string; // ex.: "Semana atual até agora"
}

// Estrutura de evidência (§7/§8 da análise aprovada). Todo número que o
// LLM cita precisa vir de uma destas — o LLM explica, nunca edita
// `value`. UUIDs podem existir aqui (uso interno/drillDown), mas nunca
// devem aparecer no texto final pro usuário (ver causality.ts/orchestrator.ts).
export interface IntelligenceEvidence {
  id: string;
  domain: "producao" | "paradas" | "desvios" | "previsao" | "funcionarios" | "economia" | "ocorrencia";
  metric: string;
  value?: number | string;
  unit?: "%" | "min" | "R$" | "peças" | "h" | null;
  period?: IntelligenceEvidencePeriod;
  context?: IntelligenceEvidenceContext;
  confidence: IntelligenceConfidence;
  source: string; // nome da função oficial reaproveitada, ex.: "calcularResumoIndicadores"
  drillDown?: string; // rota + query string, mesmo padrão já usado no resto do app
}

// ---------------------------------------------------------------------
// Envelope de resultado de tool (§6 da análise aprovada). A tool NUNCA
// devolve texto pronto — sempre este envelope, que o orquestrador passa
// pro LLM como resultado da function call.
// ---------------------------------------------------------------------
export interface IntelligenceToolSuccess<T = unknown> {
  success: true;
  tool: string;
  period?: IntelligenceEvidencePeriod;
  context?: IntelligenceEvidenceContext;
  data: T;
  evidences: IntelligenceEvidence[];
}

export type IntelligenceToolErrorCode =
  | "sem_permissao"
  | "sem_dados"
  | "amostra_insuficiente"
  | "entidade_ambigua"
  | "entidade_nao_encontrada"
  | "parametro_invalido"
  | "falha_consulta";

export interface IntelligenceToolError {
  success: false;
  tool: string;
  code: IntelligenceToolErrorCode;
  message: string; // já em linguagem segura, nunca vaza dado protegido
  candidatos?: { id: string; nome: string }[]; // só preenchido em entidade_ambigua
}

export type IntelligenceToolResult<T = unknown> = IntelligenceToolSuccess<T> | IntelligenceToolError;

// ---------------------------------------------------------------------
// Janela temporal (§9/§14 da análise aprovada) — o LLM só escolhe um
// destes rótulos semânticos; a resolução em datas exatas é sempre
// determinística (ver dates.ts).
// ---------------------------------------------------------------------
export type JanelaChave = "hoje" | "semana_atual" | "semana_passada" | "ultimos_14_dias" | "ultimos_28_dias" | "custom";

export interface JanelaParametro {
  janela: JanelaChave;
  dataInicialCustom?: string; // só usado quando janela === "custom"
  dataFinalCustom?: string;
}

export interface JanelaResolvida {
  dataInicial: string;
  dataFinal: string;
  rotulo: string;
  chave: JanelaChave;
}

// ---------------------------------------------------------------------
// Contexto de conversa (§11/§18 da análise aprovada) — sem memória
// vetorial, sem persistência entre sessões. Só o que a conversa ATUAL
// precisa pra resolver "e comparado à semana passada?" etc.
// ---------------------------------------------------------------------
export type TipoEntidadeContexto = "maquina" | "produto" | "funcionario" | "operacao";

export interface UltimoContexto {
  tipo: TipoEntidadeContexto;
  id: string;
  nome: string;
  janela?: JanelaResolvida;
}

export interface ConversationContext {
  ultimoContexto?: UltimoContexto;
}

// ---------------------------------------------------------------------
// Usuário autenticado + permissões resolvidas server-side (auth.ts) —
// mesmo vocabulário de src/lib/permissoes.ts, nunca redefinido.
// ---------------------------------------------------------------------
export interface UsuarioIntelligence {
  id: string;
  nome: string;
  papel: "admin" | "usuario";
  permissoes: Permissao[];
}
