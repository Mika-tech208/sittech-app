// Sittech Intelligence V1 — abstração de provider (§2 da instrução). O
// resto do sistema (orquestrador, tools, endpoint) nunca importa o SDK de
// um fornecedor específico — só este contrato. Troca de modelo/fornecedor
// fica isolada em providers/<nome>.ts.

export interface ProviderToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ProviderToolCall {
  id: string; // id da chamada — precisa ser devolvido junto do resultado (ver ProviderToolResultMessage)
  name: string;
  arguments: Record<string, unknown>;
}

export type ProviderMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "assistant_tool_calls"; toolCalls: ProviderToolCall[] }
  | { role: "tool_result"; toolCallId: string; content: string };

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export type ProviderRunResult =
  | { type: "tool_calls"; toolCalls: ProviderToolCall[]; usage: ProviderUsage }
  | { type: "final_text"; text: string; usage: ProviderUsage };

export interface IntelligenceProvider {
  readonly nome: string;
  run(params: { model: string; systemPrompt: string; messages: ProviderMessage[]; tools: ProviderToolDefinition[] }): Promise<ProviderRunResult>;
}
