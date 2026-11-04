// SELO da programação (puro): o chão precisa saber se está olhando uma programação gerada a partir do FECHAMENTO FÍSICO.
// Regra: pega o ÚLTIMO período que já terminou (U) e olha o fechamento dele. Só tem selo em modo `ativo` (em sombra o plano oficial NÃO vem do fechamento).
import type { EstadoFechamento } from "./tipos";

export type SeloCodigo = "ESCALA_CONFIRMADA" | "ESCALA_CONFIRMADA_PARCIAL" | "AGUARDANDO_FECHAMENTO" | "RECALCULANDO" | "ERRO_RECALCULO";
export interface SlotSelo { data: string; periodoId: string; rotulo: string; fimMs: number }
export interface FechamentoSelo { estado: EstadoFechamento; excecao: boolean; fechadoEmMs: number | null }
export interface Selo { codigo: SeloCodigo; texto: string; periodo: { data: string; periodoId: string; rotulo: string }; fechadoEmMs: number | null }

export const TEXTO_SELO: Record<SeloCodigo, string> = {
  ESCALA_CONFIRMADA: "ESCALA CONFIRMADA",
  ESCALA_CONFIRMADA_PARCIAL: "ESCALA CONFIRMADA (estimativa parcial)",
  AGUARDANDO_FECHAMENTO: "AGUARDANDO FECHAMENTO",
  RECALCULANDO: "RECALCULANDO…",
  ERRO_RECALCULO: "ERRO NO RECÁLCULO — estoque salvo",
};

export function calcularSelo(slots: SlotSelo[], agoraMs: number, fechamentos: Map<string, FechamentoSelo>): Selo | null {
  const terminados = slots.filter((s) => s.fimMs <= agoraMs).sort((a, b) => a.fimMs - b.fimMs);
  const u = terminados[terminados.length - 1];
  if (!u) return null;
  const f = fechamentos.get(`${u.data}|${u.periodoId}`);
  const periodo = { data: u.data, periodoId: u.periodoId, rotulo: u.rotulo };
  if (!f) return { codigo: "AGUARDANDO_FECHAMENTO", texto: TEXTO_SELO.AGUARDANDO_FECHAMENTO, periodo, fechadoEmMs: null };
  const codigo: SeloCodigo = f.estado === "CONFIRMADO" ? (f.excecao ? "ESCALA_CONFIRMADA_PARCIAL" : "ESCALA_CONFIRMADA") : f.estado === "ERRO_RECALCULO" ? "ERRO_RECALCULO" : "RECALCULANDO";
  return { codigo, texto: TEXTO_SELO[codigo], periodo, fechadoEmMs: f.fechadoEmMs };
}
