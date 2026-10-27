// VIGÊNCIA da metodologia de acompanhamento da Previsão (decisão de negócio de 27/10/2026).
//
// - Semanas ANTERIORES a APONTADO_REAL_PROGRESSO_DESDE: metodologia HISTÓRICA, exatamente a que existia antes — o andamento é o REALIZADO MANUAL
//   (previsao_itens tipo='realizado'): peças, R$, %, diferença/falta e Histórico semanal. Nunca são recalculadas pelo Apontado real, mesmo que hoje
//   exista apontamento para essas semanas (o passado não é reescrito).
// - Semana APONTADO_REAL_PROGRESSO_DESDE e posteriores: o andamento é o APONTADO REAL (última etapa válida; falta/% por produto; R$ pelo preço congelado).
//
// Data explícita e fixa (nunca "semana atual"): a regra não muda com o passar do tempo. Segunda-feira ISO (mesma chave de semana usada em toda a tela).
export const APONTADO_REAL_PROGRESSO_DESDE = "2026-10-26";

export type MetodologiaSemana = "legado" | "apontado_real";

export function metodologiaDaSemana(semanaInicio: string): MetodologiaSemana {
  return semanaInicio >= APONTADO_REAL_PROGRESSO_DESDE ? "apontado_real" : "legado";
}
