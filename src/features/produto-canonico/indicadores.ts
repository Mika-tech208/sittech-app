// INDICADORES CONSULTIVOS × PRODUTO COM ROTAS ALTERNATIVAS (PURO, sem IO). ÚNICA função de decisão do app.
//
// Vários cálculos/telas CONSULTIVOS (cobertura, capacidade, "possível", sugestões de adicional/WIP, recomendação de máquina, restrição operacional,
// valor de produção não realizada…) assumem que o roteiro do produto é uma CADEIA LINEAR por `ordem`. O produto único (Conector 3/4: M8 alimenta a
// Etiquetar direto; Rosquear→Parafusar é a outra rota) NÃO é linear, e esses números ficariam errados. Decisão do dono do produto: prefere ausência de
// indicador a indicador errado. Regra: para produto com rotas alternativas o indicador NÃO é calculado; a tela mostra EXATAMENTE
// MENSAGEM_INDICADOR_INDISPONIVEL e o cálculo puro devolve o sentinela `INDISPONIVEL`.
//
// Sem modelo canônico (lista vazia: antes da migration/backfill ou antes do cutover, ver `lerModelosVigentes`) NADA muda: as funções devolvem exatamente o
// que o cálculo linear devolve (mesma referência de objeto).
import type { ModeloCanonico } from "./tipos";

export const MENSAGEM_INDICADOR_INDISPONIVEL = "INDICADOR TEMPORARIAMENTE INDISPONÍVEL PARA PRODUTO COM ROTAS ALTERNATIVAS.";

export interface Indisponivel {
  readonly indisponivel: true;
  readonly mensagem: string;
}

export const INDISPONIVEL: Indisponivel = Object.freeze({ indisponivel: true as const, mensagem: MENSAGEM_INDICADOR_INDISPONIVEL });

export function ehIndisponivel(v: unknown): v is Indisponivel {
  return typeof v === "object" && v !== null && (v as { indisponivel?: unknown }).indisponivel === true;
}

/** O modelo NÃO é uma cadeia linear: 2+ rotas, ou alguma etapa com 2+ antecessores (convergência). Modelo de uma só rota e sem convergência = linear (cálculo de hoje vale). */
export function modeloTemRotasAlternativas(m: Pick<ModeloCanonico, "rotas" | "etapas" | "arestas">): boolean {
  if (m.rotas.length >= 2) return true;
  const entradas = new Map<string, Set<string>>();
  m.arestas.forEach((a) => {
    if (!entradas.has(a.destinoEtapaId)) entradas.set(a.destinoEtapaId, new Set());
    entradas.get(a.destinoEtapaId)!.add(a.origemEtapaId);
  });
  return [...entradas.values()].some((s) => s.size >= 2);
}

/** ids dos produtos canônicos com rotas alternativas. Lista vazia/ausente => conjunto vazio (nada muda). */
export function idsComRotasAlternativas(modelos: readonly ModeloCanonico[] | null | undefined): Set<string> {
  return new Set((modelos ?? []).filter(modeloTemRotasAlternativas).map((m) => m.produtoCanonicoId));
}

export function produtoTemRotasAlternativas(produtoId: string | null | undefined, modelos: readonly ModeloCanonico[] | null | undefined): boolean {
  if (!produtoId || !modelos || modelos.length === 0) return false;
  return modelos.some((m) => m.produtoCanonicoId === produtoId && modeloTemRotasAlternativas(m));
}

/** Algum dos produtos (ex.: itens da semana, apontamentos do período) tem rotas alternativas? Agregados que misturam produtos ficam indisponíveis se sim. */
export function algumProdutoComRotasAlternativas(produtoIds: Iterable<string | null | undefined>, modelos: readonly ModeloCanonico[] | null | undefined): boolean {
  if (!modelos || modelos.length === 0) return false;
  const alt = idsComRotasAlternativas(modelos);
  if (alt.size === 0) return false;
  for (const id of produtoIds) if (id && alt.has(id)) return true;
  return false;
}

/** Decisão única para cálculos puros: produto(s) com rotas alternativas => `INDISPONIVEL` (o cálculo linear nem roda); senão o resultado do cálculo, intacto. */
export function indicadorOuIndisponivel<T>(
  produtoIds: Iterable<string | null | undefined>,
  modelos: readonly ModeloCanonico[] | null | undefined,
  calcular: () => T,
): T | Indisponivel {
  return algumProdutoComRotasAlternativas(produtoIds, modelos) ? INDISPONIVEL : calcular();
}
