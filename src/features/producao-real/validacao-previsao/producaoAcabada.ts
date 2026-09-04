// Validação da Previsão V1 — produção acabada observada (§2/§4,
// aprovado). Reaproveita EXATAMENTE a regra já oficial de Indicadores
// V1/Motor Econômico V1/Desvios V1/Funcionários V1: good SOMENTE da
// última etapa do roteiro (isUltimaEtapa === true) — nunca soma etapa
// intermediária, nunca recalcula a fórmula.

import { calcularQuantidadeBoaApontamento, type ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";

// Mapa produtoId -> peças boas da última etapa, na janela informada
// (o chamador já filtra por data antes de passar aqui — nenhuma lógica
// de janela mora nesta função).
export function calcularProducaoAcabadaObservadaPorProduto(apontamentos: ApontamentoIndicador[]): Map<string, number> {
  const mapa = new Map<string, number>();
  apontamentos
    .filter((ap) => ap.status === "produzindo" && ap.isUltimaEtapa === true && ap.produtoId !== null)
    .forEach((ap) => {
      const produtoId = ap.produtoId as string;
      const boa = calcularQuantidadeBoaApontamento(ap);
      mapa.set(produtoId, (mapa.get(produtoId) || 0) + boa);
    });
  return mapa;
}

// Divergência (§2, aprovado) — nunca soma A+B, só compara. Positivo =
// Produção Real observou mais do que foi lançado manualmente.
export function calcularDivergenciaRealizado(producaoAcabadaObservada: number, realizadoOficial: number): number {
  return producaoAcabadaObservada - realizadoOficial;
}

// Falta operacional (§3, aprovado) — SEMPRE usa produção acabada
// observada, NUNCA o realizado manual. Motivo documentado na instrução:
// a projeção precisa do que fisicamente já ficou pronto.
export function calcularFaltaOperacional(previsto: number, producaoAcabadaObservada: number): number {
  return Math.max(0, previsto - producaoAcabadaObservada);
}
