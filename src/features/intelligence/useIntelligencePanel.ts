"use client";

// Sittech Intelligence V1 — UI/UX (painel lateral). Controlador único do
// painel: abrir/fechar, conversa da sessão atual, envio, erro, timing.
// NENHUMA regra de negócio mora aqui — só chama o mesmo endpoint que o
// harness de DEV já usa (/api/intelligence/chat), com a mesma técnica de
// auth (Bearer do supabase.auth.getSession()). Contexto entre perguntas
// (§17) é resolvido do jeito que os evals reais já comprovaram que
// funciona: reenviando `history` (texto puro) a cada pergunta — o próprio
// modelo re-resolve a entidade a partir da conversa. Não inventa nenhum
// armazenamento novo (sem localStorage, sem persistência entre sessões).

import { useCallback, useRef, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { ConversationContext, IntelligenceEvidence } from "@/features/intelligence/types";

export interface IntelligenceUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface IntelligenceDebugInfo {
  toolsChamadas: { tool: string; params: Record<string, unknown>; sucesso: boolean }[];
  atingiuLimiteDeChamadas: boolean;
  causalidadeCorrigida: boolean;
}

export interface IntelligenceRespostaChat {
  answer: string;
  evidences: IntelligenceEvidence[];
  followUps: string[];
  context: ConversationContext;
  usage: IntelligenceUsage;
  debug: IntelligenceDebugInfo;
}

export interface IntelligenceTurno {
  id: string;
  pergunta: string;
  carregando: boolean;
  startedAt: number;
  resposta?: IntelligenceRespostaChat;
  // Mensagem já segura pra tela (§18/§19 — nunca o texto cru do provider).
  erroSeguro?: string;
  // Só pra debug DEV (§25) — nunca renderizado pro usuário comum.
  erroTecnico?: string;
  latenciaMs?: number;
}

function mensagemSeguraParaErro(status: number | "rede"): string {
  if (status === 429) return "Limite temporário de consultas atingido. Tente novamente em alguns minutos.";
  if (status === 401) return "Sua sessão expirou. Atualize a página e entre novamente.";
  if (status === "rede") return "Não foi possível consultar a Intelligence agora.";
  // 500 (inclui provider indisponível / billing do provider) — nunca expõe
  // o texto cru do erro pro usuário comum.
  return "A Intelligence está temporariamente indisponível.";
}

let contadorId = 0;
function proximoId(): string {
  contadorId += 1;
  return `turno_${contadorId}`;
}

export function useIntelligencePanel() {
  const [aberta, setAberta] = useState(false);
  const [pergunta, setPergunta] = useState("");
  const [turnos, setTurnos] = useState<IntelligenceTurno[]>([]);
  const enviandoRef = useRef(false);

  const abrir = useCallback(() => setAberta(true), []);
  const fechar = useCallback(() => setAberta(false), []);
  const toggle = useCallback(() => setAberta((v) => !v), []);

  const enviar = useCallback(async (textoBruto?: string) => {
    const texto = (textoBruto ?? pergunta).trim();
    if (!texto || enviandoRef.current) return; // §6 — nunca envio duplicado.
    enviandoRef.current = true;
    setPergunta("");

    const historico = turnos
      .filter((t) => t.resposta)
      .flatMap((t) => [
        { role: "user" as const, content: t.pergunta },
        { role: "assistant" as const, content: t.resposta!.answer },
      ]);

    const id = proximoId();
    const startedAt = Date.now();
    setTurnos((prev) => [...prev, { id, pergunta: texto, carregando: true, startedAt }]);

    function concluirComErro(status: number | "rede", tecnico: string) {
      setTurnos((prev) =>
        prev.map((t) => (t.id === id ? { ...t, carregando: false, erroSeguro: mensagemSeguraParaErro(status), erroTecnico: tecnico, latenciaMs: Date.now() - startedAt } : t))
      );
    }

    let token: string | undefined;
    try {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token;
    } catch {
      // segue sem token — cai no ramo "sem sessão" abaixo
    }
    if (!token) {
      concluirComErro(401, "Sem sessão Supabase ativa.");
      enviandoRef.current = false;
      return;
    }

    try {
      const resp = await fetch("/api/intelligence/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: texto, history: historico }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        concluirComErro(resp.status, typeof json?.erro === "string" ? json.erro : `HTTP ${resp.status}`);
        return;
      }
      setTurnos((prev) =>
        prev.map((t) => (t.id === id ? { ...t, carregando: false, resposta: json as IntelligenceRespostaChat, latenciaMs: Date.now() - startedAt } : t))
      );
    } catch {
      concluirComErro("rede", "Falha de rede (fetch lançou exceção).");
    } finally {
      enviandoRef.current = false;
    }
  }, [pergunta, turnos]);

  const enviando = turnos.some((t) => t.carregando);

  return { aberta, abrir, fechar, toggle, pergunta, setPergunta, turnos, enviar, enviando };
}

export type IntelligencePanelController = ReturnType<typeof useIntelligencePanel>;
