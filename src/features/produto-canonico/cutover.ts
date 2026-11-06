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

// ---------------------------------------------------------------------------------------------------------------------------------
// SEPARAÇÃO PLANEJAMENTO × CUTOVER OPERACIONAL (decisão de 06/11): UMA decisão central por semana.
//   LEGADO        semana anterior a tudo: modelo vigente (dois produtos).
//   PLANEJAMENTO  semana >= `produto_unico_planejamento_desde` e < cutover (ou cutover ausente): o produto único existe para Previsão/Forecast, geração do plano
//                 (motor novo) e indicadores — o plano é FUTURO e NÃO LIBERADO para produção. NADA operacional muda (apontamento, fechamento, buffers, TV, WIP oficial, escala liberada).
//   OPERACIONAL   semana >= `produto_unico_cutover`: tudo no produto único (apontamento, fechamento, buffers, liberação, TV).
// O cutover implica planejamento (planejamento efetivo = o menor entre planejamento_desde e cutover).
export const CHAVE_PRODUTO_UNICO_PLANEJAMENTO = "produto_unico_planejamento_desde";
export type ModoProdutoUnico = "LEGADO" | "PLANEJAMENTO" | "OPERACIONAL";

/** Mesma regra do cutover: segunda-feira >= 2026-11-02 em string; qualquer outra coisa = null (sem planejamento antecipado). */
export function lerPlanejamentoDesde(valor: unknown): string | null { return lerCutover(valor); }

export function lerPlanejamentoDeParametros(linhas: { chave: string; valor: unknown }[] | null | undefined): string | null {
  const l = (linhas ?? []).find((x) => x.chave === CHAVE_PRODUTO_UNICO_PLANEJAMENTO);
  return l ? lerPlanejamentoDesde(l.valor) : null;
}

/** ÚNICA decisão de modo de uma semana (qualquer dia dela). */
export function modoProdutoUnicoDaSemana(linhas: { chave: string; valor: unknown }[] | null | undefined, semanaInicio: string): ModoProdutoUnico {
  const segunda = segundaDaSemana(semanaInicio);
  const cutover = lerCutoverDeParametros(linhas);
  if (cutover && segunda >= cutover) return "OPERACIONAL";
  const planejamento = lerPlanejamentoDeParametros(linhas);
  if (planejamento && segunda >= planejamento) return "PLANEJAMENTO";
  return "LEGADO";
}

/** Previsão/Forecast, geração do plano com o motor novo e indicadores usam o produto único? (PLANEJAMENTO ou OPERACIONAL) */
export const produtoUnicoPlanejavel = (modo: ModoProdutoUnico): boolean => modo !== "LEGADO";
/** Apontamento, fechamento, buffers, liberação, TV e WIP oficial usam o produto único? (SOMENTE OPERACIONAL) */
export const produtoUnicoOperacional = (modo: ModoProdutoUnico): boolean => modo === "OPERACIONAL";
