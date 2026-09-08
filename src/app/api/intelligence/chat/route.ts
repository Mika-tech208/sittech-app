// Sittech Intelligence V1 — endpoint server-side (§28 da instrução).
// Único ponto de entrada — o browser NUNCA chama o provider diretamente.
// Sessão real do usuário (Bearer token do próprio usuário, nunca
// service_role) — ver auth.ts.

import { NextResponse } from "next/server";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { checarRateLimit } from "@/features/intelligence/rateLimit";
import { executarConversaIntelligence, type HistoricoMensagem } from "@/features/intelligence/orchestrator";
import { registrarAuditoriaIntelligence } from "@/features/intelligence/audit";
import { obterModeloConfigurado } from "@/features/intelligence/providers";
import type { ConversationContext } from "@/features/intelligence/types";

interface RequestBody {
  message?: unknown;
  history?: unknown;
  conversationContext?: unknown;
}

function validarHistorico(v: unknown): HistoricoMensagem[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (m): m is HistoricoMensagem => typeof m === "object" && m !== null && (m as HistoricoMensagem).role !== undefined && ["user", "assistant"].includes((m as HistoricoMensagem).role) && typeof (m as HistoricoMensagem).content === "string"
  );
}

export async function POST(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });

  const rate = checarRateLimit(auth.usuario.id);
  if (!rate.permitido) {
    return NextResponse.json({ erro: "Você atingiu o limite de 30 perguntas por hora. Tente novamente em alguns minutos." }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as RequestBody | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ erro: "Mensagem vazia." }, { status: 400 });
  if (message.length > 2000) return NextResponse.json({ erro: "Mensagem muito longa (máximo 2000 caracteres)." }, { status: 400 });

  const history = validarHistorico(body?.history);
  const conversationContext = (typeof body?.conversationContext === "object" && body?.conversationContext !== null ? body.conversationContext : {}) as ConversationContext;

  const modelo = obterModeloConfigurado();

  try {
    const resultado = await executarConversaIntelligence(
      { supabase: auth.supabaseAsUser, usuario: auth.usuario, agora: new Date() },
      { message, history, conversationContext }
    );

    await registrarAuditoriaIntelligence(auth.supabaseAsUser, {
      usuarioId: auth.usuario.id,
      pergunta: message,
      toolsChamadas: resultado.toolsChamadas,
      modelo,
      tokensEntrada: resultado.usage.inputTokens,
      tokensSaida: resultado.usage.outputTokens,
      respostaFinal: resultado.answer,
    });

    return NextResponse.json({
      answer: resultado.answer,
      evidences: resultado.evidences,
      followUps: [], // sugestões de follow-up hoje vêm embutidas no texto de `answer` (instrução do system prompt) — extração estruturada separada fica para uma evolução futura, não implementada nesta V1.
      context: conversationContext,
      usage: resultado.usage,
      // Diagnóstico — só pra este mesmo usuário ver o que a própria pergunta
      // dele disparou (harness de DEV, §29). Não é segredo: são os mesmos
      // nomes/parâmetros de tool já refletidos nas evidências.
      debug: { toolsChamadas: resultado.toolsChamadas, atingiuLimiteDeChamadas: resultado.atingiuLimiteDeChamadas, causalidadeCorrigida: resultado.causalidadeCorrigida },
    });
  } catch (e) {
    const mensagemErro = e instanceof Error ? e.message : "Erro desconhecido.";
    await registrarAuditoriaIntelligence(auth.supabaseAsUser, {
      usuarioId: auth.usuario.id, pergunta: message, toolsChamadas: [], modelo, erro: mensagemErro,
    });
    // OPENAI_API_KEY ausente é um erro de configuração esperado em DEV
    // sem chave — reportado com clareza, nunca mascarado como sucesso.
    return NextResponse.json({ erro: mensagemErro.includes("OPENAI_API_KEY") ? "Integração com o provider de IA não está configurada neste ambiente." : "Não foi possível processar sua pergunta agora." }, { status: 500 });
  }
}
