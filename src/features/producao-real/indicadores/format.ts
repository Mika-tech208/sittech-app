// Formatação puramente de apresentação pros Indicadores de Produção (e
// pro Motor Econômico, que reaproveita este mesmo arquivo) — nenhuma
// fórmula aqui (isso é só em calculations.ts/economico.ts). Centralizado
// pra todo card/tabela/gráfico mostrar "N/A" da mesma forma, sem duplicar
// a checagem de null em cada componente.

import { formatBRL } from "@/lib/format";

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

// formatBRL (src/lib/format.ts) trata null/undefined como R$ 0,00 — errado
// pra semântica "N/A" do Motor Econômico (0 real e "não calculável" são
// coisas diferentes). Este wrapper só existe pra essa distinção; nenhuma
// fórmula, nenhuma mudança em formatBRL.
export function formatarBRLIndicador(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "N/A";
  return formatBRL(v);
}
