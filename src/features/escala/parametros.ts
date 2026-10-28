// Parâmetros da Escala (tabela escala_parametros) — ENTRADAS CANÔNICAS do motor.
//
// Separação conceitual (decisão do dono do produto):
//  - OPERACIONAIS: liga/desliga de recursos, limite padrão de WIP, margens, modos;
//  - TÉCNICOS AVANÇADOS: performance_min/max, K0, minimo_amostras (Fase 4) — sem tela comum de edição.
// Tudo vive no banco; o código só traz os PADRÕES (usados quando a linha não existe) e a leitura
// tipada. Mudar um parâmetro que afeta o motor gera recálculo (gatilho no banco).
//
// Fase 1: só os operacionais do WIP planejado. Os demais entram nas fases seguintes.

export type ModoWip = "desligado" | "ativo";
/** Revezamento: "duro" = a mesma pessoa nunca repete a mesma operação em períodos consecutivos (restrição do otimizador); "mole" = comportamento anterior (só rollback do motor). */
export type ModoRevezamento = "mole" | "duro";
/** Escopo do revezamento duro: "consecutivo" (padrão, regra anterior) ou "bloco" (a mesma operação no máximo 1 vez por manhã/tarde — hotfix 28/10; docs/escala-revezamento-bloco.md). */
export type EscopoRevezamentoParametro = "consecutivo" | "bloco";

/**
 * Replanejamento (Fase 4): "desligado" = nada acontece; "sombra" = calcula e GRAVA decisões em escala_sombra_decisoes, sem tocar a Escala oficial;
 * "ativo_restrito" = além de gravar a decisão, aplica à Escala oficial SÓ os períodos alteráveis (c+2 em diante; o comprometido apenas no reparo
 * mínimo) e SÓ nas semanas listadas em `replanejamento_semanas_ativas`; "ativo" = RESERVADO (replanejamento completo, NÃO autorizado) — hoje é "sombra".
 */
export type ModoReplanejamento = "desligado" | "sombra" | "ativo_restrito" | "ativo";

export interface ParametrosEscala {
  /** Adicional por etapa + estoque intermediário planejado (pipeline). "desligado" = comportamento anterior, idêntico. */
  wipModo: ModoWip;
  /** Limite padrão de estoque intermediário entre etapas: dias produtivos de consumo da etapa seguinte. */
  wipDiasLimite: number;
  /** Limite de WIP (em dias) específico de UMA semana (chave = segunda-feira ISO). Quando existe, vale só para aquela semana; o padrão global não muda. */
  wipDiasLimitePorSemana: Record<string, number>;
  /** Margem de folga (fração) abaixo da qual um previsto que fecha passa a "Em risco" (atingibilidade). Só análise: não muda a escala. */
  atingibilidadeMargem: number;
  revezamentoModo: ModoRevezamento;
  /** `revezamento_escopo`. Ausente/desconhecido = "consecutivo" (comportamento anterior). */
  revezamentoEscopo?: EscopoRevezamentoParametro;
  /** `revezamento_equivalencias`: mapa opcional (vazio por padrão) operacao_id -> operações que executá-la também expõe. */
  revezamentoEquivalencias?: Record<string, string[]>;
  replanejamentoModo: ModoReplanejamento;
  /** Semanas (segunda-feira ISO) em que o modo `ativo_restrito` PODE escrever. Fora delas ele se comporta como sombra. */
  replanejamentoSemanasAtivas: string[];
}

export const PARAMETROS_PADRAO: ParametrosEscala = { wipModo: "desligado", wipDiasLimite: 1, wipDiasLimitePorSemana: {}, atingibilidadeMargem: 0.1, revezamentoModo: "duro", revezamentoEscopo: "consecutivo", revezamentoEquivalencias: {}, replanejamentoModo: "desligado", replanejamentoSemanasAtivas: [] };

// Chaves da tabela escala_parametros.
export const CHAVE_WIP_MODO = "wip_modo";
export const CHAVE_WIP_DIAS_LIMITE = "wip_dias_limite";
export const CHAVE_WIP_DIAS_LIMITE_SEMANAS = "wip_dias_limite_semanas";
export const CHAVE_ATINGIBILIDADE_MARGEM = "atingibilidade_margem";
export const CHAVE_REVEZAMENTO_MODO = "revezamento_modo";
export const CHAVE_REVEZAMENTO_ESCOPO = "revezamento_escopo";
export const CHAVE_REVEZAMENTO_EQUIVALENCIAS = "revezamento_equivalencias";
export const CHAVE_REPLANEJAMENTO_MODO = "replanejamento_modo";
export const CHAVE_REPLANEJAMENTO_SEMANAS = "replanejamento_semanas_ativas";

