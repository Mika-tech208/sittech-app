// Estado de um período na troca (puro). O fechamento do período ANTERIOR é o que confirma o plano do período seguinte.
import type { EstadoFechamento, EstadoPeriodo } from "./tipos";

export interface FatosPeriodo {
  agoraMs: number; inicioMs: number; fimMs: number;
  /** janela de troca aberta (alguém abriu o fechamento e ele ainda não foi gravado) */
  janelaAberta: boolean;
  /** último estado do fechamento vigente deste período; null = não fechado */
  fechamento: EstadoFechamento | null;
}

export function estadoDoPeriodo(f: FatosPeriodo): EstadoPeriodo {
  if (f.fechamento) return f.fechamento;
  if (f.agoraMs < f.inicioMs) return "FUTURO";
  if (f.agoraMs < f.fimMs) return "EM_EXECUCAO";
  return "EM_FECHAMENTO"; // terminou e ninguém fechou: a fábrica está (ou deveria estar) parada para a troca
}

/** Texto do selo que a tela mostra para o PRÓXIMO período, dado o estado do período que acabou de terminar. */
export function seloProximoPeriodo(anterior: EstadoPeriodo, rotuloProximo: string): { texto: string; tom: "ok" | "andamento" | "erro" | "espera" } {
  switch (anterior) {
    case "CONFIRMADO": return { texto: `${rotuloProximo} CONFIRMADO`, tom: "ok" };
    case "RECALCULANDO": return { texto: `Recalculando ${rotuloProximo}…`, tom: "andamento" };
    case "ERRO_RECALCULO": return { texto: "Estoque salvo. Programação ainda não gerada.", tom: "erro" };
    case "EM_FECHAMENTO": return { texto: `Fechamento em andamento — ${rotuloProximo} aguarda`, tom: "andamento" };
    default: return { texto: `${rotuloProximo} aguarda o fechamento do período anterior`, tom: "espera" };
  }
}
