"use client";

// Sittech Intelligence V1 — gatilho global, redesign "Estúdio" (ver
// design_handoff_sittech_estudio §4B: pill com anel+ponto pulsante, rótulo
// "Intelligence" e chip "⌘K"). O atalho de teclado é real (não só
// decorativo) — abre/fecha o painel de qualquer tela, mas só quando o
// usuário tem a permissão mínima (mesmo gate do botão). Continua dono da
// instância do painel: TopBarActions só monta este componente.

import { useEffect } from "react";
import { temPermissao } from "@/lib/permissoes";
import IntelligencePanel from "@/features/intelligence/components/IntelligencePanel";
import { useIntelligencePanel } from "@/features/intelligence/useIntelligencePanel";

export interface IntelligenceTriggerProps {
  usuarioLogado: { papel: "admin" | "usuario"; permissoes?: string[] } | null;
}

export default function IntelligenceTrigger({ usuarioLogado }: IntelligenceTriggerProps) {
  const controller = useIntelligencePanel();
  const permitido = temPermissao(usuarioLogado, "producao_real_historico");

  useEffect(() => {
    if (!permitido) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        controller.toggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permitido]);

  if (!permitido) return null;

  return (
    <>
      <button type="button" className="stx-intel-trigger" onClick={controller.toggle} aria-haspopup="dialog" aria-expanded={controller.aberta}>
        <span className="stx-intel-trigger-ring"><span className="stx-intel-trigger-dot" /></span>
        <span className="stx-intel-trigger-label">Intelligence</span>
        <span className="stx-intel-trigger-kbd">⌘K</span>
      </button>
      <IntelligencePanel controller={controller} />
    </>
  );
}
