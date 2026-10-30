// Reconstrução do ESTADO de produção "agora" (ou de um instante simulado) a partir dos dados de PROD, pelo MESMO caminho da integração
// (src/lib/escala/fluxo/integracao.ts › insumosFluxo/dadosProducaoReal): f de desempenho embutido nas metas, pares legados, contagens físicas, sem wip_controle.
import { prepararFluxo, type CtxFluxo } from "@/features/escala/fluxo/estado";
import type { DadosProducaoReal, OpcoesFluxo } from "@/features/escala/fluxo";
import { paraParametrosCorte } from "@/features/escala/snapshotSombra";
import type { AlocacaoEscala, EntradaEscala, SlotEscala } from "@/features/escala/types";
import { montarCenario } from "../escala-fluxo-replay/montar";
import type { DadosCarregados } from "./carga";

export interface EstadoAgora {
  agoraMs: number;
  ufech: number; // último slot fechado
  aPartirDe: number; // primeiro slot ainda não fechado (= ufech + 1)
  slots: SlotEscala[];
  entrada: EntradaEscala;
  dados: DadosProducaoReal;
  opcoes: OpcoesFluxo;
  fator: Record<string, number>;
  plano: AlocacaoEscala[];
  ctx: CtxFluxo;
}

export const dataSP = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);

export function slotsDa(d: DadosCarregados): SlotEscala[] {
  return paraParametrosCorte(d.decisao.entrada).base.slots;
}
export function ultimoFechado(slots: SlotEscala[], agoraMs: number, fechMin = 10): number {
  let u = -1;
  slots.forEach((s) => { if (s.fimMs + fechMin * 60_000 <= agoraMs) u = s.indice; });
  return u;
}

export function montarEstado(d: DadosCarregados, agoraMs: number, plano: AlocacaoEscala[], comContagens = true): EstadoAgora {
  const slots = slotsDa(d);
  const ufech = ultimoFechado(slots, agoraMs);
  const dec = { ...d.decisao, corteMs: agoraMs };
  const offset = ufech + 1 - dec.entrada.c;
  const cen = montarCenario(dec, d.apontamentos, { offset, planoVigente: plano, paresLegado: d.cfg.paresLegado });
  const opcoes: OpcoesFluxo = { ...cen.opcoes, ...(d.cfg.limiar !== null ? { limiarEstabilidadePecas: d.cfg.limiar } : {}) };
  const dados: DadosProducaoReal = {
    apontamentos: d.apontamentos, agoraMs, fechamentoMinutos: 10, planoVigente: plano,
    ...(comContagens && d.cfg.contagensFisicas.length > 0 ? { contagensFisicas: d.cfg.contagensFisicas } : {}),
  };
  const entrada = { ...cen.entrada, aPartirDe: ufech + 1 };
  return { agoraMs, ufech, aPartirDe: ufech + 1, slots, entrada, dados, opcoes, fator: cen.fator, plano, ctx: prepararFluxo(entrada, dados, opcoes) };
}
