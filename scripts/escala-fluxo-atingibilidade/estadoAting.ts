// Estado de produção "agora" para o replay da regra de atingibilidade. Igual a escala-fluxo-wip-custo/estado.ts, mas com `deslocamento` do primeiro período mutável:
// 1 = primeiro período NÃO FECHADO (como o fechamento de período); 2 = primeiro período NÃO INICIADO (o período em andamento fica congelado).
import { prepararFluxo } from "@/features/escala/fluxo/estado";
import type { DadosProducaoReal, OpcoesFluxo } from "@/features/escala/fluxo";
import type { AlocacaoEscala } from "@/features/escala/types";
import { montarCenario } from "../escala-fluxo-replay/montar";
import type { DadosCarregados } from "./carga";
import { slotsDa, ultimoFechado } from "./estado";

export function montarEstadoAting(d: DadosCarregados, agoraMs: number, plano: AlocacaoEscala[], deslocamento: number, extra: Partial<OpcoesFluxo> = {}, bloco = false) {
  const slots = slotsDa(d);
  const ufech = ultimoFechado(slots, agoraMs);
  const dec = { ...d.decisao, corteMs: agoraMs };
  const aPartirDe = deslocamento >= 100 ? deslocamento - 100 : ufech + deslocamento; // >= 100: índice ABSOLUTO do slot (100 + índice)
  const cen = montarCenario(dec, d.apontamentos, { offset: aPartirDe - dec.entrada.c, planoVigente: plano, paresLegado: d.cfg.paresLegado });
  const opcoes: OpcoesFluxo = { ...cen.opcoes, ...(d.cfg.limiar !== null ? { limiarEstabilidadePecas: d.cfg.limiar } : {}), ...extra };
  const dados: DadosProducaoReal = {
    apontamentos: d.apontamentos, agoraMs, fechamentoMinutos: 10, planoVigente: plano,
    ...(d.cfg.contagensFisicas.length > 0 ? { contagensFisicas: d.cfg.contagensFisicas } : {}),
  };
  const menos = Number(process.env.MENOS_PESSOAS ?? 0); // estresse: remove as N últimas pessoas da equipe (só para sensibilidade)
  const entrada = { ...cen.entrada, aPartirDe, ...(menos > 0 ? { funcionarios: cen.entrada.funcionarios.slice(0, cen.entrada.funcionarios.length - menos) } : {}), ...(bloco ? { revezamentoEscopo: "bloco" as const } : {}) };
  return { agoraMs, ufech, aPartirDe, slots, entrada, dados, opcoes, plano, ctx: prepararFluxo(entrada, dados, opcoes) };
}