/** Modo que REALMENTE se executa: "ativo" (completo) ainda não existe e cai em "sombra" (falha segura); "ativo_restrito" é o único que escreve. */
export const modoEfetivoReplanejamento = (m: ModoReplanejamento): "desligado" | "sombra" | "ativo_restrito" => (m === "desligado" ? "desligado" : m === "ativo_restrito" ? "ativo_restrito" : "sombra");

/** O modo restrito só ESCREVE em semana autorizada explicitamente; qualquer outra coisa é sombra. */
export const replanejamentoPodeEscrever = (p: Pick<ParametrosEscala, "replanejamentoModo" | "replanejamentoSemanasAtivas">, semanaInicio: string): boolean =>
  p.replanejamentoModo === "ativo_restrito" && p.replanejamentoSemanasAtivas.includes(semanaInicio);

/** Mapa de equivalência válido: { operacao_id: [operacao_id, ...] } (ids não vazios); qualquer outra coisa = vazio. */
export function lerEquivalencias(v: unknown): Record<string, string[]> {
  const r: Record<string, string[]> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    Object.entries(v as Record<string, unknown>).forEach(([op, lista]) => {
      if (op && Array.isArray(lista)) {
        const ids = [...new Set(lista.filter((x): x is string => typeof x === "string" && x.length > 0 && x !== op))].sort();
        if (ids.length > 0) r[op] = ids;
      }
    });
  }
  return r;
}

function lerSemanas(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort() : [];
}

// {"2026-10-26": 2}: só entradas válidas (data ISO de segunda-feira → número ≥ 0); o resto é ignorado (seguro).
function lerLimitesPorSemana(v: unknown): Record<string, number> {
  const r: Record<string, number> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    Object.entries(v as Record<string, unknown>).forEach(([semana, dias]) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(semana) && typeof dias === "number" && Number.isFinite(dias) && dias >= 0) r[semana] = dias;
    });
  }
  return r;
}

/** Limite de WIP (dias) que vale para a semana: o específico dela, senão o padrão global. */
export const wipDiasLimiteDaSemana = (p: { wipDiasLimite: number; wipDiasLimitePorSemana?: Record<string, number> } | undefined, semanaInicio: string): number =>
  p?.wipDiasLimitePorSemana?.[semanaInicio] ?? p?.wipDiasLimite ?? 1;

export function lerParametros(linhas: { chave: string; valor: unknown }[] | null | undefined): ParametrosEscala {
  const mapa = new Map((linhas ?? []).map((l) => [l.chave, l.valor]));
  const modo = mapa.get(CHAVE_WIP_MODO);
  const dias = Number(mapa.get(CHAVE_WIP_DIAS_LIMITE));
  const margem = Number(mapa.get(CHAVE_ATINGIBILIDADE_MARGEM));
  return {
    wipModo: modo === "ativo" ? "ativo" : "desligado", // qualquer outro valor = desligado (seguro)
    revezamentoModo: mapa.get(CHAVE_REVEZAMENTO_MODO) === "mole" ? "mole" : "duro", // ausente/desconhecido = duro (regra definitiva)
    revezamentoEscopo: mapa.get(CHAVE_REVEZAMENTO_ESCOPO) === "bloco" ? "bloco" : "consecutivo", // ausente/desconhecido = consecutivo
    revezamentoEquivalencias: lerEquivalencias(mapa.get(CHAVE_REVEZAMENTO_EQUIVALENCIAS)),
    replanejamentoModo: ((v) => (v === "sombra" || v === "ativo" || v === "ativo_restrito" ? v : "desligado"))(mapa.get(CHAVE_REPLANEJAMENTO_MODO)), // ausente/desconhecido = desligado
    replanejamentoSemanasAtivas: lerSemanas(mapa.get(CHAVE_REPLANEJAMENTO_SEMANAS)),
    wipDiasLimitePorSemana: lerLimitesPorSemana(mapa.get(CHAVE_WIP_DIAS_LIMITE_SEMANAS)),
    wipDiasLimite: Number.isFinite(dias) && dias >= 0 ? dias : PARAMETROS_PADRAO.wipDiasLimite,
    atingibilidadeMargem: mapa.has(CHAVE_ATINGIBILIDADE_MARGEM) && Number.isFinite(margem) && margem >= 0 && margem <= 1 ? margem : PARAMETROS_PADRAO.atingibilidadeMargem,
  };
}
