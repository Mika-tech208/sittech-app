// FLAG do apontamento simplificado (escala_parametros). Padrão DESLIGADO: sem ela nada muda no fechamento nem no painel.
export const CHAVE_MODO_APONTAMENTO_SIMPLIFICADO = "apontamento_simplificado_modo";
export type ModoApontamentoSimplificado = "desligado" | "ativo";
export function lerModoApontamentoSimplificado(parametros: { chave: string; valor: unknown }[]): ModoApontamentoSimplificado {
  return parametros.find((p) => p.chave === CHAVE_MODO_APONTAMENTO_SIMPLIFICADO)?.valor === "ativo" ? "ativo" : "desligado";
}
