// Camada HTTP fina e testável do apontamento simplificado (as rotas só autenticam e delegam). Sem Next aqui.
import { lerLinhas } from "@/features/producao-real/apontamento-simplificado/payload";
import { podeFechar, type RespostaHttp, type UsuarioFechamento } from "./http";
import type { ApontamentosIO } from "./apontamentoSimplificado";

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const PERIODO = /^[a-z0-9_-]{1,12}$/i;

/** Quem fecha o período é quem lança os apontamentos do fechamento. */
export const podeApontarNoFechamento = (u: UsuarioFechamento | null | undefined) => podeFechar(u);

export async function acaoApontamentosEstado(io: ApontamentosIO, u: UsuarioFechamento, data: string, periodoId: string): Promise<RespostaHttp> {
  if (!podeApontarNoFechamento(u)) return { status: 403, corpo: { erro: "Sem permissão para fechar o período." } };
  if (!DATA.test(data) || !PERIODO.test(periodoId)) return { status: 400, corpo: { erro: "data/periodo_id inválidos." } };
  try {
    const modo = await io.modo();
    if (modo !== "ativo") return { status: 200, corpo: { modo } };          // flag desligada: a tela volta ao fluxo anterior
    return { status: 200, corpo: { modo, ...(await io.carregar(data, periodoId)) } };
  } catch (e) { return { status: 500, corpo: { erro: e instanceof Error ? e.message : "Falha ao carregar os apontamentos." } }; }
}

export async function acaoApontamentosSalvar(io: ApontamentosIO, u: UsuarioFechamento, body: unknown): Promise<RespostaHttp> {
  if (!podeApontarNoFechamento(u)) return { status: 403, corpo: { erro: "Sem permissão para fechar o período." } };
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.data !== "string" || !DATA.test(b.data) || typeof b.periodo_id !== "string" || !PERIODO.test(b.periodo_id)) return { status: 400, corpo: { erro: "data/periodo_id inválidos." } };
  const lido = lerLinhas(body);
  if ("erro" in lido) return { status: 400, corpo: { erro: lido.erro } };
  try {
    if ((await io.modo()) !== "ativo") return { status: 409, corpo: { erro: "Apontamento simplificado desligado." } };
    const r = await io.salvar(b.data, b.periodo_id, lido.linhas);
    return { status: 200, corpo: { ok: true, ...r } };
  } catch (e) {
    const m = e instanceof Error ? e.message : "Falha ao gravar os apontamentos.";
    // erros de regra (RPC): 422 com a mensagem para a tela; o resto: 500. Nada é gravado em nenhum caso (transação única).
    const regra = /LINHA\[|MAQUINA_DUPLICADA|POSTO_PROGRAMADO|APONTAMENTO_EDITADO_FORA_DO_FLUXO|FECHAMENTO_PERIODO_EM_FECHAMENTO|ainda não começou|data futura|Produto|Funcionário|Meta não cadastrada|etapa|exige/.test(m);
    return { status: regra ? 422 : 500, corpo: { erro: m, mensagem: "Nada foi gravado." } };
  }
}
