// Camada HTTP fina dos postos programados (somente leitura). Sem Next aqui.
// FONTE DA GRADE DO TABLET: alocações reais da escala vigente/LIBERADA para (data, período). Falha ⇒ erro (a tela não volta para "todas as máquinas").
import { temPermissao } from "@/lib/permissoes";
import { podeFechar, type RespostaHttp, type UsuarioFechamento } from "./http";
import type { EstadoPostos } from "./postosProgramados";

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const PERIODO = /^[a-z0-9_-]{1,12}$/i;

export interface IoPostos {
  carregar(data: string, periodoId: string): Promise<EstadoPostos>;
  /** flag do fechamento físico: só `ativo` deriva a grade da escala */
  modo(): Promise<"desligado" | "sombra" | "ativo">;
  /** decide no banco (escala_periodo_liberacao). Período NÃO liberado ⇒ a escala dele (plano interno/estimado) NÃO é entregue. */
  liberado(data: string, periodoId: string): Promise<{ liberado: boolean; predecessor?: { data: string; periodo: string; rotulo: string } | null }>;
}

export const podeLerPostos = (u: UsuarioFechamento | null | undefined) => podeFechar(u) || temPermissao(u, "producao_real_apontamento");

export async function acaoPostos(io: IoPostos, u: UsuarioFechamento, data: string, periodoId: string): Promise<RespostaHttp> {
  if (!podeLerPostos(u)) return { status: 403, corpo: { erro: "Sem permissão." } };
  if (!DATA.test(data) || !PERIODO.test(periodoId)) return { status: 400, corpo: { erro: "data/periodo_id inválidos." } };
  try {
    const modo = await io.modo();
    if (modo !== "ativo") return { status: 200, corpo: { modo, postos: [], catalogo: null, existentes: [] } };   // flag desligada/sombra: a tela usa o fluxo anterior
    const estado = await io.carregar(data, periodoId);
    const lib = await io.liberado(data, periodoId);
    if (!lib.liberado) return { status: 200, corpo: { modo, ...estado, postos: [], naoLiberado: true, predecessor: lib.predecessor ?? null } };
    return { status: 200, corpo: { modo, ...estado } };
  } catch (e) { return { status: 500, corpo: { erro: e instanceof Error ? e.message : "Falha ao carregar os postos programados." } }; }   // fail-closed
}
