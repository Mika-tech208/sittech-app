// Leitura do que o guard de listagem/seleção precisa (IO mínimo e tolerante). Sem canônico cadastrado (migration/backfill não aplicados) ou em qualquer erro => guarda vazia (nada é filtrado).
//
// PARÂMETROS DO PRODUTO ÚNICO: `produto_unico_cutover` (operacional) e `produto_unico_planejamento_desde` (planejamento antecipado, 06/11) chegam como linhas {chave, valor} — o MESMO formato
// que `modoProdutoUnicoDaSemana` (cutover.ts) consome: toda decisão de modo por semana passa por essa função, nunca por comparação de datas espalhada pelas telas.
// Cada RPC é independente: se uma não existir (ainda não migrada) ou falhar, a chave fica de fora (= sem aquela vigência). Cutover com erro continua tratado como "sem cutover".
import { CHAVE_PRODUTO_UNICO_CUTOVER, CHAVE_PRODUTO_UNICO_PLANEJAMENTO, lerCutover, lerPlanejamentoDesde, type ModoProdutoUnico, modoProdutoUnicoDaSemana } from "./cutover";

export interface LinhaParametro { chave: string; valor: unknown }

export interface GuardaProdutos {
  canonicos: Set<string>;
  legados: Set<string>;
  /** cutover OPERACIONAL (apontamento, fechamento, TV…) */
  cutover: string | null;
  /** planejamento antecipado (Previsão/plano futuro); ausente = só o cutover vale */
  planejamentoDesde?: string | null;
  /** linhas dos parâmetros para `modoProdutoUnicoDaSemana`; ausente = derivadas de `cutover`/`planejamentoDesde` */
  parametros?: LinhaParametro[];
}
export const GUARDA_VAZIA = (): GuardaProdutos => ({ canonicos: new Set(), legados: new Set(), cutover: null, planejamentoDesde: null, parametros: [] });

export interface ClienteGuarda {
  from(tabela: string): { select(colunas: string): PromiseLike<{ data: unknown[] | null; error: unknown }> };
  rpc(nome: string): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Linhas de parâmetros da guarda (compatível com guardas montadas só com `cutover`). */
export function parametrosDaGuarda(g: Pick<GuardaProdutos, "cutover" | "planejamentoDesde" | "parametros">): LinhaParametro[] {
  if (g.parametros) return g.parametros;
  return [
    ...(g.cutover ? [{ chave: CHAVE_PRODUTO_UNICO_CUTOVER, valor: g.cutover }] : []),
    ...(g.planejamentoDesde ? [{ chave: CHAVE_PRODUTO_UNICO_PLANEJAMENTO, valor: g.planejamentoDesde }] : []),
  ];
}

/** ÚNICA ponte telas -> decisão central: modo da semana a partir da guarda. */
export function modoDaSemana(g: Pick<GuardaProdutos, "cutover" | "planejamentoDesde" | "parametros">, semanaInicio: string): ModoProdutoUnico {
  return modoProdutoUnicoDaSemana(parametrosDaGuarda(g), semanaInicio);
}

/** Primeira vigência (a mais cedo entre planejamento e cutover) ou null: "algum dia o produto único aparece". Usada pelas listas sem data (canônico visível ou escondido). */
export function primeiraVigencia(g: Pick<GuardaProdutos, "cutover" | "planejamentoDesde" | "parametros">): string | null {
  const datas = parametrosDaGuarda(g).map((l) => lerCutover(l.valor)).filter((d): d is string => !!d).sort();
  return datas[0] ?? null;
}

/** Lê as duas chaves via RPC (independentes e tolerantes). */
export async function lerParametrosProdutoUnico(client: Pick<ClienteGuarda, "rpc">): Promise<LinhaParametro[]> {
  const linhas: LinhaParametro[] = [];
  const ler = async (rpc: string, chave: string, valida: (v: unknown) => string | null) => {
    try {
      const r = await client.rpc(rpc);
      const v = r.error ? null : valida(r.data);
      if (v) linhas.push({ chave, valor: v });
    } catch { /* RPC ausente/erro: sem esta vigência */ }
  };
  await ler("produto_unico_cutover", CHAVE_PRODUTO_UNICO_CUTOVER, lerCutover);
  await ler("produto_unico_planejamento_desde", CHAVE_PRODUTO_UNICO_PLANEJAMENTO, lerPlanejamentoDesde);
  return linhas;
}

export async function lerGuardaProdutos(client: ClienteGuarda): Promise<GuardaProdutos> {
  try {
    const c = await client.from("produto_canonico").select("produto_id");
    if (c.error || !c.data || c.data.length === 0) return GUARDA_VAZIA();
    const canonicos = new Set((c.data as { produto_id: string }[]).map((x) => x.produto_id));
    const l = await client.from("produto_legado_mapa").select("produto_legado_id");
    const legados = new Set(l.error || !l.data ? [] : (l.data as { produto_legado_id: string }[]).map((x) => x.produto_legado_id));
    const parametros = await lerParametrosProdutoUnico(client);
    const cutover = parametros.find((p) => p.chave === CHAVE_PRODUTO_UNICO_CUTOVER)?.valor as string | undefined;
    const planejamentoDesde = parametros.find((p) => p.chave === CHAVE_PRODUTO_UNICO_PLANEJAMENTO)?.valor as string | undefined;
    return { canonicos, legados, cutover: cutover ?? null, planejamentoDesde: planejamentoDesde ?? null, parametros };
  } catch {
    return GUARDA_VAZIA();
  }
}
