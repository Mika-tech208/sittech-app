// Sittech Intelligence V1 — auditoria (§24 da instrução). Insert direto
// em intelligence_audit_log via supabaseAsUser (RLS exige
// usuario_id = o próprio usuário — nunca grava em nome de outro). Nunca
// registra API key/service role/tokens/payload bruto das tools — só
// parâmetros já resolvidos (mesmos IDs/janelas das evidências).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ToolChamadaAuditoria {
  tool: string;
  params: Record<string, unknown>;
  sucesso: boolean;
}

export interface RegistroAuditoriaIntelligence {
  usuarioId: string;
  pergunta: string;
  toolsChamadas: ToolChamadaAuditoria[];
  modelo: string;
  tokensEntrada?: number;
  tokensSaida?: number;
  custoEstimadoCentavos?: number | null;
  respostaFinal?: string | null;
  erro?: string | null;
}

export async function registrarAuditoriaIntelligence(supabase: SupabaseClient, registro: RegistroAuditoriaIntelligence): Promise<void> {
  const { error } = await supabase.from("intelligence_audit_log").insert({
    usuario_id: registro.usuarioId,
    pergunta: registro.pergunta,
    tools_chamadas: registro.toolsChamadas,
    modelo: registro.modelo,
    tokens_entrada: registro.tokensEntrada ?? null,
    tokens_saida: registro.tokensSaida ?? null,
    custo_estimado_centavos: registro.custoEstimadoCentavos ?? null,
    resposta_final: registro.respostaFinal ?? null,
    erro: registro.erro ?? null,
  });
  if (error) {
    // Falha de auditoria nunca deve derrubar a resposta ao usuário — só
    // registra no log do servidor (mesma disciplina de
    // registrarAuditoria em useAuthSession.ts, que também só faz
    // console.error em caso de falha).
    console.error("Falha ao registrar auditoria da Intelligence:", error.message);
  }
}
