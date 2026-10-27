import { carregarApontamentos, carregarDecisoes, carregarParadasReais } from "./dados";
import { montarCenario, type OpcoesCenario } from "./montar";
import { rodarCenario, type Rodada } from "./rodar";
import { PARES_LEGADO_PROD } from "./paresLegado";
import type { OpcoesFluxo } from "@/features/escala/fluxo";

export const decisoes = carregarDecisoes();
export const apontamentos = carregarApontamentos();
export const paradas = carregarParadasReais();

/** Os fechamentos (uma decisão por período, revisão 0), em ordem cronológica. */
export const fechamentos = decisoes.filter((d) => d.revisao === 0).sort((a, b) => a.entrada.c - b.entrada.c);

export function rodar(dec: (typeof decisoes)[number], oc: OpcoesCenario = {}, opcoesExtra: Partial<OpcoesFluxo> = {}, determinismo = false): Rodada {
  const cen = montarCenario(dec, apontamentos, { paresLegado: PARES_LEGADO_PROD, ...oc });
  return rodarCenario(cen, paradas, opcoesExtra, determinismo);
}

export const mediana = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const percentil = (v: number[], p: number) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
