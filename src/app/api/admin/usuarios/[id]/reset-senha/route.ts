// Route Handler — redefine a senha de OUTRO usuário via Supabase Auth
// Admin API. Requer service_role (não é auto-atendimento: é o admin
// redefinindo a senha de alguém), por isso não pode ser feito no navegador.

import { NextResponse } from "next/server";
import { verificarAdminAutenticado } from "@/lib/supabase-admin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verificarAdminAutenticado(request);
  if (!auth) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const novaSenha = typeof body?.novaSenha === "string" ? body.novaSenha : "";
  if (novaSenha.length < 6) {
    return NextResponse.json({ erro: "A nova senha precisa ter pelo menos 6 caracteres." }, { status: 400 });
  }

  const { admin } = auth;

  const { data: alvo, error: erroAlvo } = await admin
    .from("usuarios")
    .select("auth_user_id")
    .eq("id", id)
    .maybeSingle();
  if (erroAlvo || !alvo?.auth_user_id) {
    return NextResponse.json({ erro: "Usuário não encontrado." }, { status: 404 });
  }

  const { error: erroReset } = await admin.auth.admin.updateUserById(alvo.auth_user_id, { password: novaSenha });
  if (erroReset) {
    return NextResponse.json({ erro: "Não foi possível redefinir a senha." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
