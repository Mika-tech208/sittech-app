// Texto do aviso "apontamentos completos" do painel. Com o fechamento físico ATIVO, apontamentos completos NUNCA significam período fechado:
// só o fechamento físico confirmado (estoques + recálculo + portão) gera a próxima programação.
export function textoApontamentosCompletos(modo: "desligado" | "sombra" | "ativo", estado: string | null): string {
  if (modo !== "ativo") return "✓ Período fechado — todas as máquinas apontadas";
  return estado === "CONFIRMADO" ? "✓ Apontamentos completos e estoque físico confirmado" : "✓ Apontamentos completos — FALTA o fechamento físico (estoques) para gerar a próxima programação";
}

/** A etapa de ESTOQUE FÍSICO só é liberada quando todos os postos programados estão resolvidos (apontados ou NÃO PRODUZIU). O estoque continua obrigatório para fechar. */
export const etapaEstoqueLiberada = (postos: { status: string }[]): boolean => postos.every((p) => p.status !== "pendente");
