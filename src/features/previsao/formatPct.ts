// Percentual em pt-BR com 1 casa ("20,2%"); null = N/A. Sem teto: 105% aparece como 105,0%.
export function formatPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "N/A";
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)}%`;
}
