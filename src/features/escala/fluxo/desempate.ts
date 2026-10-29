// DESEMPATE da escolha da PESSOA para um posto já decidido (etapa 2). Pura. A decisão do POSTO é econômica (valor marginal do posto); a pessoa é escolhida SÓ por:
// hard constraints (candidato que viola já foi descartado), folga de revezamento no bloco, equilíbrio de exposição na operação de destino, churn, continuidade e — por último — id.
// Nenhuma produtividade individual; a ordem do array NUNCA decide.
export interface CandidatoMovimento {
  /** ganho de lucro projetado do POSTO destino (R$), comparado com tolerância */
  ganho: number;
  /** operações do catálogo ainda NÃO expostas à pessoa no bloco, depois da movimentação (maior = mais folga) */
  folgaRevezamento: number;
  /** ContadoresEquidade.desvioOperacao(pessoa, operação de destino) com o histórico gravado: MENOR = mais abaixo da parcela justa = preferido */
  desvioExposicao: number;
  /** linhas pessoa/posto alteradas vs. o plano atual depois da movimentação (menor = preferido) */
  churn: number;
  /** 1 se a pessoa mantém a mesma máquina do período anterior (continuidade) */
  continuidade: number;
  /** último desempate determinístico */
  id: string;
}

export const TOLERANCIA_GANHO_RS = 0.01;

/** < 0 ⇒ `a` é preferido. Ordem: ganho (± tolerância) → folga de revezamento → desvio de exposição → churn → continuidade → id. */
export function compararMovimentos(a: CandidatoMovimento, b: CandidatoMovimento, tolerancia = TOLERANCIA_GANHO_RS): number {
  if (Math.abs(a.ganho - b.ganho) > tolerancia) return a.ganho > b.ganho ? -1 : 1;
  if (a.folgaRevezamento !== b.folgaRevezamento) return a.folgaRevezamento > b.folgaRevezamento ? -1 : 1;
  if (Math.abs(a.desvioExposicao - b.desvioExposicao) > 1e-9) return a.desvioExposicao < b.desvioExposicao ? -1 : 1;
  if (a.churn !== b.churn) return a.churn < b.churn ? -1 : 1;
  if (a.continuidade !== b.continuidade) return a.continuidade > b.continuidade ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Melhor candidato, independente da ordem do array. */
export function melhorMovimento<T extends CandidatoMovimento>(lista: T[], tolerancia = TOLERANCIA_GANHO_RS): T | null {
  return lista.length === 0 ? null : [...lista].sort((x, y) => compararMovimentos(x, y, tolerancia))[0];
}
