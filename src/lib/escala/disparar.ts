// Navegador: pede ao servidor que processe os eventos pendentes da Escala.
// Fire-and-forget (a ação real já aconteceu; nada aqui pode falhar a ação).
import { supabase } from "@/services/supabase-client";

export function dispararProcessamentoEscala(): Promise<void> {
  return (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      await fetch("/api/escala/processar", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    } catch {
      // best-effort: o evento continua pendente e é retomado na próxima chamada
    }
  })();
}

export async function gerarEscalaNoServidor(semanaInicio: string): Promise<{ ok: boolean; erro?: string; aviso?: string; status?: string; alocacoesGravadas?: number; motivoIgnorado?: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, erro: "Sessão expirada." };
  const resp = await fetch("/api/escala/gerar", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ semana_inicio: semanaInicio }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) return { ok: false, erro: json?.erro || "Falha ao gerar a Escala." };
  return { ok: true, aviso: json.aviso, status: json.status, alocacoesGravadas: json.alocacoesGravadas, motivoIgnorado: json.motivoIgnorado };
}
