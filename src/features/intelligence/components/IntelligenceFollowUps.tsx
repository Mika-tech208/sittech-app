"use client";

// §16 da instrução — sugestões de follow-up como chips discretos (máx. 3).
// No contrato atual do endpoint `followUps` vem sempre `[]` (as sugestões
// de continuação hoje vêm embutidas no texto da resposta, não estruturadas
// — ver comentário em route.ts) — este componente já existe pronto pra
// quando isso mudar, mas não renderiza nada enquanto o array vier vazio
// (não alteramos o schema do endpoint nesta etapa).

export default function IntelligenceFollowUps({ followUps, onEscolher }: { followUps: string[]; onEscolher: (texto: string) => void }) {
  if (followUps.length === 0) return null;
  return (
    <div className="stx-intel-followups">
      {followUps.slice(0, 3).map((texto, i) => (
        <button key={i} type="button" className="stx-intel-chip" onClick={() => onEscolher(texto)}>
          {texto}
        </button>
      ))}
    </div>
  );
}
