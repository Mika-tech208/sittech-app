// Sittech Intelligence V1 — níveis de confiança (§8/§9 da análise
// aprovada). Mapeamento verificado contra o código real de cada motor
// (não é uma convenção nova, é o vocabulário que já existe):
//   - FATO: registro direto (ocorrência aberta, minutos de UMA parada,
//     "sem produção" registrado, realizado oficial manual).
//   - CALCULADO: Performance/Disponibilidade/Qualidade/OEE, capacidade
//     teórica restante, recursosPressionados (mesmo >100%), custo
//     operacional/por peça, custo ocioso/capacidade perdida por parada,
//     sinais de Funcionários (`SinalFuncionario.confianca` é fixo
//     "calculado" no tipo), maioria dos desvios.
//   - ESTIMATIVA: capacidade provável restante / projeção / déficit
//     projetado, `detectarPossivelRestricaoOperacional`, e os dois únicos
//     tipos de desvio com confianca:"estimativa" no código
//     (margem_deteriorou, possivel_restricao_operacional — ver
//     desvios/deteccao.ts).
//   - APROXIMACAO: custo industrial aproximado, margem de processamento
//     (preço em JOIN vivo, nunca snapshot).
//
// Regra central: a IA NUNCA promove um nível pra um mais forte do que o
// motor original atribuiu. Este arquivo só fornece a linguagem
// obrigatória por nível — a checagem "a resposta não promoveu confiança"
// fica pro causality.ts/orchestrator.ts (mesmo tipo de filtro leve).

import type { IntelligenceConfidence } from "@/features/intelligence/types";

export const LINGUAGEM_POR_CONFIANCA: Record<IntelligenceConfidence, { verbos: string[]; exemplo: string }> = {
  FATO: {
    verbos: ["foram registrados", "está aberto desde", "consta o registro de"],
    exemplo: "Foram registrados 3 apontamentos de sem produção nesta janela.",
  },
  CALCULADO: {
    verbos: ["o sistema calcula", "o indicador está em", "está calculado em"],
    exemplo: "A Performance está calculada em 92,3% para a janela atual.",
  },
  ESTIMATIVA: {
    verbos: ["os dados sugerem", "se o comportamento recente se mantiver", "a estimativa aponta"],
    exemplo: "Se o comportamento recente se mantiver, a projeção sugere um déficit de 8.200 peças.",
  },
  APROXIMACAO: {
    verbos: ["aproximadamente", "com base nos dados disponíveis", "em uma aproximação"],
    exemplo: "Com base nos dados disponíveis, a margem de processamento é de aproximadamente 18%.",
  },
};

// Trecho reaproveitável no system prompt do provider (§8/§9) — texto
// único, nunca duplicado em outro lugar do código.
export function instrucaoConfiancaParaPrompt(): string {
  return [
    "Cada evidência que você recebe das tools já vem com um nível de confiança: FATO, CALCULADO, ESTIMATIVA ou APROXIMACAO.",
    "Nunca escreva uma frase mais certa do que o nível permite. Nunca troque ESTIMATIVA ou APROXIMACAO por uma afirmação de fato.",
    "Use exatamente este vocabulário por nível:",
    `- FATO: ${LINGUAGEM_POR_CONFIANCA.FATO.verbos.join(", ")}.`,
    `- CALCULADO: ${LINGUAGEM_POR_CONFIANCA.CALCULADO.verbos.join(", ")}.`,
    `- ESTIMATIVA: ${LINGUAGEM_POR_CONFIANCA.ESTIMATIVA.verbos.join(", ")}.`,
    `- APROXIMACAO: ${LINGUAGEM_POR_CONFIANCA.APROXIMACAO.verbos.join(", ")}.`,
  ].join("\n");
}
