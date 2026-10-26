// Cliente (navegador) dos relatórios semanais da Escala: lista e download. O conteúdo e os hashes são sempre os do servidor — nada digitável aqui.
import { supabase } from "@/services/supabase-client";
import { montarQuery, type Arquivo, type FiltrosArquivo, type TipoRelatorio } from "@/features/relatorios/arquivo";

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

// ---------- arquivo histórico (aba Relatórios) ----------
export async function buscarArquivo(f: FiltrosArquivo): Promise<{ ok: true; dados: Arquivo } | { ok: false; erro: string }> {
  const t = await tokenDaSessao();
  if (!t) return { ok: false, erro: "Sessão expirada." };
  const qs = montarQuery(f);
  const r = await fetch(`/api/escala/relatorios/arquivo${qs ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${t}` } });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, dados: j as Arquivo } : { ok: false, erro: j?.erro || "Não foi possível consultar os relatórios." };
}

// Todas as versões de uma família (semana + tipo), da mais nova para a mais antiga
export async function buscarVersoes(semana: string, tipo: TipoRelatorio): Promise<{ ok: true; versoes: LinhaRelatorio[] } | { ok: false; erro: string }> {
  const r = await buscarLista(semana);
  return r.ok ? { ok: true, versoes: r.dados.relatorios.filter((x) => x.tipo === tipo).sort((a, b) => b.versao - a.versao) } : r;
}

// Baixa EXATAMENTE o PDF armazenado (a rota confere o SHA-256 antes de entregar)
export async function baixarPdfArquivado(id: string, nome: string): Promise<string | null> {
  const t = await tokenDaSessao();
  if (!t) return "Sessão expirada.";
  const r = await fetch(`/api/escala/relatorios/${id}/pdf`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) return "Não foi possível baixar o PDF.";
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return null;
}

export async function gerarNovaVersao(semana: string, tipo: TipoRelatorio): Promise<{ ok: true; id: string; versao: number; nomeArquivo: string } | { ok: false; erro: string }> {
  const t = await tokenDaSessao();
  if (!t) return { ok: false, erro: "Sessão expirada." };
  const r = await fetch("/api/escala/relatorios", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ semana_inicio: semana, tipo }) });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, id: j.id, versao: j.versao, nomeArquivo: j.nomeArquivo } : { ok: false, erro: j?.erro || "Falha ao gerar a nova versão." };
}
