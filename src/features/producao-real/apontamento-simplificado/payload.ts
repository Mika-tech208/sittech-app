// Leitura ESTRITA do corpo do salvamento (servidor): nunca confia no cliente. Devolve linhas da RPC ou o erro.
import type { LinhaRpc, MotivoNaoProduziu } from "./tipos";
import { MOTIVOS_NAO_PRODUZIU } from "./motivos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_LINHAS = 60;
const uuidOuNull = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);

export function lerLinhas(body: unknown): { linhas: LinhaRpc[] } | { erro: string } {
  const arr = (body as { linhas?: unknown } | null)?.linhas;
  if (!Array.isArray(arr)) return { erro: "linhas inválidas" };
  if (arr.length > MAX_LINHAS) return { erro: `linhas demais (máximo ${MAX_LINHAS})` };
  const out: LinhaRpc[] = [];
  for (const [i, x] of arr.entries()) {
    const o = (x ?? {}) as Record<string, unknown>;
    const n = i + 1;
    const chave = uuidOuNull(o.chave); const maquina = uuidOuNull(o.maquina_id);
    if (!chave) return { erro: `linha ${n}: chave inválida` };
    if (!maquina) return { erro: `linha ${n}: máquina inválida` };
    if (o.maquina_planejada_id !== null && o.maquina_planejada_id !== undefined && !uuidOuNull(o.maquina_planejada_id)) return { erro: `linha ${n}: posto programado inválido` };
    const nao = o.nao_produziu === true;
    const descricao = typeof o.descricao === "string" ? o.descricao.slice(0, 300) : "";
    if (nao) {
      const motivo = MOTIVOS_NAO_PRODUZIU.find((m) => m.codigo === o.motivo);
      if (!motivo) return { erro: `linha ${n}: motivo do NÃO PRODUZIU inválido` };
      if (motivo.exigeDescricao && descricao.trim().length < 3) return { erro: `linha ${n}: descreva o motivo (Outro)` };
      out.push({ chave, maquina_planejada_id: uuidOuNull(o.maquina_planejada_id), maquina_id: maquina, produto_id: null, funcionario_id: null, produzido: 0, refugo: 0, nao_produziu: true, motivo: motivo.codigo as MotivoNaoProduziu, descricao });
      continue;
    }
    const produto = uuidOuNull(o.produto_id); const func = uuidOuNull(o.funcionario_id);
    if (!produto) return { erro: `linha ${n}: produto inválido` };
    if (!func) return { erro: `linha ${n}: operador inválido` };
    const produzido = o.produzido; const refugo = o.refugo ?? 0;
    if (typeof produzido !== "number" || !Number.isInteger(produzido) || produzido < 0 || produzido > 10_000_000) return { erro: `linha ${n}: produzido inválido` };
    if (typeof refugo !== "number" || !Number.isInteger(refugo) || refugo < 0 || refugo > produzido) return { erro: `linha ${n}: refugo inválido` };
    out.push({ chave, maquina_planejada_id: uuidOuNull(o.maquina_planejada_id), maquina_id: maquina, produto_id: produto, funcionario_id: func, produzido, refugo, nao_produziu: false, motivo: null, descricao: "" });
  }
  if (new Set(out.map((l) => l.maquina_id)).size !== out.length) return { erro: "há duas linhas na mesma máquina" };
  if (new Set(out.map((l) => l.chave)).size !== out.length) return { erro: "chaves de linha repetidas" };
  return { linhas: out };
}
