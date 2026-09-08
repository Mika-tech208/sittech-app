"use client";

// §6 da instrução — campo de pergunta. Enter envia, Shift+Enter quebra
// linha, botão de enviar discreto, sem permitir envio duplicado (input
// continua visível durante o processamento, mas o botão e o Enter ficam
// desabilitados enquanto `enviando` for true).

import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";

export interface IntelligenceComposerProps {
  valor: string;
  onChange: (v: string) => void;
  onEnviar: () => void;
  enviando: boolean;
  autoFocus?: boolean;
}

export default function IntelligenceComposer({ valor, onChange, onEnviar, enviando, autoFocus }: IntelligenceComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (valor.trim() && !enviando) onEnviar();
    }
  }

  return (
    <div className="stx-intel-composer">
      <textarea
        ref={ref}
        className="stx-intel-composer-input"
        placeholder="Pergunte sobre sua operação..."
        value={valor}
        maxLength={2000}
        rows={1}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Pergunta para a Sittech Intelligence"
        autoFocus={autoFocus}
      />
      <button
        type="button"
        className="stx-intel-composer-send"
        onClick={onEnviar}
        disabled={!valor.trim() || enviando}
        aria-label="Enviar pergunta"
        title="Enviar (Enter)"
      >
        <ArrowUp size={16} />
      </button>
    </div>
  );
}

export function IntelligenceComposerHint() {
  return <p className="stx-intel-composer-hint">Enter envia · Shift+Enter quebra linha</p>;
}
