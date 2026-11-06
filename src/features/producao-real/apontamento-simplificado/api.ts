// Cliente do apontamento simplificado (navegador → /api/escala/fechamento/apontamentos). Sem regra de negócio: o servidor valida tudo de novo.
import { supabase } from "@/services/supabase-client";
import type { ApontamentoExistente, Catalogo, Divergencia, LinhaRpc, OrigemLinha, PlanejadoPosto, PostoRealInformado, VinculoSalvo } from "./tipos";

export interface EstadoApontamentosApi { modo: "desligado" | "ativo"; naoLiberado?: boolean; postos?: PlanejadoPosto[]; catalogo?: Catalogo; existentes?: ApontamentoExistente[]; vinculos?: VinculoSalvo[]; execucaoReal?: PostoRealInformado[]; erro?: string }
export interface SalvarApontamentosApi { ok?: boolean; erro?: string; mensagem?: string; substituidas?: number; linhas?: { chave: string; apontamentoId: string; origem: OrigemLinha; divergencias: Divergencia[]; naoProduziu: boolean }[] }

export async function chamar<T>(caminho: string, corpo?: unknown): Promise<{ status: number; corpo: T }> {
  const token = await Promise.race([
    supabase.auth.getSession().then(({ data }) => data.session?.access_token).catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000)),
  ]);
  const resp = await fetch(caminho, { method: corpo !== undefined ? "POST" : "GET", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` }, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
  return { status: resp.status, corpo: (await resp.json().catch(() => ({}))) as T };
}
export const estadoApontamentosApi = (data: string, periodoId: string) => chamar<EstadoApontamentosApi>(`/api/escala/fechamento/apontamentos?data=${data}&periodo_id=${periodoId}`);
export const salvarApontamentosApi = (data: string, periodoId: string, linhas: LinhaRpc[]) => chamar<SalvarApontamentosApi>("/api/escala/fechamento/apontamentos", { data, periodo_id: periodoId, linhas });

export const reabrirPeriodoApi = (data: string, periodoId: string, motivo: string) => chamar<{ ok?: boolean; erro?: string; valido_ate?: string; renovada?: boolean }>("/api/escala/fechamento/reabrir", { data, periodo_id: periodoId, motivo });
