// Sittech Intelligence V1 — contrato comum de tool (§5/§6/§12 da análise
// aprovada). Cada tool: (1) valida permissão server-side, (2) resolve
// janela/entidades deterministicamente, (3) chama SÓ funções/RPCs já
// existentes, (4) devolve o envelope estruturado — nunca texto.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Permissao } from "@/lib/permissoes";
import type { UsuarioIntelligence, IntelligenceToolResult } from "@/features/intelligence/types";

export interface IntelligenceToolContext {
  supabase: SupabaseClient; // sempre supabaseAsUser (ver auth.ts) — nunca admin/service_role.
  usuario: UsuarioIntelligence;
  agora: Date;
}

// JSON Schema simplificado — o suficiente pro function-calling do
// provider (ver providers/openai.ts). Mantido solto de propósito (Record)
// em vez de tipar cada variante de JSON Schema — a validação real dos
// parâmetros acontece no handler (nunca confia cegamente no que o LLM
// mandou), então um schema mais rico aqui não traria segurança extra.
export type IntelligenceToolJSONSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
};

export interface IntelligenceTool<TParams = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: IntelligenceToolJSONSchema;
  permissoesRequeridas: Permissao[]; // TODAS obrigatórias (ver usuarioTemTodasPermissoes).
  handler: (ctx: IntelligenceToolContext, params: TParams) => Promise<IntelligenceToolResult>;
}

export function erroSemPermissao(tool: string, faltando: Permissao[]): IntelligenceToolResult {
  return {
    success: false,
    tool,
    code: "sem_permissao",
    message: `Você não tem acesso a esse dado com sua permissão atual (requer: ${faltando.join(", ")}).`,
  };
}

export function erroFalhaConsulta(tool: string, detalhe: string): IntelligenceToolResult {
  return { success: false, tool, code: "falha_consulta", message: `Não consegui consultar esse dado agora (${detalhe}).` };
}

export function erroParametroInvalido(tool: string, detalhe: string): IntelligenceToolResult {
  return { success: false, tool, code: "parametro_invalido", message: detalhe };
}
