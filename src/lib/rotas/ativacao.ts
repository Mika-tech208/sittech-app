// Ativação PROGRAMADA do modelo de rotas — lado cliente. A liberação é decidida PELO BANCO (data/semana + validações, fail closed); aqui só se lê o estado e se pede a ativação on-demand idempotente.
// Banco sem as funções (ambiente antes da migration) ou qualquer erro = `null` = modelo fechado, tudo legado como sempre.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ChecagemRotas { id: string; ok: boolean; detalhe: string }
export interface EstadoAtivacaoRotas {
  programado: boolean; desde: string | null; desdeData: string | null; agora: string; dataConsultada: string; suporteManual: boolean;
  liberado: boolean; motivo: string; validacao: { ok: boolean; checks: ChecagemRotas[] }; produtosAtivados?: number;
}

export async function consultarEstadoRotas(supabase: SupabaseClient, semana?: string): Promise<EstadoAtivacaoRotas | null> {
  const r = await supabase.rpc("rotas_estado_ativacao", semana ? { p_semana: semana } : {});
  return r.error || !r.data ? null : (r.data as EstadoAtivacaoRotas);
}

let ultima: { quando: number; promessa: Promise<EstadoAtivacaoRotas | null> } | null = null;
// Pede ao banco para aplicar a ativação (idempotente: repetir não duplica nada nem muda o resultado). Memoizada por 30 s para não repetir a cada tela.
export function garantirAtivacaoRotas(supabase: SupabaseClient): Promise<EstadoAtivacaoRotas | null> {
  const agora = Date.now();
  if (ultima && agora - ultima.quando < 30_000) return ultima.promessa;
  const promessa = (async () => {
    const r = await supabase.rpc("rotas_ativacao_aplicar");
    return r.error || !r.data ? null : (r.data as EstadoAtivacaoRotas);
  })();
  ultima = { quando: agora, promessa };
  return promessa;
}

export const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
