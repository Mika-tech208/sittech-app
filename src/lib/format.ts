import { MESES_ABREV } from "@/lib/constants";

// Estado de módulo (fora de qualquer componente) para que formatBRL leia o
// modo privado sem esperar o próximo re-render — mesmo comportamento do
// sistema original.
let modoPrivadoAtivo = false;

export function setModoPrivadoAtivo(v: boolean): void {
  modoPrivadoAtivo = v;
}

export function formatBRL(v: number | string | undefined | null): string {
  if (modoPrivadoAtivo) return "R$ ••••";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);
}

export function toNumber(v: unknown): number {
  return Number(String(v ?? "0").replace(",", "."));
}

// Quantidade (peças/unidades), sem símbolo de moeda — separado de
// formatBRL de propósito, pra nunca confundir R$ com peças na tela.
export function formatQtd(v: number | string | undefined | null): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(v) || 0);
}

export function monthLabelShort(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MESES_ABREV[m - 1]}/${String(y).slice(2)}`;
}

// Cores de alerta pra números críticos (margem, lucro/hora) — usadas em
// vários domínios (Início, Faturamento, Produtos), por isso centralizadas
// aqui em vez de redefinidas em cada tela.
export function corPorMargemPct(pct: number): string {
  if (pct < 0) return "var(--danger)";
  if (pct < 20) return "var(--warning)";
  return "var(--accent)";
}

export function corPorLucroHora(valor: number): string {
  if (valor < 0) return "var(--danger)";
  if (valor < 20) return "var(--warning)";
  return "var(--accent)";
}
