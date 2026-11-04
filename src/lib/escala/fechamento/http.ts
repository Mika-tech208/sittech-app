// Camada HTTP fina e testável do fechamento físico (as rotas só autenticam e delegam). Sem Next aqui.
import type { SupabaseClient } from "@supabase/supabase-js";
import { temPermissao } from "@/lib/permissoes";
import type { EntradaConfirmacao, EstadoFechamento } from "@/features/escala/fechamento/tipos";
import { calcularSelo, type FechamentoSelo, type SlotSelo } from "@/features/escala/fechamento/selo";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { abrirFechamento, confirmarFechamento, reprocessarFechamento, type FechamentoIO, type ResultadoFechamento } from "./orquestrador";
import { criarFechamentoIO } from "./supabaseFechamento";

export interface UsuarioFechamento { id: string; papel: "admin" | "usuario"; permissoes?: string[] }
export interface RespostaHttp { status: number; corpo: Record<string, unknown> }

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

export function podeFechar(u: UsuarioFechamento | null | undefined): boolean { return temPermissao(u, "escala_fechamento"); }
export function podeFecharSemContagem(u: UsuarioFechamento | null | undefined): boolean { return temPermissao(u, "escala_fechamento_excecao"); }

export function statusHttp(r: ResultadoFechamento): number {
  if (r.ok) return 200;
  if (r.duplicado) return 200;
  if (r.estado === "ERRO_RECALCULO") return 502;        // estoque salvo; programação não gerada
  if (r.estado === "RECALCULANDO") return 409;           // outro recálculo em andamento
  if (r.erros.some((e) => e.codigo === "PERIODO_JA_FECHADO")) return 409;
  if (r.erros.length > 0 || r.exigeConfirmacao.length > 0) return 422;
  return 503;                                            // desligado / indisponível
}

export function lerEntrada(body: unknown): { entrada: EntradaConfirmacao } | { erro: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.data !== "string" || !DATA.test(b.data)) return { erro: "data inválida" };
  if (typeof b.periodo_id !== "string" || !/^[a-z0-9_-]{1,12}$/i.test(b.periodo_id)) return { erro: "periodo_id inválido" };
  if (typeof b.chave !== "string" || !UUID.test(b.chave)) return { erro: "chave inválida" };
  const bufs = Array.isArray(b.buffers) ? b.buffers : [];
  return {
    entrada: {
      data: b.data, periodoId: b.periodo_id, chave: b.chave,
      ...(typeof b.contado_em_ms === "number" ? { contadoEmMs: b.contado_em_ms } : {}),
      buffers: bufs.map((x) => { const y = x as Record<string, unknown>; return { bufferId: String(y.buffer_id), fisico: y.fisico === null || y.fisico === undefined || y.fisico === "" ? null : (y.fisico as number), motivo: typeof y.motivo === "string" ? y.motivo : null }; }),
      confirmouDiferencaGrande: b.confirmou_diferenca_grande === true,
      ...(typeof b.excecao_motivo === "string" && b.excecao_motivo.length > 0 ? { excecao: { motivo: b.excecao_motivo } } : {}),
      observacao: typeof b.observacao === "string" ? b.observacao : null, dispositivo: typeof b.dispositivo === "string" ? b.dispositivo.slice(0, 80) : null,
    },
  };
}

