// Client Supabase único, reutilizado por toda autenticação do app. Só usa
// variáveis públicas (URL + anon key) — protegidas pelas policies de RLS já
// aplicadas no banco. NUNCA importar a service_role key aqui nem em
// qualquer outro arquivo que rode no navegador.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY precisam estar definidas em .env.local");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
