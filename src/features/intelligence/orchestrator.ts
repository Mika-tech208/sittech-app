// Sittech Intelligence V1 — orquestrador (§1/§6/§7/§15/§19/§20 da
// instrução). Único lugar que fala com o provider e decide quando parar.
// Fluxo: pergunta -> LLM escolhe tools (schema fechado, datas/entidades
// resolvidas DENTRO da tool, nunca pelo LLM) -> tool layer (permissão
// server-side) -> motor determinístico -> evidências -> de volta pro LLM
// -> repete até no máximo 4 chamadas de tool -> checagem de causalidade
// (no máximo 1 reformulação) -> resposta final.

import { obterProvider, obterModeloConfigurado } from "@/features/intelligence/providers";
import type { ProviderMessage, ProviderToolDefinition } from "@/features/intelligence/providers/types";
import { construirSystemPrompt } from "@/features/intelligence/systemPrompt";
import { executarTool } from "@/features/intelligence/tools";
import { INTELLIGENCE_TOOLS } from "@/features/intelligence/tools";
import { avaliarCausalidade, instrucaoReformulacaoParaPrompt } from "@/features/intelligence/causality";
import { limitarHistorico } from "@/features/intelligence/conversationContext";
import type { IntelligenceToolContext } from "@/features/intelligence/tools/types";
import type { IntelligenceEvidence, ConversationContext } from "@/features/intelligence/types";
import type { ToolChamadaAuditoria } from "@/features/intelligence/audit";

export const MAX_TOOL_CALLS_POR_PERGUNTA = 4;

export interface HistoricoMensagem {
  role: "user" | "assistant";
  content: string;
}

export interface OrchestratorInput {
  message: string;
  history?: HistoricoMensagem[];
  conversationContext?: ConversationContext;
}

export interface OrchestratorOutput {
  answer: string;
  evidences: IntelligenceEvidence[];
  toolsChamadas: ToolChamadaAuditoria[];
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  atingiuLimiteDeChamadas: boolean;
  causalidadeCorrigida: boolean;
}

const RESPOSTA_SEM_EVIDENCIA = "Não há evidência suficiente para concluir isso com segurança agora. Quer que eu investigue de outro ângulo?";
const RESPOSTA_CAUSALIDADE_INSEGURA =
  "Encontrei sinais relacionados, mas não tenho evidência determinística suficiente para afirmar uma relação de causa — só posso dizer que os dados mostram associação. Prefiro não arriscar uma conclusão que os dados não sustentam.";