export async function acaoAbrir(io: FechamentoIO, u: UsuarioFechamento, body: unknown): Promise<RespostaHttp> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!podeFechar(u)) return { status: 403, corpo: { erro: "Sem permissão para fechar o período." } };
  if (typeof b.data !== "string" || !DATA.test(b.data) || typeof b.periodo_id !== "string") return { status: 400, corpo: { erro: "data/periodo_id inválidos." } };
  const r = await abrirFechamento(io, { data: b.data, periodoId: b.periodo_id, usuarioId: u.id, dispositivo: typeof b.dispositivo === "string" ? b.dispositivo : null, forcar: b.forcar === true && podeFecharSemContagem(u) });
  if (!r.ok || !r.contexto) return { status: r.erros?.length ? 422 : r.erro?.match(/EM_ANDAMENTO/) ? 409 : r.erro?.match(/desligado/) ? 503 : 422, corpo: { erro: r.erro ?? "Não foi possível abrir o fechamento.", ...(r.erros?.length ? { erros: r.erros } : {}) } };
  const c = r.contexto;
  return { status: 200, corpo: {
    ok: true, abertura_id: r.aberturaId, valido_ate_ms: r.validoAteMs,
    periodo: { data: c.periodo.data, periodo_id: c.periodo.periodoId, rotulo: c.periodo.rotulo, fim_ms: c.periodo.fimMs, proximo: c.periodo.proximo ? { rotulo: c.periodo.proximo.rotulo, periodo_id: c.periodo.proximo.periodoId } : null },
    postos: c.postos, tem_pendentes: c.postos.some((p) => p.status === "pendente"),
    buffers: c.obrigatorios.map((b) => { const e = c.estimativas.find((x) => x.bufferId === b.id); return { buffer_id: b.id, rotulo: b.rotulo, estimado: e?.estimado ?? null, estimado_lo: e?.lo ?? null, estimado_hi: e?.hi ?? null }; }),
    pode_excecao: podeFecharSemContagem(u), pares_sem_buffer: c.paresSemBuffer ?? [], alertas: r.alertas ?? [],
  } };
}

/** REABRIR PERÍODO: abre uma janela de correção (60 min) num período CONFIRMADO para corrigir lançamentos. Exige `escala_fechamento` (ou admin) e um motivo; fica auditado.
 *  Não recalcula o plano nem tira a liberação do período seguinte (o físico contado no fechamento segue sendo a verdade). */
export async function acaoReabrir(admin: SupabaseClient, u: UsuarioFechamento, body: unknown): Promise<RespostaHttp> {
  if (!podeFechar(u)) return { status: 403, corpo: { erro: "Sem permissão para reabrir o período." } };
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.data !== "string" || !DATA.test(b.data) || typeof b.periodo_id !== "string" || !/^[a-z0-9_-]{1,12}$/i.test(b.periodo_id)) return { status: 400, corpo: { erro: "data/periodo_id inválidos." } };
  const motivo = typeof b.motivo === "string" ? b.motivo.trim() : "";
  if (motivo.length < 3) return { status: 422, corpo: { erro: "Informe o motivo da reabertura." } };
  const { data, error } = await admin.rpc("escala_fechamento_reabrir", { p_usuario: u.id, p_data: b.data, p_periodo: b.periodo_id, p_motivo: motivo.slice(0, 500), p_ttl_min: 60 });
  if (error) {
    const m = error.message ?? "";
    const codigo = m.match(/REABERTURA_[A-Z_]+/)?.[0];
    const texto = m.replace(/^.*?REABERTURA_[A-Z_]+:\s*/, "");
    return { status: codigo ? 422 : 500, corpo: { erro: codigo ? texto : "Não foi possível reabrir o período.", ...(codigo ? { codigo } : {}) } };
  }
  const r = (Array.isArray(data) ? data[0] : data) as { abertura_id?: string; valido_ate?: string; renovada?: boolean } | null;
  if (!r?.abertura_id) return { status: 500, corpo: { erro: "Não foi possível reabrir o período." } };
  return { status: 200, corpo: { ok: true, abertura_id: r.abertura_id, valido_ate: r.valido_ate, renovada: r.renovada === true } };
}

