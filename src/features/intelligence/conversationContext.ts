// Sittech Intelligence V1 — contexto de conversa (§11/§18 da análise
// aprovada). Sem memória vetorial, sem persistência entre sessões. Só
// `ultimoContexto` (entidade + janela da última tool bem-sucedida) e o
// histórico curto de mensagens da conversa ATUAL, que o endpoint recebe
// do cliente a cada requisição (o cliente — harness de DEV nesta etapa —
// é quem guarda o histórico entre chamadas; o servidor não persiste
// conversa nenhuma nesta V1).

import type { UltimoContexto, JanelaResolvida, TipoEntidadeContexto } from "@/features/intelligence/types";

const MAX_MENSAGENS_HISTORICO = 10; // §22: limitar histórico enviado ao modelo.

export function limitarHistorico<T>(mensagens: T[]): T[] {
  if (mensagens.length <= MAX_MENSAGENS_HISTORICO) return mensagens;
  return mensagens.slice(mensagens.length - MAX_MENSAGENS_HISTORICO);
}

export function atualizarUltimoContexto(tipo: TipoEntidadeContexto, id: string, nome: string, janela?: JanelaResolvida): UltimoContexto {
  return { tipo, id, nome, janela };
}
