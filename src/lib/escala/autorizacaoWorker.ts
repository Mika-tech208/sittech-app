// Autorização do worker /api/escala/drenar. Aceita DUAS credenciais, ambas como `Authorization: Bearer …`:
//   1) CRON_SECRET (Vercel Cron, GitHub Actions) — comparação em tempo constante;
//   2) token do agendador pg_cron/pg_net, gerado e guardado SÓ no banco (Vault) e validado pela RPC escala_agendador_token_valido.
// Retorno: true = autorizado; false = credencial inválida; null = worker não configurado (nenhuma das duas existe) — a rota responde 503.
import { timingSafeEqual } from "node:crypto";

export async function autorizarWorker(
  cabecalho: string,
  segredoCron: string | undefined,
  validarTokenAgendador: (token: string) => Promise<boolean>
): Promise<boolean | null> {
  const cronConfigurado = !!segredoCron && segredoCron.length >= 16;
  if (cronConfigurado) {
    const esperado = Buffer.from(`Bearer ${segredoCron}`);
    const recebido = Buffer.from(cabecalho);
    if (recebido.length === esperado.length && timingSafeEqual(recebido, esperado)) return true;
  }
  const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : "";
  if (token.length >= 32) {
    try {
      if (await validarTokenAgendador(token)) return true;
    } catch {
      // RPC indisponível (ex.: migration do agendador ainda não aplicada): trata como credencial inválida
    }
    return false;
  }
  return cronConfigurado ? false : null;
}
