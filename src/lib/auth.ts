// Hash de senha client-side (SHA-256 + salt). TEMPORÁRIO — ver Etapa 9 do
// briefing de migração: será substituído por Supabase Auth em fase futura,
// não deve ser "aproveitado" nem sofisticado nesta fase.

export function gerarSalt(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashSenha(senha: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const dados = encoder.encode(salt + ":" + senha);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dados);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
