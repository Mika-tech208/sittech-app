// Formatação puramente de apresentação pros Indicadores de Produção —
// nenhuma fórmula aqui (isso é só em calculations.ts). Centralizado pra
// todo card/tabela/gráfico mostrar "N/A" da mesma forma, sem duplicar a
// checagem de null em cada componente.

export function formatarPercentualIndicador(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "N/A";
  return `${pct.toFixed(1)}%`;
}

export function formatarPecas(qtd: number | null | undefined): string {
  if (qtd === null || qtd === undefined || !Number.isFinite(qtd)) return "N/A";
  return Math.round(qtd).toLocaleString("pt-BR");
}

export function formatarMinutos(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return "N/A";
  const arredondado = Math.round(min);
  if (arredondado < 60) return `${arredondado} min`;
  const horas = Math.floor(arredondado / 60);
  const minutosRestantes = arredondado % 60;
  return minutosRestantes === 0 ? `${horas}h` : `${horas}h${minutosRestantes}min`;
}
