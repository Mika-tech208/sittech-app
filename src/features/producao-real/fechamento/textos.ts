// Texto do aviso "apontamentos completos" do painel. Com o fechamento físico ATIVO, apontamentos completos NUNCA significam período fechado:
// só o fechamento físico confirmado (estoques + recálculo + portão) gera a próxima programação.
export function textoApontamentosCompletos(modo: "desligado" | "sombra" | "ativo", estado: string | null): string {
  if (modo !== "ativo") return "✓ Período fechado — todas as máquinas apontadas";
  return estado === "CONFIRMADO" ? "✓ Apontamentos completos e estoque físico confirmado" : "✓ Apontamentos completos — FALTA o fechamento físico (estoques) para gerar a próxima programação";
}

/** A etapa de ESTOQUE FÍSICO só é liberada quando todos os postos programados estão resolvidos (apontados ou NÃO PRODUZIU). O estoque continua obrigatório para fechar. */
export const etapaEstoqueLiberada = (postos: { status: string }[]): boolean => postos.every((p) => p.status !== "pendente");

/**
 * GRADE DO TABLET (regra definitiva, fechamento ATIVO): só os postos PROGRAMADOS do período (escala vigente/liberada) + os adicionados como EXCEÇÃO explícita (+ ADICIONAR APONTAMENTO)
 * + máquinas que já têm apontamento no período. Nunca "todas as máquinas ativas".
 */
export function filtrarGradeProgramada<T extends { id: string; estadoPeriodo: string }>(maquinas: T[], programados: Set<string>, extras: Set<string> = new Set()): T[] {
  return maquinas.filter((m) => programados.has(m.id) || extras.has(m.id) || m.estadoPeriodo !== "pendente");
}

export const MENSAGEM_POSTOS_NAO_CARREGADOS = "NÃO FOI POSSÍVEL CARREGAR OS POSTOS PROGRAMADOS.";
export type EstadoGrade = "carregando" | "legado" | "programada" | "erro" | "nao_liberada";
/** Resposta de /postos → estado da grade. Falha de qualquer tipo ⇒ "erro" (FAIL CLOSED: nunca volta para todas as máquinas). */
export function estadoDaGrade(r: { status: number; corpo: { modo?: string; naoLiberado?: boolean; postos?: unknown[]; catalogo?: unknown } } | null): EstadoGrade {
  if (!r || r.status !== 200) return "erro";
  if (r.corpo.modo === "desligado" || r.corpo.modo === "sombra") return "legado";
  if (r.corpo.modo !== "ativo") return "erro";
  if (r.corpo.naoLiberado) return "nao_liberada";
  return Array.isArray(r.corpo.postos) ? "programada" : "erro";   // lista vazia é legítima (período sem postos programados); a falha de leitura chega como status != 200
}
