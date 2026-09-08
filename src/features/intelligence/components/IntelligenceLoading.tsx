"use client";

// §10/§27/§28 da instrução — progresso honesto baseado só em tempo
// decorrido, nunca fingindo que uma tool específica terminou (o frontend
// não recebe eventos em tempo real do endpoint atual — e não vamos criar
// streaming/SSE nesta etapa, §11). Mensagens vão ficando mais "cientes"
// de que a análise é longa conforme o tempo passa, sem alarmar.

import { useEffect, useState } from "react";

const ESTAGIOS: { apósMs: number; texto: string }[] = [
  { apósMs: 0, texto: "Entendendo sua pergunta..." },
  { apósMs: 2000, texto: "Consultando os dados da operação..." },
  { apósMs: 6000, texto: "Analisando produtividade e paradas..." },
  { apósMs: 15000, texto: "Cruzando os dados disponíveis..." },
  { apósMs: 30000, texto: "Esta análise envolve mais de uma fonte de dados." },
];

function estagioAtual(elapsedMs: number): string {
  let texto = ESTAGIOS[0].texto;
  for (const e of ESTAGIOS) {
    if (elapsedMs >= e.apósMs) texto = e.texto;
  }
  return texto;
}

export default function IntelligenceLoading({ startedAt }: { startedAt: number }) {
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const intervalo = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(intervalo);
  }, []);

  const elapsedMs = agora - startedAt;
  const elapsedS = Math.max(0, Math.round(elapsedMs / 1000));

  return (
    <div className="stx-intel-loading" role="status" aria-live="polite">
      <span className="stx-intel-loading-dot" aria-hidden="true" />
      <span className="stx-intel-loading-texto">
        {estagioAtual(elapsedMs)} <span className="stx-intel-loading-tempo">· {elapsedS}s</span>
      </span>
    </div>
  );
}
