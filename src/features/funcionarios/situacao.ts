// Ativar/desativar funcionário — regras de apresentação (o banco é a autoridade). Um único conceito: ATIVO / INATIVO.
// Datas efetivas são digitadas no relógio de America/Sao_Paulo (UTC-3 fixo desde 2019) e enviadas como ISO com offset.
export type FiltroSituacao = "ativos" | "inativos" | "todos";

export const TEXTO_DESATIVAR = "Este funcionário será removido das operações futuras, mas todo o histórico de produção, ausências, escalas e custos será preservado.";

export function filtrarPorSituacao<T extends { ativo: boolean }>(lista: T[], filtro: FiltroSituacao): T[] {
  if (filtro === "todos") return lista;
  return lista.filter((f) => (filtro === "ativos" ? f.ativo : !f.ativo));
}

const pad = (n: number) => String(n).padStart(2, "0");

// Date -> "YYYY-MM-DDTHH:MM" (valor de <input type="datetime-local">) no horário de São Paulo
export function agoraParaInputLocal(agora: Date = new Date()): string {
  const sp = new Date(agora.getTime() - 3 * 3600_000);
  return `${sp.getUTCFullYear()}-${pad(sp.getUTCMonth() + 1)}-${pad(sp.getUTCDate())}T${pad(sp.getUTCHours())}:${pad(sp.getUTCMinutes())}`;
}

// "YYYY-MM-DDTHH:MM" (São Paulo) -> ISO com offset; vazio/ inválido -> null
export function inputLocalParaIso(valor: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor) ? `${valor}:00-03:00` : null;
}

// Erro óbvio antes de ir ao servidor (o banco repete a validação): data/hora efetiva no futuro
export function efetivoNoFuturo(valor: string, agora: Date = new Date()): boolean {
  const iso = inputLocalParaIso(valor);
  return iso !== null && Date.parse(iso) > agora.getTime() + 5 * 60_000;
}

export function formatarDataHoraSP(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(Date.parse(iso) - 3 * 3600_000);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
