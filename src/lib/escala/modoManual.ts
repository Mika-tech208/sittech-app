// MODO MANUAL DE OPERAÇÃO — a escala automática NÃO comanda o chão e o apontamento é manual (decisão de 06/11/2026).
//
// DEFINIÇÃO ÚNICA (espelha a função SQL `escala_operacao_manual()`): "operação manual" = as três flags que dão comando operacional à escala automática estão
// TODAS desligadas. Não existe flag nova: liga/desliga-se por configuração (escala_parametros), exatamente como antes.
//   producao_real_modo            — motor Escala Inteligente / planejador de corte (corte-v1)
//   replanejamento_modo           — replanejamento oficial por eventos
//   escala_fechamento_fisico_modo — fechamento físico + liberação de período
// Qualquer uma ligada ⇒ NÃO é manual (nada de "meia desativação"): o comportamento anterior é preservado byte a byte.
// Ausente / null = 'desligado' (mesmo padrão dos acessores SQL).
export const CHAVES_COMANDO_OPERACIONAL = ["producao_real_modo", "replanejamento_modo", "escala_fechamento_fisico_modo"] as const;

export const MOTIVO_OPERACAO_MANUAL = "Escala automática desativada (modo manual): o apontamento é manual e o motor não publica programação para o chão.";

export function lerOperacaoManual(parametros: { chave: string; valor: unknown }[] | null | undefined): boolean {
  return CHAVES_COMANDO_OPERACIONAL.every((chave) => {
    const v = (parametros ?? []).find((p) => p.chave === chave)?.valor;
    return v === undefined || v === null || v === "desligado";
  });
}
