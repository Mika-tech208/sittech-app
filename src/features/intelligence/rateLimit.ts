// Sittech Intelligence V1 — rate limit (§25 da instrução): 30 perguntas
// por usuário por hora. Proteção contra abuso/loop/custo, não um sistema
// de créditos. Implementação em memória do PROCESSO — suficiente pra V1
// de um único servidor Next.js; NÃO sobrevive a restart nem funciona
// corretamente com múltiplas instâncias/serverless replicado (limitação
// documentada, ver relatório). Evoluir pra uma tabela/Redis fica pra
// depois, só se o volume real justificar.

const JANELA_MS = 60 * 60 * 1000; // 1 hora
const LIMITE_POR_JANELA = 30;

const contagemPorUsuario = new Map<string, number[]>(); // usuarioId -> timestamps das últimas chamadas

export interface ResultadoRateLimit {
  permitido: boolean;
  restantes: number;
  reiniciaEm: number | null; // ms até o timestamp mais antigo sair da janela
}

export function checarRateLimit(usuarioId: string, agora: number = Date.now()): ResultadoRateLimit {
  const timestamps = (contagemPorUsuario.get(usuarioId) || []).filter((t) => agora - t < JANELA_MS);
  if (timestamps.length >= LIMITE_POR_JANELA) {
    contagemPorUsuario.set(usuarioId, timestamps);
    return { permitido: false, restantes: 0, reiniciaEm: JANELA_MS - (agora - timestamps[0]) };
  }
  timestamps.push(agora);
  contagemPorUsuario.set(usuarioId, timestamps);
  return { permitido: true, restantes: LIMITE_POR_JANELA - timestamps.length, reiniciaEm: null };
}

// Só pra testes — nunca chamado em código de produção.
export function _resetarRateLimitParaTeste(): void {
  contagemPorUsuario.clear();
}
