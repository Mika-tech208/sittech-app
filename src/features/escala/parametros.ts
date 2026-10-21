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

/**
 * Replanejamento (Fase 4): "desligado" = nada acontece; "sombra" = calcula e GRAVA decisões em escala_sombra_decisoes, sem tocar a Escala oficial;
 * "ativo" = RESERVADO para uma fase futura e ainda não autorizada — hoje é tratado como "sombra" (nunca altera a escala).
 */
export type ModoReplanejamento = "desligado" | "sombra" | "ativo";

export interface ParametrosEscala {
  /** Adicional por etapa + estoque intermediário planejado (pipeline). "desligado" = comportamento anterior, idêntico. */
  wipModo: ModoWip;
  /** Limite padrão de estoque intermediário entre etapas: dias produtivos de consumo da etapa seguinte. */
  wipDiasLimite: number;
  /** Margem de folga (fração) abaixo da qual um previsto que fecha passa a "Em risco" (atingibilidade). Só análise: não muda a escala. */
  atingibilidadeMargem: number;
  revezamentoModo: ModoRevezamento;
  replanejamentoModo: ModoReplanejamento;
}

export const PARAMETROS_PADRAO: ParametrosEscala = { wipModo: "desligado", wipDiasLimite: 1, atingibilidadeMargem: 0.1, revezamentoModo: "duro", replanejamentoModo: "desligado" };

// Chaves da tabela escala_parametros.
export const CHAVE_WIP_MODO = "wip_modo";
export const CHAVE_WIP_DIAS_LIMITE = "wip_dias_limite";
export const CHAVE_ATINGIBILIDADE_MARGEM = "atingibilidade_margem";
export const CHAVE_REVEZAMENTO_MODO = "revezamento_modo";
export const CHAVE_REPLANEJAMENTO_MODO = "replanejamento_modo";

/** Modo que REALMENTE se executa: "ativo" ainda não existe e cai em "sombra" (falha segura). */
export const modoEfetivoReplanejamento = (m: ModoReplanejamento): "desligado" | "sombra" => (m === "desligado" ? "desligado" : "sombra");

export function lerParametros(linhas: { chave: string; valor: unknown }[] | null | undefined): ParametrosEscala {
  const mapa = new Map((linhas ?? []).map((l) => [l.chave, l.valor]));
  const modo = mapa.get(CHAVE_WIP_MODO);
  const dias = Number(mapa.get(CHAVE_WIP_DIAS_LIMITE));
  const margem = Number(mapa.get(CHAVE_ATINGIBILIDADE_MARGEM));
  return {
    wipModo: modo === "ativo" ? "ativo" : "desligado", // qualquer outro valor = desligado (seguro)
    revezamentoModo: mapa.get(CHAVE_REVEZAMENTO_MODO) === "mole" ? "mole" : "duro", // ausente/desconhecido = duro (regra definitiva)
    replanejamentoModo: ((v) => (v === "sombra" || v === "ativo" ? v : "desligado"))(mapa.get(CHAVE_REPLANEJAMENTO_MODO)), // ausente/desconhecido = desligado
    wipDiasLimite: Number.isFinite(dias) && dias >= 0 ? dias : PARAMETROS_PADRAO.wipDiasLimite,
    atingibilidadeMargem: mapa.has(CHAVE_ATINGIBILIDADE_MARGEM) && Number.isFinite(margem) && margem >= 0 && margem <= 1 ? margem : PARAMETROS_PADRAO.atingibilidadeMargem,
  };
}
