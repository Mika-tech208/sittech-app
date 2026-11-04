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

// ---------------------------------------------------------------------------------------------------------------------------------------------
// LIBERAÇÃO DA PROGRAMAÇÃO PARA O CHÃO (TV/monitor). Plano interno/estimado ≠ escala LIBERADA para produção.
// Regra (fechamento físico ATIVO): a programação de um período só é mostrada ao chão quando o fechamento físico do período ANTERIOR está CONFIRMADO.
// Até lá a TV mostra "AGUARDANDO NOVA PROGRAMAÇÃO" — mesmo que exista uma linha estimada no banco. Só controla a EXIBIÇÃO: não altera motor, plano nem apontamentos.
// TRANSIÇÃO: períodos anteriores a `LIBERACAO_EXIGIDA_DESDE` (hoje: M1/M2 de 04/11, que já passaram/estão em execução) seguem liberados como sempre.
// ---------------------------------------------------------------------------------------------------------------------------------------------
export const LIBERACAO_EXIGIDA_DESDE = { data: "2026-11-04", periodoId: "m3" };
export type MotivoLiberacao = "TRANSICAO" | "CONFIRMADO" | "AGUARDANDO_FECHAMENTO" | "RECALCULANDO" | "ERRO_RECALCULO";
export interface StatusLiberacao {
  liberado: boolean;
  motivo: MotivoLiberacao;
  /** período cujo fechamento físico libera este (o anterior) */
  predecessor: { data: string; periodoId: string; rotulo: string } | null;
  fechadoEmMs: number | null;
  excecao: boolean;
}

export function statusLiberacao(slot: { data: string; periodoId: string }, slots: SlotSelo[], fechamentos: Map<string, FechamentoSelo>, desde: { data: string; periodoId: string } = LIBERACAO_EXIGIDA_DESDE): StatusLiberacao {
  const livre = (motivo: MotivoLiberacao = "TRANSICAO", predecessor: StatusLiberacao["predecessor"] = null): StatusLiberacao => ({ liberado: true, motivo, predecessor, fechadoEmMs: null, excecao: false });
  const ordenados = [...slots].sort((a, b) => a.fimMs - b.fimMs);
  const i = ordenados.findIndex((s) => s.data === slot.data && s.periodoId === slot.periodoId);
  if (i < 0) return livre();
  const slotDesde = ordenados.find((s) => s.data === desde.data && s.periodoId === desde.periodoId);
  const anteriorARegra = slotDesde ? ordenados[i].fimMs < slotDesde.fimMs : slot.data < desde.data;
  if (anteriorARegra) return livre();
  const pred = ordenados[i - 1];
  if (!pred) return livre();
  const predecessor = { data: pred.data, periodoId: pred.periodoId, rotulo: pred.rotulo };
  const f = fechamentos.get(`${pred.data}|${pred.periodoId}`);
  if (!f) return { liberado: false, motivo: "AGUARDANDO_FECHAMENTO", predecessor, fechadoEmMs: null, excecao: false };
  if (f.estado === "CONFIRMADO") return { liberado: true, motivo: "CONFIRMADO", predecessor, fechadoEmMs: f.fechadoEmMs, excecao: f.excecao };
  return { liberado: false, motivo: f.estado === "ERRO_RECALCULO" ? "ERRO_RECALCULO" : "RECALCULANDO", predecessor, fechadoEmMs: f.fechadoEmMs, excecao: f.excecao };
}

/** Texto da TV quando a programação do período NÃO está liberada. */
export function textoTvNaoLiberada(st: StatusLiberacao, rotuloPeriodo: string): { titulo: string; detalhe: string } {
  const ant = st.predecessor?.rotulo ?? "período anterior";
  if (st.motivo === "ERRO_RECALCULO") return { titulo: "PROGRAMAÇÃO NÃO LIBERADA", detalhe: "Estoque salvo. Aguardando correção do recálculo." };
  if (st.motivo === "RECALCULANDO") return { titulo: `RECALCULANDO ${rotuloPeriodo}…`, detalhe: `Fechamento físico de ${ant} concluído. Gerando a programação de ${rotuloPeriodo}.` };
  return { titulo: "AGUARDANDO NOVA PROGRAMAÇÃO", detalhe: `${ant} encerrado. Fechamento físico de ${ant} em andamento — aguarde a programação de ${rotuloPeriodo}.` };
}
