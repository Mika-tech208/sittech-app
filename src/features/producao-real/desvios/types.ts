// Desvios V1 — tipos centrais. Nenhuma fórmula oficial mora aqui; só o
// vocabulário estruturado usado pelo motor de detecção
// (janelas/amostra/severidade/deduplicação) e, no futuro, consumível pelo
// Sittech Intelligence sem precisar reconstruir o significado a partir de
// texto solto (item 18 da análise aprovada).

import type { FiltrosIndicadores } from "@/features/producao-real/indicadores/calculations";

export type DominioDesvio = "produtividade" | "paradas" | "qualidade" | "sem_producao" | "economia" | "fluxo";

export type TipoDesvio =
  | "performance_deteriorou"
  | "atingimento_meta_deteriorou"
  | "paradas_minutos_aumentaram"
  | "paradas_frequencia_aumentou"
  | "paradas_duracao_media_aumentou"
  | "paradas_motivo_recorrente"
  | "paradas_capacidade_perdida_aumentou"
  | "paradas_custo_ocioso_aumentou"
  | "refugo_aumentou"
  | "qualidade_deteriorou"
  | "sem_producao_recorrente"
  | "custo_peca_aumentou"
  | "diferenca_custo_teorico_observado_aumentou"
  | "margem_deteriorou"
  | "possivel_restricao_operacional";

export type SeveridadeDesvio = "informativo" | "atencao" | "critico";
export type NivelMagnitude = "leve" | "relevante" | "forte";
// Vocabulário já estabelecido em economico.ts/paradas/calculations.ts —
// reaproveitado aqui, nunca redefinido com outro sentido.
export type NivelConfiancaDesvio = "calculado" | "estimativa";

// Contexto de comparação (§6 da análise aprovada): produto+operação
// sempre presentes; maquinaId é null quando o desvio é agregado entre as
// máquinas elegíveis da etapa (nunca misturado silenciosamente com um
// desvio de máquina específica — o campo em si já marca qual dos dois é).
export interface ContextoDesvio {
  produtoId: string | null;
  produtoNome: string | null;
  operacaoId: string | null;
  operacaoNome: string | null;
  maquinaId: string | null;
  maquinaNome: string | null;
}

export interface Janela {
  dataInicial: string;
  dataFinal: string;
}

export interface ParDeJanelas {
  atual: Janela;
  referencia: Janela;
}

// Rastreabilidade obrigatória (§12): toda evidência/fator precisa apontar
// pra fonte, contexto, período e valor que a originou — nunca um texto
// solto como única prova.
export interface Evidencia {
  fonte: string; // ex.: "Pareto de paradas", "Recorrência de motivo", "Ocorrência de máquina", "Sem produção"
  descricao: string; // texto curto, sempre com "possível"/"coincidiu com"/"vale investigar" quando sugere causa
  contexto: string; // rótulo legível do contexto (ex.: "Rosqueadeira 4 — Rosquear")
  periodo: string; // rótulo legível da janela usada
  valor: string; // valor formatado que sustenta a evidência (ex.: "186 min", "5 de 8 períodos")
}

export interface Impacto {
  metrica: string; // ex.: "Custo do tempo ocioso", "Capacidade local perdida"
  valor: number;
  unidade: "R$" | "peças" | "min" | "%";
}

export interface PossivelFator {
  fator: string; // rótulo curto (ex.: "Ferramenta", "Mudança de operador")
  descricao: string; // sempre em tom de hipótese ("possível fator associado", nunca "causado por")
  evidencia: Evidencia;
}

export interface AvaliacaoAmostra {
  suficiente: boolean;
  periodosJanelaAtual: number;
  periodosJanelaReferencia: number;
  minutosProdutivosJanelaAtual: number;
  minutosProdutivosJanelaReferencia: number;
  volumeProduzidoJanelaAtual: number | null; // só avaliado pra Qualidade/Refugo
  metaPeriodoMediaContexto: number | null; // idem
  motivoInsuficiencia: string | null;
}

export interface AvaliacaoSeveridade {
  severidade: SeveridadeDesvio;
  magnitude: NivelMagnitude;
  persistente: boolean;
  impactoAlto: boolean;
  justificativa: string; // legível, mostrado na UI — nunca só um número
}

export interface DesvioDetectado {
  // Determinístico: dominio+tipo+contexto+janela — mesmo desvio recalculado
  // duas vezes com os mesmos dados sempre produz o mesmo id.
  id: string;
  dominio: DominioDesvio;
  tipo: TipoDesvio;
  titulo: string;
  contexto: ContextoDesvio;
  janelaAtual: Janela;
  janelaReferencia: Janela;
  metrica: string;
  unidade: "%" | "min" | "R$" | "peças";
  valorAtual: number;
  valorReferencia: number;
  deltaAbsoluto: number;
  deltaPercentual: number | null;
  magnitude: NivelMagnitude;
  severidade: SeveridadeDesvio;
  justificativaSeveridade: string;
  persistente: boolean;
  percentualPeriodosAfetados: number | null;
  evidencias: Evidencia[];
  impactos: Impacto[];
  possiveisFatores: PossivelFator[];
  confianca: NivelConfiancaDesvio;
  amostra: AvaliacaoAmostra;
  filtrosDrillDown: FiltrosIndicadores;
  linkSugerido: "produtividade" | "paradas" | null;
  // Qual leitura gerou este desvio (§9 da análise: operacional = mais
  // recente/granular, estrutural = 28 dias) — usado só como critério de
  // RECÊNCIA na prioridade (§14), nunca duplicado como um segundo desvio.
  origemJanela: "operacional" | "estrutural";
}

// Pós-deduplicação (§13): 1 incidente principal + efeitos observados.
// Quando não há fator dominante confiável, `chaveFatorDominante` é null e
// o agrupamento cai só na chave de contexto+janela (nunca inventa causa).
export interface IncidenteDesvio {
  id: string;
  contexto: ContextoDesvio;
  janelaAtual: Janela;
  janelaReferencia: Janela;
  chaveFatorDominante: string | null;
  desvioPrincipal: DesvioDetectado;
  efeitos: DesvioDetectado[];
  severidade: SeveridadeDesvio;
  possiveisFatores: PossivelFator[];
}
