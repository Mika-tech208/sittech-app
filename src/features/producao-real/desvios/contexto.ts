// Desvios V1 — agrupamento por contexto de comparação (§6, aprovado).
// Produto+operação (a etapa) sempre iguais dentro de um grupo; máquina é
// obrigatoriamente igual para "desvio de máquina" e agregada (null) para
// "desvio de etapa" — os dois nunca se misturam silenciosamente porque
// são produzidos por funções diferentes, cada uma com seu próprio campo
// `maquinaId` explícito no ContextoDesvio resultante.

import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import type { ContextoDesvio } from "@/features/producao-real/desvios/types";

export interface GrupoContexto {
  contexto: ContextoDesvio;
  chave: string;
  apontamentos: ApontamentoIndicador[];
}

function elegivel(ap: ApontamentoIndicador): boolean {
  return ap.status === "produzindo" && ap.produtoId !== null && ap.operacaoId !== null;
}

// Desvio de MÁQUINA: produto + operação + máquina iguais.
export function agruparPorContextoMaquina(apontamentos: ApontamentoIndicador[]): GrupoContexto[] {
  const porChave = new Map<string, GrupoContexto>();
  apontamentos.filter(elegivel).forEach((ap) => {
    const chave = `${ap.produtoId}::${ap.operacaoId}::${ap.maquinaId}`;
    const atual = porChave.get(chave);
    if (atual) atual.apontamentos.push(ap);
    else
      porChave.set(chave, {
        chave,
        contexto: {
          produtoId: ap.produtoId, produtoNome: ap.produtoNome,
          operacaoId: ap.operacaoId, operacaoNome: ap.operacaoNome,
          maquinaId: ap.maquinaId, maquinaNome: ap.maquinaNome,
        },
        apontamentos: [ap],
      });
  });
  return Array.from(porChave.values());
}

// Desvio de ETAPA: produto + operação iguais, máquina agregada
// (contextos.maquinaId = null — nunca confundir com "desvio de máquina").
export function agruparPorContextoEtapa(apontamentos: ApontamentoIndicador[]): GrupoContexto[] {
  const porChave = new Map<string, GrupoContexto>();
  apontamentos.filter(elegivel).forEach((ap) => {
    const chave = `${ap.produtoId}::${ap.operacaoId}`;
    const atual = porChave.get(chave);
    if (atual) atual.apontamentos.push(ap);
    else
      porChave.set(chave, {
        chave,
        contexto: {
          produtoId: ap.produtoId, produtoNome: ap.produtoNome,
          operacaoId: ap.operacaoId, operacaoNome: ap.operacaoNome,
          maquinaId: null, maquinaNome: null,
        },
        apontamentos: [ap],
      });
  });
  return Array.from(porChave.values());
}

export function rotuloContexto(c: ContextoDesvio): string {
  const partes = [c.produtoNome, c.operacaoNome, c.maquinaNome].filter((v): v is string => !!v);
  return partes.join(" — ") || "Contexto sem identificação";
}
