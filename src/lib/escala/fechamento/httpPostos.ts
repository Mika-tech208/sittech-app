// Camada HTTP fina dos postos programados do fechamento (somente leitura). Sem Next aqui.
import { podeFechar, type RespostaHttp, type UsuarioFechamento } from "./http";
import type { EstadoPostos } from "./postosProgramados";

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const PERIODO = /^[a-z0-9_-]{1,12}$/i;

export async function acaoPostos(carregar: (data: string, periodoId: string) => Promise<EstadoPostos>, u: UsuarioFechamento, data: string, periodoId: string): Promise<RespostaHttp> {
  if (!podeFechar(u)) return { status: 403, corpo: { erro: "Sem permissão para fechar o período." } };
  if (!DATA.test(data) || !PERIODO.test(periodoId)) return { status: 400, corpo: { erro: "data/periodo_id inválidos." } };
  try { return { status: 200, corpo: { ...(await carregar(data, periodoId)) } }; }
  catch (e) { return { status: 500, corpo: { erro: e instanceof Error ? e.message : "Falha ao carregar os postos programados." } }; }
}
