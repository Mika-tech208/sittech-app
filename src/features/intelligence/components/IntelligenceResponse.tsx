// §8 da instrução — a resposta aparece primeiro, texto legível, sem
// recalcular/reformular números. O único tratamento aqui é visual: o
// system prompt do core já escreve `**assim**` pra destacar termos: isso
// só troca `**texto**` por <strong>texto</strong> na tela — a string
// original (com os asteriscos) continua sendo o que é guardado em
// `turno.resposta.answer` e reenviado no histórico da próxima pergunta.
// Nunca usa dangerouslySetInnerHTML — só split + JSX, então nada de HTML
// vindo da resposta é interpretado como marcação.

import type { ReactNode } from "react";

function renderComNegrito(texto: string): ReactNode[] {
  const partes = texto.split(/(\*\*[^*]+\*\*)/g);
  return partes.map((parte, i) => {
    if (parte.startsWith("**") && parte.endsWith("**") && parte.length > 4) {
      return <strong key={i}>{parte.slice(2, -2)}</strong>;
    }
    return parte;
  });
}

export default function IntelligenceResponse({ texto }: { texto: string }) {
  const paragrafos = texto.split(/\n{2,}/);
  return (
    <div className="stx-intel-resposta">
      {paragrafos.map((p, i) => (
        <p key={i} className="stx-intel-resposta-paragrafo">
          {renderComNegrito(p)}
        </p>
      ))}
    </div>
  );
}
