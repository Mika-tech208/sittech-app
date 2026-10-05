import { MESES } from "@/lib/constants";

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MESES[m - 1]} de ${y}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function mondayOf(date: Date): Date {
  const d = new Date(date);
  const dia = d.getDay(); // 0=domingo
  const diff = dia === 0 ? -6 : 1 - dia;
  d.setDate(d.getDate() + diff);
  return d;
}

export function weekLabel(mondayISO: string): string {
  const monday = new Date(mondayISO + "T00:00:00");
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `Semana de ${fmt(monday)} a ${fmt(sunday)}/${sunday.getFullYear()}`;
}

export function shiftWeek(mondayISO: string, delta: number): string {
  const d = new Date(mondayISO + "T00:00:00");
  d.setDate(d.getDate() + delta * 7);
  return toISODate(d);
}

// dd/mm/aaaa <-> YYYY-MM-DD — usado pelo DatePicker compartilhado; o valor
// que entra/sai dos formulários e filtros continua sempre ISO.
export function isoParaBR(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

export function brParaISO(br: string): string | null {
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const dia = Number(d);
  const mes = Number(mo);
  const ano = Number(y);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const data = new Date(ano, mes - 1, dia);
  if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) return null;
  return `${y}-${mo}-${d}`;
}

// mm/aaaa <-> YYYY-MM — mesma ideia, pro MonthPicker.
export function monthKeyParaBR(key: string): string {
  if (!key) return "";
  const [y, m] = key.split("-");
  if (!y || !m) return "";
  return `${m}/${y}`;
}

export function brParaMonthKey(br: string): string | null {
  const m = br.match(/^(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, y] = m;
  const mes = Number(mo);
  if (mes < 1 || mes > 12) return null;
  return `${y}-${mo}`;
}
