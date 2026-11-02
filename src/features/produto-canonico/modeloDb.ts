// Montagem do ModeloCanonico a partir das linhas das tabelas novas (PURO) + leitura (IO mínimo, tolerante: tabela ausente/erro => nenhum modelo, nunca lança).
// Usado por quem precisa do modelo em memória (adaptador do motor, telas). Com a migration não aplicada ou sem backfill o resultado é [] (flag desligada = comportamento anterior).
import type { ArestaCanonica, EtapaCanonica, ModeloCanonico, PapelEtapa, RotaCanonica, TipoRota } from "./tipos";

export interface LinhasModeloDb {
  canonico: { produto_id: string; codigo: string; nome_exibicao: string }[];
  rotas: { id: string; produto_id: string; codigo: string; nome: string; tipo: string; ordem: number; ativa: boolean; parametros?: unknown }[];
  etapas: { etapa_id: string; produto_id: string; rota_id: string | null; papel: string }[];
  arestas: { origem_etapa_id: string; destino_etapa_id: string }[];
  produtosLegado: { produto_legado_id: string; produto_canonico_id: string; rota_id: string }[];
  etapasLegado: { etapa_legado_id: string; etapa_canonica_id: string; produto_legado_id: string }[];
  /** elegibilidade e operação das etapas canônicas (roteiro_etapas / roteiro_etapa_maquinas) */
  roteiroEtapas?: { id: string; operacao_id: string }[];
  maquinasEtapa?: { etapa_id: string; maquina_id: string }[];
}

const PAPEIS: PapelEtapa[] = ["ROTA", "COMUM", "FINAL"];
const TIPOS: TipoRota[] = ["convencional", "automatica", "outra"];

export function montarModelosCanonicos(l: LinhasModeloDb): ModeloCanonico[] {
  return [...l.canonico].sort((a, b) => (a.codigo < b.codigo ? -1 : 1)).map((c) => {
    const rotas: RotaCanonica[] = l.rotas.filter((r) => r.produto_id === c.produto_id).sort((a, b) => a.ordem - b.ordem).map((r) => ({
      id: r.id, codigo: r.codigo, nome: r.nome, tipo: (TIPOS as string[]).includes(r.tipo) ? (r.tipo as TipoRota) : "outra", ordem: r.ordem, ativa: r.ativa,
      ...(r.parametros && typeof r.parametros === "object" && Object.keys(r.parametros as object).length > 0 ? { parametros: r.parametros as RotaCanonica["parametros"] } : {}),
    }));
    const etapas: EtapaCanonica[] = l.etapas.filter((e) => e.produto_id === c.produto_id).map((e) => ({
      etapaId: e.etapa_id, papel: (PAPEIS as string[]).includes(e.papel) ? (e.papel as PapelEtapa) : "COMUM", rotaId: e.rota_id,
      ...(l.roteiroEtapas?.find((x) => x.id === e.etapa_id) ? { operacaoId: l.roteiroEtapas.find((x) => x.id === e.etapa_id)!.operacao_id } : {}),
      ...(l.maquinasEtapa ? { maquinasIds: l.maquinasEtapa.filter((m) => m.etapa_id === e.etapa_id).map((m) => m.maquina_id).sort() } : {}),
    }));
    const ids = new Set(etapas.map((e) => e.etapaId));
    const arestas: ArestaCanonica[] = l.arestas.filter((a) => ids.has(a.origem_etapa_id) && ids.has(a.destino_etapa_id)).map((a) => ({ origemEtapaId: a.origem_etapa_id, destinoEtapaId: a.destino_etapa_id }));
    const produtosLegado: ModeloCanonico["produtosLegado"] = {};
    l.produtosLegado.filter((p) => p.produto_canonico_id === c.produto_id).forEach((p) => (produtosLegado[p.produto_legado_id] = { produtoCanonicoId: p.produto_canonico_id, rotaId: p.rota_id }));
    const etapasLegado: ModeloCanonico["etapasLegado"] = {};
    l.etapasLegado.filter((e) => ids.has(e.etapa_canonica_id)).forEach((e) => (etapasLegado[e.etapa_legado_id] = { etapaCanonicaId: e.etapa_canonica_id, produtoLegadoId: e.produto_legado_id }));
    return { produtoCanonicoId: c.produto_id, codigo: c.codigo, nomeExibicao: c.nome_exibicao, rotas, etapas, arestas, produtosLegado, etapasLegado };
  });
}

/** Cliente mínimo (compatível com o supabase-js usado em src/lib e nos hooks). */
export interface ClienteLeitura {
  from(tabela: string): { select(colunas: string): PromiseLike<{ data: unknown[] | null; error: unknown }> };
}

/** Lê as tabelas e monta o(s) modelo(s). Qualquer falha (tabela inexistente antes da migration, RLS, rede) => []: nunca derruba o chamador. */
export async function lerModelosCanonicos(client: ClienteLeitura): Promise<ModeloCanonico[]> {
  try {
    const t = async <T,>(nome: string, cols: string): Promise<T[] | null> => {
      const r = await client.from(nome).select(cols);
      return r.error ? null : ((r.data ?? []) as T[]);
    };
    const canonico = await t<LinhasModeloDb["canonico"][number]>("produto_canonico", "produto_id, codigo, nome_exibicao");
    if (!canonico || canonico.length === 0) return [];
    const [rotas, etapas, arestas, produtosLegado, etapasLegado, roteiroEtapas, maquinasEtapa] = await Promise.all([
      t<LinhasModeloDb["rotas"][number]>("produto_rotas", "id, produto_id, codigo, nome, tipo, ordem, ativa, parametros"),
      t<LinhasModeloDb["etapas"][number]>("produto_canonico_etapas", "etapa_id, produto_id, rota_id, papel"),
      t<LinhasModeloDb["arestas"][number]>("produto_canonico_arestas", "origem_etapa_id, destino_etapa_id"),
      t<LinhasModeloDb["produtosLegado"][number]>("produto_legado_mapa", "produto_legado_id, produto_canonico_id, rota_id"),
      t<LinhasModeloDb["etapasLegado"][number]>("etapa_legado_mapa", "etapa_legado_id, etapa_canonica_id, produto_legado_id"),
      t<NonNullable<LinhasModeloDb["roteiroEtapas"]>[number]>("roteiro_etapas", "id, operacao_id"),
      t<NonNullable<LinhasModeloDb["maquinasEtapa"]>[number]>("roteiro_etapa_maquinas", "etapa_id, maquina_id"),
    ]);
    if (!rotas || !etapas || !arestas || !produtosLegado || !etapasLegado) return [];
    return montarModelosCanonicos({ canonico, rotas, etapas, arestas, produtosLegado, etapasLegado, ...(roteiroEtapas ? { roteiroEtapas } : {}), ...(maquinasEtapa ? { maquinasEtapa } : {}) });
  } catch {
    return [];
  }
}
