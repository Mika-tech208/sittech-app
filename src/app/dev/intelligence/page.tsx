"use client";

// Sittech Intelligence V1 — harness mínimo de DEV (§29 da instrução).
// NÃO é o painel lateral final — só uma superfície pra testar o core
// (endpoint + tools + evidências + confiança + usage) sem gastar tempo em
// design. Desabilitada por ambiente: em produção esta página nunca
// renderiza (notFound()), mesmo que o código seja publicado por engano —
// defesa em profundidade além do gate de permissão normal.

import { notFound } from "next/navigation";
import { useState } from "react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { temPermissao } from "@/lib/permissoes";
import { supabase } from "@/services/supabase-client";
import type { IntelligenceEvidence } from "@/features/intelligence/types";

if (process.env.NODE_ENV === "production") {
  notFound();
}

interface RespostaChat {
  answer: string;
  evidences: IntelligenceEvidence[];
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  debug: { toolsChamadas: { tool: string; params: Record<string, unknown>; sucesso: boolean }[]; atingiuLimiteDeChamadas: boolean; causalidadeCorrigida: boolean };
  erro?: string;
}

interface Turno {
  pergunta: string;
  resposta?: RespostaChat;
  carregando?: boolean;
}

export default function DevIntelligencePage() {
  const auth = useAuthSession();
  const [pergunta, setPergunta] = useState("");
  const [turnos, setTurnos] = useState<Turno[]>([]);

  if (auth.restaurandoSessao) return <p style={{ padding: 20, fontFamily: "monospace" }}>Carregando…</p>;
  if (!auth.autenticado) return <p style={{ padding: 20, fontFamily: "monospace" }}>Faça login no app normal primeiro, depois volte pra esta página.</p>;
  if (!temPermissao(auth.usuarioLogado, "producao_real_historico")) return <p style={{ padding: 20, fontFamily: "monospace" }}>Sem permissão producao_real_historico.</p>;

  async function enviar() {
    const texto = pergunta.trim();
    if (!texto) return;
    setPergunta("");
    const historico = turnos.filter((t) => t.resposta).flatMap((t) => [{ role: "user" as const, content: t.pergunta }, { role: "assistant" as const, content: t.resposta!.answer }]);
    setTurnos((prev) => [...prev, { pergunta: texto, carregando: true }]);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setTurnos((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, carregando: false, resposta: { answer: "", evidences: [], usage: { inputTokens: 0, outputTokens: 0 }, debug: { toolsChamadas: [], atingiuLimiteDeChamadas: false, causalidadeCorrigida: false }, erro: "Sem sessão." } } : t)));
      return;
    }

    try {
      const resp = await fetch("/api/intelligence/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: texto, history: historico }),
      });
      const json = await resp.json();
      setTurnos((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, carregando: false, resposta: resp.ok ? json : { answer: "", evidences: [], usage: { inputTokens: 0, outputTokens: 0 }, debug: { toolsChamadas: [], atingiuLimiteDeChamadas: false, causalidadeCorrigida: false }, erro: json.erro || "Erro desconhecido." } } : t)));
    } catch {
      setTurnos((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, carregando: false, resposta: { answer: "", evidences: [], usage: { inputTokens: 0, outputTokens: 0 }, debug: { toolsChamadas: [], atingiuLimiteDeChamadas: false, causalidadeCorrigida: false }, erro: "Falha de rede." } } : t)));
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: "monospace", maxWidth: 900, margin: "0 auto" }}>
      <h1>Sittech Intelligence — harness DEV (não é UI final)</h1>
      <p style={{ opacity: 0.7 }}>Logado como {auth.usuarioLogado?.nome}. Esta página não existe em produção.</p>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input
          style={{ flex: 1, padding: 8 }}
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enviar()}
          placeholder="Ex.: Como está minha fábrica esta semana?"
        />
        <button onClick={enviar}>Enviar</button>
      </div>

      {turnos.map((t, i) => (
        <div key={i} style={{ border: "1px solid #444", padding: 12, marginTop: 12 }}>
          <p><strong>Pergunta:</strong> {t.pergunta}</p>
          {t.carregando && <p>Consultando…</p>}
          {t.resposta?.erro && <p style={{ color: "red" }}>Erro: {t.resposta.erro}</p>}
          {t.resposta && !t.resposta.erro && (
            <>
              <p><strong>Resposta:</strong> {t.resposta.answer}</p>
              <details open>
                <summary>Tools chamadas ({t.resposta.debug.toolsChamadas.length})</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(t.resposta.debug.toolsChamadas, null, 2)}</pre>
              </details>
              <details>
                <summary>Evidências ({t.resposta.evidences.length})</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(t.resposta.evidences, null, 2)}</pre>
              </details>
              <p style={{ fontSize: 12, opacity: 0.7 }}>
                Tokens: {t.resposta.usage.inputTokens} entrada / {t.resposta.usage.outputTokens} saída
                {t.resposta.debug.atingiuLimiteDeChamadas && " · atingiu limite de 4 tools"}
                {t.resposta.debug.causalidadeCorrigida && " · causalidade corrigida"}
              </p>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
