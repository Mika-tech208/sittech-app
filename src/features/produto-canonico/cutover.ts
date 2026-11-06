// Cutover do produto único (parâmetro `produto_unico_cutover` de escala_parametros). PURO.
// null/ausente/inválido = SEM cutover => todo o resto deste diretório é identidade (comportamento anterior).

export const CHAVE_PRODUTO_UNICO_CUTOVER = "produto_unico_cutover";
export const PRIMEIRO_CUTOVER_POSSIVEL = "2026-11-02";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Segunda-feira ISO da semana de `dataIso` (YYYY-MM-DD), sem depender de fuso. */
export function segundaDaSemana(dataIso: string): string {
  const [y, m, d] = dataIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // segunda = 0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

/** Lê o valor jsonb da chave. Qualquer coisa que não seja uma segunda-feira >= 2026-11-02 em string vira null (desligado) — mesma regra da constraint do banco. */
export function lerCutover(valor: unknown): string | null {
  if (typeof valor !== "string" || !ISO.test(valor)) return null;
  if (valor < PRIMEIRO_CUTOVER_POSSIVEL) return null;
  if (segundaDaSemana(valor) !== valor) return null;
  return valor;
}

export function lerCutoverDeParametros(linhas: { chave: string; valor: unknown }[] | null | undefined): string | null {
  const l = (linhas ?? []).find((x) => x.chave === CHAVE_PRODUTO_UNICO_CUTOVER);
  return l ? lerCutover(l.valor) : null;
}

/** A data (qualquer dia da semana) usa o espaço do produto canônico? Espelha produto_unico_ativo(date) do banco. */
export function produtoUnicoAtivo(dataIso: string, cutover: string | null): boolean {
  if (!cutover) return false;
  return segundaDaSemana(dataIso) >= cutover;
}

/** ÚNICA decisão de cutover do recálculo/fechamento: a semana (qualquer dia) usa o produto único? Devolve o cutover vigente da semana ou null. Sem parâmetro/inválido/semana anterior => null (comportamento legado). */
export function cutoverDaSemana(linhas: { chave: string; valor: unknown }[] | null | undefined, semanaInicio: string): string | null {
  const c = lerCutoverDeParametros(linhas);
  return c && produtoUnicoAtivo(semanaInicio, c) ? c : null;
}

/** Escolhe o modelo canônico com as duas rotas (convencional + automática). Outros modelos (ou nenhum) => null. */
export function escolherModeloUnico<M extends { rotas: { tipo: string }[] }>(modelos: M[] | null | undefined): M | null {
  return (modelos ?? []).find((m) => m.rotas.some((r) => r.tipo === "convencional") && m.rotas.some((r) => r.tipo === "automatica")) ?? null;
}
