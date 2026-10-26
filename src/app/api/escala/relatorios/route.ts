// Relatórios semanais da Escala (PDF). Exige a permissão própria `escala_relatorios` (administrador sempre pode).
//  GET  ?semana=YYYY-MM-DD  → lista as versões da semana (com a marca "alterações posteriores")
//  POST { semana_inicio, tipo: "planejada" | "executada" } → gera uma NOVA versão. O sistema decide parcial/final; o conteúdo vem do banco, nunca do navegador.
import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { temPermissao } from "@/lib/permissoes";
import { gerarRelatorio, listarRelatorios } from "@/lib/escala-relatorio/servico";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function baseUrl(request: Request): string {
  const env = process.env.RELATORIO_BASE_URL;
  if (env && /^https?:\/\//.test(env)) return env;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth || !temPermissao(auth.usuario, "escala_relatorios")) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const semana = new URL(request.url).searchParams.get("semana") ?? "";
  if (!DATA.test(semana)) return NextResponse.json({ erro: "semana inválida." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await listarRelatorios(criarClienteAdmin(), auth.supabaseAsUser, semana)) });
  } catch (e) {
    console.error("escala/relatorios GET:", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Falha ao consultar os relatórios." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth || !temPermissao(auth.usuario, "escala_relatorios")) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const semana = typeof body?.semana_inicio === "string" ? body.semana_inicio : "";
  const tipo = body?.tipo;
  if (!DATA.test(semana) || (tipo !== "planejada" && tipo !== "executada")) return NextResponse.json({ erro: "Parâmetros inválidos." }, { status: 400 });
  try {
    const r = await gerarRelatorio(criarClienteAdmin(), { semana, tipo, usuario: { id: auth.usuario.id, nome: auth.usuario.nome }, baseUrl: baseUrl(request) });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao gerar o relatório.";
    console.error("escala/relatorios POST:", msg);
    return NextResponse.json({ erro: msg }, { status: 500 });
  }
}
