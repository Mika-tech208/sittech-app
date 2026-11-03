// REDE DE SEGURANÇA do fechamento físico: o evento `fechamento_fisico` (outbox) é enfileirado junto com o snapshot. Se o servidor caiu depois de gravar o inventário e antes de
// publicar, o worker /api/escala/drenar refaz o recálculo SEM pedir a contagem de novo. Fechamento já CONFIRMADO / fora do modo ativo ⇒ evento dado como processado.
import type { SupabaseClient } from "@supabase/supabase-js";
import { reprocessarFechamento } from "./orquestrador";
import { criarFechamentoIO } from "./supabaseFechamento";

const EM_ANDAMENTO_MS = 90_000;

export async function processarEventoFechamento(admin: SupabaseClient, ev: { id: string; payload: Record<string, unknown> | null; usuario_id: string | null }, agoraMs: number): Promise<"processado" | "erro"> {
  const concluir = async (status: "processado" | "erro", erro: string | null) => { await admin.rpc("escala_concluir_eventos", { p_ids: [ev.id], p_status: status, p_erro: erro }); return status; };
  const id = typeof ev.payload?.fechamento_id === "string" ? (ev.payload.fechamento_id as string) : null;
  if (!id) return concluir("processado", "evento sem fechamento");
  try {
    const io = criarFechamentoIO(admin, { podeExcecao: false });
    const modo = await io.modo();
    if (modo !== "ativo") return concluir("processado", null);                // sombra/desligado: o motor nunca usou o físico
    const f = await io.carregarFechamento(id);
    if (!f || f.estado === "CONFIRMADO") return concluir("processado", null);
    if (f.estado === "RECALCULANDO" && f.estadoEmMs !== null && agoraMs - f.estadoEmMs < EM_ANDAMENTO_MS) return concluir("erro", "fechamento em andamento no servidor; tentar de novo");
    const r = await reprocessarFechamento(io, id, ev.usuario_id ?? f.fechadoPor ?? "", () => Date.now());
    return r.ok ? concluir("processado", null) : concluir("erro", r.erros[0]?.mensagem ?? r.mensagem ?? "recálculo do fechamento falhou");
  } catch (e) {
    return concluir("erro", e instanceof Error ? e.message : String(e));
  }
}
