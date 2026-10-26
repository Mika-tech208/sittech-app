// TESTAR ENVIO DE RELATÓRIO — SOMENTE ADMIN. Sem corpo: o destinatário é o e-mail da conta autenticada (Supabase Auth), nunca um valor enviado pelo navegador;
// remetente, provedor e chave vêm da configuração do servidor; o PDF é fictício e marcado TESTE. Não cria relatório, versão nem fechamento.
import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { provedorDoAmbiente } from "@/lib/escala-relatorio/email";
import { executarTesteEmail, registrarTesteSupabase } from "@/lib/escala-relatorio/testeEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth || auth.usuario.papel !== "admin") return NextResponse.json({ erro: "Somente administrador pode testar o envio." }, { status: 403 });
  try {
    const admin = criarClienteAdmin();
    const token = (request.headers.get("authorization") ?? "").slice(7);
    const { data } = await admin.auth.getUser(token);
    const destinatario = data.user?.email?.trim().toLowerCase();
    if (!destinatario) return NextResponse.json({ erro: "A conta não tem e-mail cadastrado." }, { status: 409 });
    const base = process.env.RELATORIO_BASE_URL && /^https?:\/\//.test(process.env.RELATORIO_BASE_URL) ? process.env.RELATORIO_BASE_URL : new URL(request.url).origin;
    const r = await executarTesteEmail({ usuarioId: auth.usuario.id, destinatario, baseUrl: base, provedor: provedorDoAmbiente(), registrar: registrarTesteSupabase(admin) });
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  } catch (e) {
    console.error("escala/relatorios email-teste:", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Falha ao executar o teste de envio." }, { status: 500 });
  }
}
