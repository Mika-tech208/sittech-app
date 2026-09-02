// Route Handler — cria usuário (Supabase Auth + perfil public.usuarios).
// Requer privilégio de service_role (criação de usuário via Admin API),
// por isso não pode ser feito no navegador. Só executa se o chamador for
// um admin ativo autenticado (verificado via o próprio access token dele).

import { NextResponse } from "next/server";
import { verificarAdminAutenticado } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const auth = await verificarAdminAutenticado(request);
  if (!auth) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const nome = typeof body?.nome === "string" ? body.nome.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const senha = typeof body?.senha === "string" ? body.senha : "";
  const papel = body?.papel === "admin" ? "admin" : body?.papel === "usuario" ? "usuario" : "";

  if (!nome || !email || !papel || senha.length < 6) {
    return NextResponse.json(
      { erro: "Dados inválidos: nome, e-mail, papel e senha (mín. 6 caracteres) são obrigatórios." },
      { status: 400 }
    );
  }

  const { admin } = auth;

  const { data: novoAuthUser, error: erroCriacao } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
  });
  if (erroCriacao || !novoAuthUser.user) {
    return NextResponse.json(
      { erro: erroCriacao?.message?.includes("already been registered")
          ? "Já existe uma conta com esse e-mail."
          : "Não foi possível criar o usuário." },
      { status: 400 }
    );
  }

  const { data: perfil, error: erroPerfil } = await admin
    .from("usuarios")
    .insert({ auth_user_id: novoAuthUser.user.id, nome, email, papel, ativo: true })
    .select("id, auth_user_id, nome, email, papel, ativo, created_at")
    .single();

  if (erroPerfil || !perfil) {
    // rollback: o auth user foi criado mas o perfil falhou — remove pra não
    // deixar uma conta "órfã" sem linha em public.usuarios.
    await admin.auth.admin.deleteUser(novoAuthUser.user.id);
    return NextResponse.json({ erro: "Não foi possível criar o perfil do usuário." }, { status: 400 });
  }

  return NextResponse.json({ usuario: perfil }, { status: 201 });
}
