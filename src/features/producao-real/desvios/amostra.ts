// Desvios V1 — amostra mínima (§5, aprovado). Antes de qualquer desvio
// comparativo por contexto: >=3 períodos válidos em cada janela e >=60
// min produtivos agregados em cada janela; Qualidade/Refugo exigem
// adicionalmente volume produzido >= 1 meta-período MÉDIA do contexto
// (nunca um número fixo de peças). Se não cumprir, NÃO gerar alerta —
// o chamador deve checar `suficiente` antes de emitir qualquer desvio.

import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import type { AvaliacaoAmostra } from "@/features/producao-real/desvios/types";
import { AMOSTRA_MINIMA_MINUTOS_PRODUTIVOS, AMOSTRA_MINIMA_PERIODOS, AMOSTRA_MINIMA_QUALIDADE_MULTIPLO_META } from "@/features/producao-real/desvios/thresholds";

function minutosProdutivos(apontamentos: ApontamentoIndicador[]): number {
  return apontamentos.reduce((s, ap) => s + ap.duracaoPeriodoHorasVigente * 60, 0);
}

function mediaMeta(apontamentos: ApontamentoIndicador[]): number | null {
  const metas = apontamentos.map((ap) => ap.metaPeriodoVigente).filter((v): v is number => v !== null && v > 0);
  if (metas.length === 0) return null;
  return metas.reduce((s, v) => s + v, 0) / metas.length;
}

export function avaliarAmostra(
  apontamentosAtual: ApontamentoIndicador[],
  apontamentosReferencia: ApontamentoIndicador[],
  exigirVolumeQualidade: boolean
): AvaliacaoAmostra {
  const produzindoAtual = apontamentosAtual.filter((ap) => ap.status === "produzindo");
  const produzindoReferencia = apontamentosReferencia.filter((ap) => ap.status === "produzindo");

  const periodosJanelaAtual = produzindoAtual.length;
  const periodosJanelaReferencia = produzindoReferencia.length;
  const minutosProdutivosJanelaAtual = minutosProdutivos(produzindoAtual);
  const minutosProdutivosJanelaReferencia = minutosProdutivos(produzindoReferencia);

  const volumeProduzidoJanelaAtual = exigirVolumeQualidade
    ? produzindoAtual.reduce((s, ap) => s + ap.quantidadeProduzida, 0)
    : null;
  const metaPeriodoMediaContexto = exigirVolumeQualidade ? mediaMeta([...produzindoAtual, ...produzindoReferencia]) : null;

  const motivos: string[] = [];
  if (periodosJanelaAtual < AMOSTRA_MINIMA_PERIODOS) motivos.push(`menos de ${AMOSTRA_MINIMA_PERIODOS} períodos na janela atual (${periodosJanelaAtual})`);
  if (periodosJanelaReferencia < AMOSTRA_MINIMA_PERIODOS) motivos.push(`menos de ${AMOSTRA_MINIMA_PERIODOS} períodos na referência (${periodosJanelaReferencia})`);
  if (minutosProdutivosJanelaAtual < AMOSTRA_MINIMA_MINUTOS_PRODUTIVOS) motivos.push(`menos de ${AMOSTRA_MINIMA_MINUTOS_PRODUTIVOS} min produtivos na janela atual`);
  if (minutosProdutivosJanelaReferencia < AMOSTRA_MINIMA_MINUTOS_PRODUTIVOS) motivos.push(`menos de ${AMOSTRA_MINIMA_MINUTOS_PRODUTIVOS} min produtivos na referência`);

  if (exigirVolumeQualidade) {
    if (metaPeriodoMediaContexto === null) {
      motivos.push("meta do contexto desconhecida — sem base pra exigir volume mínimo");
    } else if ((volumeProduzidoJanelaAtual ?? 0) < metaPeriodoMediaContexto * AMOSTRA_MINIMA_QUALIDADE_MULTIPLO_META) {
      motivos.push(`volume produzido abaixo de ${AMOSTRA_MINIMA_QUALIDADE_MULTIPLO_META}x a meta-período média do contexto`);
    }
  }

  return {
    suficiente: motivos.length === 0,
    periodosJanelaAtual,
    periodosJanelaReferencia,
    minutosProdutivosJanelaAtual,
    minutosProdutivosJanelaReferencia,
    volumeProduzidoJanelaAtual,
    metaPeriodoMediaContexto,
    motivoInsuficiencia: motivos.length > 0 ? motivos.join("; ") : null,
  };
}
