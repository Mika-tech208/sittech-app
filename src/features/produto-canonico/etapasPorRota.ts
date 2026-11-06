// Agrupamento das etapas do produto único por ROTA para a seleção de máquinas da Previsão (PURO). A ordem do roteiro (M8 = ordem 0) mistura as rotas; aqui as etapas aparecem sob
// "ROTA CONVENCIONAL" (Rosquear, Parafusar), "ROTA AUTOMÁTICA" (Máquina 8) e "DOWNSTREAM" (Etiquetar, Embalar: comuns às duas rotas). Produto sem modelo canônico => um grupo só, sem título (tela de hoje).
import type { ModeloCanonico } from "./tipos";

export interface GrupoEtapas<E> { chave: string; titulo: string | null; etapas: E[] }

export const TITULO_DOWNSTREAM = "DOWNSTREAM — comum às duas rotas";

export function agruparEtapasPorRota<E extends { id: string }>(roteiro: E[], modelo: ModeloCanonico | null | undefined): GrupoEtapas<E>[] {
  if (!modelo) return [{ chave: "todas", titulo: null, etapas: roteiro }];
  const rotaDe = new Map(modelo.etapas.map((e) => [e.etapaId, e.rotaId] as const));
  const grupos: GrupoEtapas<E>[] = [...modelo.rotas].sort((a, b) => a.ordem - b.ordem).map((r) => ({
    chave: r.id,
    titulo: r.tipo === "convencional" ? "ROTA CONVENCIONAL" : r.tipo === "automatica" ? "ROTA AUTOMÁTICA" : r.nome.toUpperCase(),
    etapas: roteiro.filter((e) => rotaDe.get(e.id) === r.id),
  }));
  grupos.push({ chave: "downstream", titulo: TITULO_DOWNSTREAM, etapas: roteiro.filter((e) => rotaDe.has(e.id) && rotaDe.get(e.id) === null) });
  const classificadas = new Set(grupos.flatMap((g) => g.etapas.map((e) => e.id)));
  const resto = roteiro.filter((e) => !classificadas.has(e.id));
  if (resto.length > 0) grupos.push({ chave: "outras", titulo: "OUTRAS ETAPAS", etapas: resto });
  return grupos.filter((g) => g.etapas.length > 0);
}
