// SERVER-ONLY. Cliente Supabase com a service_role key — nunca importar
// este arquivo de um Client Component, de um hook que roda no navegador,
// ou de qualquer código que possa ser incluído no bundle do cliente. Só
// deve ser usado dentro de Route Handlers (src/app/api/**/route.ts), que
// rodam exclusivamente no servidor.

import { createClient } from "@supabase/supabase-js";

export function criarClienteAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar definidas em .env.local");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verifica o Bearer token da requisição e confirma que pertence a um
// admin ativo em public.usuarios. Retorna o perfil se autorizado, ou
// `null` se o token for inválido/ausente ou o usuário não for admin ativo.
export async function verificarAdminAutenticado(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  const admin = criarClienteAdmin();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return null;

  const { data: perfil, error: perfilError } = await admin
    .from("usuarios")
    .select("id, auth_user_id, nome, papel, ativo")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();

  if (perfilError || !perfil || !perfil.ativo || perfil.papel !== "admin") return null;

  return { admin, perfil, authUserId: userData.user.id };
}
