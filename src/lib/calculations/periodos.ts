export function duracaoPeriodoHorasCalc(inicio: string, fim: string): number {
  if (!inicio || !fim) return 0;
  const [h1, m1] = inicio.split(":").map(Number);
  const [h2, m2] = fim.split(":").map(Number);
  if ([h1, m1, h2, m2].some((n) => Number.isNaN(n))) return 0;
  const minutos = h2 * 60 + m2 - (h1 * 60 + m1);
  return minutos > 0 ? minutos / 60 : 0;
}
