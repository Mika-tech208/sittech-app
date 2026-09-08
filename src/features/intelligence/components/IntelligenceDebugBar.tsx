// §25 da instrução — modo técnico discreto, só em DEV (gate por
// NODE_ENV, igual ao harness em /dev/intelligence). Mostra tools/tokens/
// latência/evidence count. O endpoint não devolve o nome do modelo usado
// no payload da resposta (route.ts só devolve answer/evidences/followUps/
// context/usage/debug — ver types) e esta etapa é proibida de alterar
// schemas, então "modelo" não aparece aqui; nunca inventamos um campo novo
// pra contornar isso. Nunca mostra segredo nenhum (a própria resposta já
// não carrega nada sensível).

import type { IntelligenceRespostaChat } from "@/features/intelligence/useIntelligencePanel";

export default function IntelligenceDebugBar({ resposta, latenciaMs, erroTecnico }: { resposta?: IntelligenceRespostaChat; latenciaMs?: number; erroTecnico?: string }) {
  if (process.env.NODE_ENV === "production") return null;
  if (!resposta && !erroTecnico) return null;

  return (
    <p className="stx-intel-debugbar">
      DEV·
      {resposta && (
        <>
          {" "}tools {resposta.debug.toolsChamadas.length} · evidências {resposta.evidences.length} · tokens{" "}
          {resposta.usage.inputTokens}
          {typeof resposta.usage.cachedInputTokens === "number" ? ` (${resposta.usage.cachedInputTokens} cache)` : ""} in /{" "}
          {resposta.usage.outputTokens} out
          {resposta.debug.atingiuLimiteDeChamadas && " · limite de tools atingido"}
          {resposta.debug.causalidadeCorrigida && " · causalidade corrigida"}
        </>
      )}
      {typeof latenciaMs === "number" && ` · ${(latenciaMs / 1000).toFixed(1)}s`}
      {erroTecnico && ` · erro técnico: ${erroTecnico}`}
    </p>
  );
}
