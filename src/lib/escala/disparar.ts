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

// Modo sombra (Fase 4d): depois de um lançamento de Produção Real, pede ao servidor que avalie o fechamento do período agora e de novo em
// ~10 e ~20 min (se a aba continuar aberta). Best-effort e idempotente: com o modo desligado o servidor não faz nada; a garantia de
// processamento vem do worker /api/escala/drenar e das próximas chamadas — o CORTE da decisão é calculado pelos carimbos dos lançamentos,
// então rodar mais tarde não muda o resultado.
export function agendarFechamentoEscala(): void {
  void dispararProcessamentoEscala();
  if (typeof window === "undefined") return;
  [10 * 60_000 + 15_000, 20 * 60_000 + 15_000].forEach((ms) => window.setTimeout(() => void dispararProcessamentoEscala(), ms));
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

// "Tentar novamente": devolve à fila os eventos esgotados e drena (servidor).
export async function reprocessarEventosEsgotados(): Promise<{ ok: boolean; erro?: string; esgotados?: number }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, erro: "Sessão expirada." };
  const resp = await fetch("/api/escala/reprocessar", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) return { ok: false, erro: json?.erro || "Falha ao reprocessar a Escala." };
  return { ok: true, esgotados: json.esgotados };
}

// Cobertura da equipe na Previsão (simulação SOMENTE LEITURA, mesmo motor da Escala).
export async function analisarCoberturaNoServidor(
  semanaInicio: string,
  opcoes: { sugerir?: boolean; itens?: { produto_id: string; quantidade?: number; quantidade_adicional?: number; adicional_etapas?: Record<string, number>; valor_unitario?: number; maquinas_por_etapa?: Record<string, string[]> }[] } = {}
): Promise<{ ok: true; dados: import("./simularCobertura").SimulacaoCobertura } | { ok: false; erro: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, erro: "Sessão expirada." };
  const resp = await fetch("/api/escala/simular-cobertura", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ semana_inicio: semanaInicio, sugerir: opcoes.sugerir === true, itens: opcoes.itens }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) return { ok: false, erro: json?.erro || "Falha ao analisar a cobertura." };
  return { ok: true, dados: json };
}
