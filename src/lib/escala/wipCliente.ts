// Navegador: consulta e ações do estoque intermediário (WIP). Toda escrita passa pela rota do servidor (que checa a permissão).
import { supabase } from "@/services/supabase-client";
import type { ResumoControleWip } from "@/features/escala/wipSaldo";

export interface RespostaWip {
  ok: true;
  modoWip: boolean;
  hoje: string;
  semana: string;
  podeAlterar: boolean;
  controles: ResumoControleWip[];
}

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function consultarWip(semana: string): Promise<RespostaWip | { ok: false; erro: string }> {
  const t = await token();
  if (!t) return { ok: false, erro: "Sessão expirada." };
  const resp = await fetch(`/api/escala/wip?semana=${encodeURIComponent(semana)}`, { headers: { Authorization: `Bearer ${t}` } });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) return { ok: false, erro: json?.erro || "Não foi possível consultar o estoque intermediário." };
  return json as RespostaWip;
}

export async function acaoWip(corpo: Record<string, unknown>): Promise<{ ok: true } | { ok: false; erro: string }> {
  const t = await token();
  if (!t) return { ok: false, erro: "Sessão expirada." };
  const resp = await fetch("/api/escala/wip", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(corpo) });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) return { ok: false, erro: json?.erro || "Não foi possível salvar." };
  return { ok: true };
}
