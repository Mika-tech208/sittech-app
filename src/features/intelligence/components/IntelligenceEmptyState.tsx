"use client";

// §5/§21 da instrução — painel aberto sem conversa: só título, descrição,
// sugestões e campo de pergunta. Nunca um dashboard aqui dentro — a
// Intelligence é interface de investigação, não uma nova Visão Geral.

import IntelligenceComposer, { IntelligenceComposerHint } from "@/features/intelligence/components/IntelligenceComposer";

const SUGESTOES = [
  "Como está minha fábrica esta semana?",
  "O que merece minha atenção agora?",
  "Estamos no caminho de cumprir a previsão?",
  "Quais foram as principais paradas?",
];

export interface IntelligenceEmptyStateProps {
  pergunta: string;
  onChangePergunta: (v: string) => void;
  onEnviar: (texto?: string) => void;
  enviando: boolean;
}

export default function IntelligenceEmptyState({ pergunta, onChangePergunta, onEnviar, enviando }: IntelligenceEmptyStateProps) {
  return (
    <div className="stx-intel-empty">
      <p className="stx-intel-empty-titulo">O que você quer entender da fábrica?</p>
      <p className="stx-intel-empty-sub">Consulte produção, previsão, paradas e desvios usando os dados do Sittech.</p>

      <div className="stx-intel-suggestions">
        {SUGESTOES.map((s) => (
          <button key={s} type="button" className="stx-intel-suggestion" onClick={() => onEnviar(s)} disabled={enviando}>
            {s}
          </button>
        ))}
      </div>

      <IntelligenceComposer valor={pergunta} onChange={onChangePergunta} onEnviar={() => onEnviar()} enviando={enviando} autoFocus />
      <IntelligenceComposerHint />
    </div>
  );
}
