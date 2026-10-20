"use client";

// Chamadas ao backend (RPC) da exclusão/unificação controlada. Nunca há DELETE direto do navegador.
import { supabase } from "@/services/supabase-client";
import { mensagemDeErro, type PlanoExclusao, type ResumoFuncionario } from "./exclusao";

type Resp<T> = { ok: true; dados: T } | { ok: false; erro: string };
export type Decisoes = Record<string, "copiar" | "descartar">;

export async function carregarResumo(id: string): Promise<Resp<ResumoFuncionario>> {
  const { data, error } = await supabase.rpc("funcionario_resumo", { p_id: id });
  if (error) return { ok: false, erro: mensagemDeErro(error.message) };
  return { ok: true, dados: data as ResumoFuncionario };
}

export async function simularExclusao(excluidoId: string, mantidoId: string | null, decisoes: Decisoes): Promise<Resp<PlanoExclusao>> {
  const { data, error } = await supabase.rpc("funcionario_exclusao_simular", { p_excluido: excluidoId, p_mantido: mantidoId, p_decisoes_custos: decisoes });
  if (error) return { ok: false, erro: mensagemDeErro(error.message) };
  return { ok: true, dados: data as PlanoExclusao };
}

export async function executarExclusao(excluidoId: string, mantidoId: string | null, decisoes: Decisoes, assinatura: string): Promise<Resp<{ log_id: string }>> {
  const { data, error } = await supabase.rpc("funcionario_exclusao_executar", {
    p_excluido: excluidoId, p_mantido: mantidoId, p_decisoes_custos: decisoes, p_assinatura: assinatura,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error.message) };
  return { ok: true, dados: data as { log_id: string } };
}
