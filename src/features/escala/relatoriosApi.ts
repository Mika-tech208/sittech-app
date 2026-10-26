// Cliente (navegador) dos relatórios semanais da Escala: lista e download. O conteúdo e os hashes são sempre os do servidor — nada digitável aqui.
import { supabase } from "@/services/supabase-client";

export interface LinhaRelatorio {
  id: string; codigo: string; tipo: "planejada" | "executada"; versao: number; status: "parcial" | "final"; geradoEm: string; consolidadoAte: string; geradoPor: string | null; hash: string;
  pdfBytes: number; alteracoesPosteriores: boolean | null; fechamentoAutomatico: boolean;
}
export interface FechamentoSemana { ativo: boolean; desdeSemana: string | null; fechamentoLogicoEm: string | null; geracaoStatus: "pendente" | "gerado" | "erro" | null; geracaoTentativas: number; geracaoUltimoErro: string | null }
export interface ListaRelatorios { relatorios: LinhaRelatorio[]; status: "parcial" | "final" | null; elegivelFinalEm: string | null; fechamento: FechamentoSemana }

export async function tokenDaSessao(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function buscarLista(semanaInicio: string): Promise<{ ok: true; dados: ListaRelatorios } | { ok: false; erro: string }> {
  const t = await tokenDaSessao();
  if (!t) return { ok: false, erro: "Sessão expirada." };
  const r = await fetch(`/api/escala/relatorios?semana=${semanaInicio}`, { headers: { Authorization: `Bearer ${t}` } });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, dados: j as ListaRelatorios } : { ok: false, erro: j?.erro || "Não foi possível consultar os relatórios." };
}

// o relatório FINAL automático mais recente da semana (o que a pessoa deve baixar e imprimir)
export function finalAutomaticoDisponivel(lista: ListaRelatorios | null): LinhaRelatorio | null {
  const finais = (lista?.relatorios ?? []).filter((r) => r.tipo === "executada" && r.status === "final" && r.fechamentoAutomatico);
  return finais.length === 0 ? null : finais.reduce((a, b) => (b.versao > a.versao ? b : a));
}
