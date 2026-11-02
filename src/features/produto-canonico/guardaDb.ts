// Leitura do que o guard de listagem/seleção precisa (IO mínimo e tolerante). Sem canônico cadastrado (migration/backfill não aplicados) ou em qualquer erro => guarda vazia (nada é filtrado).
import { lerCutover } from "./cutover";

export interface GuardaProdutos { canonicos: Set<string>; legados: Set<string>; cutover: string | null }
export const GUARDA_VAZIA = (): GuardaProdutos => ({ canonicos: new Set(), legados: new Set(), cutover: null });

export interface ClienteGuarda {
  from(tabela: string): { select(colunas: string): PromiseLike<{ data: unknown[] | null; error: unknown }> };
  rpc(nome: string): PromiseLike<{ data: unknown; error: unknown }>;
}

export async function lerGuardaProdutos(client: ClienteGuarda): Promise<GuardaProdutos> {
  try {
    const c = await client.from("produto_canonico").select("produto_id");
    if (c.error || !c.data || c.data.length === 0) return GUARDA_VAZIA();
    const canonicos = new Set((c.data as { produto_id: string }[]).map((x) => x.produto_id));
    const l = await client.from("produto_legado_mapa").select("produto_legado_id");
    const legados = new Set(l.error || !l.data ? [] : (l.data as { produto_legado_id: string }[]).map((x) => x.produto_legado_id));
    const r = await client.rpc("produto_unico_cutover");
    return { canonicos, legados, cutover: r.error ? null : lerCutover(r.data) };
  } catch {
    return GUARDA_VAZIA();
  }
}