function toolDefinitions(): ProviderToolDefinition[] {
  return INTELLIGENCE_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

export async function executarConversaIntelligence(ctx: IntelligenceToolContext, input: OrchestratorInput): Promise<OrchestratorOutput> {
  const provider = obterProvider();
  const model = obterModeloConfigurado();
  const systemPrompt = construirSystemPrompt();

  const historico = limitarHistorico(input.history || []);
  const messages: ProviderMessage[] = [
    ...historico.map((h) => ({ role: h.role, content: h.content }) as ProviderMessage),
    { role: "user", content: input.message },
  ];

  const evidencesAcumuladas: IntelligenceEvidence[] = [];
  const toolsChamadas: ToolChamadaAuditoria[] = [];
  let chamadasDeTool = 0;
  let usageTotal = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  let atingiuLimite = false;

  // Loop de tool-calling — nunca mais que MAX_TOOL_CALLS_POR_PERGUNTA
  // chamadas de tool no total (não de rodadas — uma rodada pode conter
  // mais de uma chamada, contamos cada uma).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const resultado = await provider.run({ model, systemPrompt, messages, tools: toolDefinitions() });
    usageTotal = {
      inputTokens: usageTotal.inputTokens + resultado.usage.inputTokens,
      outputTokens: usageTotal.outputTokens + resultado.usage.outputTokens,
      cachedInputTokens: (usageTotal.cachedInputTokens || 0) + (resultado.usage.cachedInputTokens || 0),
    };

    if (resultado.type === "final_text") {
      return await finalizarResposta(resultado.text, evidencesAcumuladas, toolsChamadas, usageTotal, atingiuLimite, ctx, provider, model, systemPrompt, messages);
    }

    // type === "tool_calls"
    if (chamadasDeTool >= MAX_TOOL_CALLS_POR_PERGUNTA) {
      atingiuLimite = true;
      return { answer: RESPOSTA_SEM_EVIDENCIA, evidences: evidencesAcumuladas, toolsChamadas, usage: usageTotal, atingiuLimiteDeChamadas: true, causalidadeCorrigida: false };
    }

    messages.push({ role: "assistant_tool_calls", toolCalls: resultado.toolCalls });

    for (const chamada of resultado.toolCalls) {
      if (chamadasDeTool >= MAX_TOOL_CALLS_POR_PERGUNTA) {
        messages.push({ role: "tool_result", toolCallId: chamada.id, content: JSON.stringify({ success: false, code: "limite_atingido", message: "Limite de 4 chamadas de tool por pergunta atingido." }) });
        continue;
      }
      chamadasDeTool += 1;
      const resultadoTool = await executarTool(chamada.name, chamada.arguments, ctx);
      toolsChamadas.push({ tool: chamada.name, params: chamada.arguments, sucesso: resultadoTool.success });
      if (resultadoTool.success) evidencesAcumuladas.push(...resultadoTool.evidences);
      messages.push({ role: "tool_result", toolCallId: chamada.id, content: JSON.stringify(resultadoTool) });
    }

    if (chamadasDeTool >= MAX_TOOL_CALLS_POR_PERGUNTA) atingiuLimite = true;
  }
}

async function finalizarResposta(
  texto: string,
  evidences: IntelligenceEvidence[],
  toolsChamadas: ToolChamadaAuditoria[],
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number },
  atingiuLimite: boolean,
  ctx: IntelligenceToolContext,
  provider: ReturnType<typeof obterProvider>,
  model: string,
  systemPrompt: string,
  messages: ProviderMessage[]
): Promise<OrchestratorOutput> {
  const avaliacao = avaliarCausalidade(texto);
  if (!avaliacao.violacao) {
    return { answer: texto, evidences, toolsChamadas, usage, atingiuLimiteDeChamadas: atingiuLimite, causalidadeCorrigida: false };
  }

  // §15: no máximo 1 tentativa de correção — nunca loop.
  const mensagensComCorrecao: ProviderMessage[] = [
    ...messages,
    { role: "assistant", content: texto },
    { role: "user", content: instrucaoReformulacaoParaPrompt(avaliacao.padroesEncontrados) },
  ];
  const segundaTentativa = await provider.run({ model, systemPrompt, messages: mensagensComCorrecao, tools: toolDefinitions() });
  const usageFinal = {
    inputTokens: usage.inputTokens + segundaTentativa.usage.inputTokens,
    outputTokens: usage.outputTokens + segundaTentativa.usage.outputTokens,
    cachedInputTokens: (usage.cachedInputTokens || 0) + (segundaTentativa.usage.cachedInputTokens || 0),
  };

  if (segundaTentativa.type === "final_text") {
    const segundaAvaliacao = avaliarCausalidade(segundaTentativa.text);
    if (!segundaAvaliacao.violacao) {
      return { answer: segundaTentativa.text, evidences, toolsChamadas, usage: usageFinal, atingiuLimiteDeChamadas: atingiuLimite, causalidadeCorrigida: true };
    }
  }
  // Ainda violou (ou o provider tentou chamar tool de novo) — nunca expõe
  // a versão com causalidade indevida, substitui por um texto seguro fixo.
  return { answer: RESPOSTA_CAUSALIDADE_INSEGURA, evidences, toolsChamadas, usage: usageFinal, atingiuLimiteDeChamadas: atingiuLimite, causalidadeCorrigida: true };
}
