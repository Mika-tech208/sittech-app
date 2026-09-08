// Sittech Intelligence V1 — autenticação e permissões (§12/§13/§15 da
// análise aprovada). Princípio central: Intelligence roda SEMPRE com a
// sessão real do usuário (RLS normal) — nunca service_role pra buscar
// dados de negócio. A única chamada que usa o cliente admin é a
// validação do próprio token (auth.getUser), mesma técnica já usada em
// verificarAdminAutenticado (src/lib/supabase-admin.ts) — nunca pra ler
// dado de negócio.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { temPermissao, type Permissao } from "@/lib/permissoes";
import type { UsuarioIntelligence } from "@/features/intelligence/types";

export interface IntelligenceAuthContext {
  supabaseAsUser: SupabaseClient;
  usuario: UsuarioIntelligence;
}

// Extrai o Bearer token da requisição, valida contra o Auth do Supabase
// (via cliente admin — só decodifica/valida o JWT, não lê dado de
// negócio), resolve o perfil em `usuarios` e as permissões concedidas em
// `usuario_permissoes` USANDO um cliente autenticado COMO o próprio
// usuário (anon key + o access_token dele) — é esse cliente
// (`supabaseAsUser`) que toda tool deve usar daqui em diante, nunca o
// admin. `null` = não autenticado / usuário inativo.
export async function autenticarRequisicaoIntelligence(request: Request): Promise<IntelligenceAuthContext | null> {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  const admin = criarClienteAdmin();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY precisam estar definidas.");

  const supabaseAsUser = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: perfil, error: perfilError } = await supabaseAsUser
    .from("usuarios")
    .select("id, nome, papel, ativo")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (perfilError || !perfil || !perfil.ativo) return null;

  let permissoes: Permissao[] = [];
  if (perfil.papel !== "admin") {
    const { data: permissoesRows } = await supabaseAsUser.from("usuario_permissoes").select("permissao").eq("usuario_id", perfil.id);
    permissoes = (permissoesRows || []).map((r) => r.permissao as Permissao);
  }

  return {
    supabaseAsUser,
    usuario: { id: perfil.id, nome: perfil.nome, papel: perfil.papel, permissoes },
  };
}

// Checa 1+ permissões (todas obrigatórias) contra o usuário já resolvido
// — reaproveita temPermissao (src/lib/permissoes.ts) literalmente, nunca
// reimplementa a regra "admin sempre passa".
export function usuarioTemTodasPermissoes(usuario: UsuarioIntelligence, chaves: Permissao[]): boolean {
  return chaves.every((chave) => temPermissao(usuario, chave));
}
