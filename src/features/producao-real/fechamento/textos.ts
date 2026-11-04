// Texto do aviso "apontamentos completos" do painel. Com o fechamento físico ATIVO, apontamentos completos NUNCA significam período fechado:
// só o fechamento físico confirmado (estoques + recálculo + portão) gera a próxima programação.
export function textoApontamentosCompletos(modo: "desligado" | "sombra" | "ativo", estado: string | null): string {
  if (modo !== "ativo") return "✓ Período fechado — todas as máquinas apontadas";
  return estado === "CONFIRMADO" ? "✓ Apontamentos completos e estoque físico confirmado" : "✓ Apontamentos completos — FALTA o fechamento físico (estoques) para gerar a próxima programação";
}

/** A etapa de ESTOQUE FÍSICO só é liberada quando todos os postos programados estão resolvidos (apontados ou NÃO PRODUZIU). O estoque continua obrigatório para fechar. */
export const etapaEstoqueLiberada = (postos: { status: string }[]): boolean => postos.every((p) => p.status !== "pendente");

/** Grade do painel com o fechamento ATIVO: só postos PROGRAMADOS do período (plano vigente) + máquinas que já têm apontamento. `programados = null` ⇒ grade completa (falha ao carregar nunca trava o apontamento). */
export function filtrarGradeProgramada<T extends { id: string; estadoPeriodo: string }>(maquinas: T[], programados: Set<string> | null): T[] {
  return programados ? maquinas.filter((m) => programados.has(m.id) || m.estadoPeriodo !== "pendente") : maquinas;
}
