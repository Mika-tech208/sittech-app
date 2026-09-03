// Funcionários V1 — amostra mínima (§5/§6, aprovado). Mesma disciplina de
// Desvios V1 ("se não cumprir, NÃO gerar sinal"), com thresholds próprios
// e mais rígidos, e avaliada em DOIS grupos separados (funcionário /
// pares) — nunca misturados.

import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import type { AmostraSimples } from "@/features/producao-real/funcionarios/types";
import { AMOSTRA_MINIMA_QUALIDADE_MULTIPLO_META } from "@/features/producao-real/funcionarios/thresholds";

function minutosProdutivos(apontamentos: ApontamentoIndicador[]): number {
  return apontamentos.reduce((s, ap) => s + ap.duracaoPeriodoHorasVigente * 60, 0);
}

export function avaliarAmostraSimples(apontamentos: ApontamentoIndicador[], minPeriodos: number, minMinutos: number): AmostraSimples {
  const produzindo = apontamentos.filter((ap) => ap.status === "produzindo");
  const periodos = produzindo.length;
  const minutos = minutosProdutivos(produzindo);
  const motivos: string[] = [];
  if (periodos < minPeriodos) motivos.push(`menos de ${minPeriodos} períodos (${periodos})`);
  if (minutos < minMinutos) motivos.push(`menos de ${minMinutos} min produtivos`);
  return {
    suficiente: motivos.length === 0,
    periodos,
    minutosProdutivos: minutos,
    motivoInsuficiencia: motivos.length > 0 ? motivos.join("; ") : null,
  };
}

function mediaMeta(apontamentos: ApontamentoIndicador[]): number | null {
  const metas = apontamentos.map((ap) => ap.metaPeriodoVigente).filter((v): v is number => v !== null && v > 0);
  if (metas.length === 0) return null;
  return metas.reduce((s, v) => s + v, 0) / metas.length;
}

// Proteção adicional de volume pra Qualidade/Refugo (§8, reaproveita a
// mesma disciplina de Desvios V1) — aplicada POR CIMA da amostra simples,
// nunca substituindo-a.
export function avaliarAmostraQualidade(apontamentos: ApontamentoIndicador[], minPeriodos: number, minMinutos: number): AmostraSimples {
  const base = avaliarAmostraSimples(apontamentos, minPeriodos, minMinutos);
  const produzindo = apontamentos.filter((ap) => ap.status === "produzindo");
  const volumeProduzido = produzindo.reduce((s, ap) => s + ap.quantidadeProduzida, 0);
  const metaMedia = mediaMeta(produzindo);

  const motivosVolume: string[] = [];
  if (metaMedia === null) {
    motivosVolume.push("meta do contexto desconhecida — sem base pra exigir volume mínimo");
  } else if (volumeProduzido < metaMedia * AMOSTRA_MINIMA_QUALIDADE_MULTIPLO_META) {
    motivosVolume.push(`volume produzido abaixo de ${AMOSTRA_MINIMA_QUALIDADE_MULTIPLO_META}x a meta-período média do contexto`);
  }

  const todosMotivos = [...(base.motivoInsuficiencia ? [base.motivoInsuficiencia] : []), ...motivosVolume];
  return {
    suficiente: base.suficiente && motivosVolume.length === 0,
    periodos: base.periodos,
    minutosProdutivos: base.minutosProdutivos,
    motivoInsuficiencia: todosMotivos.length > 0 ? todosMotivos.join("; ") : null,
  };
}