export async function acaoConfirmar(io: FechamentoIO, u: UsuarioFechamento, body: unknown, relogio: () => number = Date.now): Promise<RespostaHttp> {
  if (!podeFechar(u)) return { status: 403, corpo: { erro: "Sem permissão para fechar o período." } };
  const lido = lerEntrada(body);
  if ("erro" in lido) return { status: 400, corpo: { erro: lido.erro } };
  if (lido.entrada.excecao && !podeFecharSemContagem(u)) return { status: 403, corpo: { erro: "Fechar sem contagem exige perfil superior." } };
  try {
    // CORREÇÃO de um período já fechado (nova revisão; a anterior fica no histórico): só perfil superior, e a janela foi aberta com `forcar`
    const revisao = (body as { revisao?: unknown } | null)?.revisao === true && podeFecharSemContagem(u);
    const r = await confirmarFechamento(io, lido.entrada, u.id, relogio, { forcarRevisao: revisao });
    return { status: statusHttp(r), corpo: { ...r } };
  } catch (e) {
    return { status: 500, corpo: { erro: e instanceof Error ? e.message : "Falha no fechamento.", mensagem: "Falha no fechamento. Nada foi publicado." } };
  }
}

export async function acaoRetry(io: FechamentoIO, u: UsuarioFechamento, body: unknown, relogio: () => number = Date.now): Promise<RespostaHttp> {
  if (!podeFechar(u)) return { status: 403, corpo: { erro: "Sem permissão." } };
  const id = (body as { fechamento_id?: unknown } | null)?.fechamento_id;
  if (typeof id !== "string" || !UUID.test(id)) return { status: 400, corpo: { erro: "fechamento_id inválido." } };
  try {
    const r = await reprocessarFechamento(io, id, u.id, relogio);
    return { status: statusHttp(r), corpo: { ...r } };
  } catch (e) {
    return { status: 500, corpo: { erro: e instanceof Error ? e.message : "Falha no retry." } };
  }
}

export interface LinhaProgramacao { maquina: string; pessoa: string; produto: string; pecas: number }
/** Programação (postos × pessoas × peças) de um período — mostrada logo após o CONFIRMADO. */
export async function programacaoDoPeriodo(admin: SupabaseClient, data: string, periodoId: string): Promise<LinhaProgramacao[]> {
  const { data: rows, error } = await admin.from("escala_producao_alocacoes").select("funcionario_id, maquina_id, produto_id, pecas").eq("data", data).eq("periodo_id", periodoId).not("maquina_id", "is", null);
  if (error || !rows) return [];
  const ls = rows as { funcionario_id: string; maquina_id: string; produto_id: string | null; pecas: number | string }[];
  const [maq, fun, prod] = await Promise.all([
    admin.from("maquinas").select("id, nome").in("id", [...new Set(ls.map((l) => l.maquina_id))]),
    admin.from("funcionarios").select("id, nome").in("id", [...new Set(ls.map((l) => l.funcionario_id))]),
    admin.from("produtos").select("id, nome").in("id", [...new Set(ls.map((l) => l.produto_id).filter(Boolean) as string[])]),
  ]);
  const nome = (r: { data: unknown }, id: string | null) => ((r.data as { id: string; nome: string }[] | null) ?? []).find((x) => x.id === id)?.nome?.trim() ?? "—";
  return ls.map((l) => ({ maquina: nome(maq, l.maquina_id), pessoa: nome(fun, l.funcionario_id).split(" ")[0], produto: nome(prod, l.produto_id), pecas: Number(l.pecas) })).sort((a, b) => a.maquina.localeCompare(b.maquina));
}

export function ioDoUsuario(admin: SupabaseClient, u: UsuarioFechamento): FechamentoIO {
  return criarFechamentoIO(admin, { podeExcecao: podeFecharSemContagem(u) });
}

