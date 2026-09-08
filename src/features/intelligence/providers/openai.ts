// Sittech Intelligence V1 — adapter OpenAI (§2/§42 da instrução). Único
// arquivo que importa o SDK `openai` — nada mais no sistema depende dele
// diretamente. Usa a Responses API (client.responses.create), que é o
// formato atual do SDK instalado (openai@^7 — conferido em
// node_modules/openai/resources/responses/responses.d.ts antes de
// escrever este arquivo, não assumido de memória). API key SOMENTE
// server-side (lida de OPENAI_API_KEY, nunca de uma variável NEXT_PUBLIC_*).

import OpenAI from "openai";
import type { IntelligenceProvider, ProviderMessage, ProviderRunResult, ProviderToolDefinition } from "@/features/intelligence/providers/types";

function criarClienteOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada — Intelligence não pode chamar o provider.");
  return new OpenAI({ apiKey });
}

// Converte o histórico de mensagens (formato agnóstico de provider) pro
// shape de `input` da Responses API.
function paraInputResponses(messages: ProviderMessage[]): OpenAI.Responses.ResponseInputItem[] {
  const input: OpenAI.Responses.ResponseInputItem[] = [];
  for (const m of messages) {
    if (m.role === "user") input.push({ role: "user", content: m.content });
    else if (m.role === "assistant") input.push({ role: "assistant", content: m.content });
    else if (m.role === "assistant_tool_calls") {
      for (const tc of m.toolCalls) {
        input.push({ type: "function_call", call_id: tc.id, name: tc.name, arguments: JSON.stringify(tc.arguments) });
      }
    } else if (m.role === "tool_result") {
      input.push({ type: "function_call_output", call_id: m.toolCallId, output: m.content });
    }
  }
  return input;
}

function paraToolsResponses(tools: ProviderToolDefinition[]): OpenAI.Responses.FunctionTool[] {
  return tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: null }));
}

export const openaiProvider: IntelligenceProvider = {
  nome: "openai",
  async run({ model, systemPrompt, messages, tools }) {
    const client = criarClienteOpenAI();
    const response = await client.responses.create({
      model,
      instructions: systemPrompt,
      input: paraInputResponses(messages),
      tools: paraToolsResponses(tools),
    });

    const usage = {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens,
    };

    const chamadasDeFuncao = response.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call");
    if (chamadasDeFuncao.length > 0) {
      const toolCalls = chamadasDeFuncao.map((c) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.arguments || "{}");
        } catch {
          args = {};
        }
        return { id: c.call_id, name: c.name, arguments: args };
      });
      return { type: "tool_calls", toolCalls, usage } satisfies ProviderRunResult;
    }

    return { type: "final_text", text: response.output_text || "", usage } satisfies ProviderRunResult;
  },
};
