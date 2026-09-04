// Formatação de tempo decorrido desde um timestamp ISO — extraído de
// EncerrarOcorrenciaModal.tsx (fórmula idêntica, nunca duplicada) pra
// reuso pela Visão Geral da Produção Real (bloco "Agora"). `agora` é
// injetável só pra permitir teste determinístico; em produção sempre usa
// o default (Date.now() no momento do render — não há polling aqui, o
// valor só atualiza quando o componente re-renderiza por outro motivo).
export function formatarTempoDecorrido(iso: string, agora: Date = new Date()): string {
  const minutos = Math.max(0, Math.round((agora.getTime() - new Date(iso).getTime()) / 60000));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return `${horas}h${resto > 0 ? ` ${resto}min` : ""}`;
}

export function minutosDecorridos(iso: string, agora: Date = new Date()): number {
  return Math.max(0, Math.round((agora.getTime() - new Date(iso).getTime()) / 60000));
}