/** Estado para a tela (polling): último fechamento vigente do período e o selo do próximo. */
export async function acaoEstado(admin: SupabaseClient, u: UsuarioFechamento, data: string, periodoId: string): Promise<RespostaHttp> {
  if (!temPermissao(u, "escala_fechamento") && !temPermissao(u, "escala_producao") && !temPermissao(u, "escala_producao_tv") && !temPermissao(u, "producao_real_apontamento")) return { status: 403, corpo: { erro: "Sem permissão." } };
  if (!DATA.test(data)) return { status: 400, corpo: { erro: "data inválida" } };
  const modoRow = await admin.from("escala_parametros").select("valor").eq("chave", "escala_fechamento_fisico_modo").maybeSingle();
  const modo = modoRow.data?.valor === "sombra" || modoRow.data?.valor === "ativo" ? (modoRow.data.valor as string) : "desligado";
  if (modo === "desligado") return { status: 200, corpo: { modo, fechado: false } };
  const { data: rows, error } = await admin.from("escala_fechamento_estado").select("fechamento_id, estado, estado_em, detalhe, fechado_em, excecao").eq("data", data).eq("periodo_id", periodoId).limit(1);
  if (error) return { status: 500, corpo: { erro: error.message } };
  const r = (rows ?? [])[0] as { fechamento_id: string; estado: string; estado_em: string; detalhe: Record<string, unknown>; fechado_em: string; excecao: boolean } | undefined;
  return { status: 200, corpo: { modo, fechado: !!r, ...(r ? { fechamento_id: r.fechamento_id, estado: r.estado, estado_em: r.estado_em, fechado_em: r.fechado_em, excecao: r.excecao, tempos_ms: (r.detalhe?.tempos_ms ?? null), erro: (r.detalhe?.erro ?? null) } : {}) } };
}

/** Selo da programação para as telas (Escala, TV, painel). Só em modo `ativo`; em sombra/desligado devolve `selo: null`. */
export async function acaoSelo(admin: SupabaseClient, u: UsuarioFechamento, agoraMs: number = Date.now()): Promise<RespostaHttp> {
  if (!temPermissao(u, "escala_fechamento") && !temPermissao(u, "escala_producao") && !temPermissao(u, "escala_producao_tv") && !temPermissao(u, "producao_real_apontamento")) return { status: 403, corpo: { erro: "Sem permissão." } };
  const modoRow = await admin.from("escala_parametros").select("valor").eq("chave", "escala_fechamento_fisico_modo").maybeSingle();
  const modo = modoRow.data?.valor === "sombra" || modoRow.data?.valor === "ativo" ? (modoRow.data.valor as string) : "desligado";
  if (modo !== "ativo") return { status: 200, corpo: { modo, selo: null } };
  const hoje = new Date(agoraMs).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const desde = new Date(agoraMs - 7 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const { data: dias, error } = await admin.from("escala_producao_dias").select("data, periodos_snapshot").gte("data", desde).lte("data", hoje).order("data");
  if (error) return { status: 500, corpo: { erro: error.message } };
  const slots: SlotSelo[] = ((dias ?? []) as { data: string; periodos_snapshot: { id: string; nome: string; fim: string }[] }[]).flatMap((d) => d.periodos_snapshot.map((p) => ({ data: d.data, periodoId: p.id, rotulo: p.nome, fimMs: epochMsNoFuso(d.data, p.fim) })));
  const { data: fechs, error: e2 } = await admin.from("escala_fechamento_estado").select("data, periodo_id, estado, excecao, fechado_em, sombra").gte("data", desde).lte("data", hoje);
  if (e2) return { status: 500, corpo: { erro: e2.message } };
  const mapa = new Map<string, FechamentoSelo>(((fechs ?? []) as { data: string; periodo_id: string; estado: EstadoFechamento; excecao: boolean; fechado_em: string; sombra: boolean }[]).filter((f) => !f.sombra).map((f) => [`${f.data}|${f.periodo_id}`, { estado: f.estado, excecao: f.excecao, fechadoEmMs: Date.parse(f.fechado_em) }]));
  return { status: 200, corpo: { modo, selo: calcularSelo(slots, agoraMs, mapa) } };
}
