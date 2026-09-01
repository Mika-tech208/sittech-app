// Fórmula de "quanto preciso faturar pra bater a margem desejada", exibida
// no painel "Meta de faturamento" da Previsão Semanal e usada pelo card
// "Meta semanal" do menu lateral. Extraída como função pura para reuso sem
// duplicar a fórmula entre o app legado e as novas rotas.

export interface MetaFaturamento {
  metaInvalida: boolean;
  faturamentoMensalNecessario: number;
  faturamentoSemanalNecessario: number;
  impostoMeta: number;
  lucroMeta: number;
}

const SEMANAS_POR_MES = 52 / 12;
const ALIQUOTA_IMPOSTO = 0.09;

export function calcularMetaFaturamento(custoTotalMensal: number, margemDesejadaPct: number): MetaFaturamento {
  const margemDesejadaNum = margemDesejadaPct / 100;
  const divisorMeta = 1 - ALIQUOTA_IMPOSTO - margemDesejadaNum;
  const metaInvalida = divisorMeta <= 0;
  const faturamentoMensalNecessario = !metaInvalida ? custoTotalMensal / divisorMeta : 0;
  const faturamentoSemanalNecessario = faturamentoMensalNecessario / SEMANAS_POR_MES;
  const impostoMeta = faturamentoMensalNecessario * ALIQUOTA_IMPOSTO;
  const lucroMeta = faturamentoMensalNecessario - impostoMeta - custoTotalMensal;
  return { metaInvalida, faturamentoMensalNecessario, faturamentoSemanalNecessario, impostoMeta, lucroMeta };
}
