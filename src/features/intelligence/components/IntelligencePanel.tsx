"use client";

// Sittech Intelligence V1 — UI/UX. Painel lateral (desktop) / sheet
// full-screen (mobile/tablet, §2/§3 da instrução). Não redireciona de
// página, não dispara consulta nenhuma sozinho ao abrir (§23 — só quando o
// usuário pergunta ou clica numa sugestão). Acessibilidade (§26): foco vai
// pro painel ao abrir e volta pro gatilho ao fechar, Escape fecha, foco
// preso dentro do painel enquanto aberto (focus trap simples via Tab).

import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { X } from "lucide-react";
import IntelligenceEmptyState from "@/features/intelligence/components/IntelligenceEmptyState";
import IntelligenceComposer, { IntelligenceComposerHint } from "@/features/intelligence/components/IntelligenceComposer";
import IntelligenceInteraction from "@/features/intelligence/components/IntelligenceInteraction";
import type { IntelligencePanelController } from "@/features/intelligence/useIntelligencePanel";

const SELETOR_FOCAVEL = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

export default function IntelligencePanel({ controller }: { controller: IntelligencePanelController }) {
  const { aberta, fechar, pergunta, setPergunta, turnos, enviar, enviando } = controller;
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const focoAnteriorRef = useRef<Element | null>(null);

  // Abrir: guarda o foco atual (o próprio botão-gatilho) e move o foco pro
  // painel. Fechar/desmontar: devolve o foco pra onde estava.
  useEffect(() => {
    if (!aberta) return;
    focoAnteriorRef.current = document.activeElement;
    panelRef.current?.focus();
    return () => {
      if (focoAnteriorRef.current instanceof HTMLElement) focoAnteriorRef.current.focus();
    };
  }, [aberta]);

  // Sempre que uma nova interação é adicionada, rola pro fim.
  useEffect(() => {
    if (!bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [turnos.length]);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      fechar();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const focaveis = Array.from(panelRef.current.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)).filter((el) => !el.hasAttribute("disabled"));
    if (focaveis.length === 0) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  }

  if (!aberta) return null;

  return (
    <>
      {/* Não escurece a tela (§2 — usuário continua enxergando o resto do
          software atrás); só fecha o painel ao clicar fora dele. */}
      <div className="stx-intel-backdrop" onClick={fechar} aria-hidden="true" />
      <div
        ref={panelRef}
        className="stx-intel-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Sittech Intelligence"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="stx-intel-header">
          <div className="stx-intel-header-marca">
            <span className="stx-intel-header-ring"><span className="stx-intel-header-dot" /></span>
            <p className="stx-intel-header-titulo">Intelligence</p>
          </div>
          <button type="button" className="stx-intel-close" onClick={fechar} aria-label="Fechar Intelligence">
            <X size={18} />
          </button>
        </div>

        {turnos.length === 0 ? (
          <div className="stx-intel-body" ref={bodyRef}>
            <IntelligenceEmptyState pergunta={pergunta} onChangePergunta={setPergunta} onEnviar={enviar} enviando={enviando} />
          </div>
        ) : (
          <>
            <div className="stx-intel-body" ref={bodyRef}>
              {turnos.map((turno) => (
                <IntelligenceInteraction key={turno.id} turno={turno} onFollowUp={(texto) => enviar(texto)} />
              ))}
            </div>
            <div className="stx-intel-footer">
              <IntelligenceComposer valor={pergunta} onChange={setPergunta} onEnviar={() => enviar()} enviando={enviando} />
              <IntelligenceComposerHint />
            </div>
          </>
        )}
      </div>
    </>
  );
}
