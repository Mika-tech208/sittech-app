// REENVIAR E-MAIL do relatório gerado pelo fechamento automático: reaproveita EXATAMENTE o mesmo PDF/versão (nunca regera). Exige `escala_relatorios`.
import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { temPermissao } from "@/lib/permissoes";
import { reenviarEmail } from "@/lib/escala-relatorio/fechamentoAutomatico";
import { provedorDoAmbiente } from "@/lib/escala-relatorio/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth || !temPermissao(auth.usuario, "escala_relatorios")) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ erro: "id inválido." }, { status: 400 });
  try {
    const base = process.env.RELATORIO_BASE_URL && /^https?:\/\//.test(process.env.RELATORIO_BASE_URL) ? process.env.RELATORIO_BASE_URL : new URL(request.url).origin;
    const r = await reenviarEmail(criarClienteAdmin(), provedorDoAmbiente(), id, base);
    return NextResponse.json(r.ok ? { ok: true } : { ok: false, erro: r.erro }, { status: r.ok ? 200 : 409 });
  } catch (e) {
    console.error("escala/relatorios reenviar:", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Falha ao reenviar o e-mail." }, { status: 500 });
  }
}
