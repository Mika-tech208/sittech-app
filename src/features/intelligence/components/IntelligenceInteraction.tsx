"use client";

// §7/§20 da instrução — uma interação = pergunta → resposta → evidências →
// tool trace → follow-ups, claramente separada da próxima por whitespace
// (não por várias bordas empilhadas). Nada de bolha de WhatsApp — a
// pergunta tem tratamento leve (rótulo pequeno + texto), a resposta parece
// análise de sistema.

import IntelligenceLoading from "@/features/intelligence/components/IntelligenceLoading";
import IntelligenceError from "@/features/intelligence/components/IntelligenceError";
import IntelligenceResponse from "@/features/intelligence/components/IntelligenceResponse";
import IntelligenceEvidenceList from "@/features/intelligence/components/IntelligenceEvidenceList";
import IntelligenceToolTrace from "@/features/intelligence/components/IntelligenceToolTrace";
import IntelligenceFollowUps from "@/features/intelligence/components/IntelligenceFollowUps";
import IntelligenceDebugBar from "@/features/intelligence/components/IntelligenceDebugBar";
import type { IntelligenceTurno } from "@/features/intelligence/useIntelligencePanel";

export default function IntelligenceInteraction({ turno, onFollowUp }: { turno: IntelligenceTurno; onFollowUp: (texto: string) => void }) {
  return (
    <div className="stx-intel-interaction">
      <p className="stx-intel-pergunta">{turno.pergunta}</p>

      {turno.carregando && <IntelligenceLoading startedAt={turno.startedAt} />}
      {turno.erroSeguro && <IntelligenceError mensagem={turno.erroSeguro} />}

      {turno.resposta && (
        <>
          <IntelligenceResponse texto={turno.resposta.answer} />
          <IntelligenceEvidenceList evidencias={turno.resposta.evidences} />
          <IntelligenceToolTrace debug={turno.resposta.debug} />
          <IntelligenceFollowUps followUps={turno.resposta.followUps} onEscolher={onFollowUp} />
        </>
      )}

      <IntelligenceDebugBar resposta={turno.resposta} latenciaMs={turno.latenciaMs} erroTecnico={turno.erroTecnico} />
    </div>
  );
}
