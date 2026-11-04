// Camada HTTP fina dos postos programados do fechamento (somente leitura). Sem Next aqui.
import { podeFechar, type RespostaHttp, type UsuarioFechamento } from "./http";
import type { EstadoPostos } from "./postosProgramados";

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const PERIODO = /^[a-z0-9_-]{1,12}$/i;

/** `liberado`: decide no banco (escala_periodo_liberacao). Período NÃO liberado ⇒ a escala dele (plano interno/estimado) NÃO é entregue (postos vazios). Erro ao decidir ⇒ 500 (fail-closed: a tela volta ao fluxo anterior). */
export async function acaoPostos(carregar: (data: string, periodoId: string) => Promise<EstadoPostos>, u: UsuarioFechamento, data: string, periodoId: string, liberado?: (data: string, periodoId: string) => Promise<boolean>): Promise<RespostaHttp> {
  if (!podeFechar(u)) return { status: 403, corpo: { erro: "Sem permissão para fechar o período." } };
  if (!DATA.test(data) || !PERIODO.test(periodoId)) return { status: 400, corpo: { erro: "data/periodo_id inválidos." } };
  try {
    const estado = await carregar(data, periodoId);
    if (liberado && !(await liberado(data, periodoId))) return { status: 200, corpo: { ...estado, postos: [], naoLiberado: true } };
    return { status: 200, corpo: { ...estado } };
  }
  catch (e) { return { status: 500, corpo: { erro: e instanceof Error ? e.message : "Falha ao carregar os postos programados." } }; }
}
