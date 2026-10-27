// REPLAY COMPLETO DA SEMANA (encadeado): percorre os fechamentos em ordem cronológica como se a Escala de fluxo estivesse ATIVA desde o 1º recálculo.
// Em cada fechamento i: plano vigente = o plano do próprio encadeamento (oficial gravado no 1º; depois: o que já valia antes de aPartirDe + o futuro devolvido pelo fluxo).
// Compara, na MESMA régua (avaliarPlano), a trajetória da falta final do plano oficial gravado × plano de fluxo, e o churn entre recálculos consecutivos.
import type { AlocacaoEscala } from "@/features/escala/types";
import { fechamentos, rodar, apontamentos } from "./comum";
import { resumir } from "./resumo";
import { churnIndependente } from "./independente";
import { montarCenario } from "./montar";
import { avaliarPlano } from "@/features/escala/fluxo";
import { PARES_LEGADO_PROD } from "./paresLegado";

export function replayEncadeado(offset = 2) {
  const linhas: unknown[] = [];
  // O plano da semana no mundo "fluxo ativo desde o 1º recálculo": começa como o plano oficial gravado e, a cada fechamento, passa a ser
  // [o que já estava vigente antes de aPartirDe] + [o futuro devolvido pelo fluxo]. O período c+1 (comprometido) e o passado são, portanto, os do
  // PRÓPRIO encadeamento (não os do plano oficial gravado) — o revezamento na fronteira c→c+1 é o que o fluxo anterior assumiu.
  let chain: AlocacaoEscala[] | null = null;
  let prev: { futuras: AlocacaoEscala[]; ap: number } | null = null;
  let prevOficial: AlocacaoEscala[] | null = null;
  for (const d of fechamentos) {
    const base = montarCenario(d, apontamentos, { offset, paresLegado: PARES_LEGADO_PROD });
    const slots = base.entrada.slots;
    const idx = (a: { data: string; periodoId: string }) => slots.findIndex((s) => s.data === a.data && s.periodoId === a.periodoId);
    const c = d.entrada.c;
    let planoVigente = base.planoVigente;
    if (chain) {
      const cobertos = new Set(chain.map((a) => `${a.data}|${a.periodoId}|${a.funcionarioId}`));
      planoVigente = [...chain, ...base.planoVigente.filter((a) => !cobertos.has(`${a.data}|${a.periodoId}|${a.funcionarioId}`))];
    }
    const r = rodar(d, { offset, planoVigente });
    const oficial = montarCenario(d, apontamentos, { offset, paresLegado: PARES_LEGADO_PROD }); // plano gravado (mundo real)
    const avOficialGravado = avaliarPlano(oficial.entrada, oficial.dados, oficial.planoVigente, oficial.opcoes);
    const avFluxoCadeia = r.avFluxo;
    const ap = r.cen.aPartirDe;
    const futurasOficial = oficial.planoVigente.filter((a) => idx(a) >= ap);
    const churnFluxoVsAnterior = prev ? churnIndependente(r.cen.entrada, r.planoFluxoFuturo, prev.futuras.filter((a) => idx(a) >= ap)) : null;
    const churnOficialVsAnterior = prevOficial ? churnIndependente(oficial.entrada, futurasOficial, prevOficial.filter((a) => idx(a) >= ap)) : null;
    linhas.push({
      resumo: { ...resumir(r), ms: 0 }, c, rotulo: `${d.data.slice(5)} ${d.periodoId}`,
      faltaOficialGravado: [Math.round(avOficialGravado.totais.faltaFinalLo), Math.round(avOficialGravado.totais.faltaFinalHi)],
      faltaFluxoCadeia: [Math.round(avFluxoCadeia.totais.faltaFinalLo), Math.round(avFluxoCadeia.totais.faltaFinalHi)],
      faltaVigenteDaCadeia: [Math.round(r.avVigente.totais.faltaFinalLo), Math.round(r.avVigente.totais.faltaFinalHi)],
      churnFluxoVsAnterior, churnOficialVsAnterior,
    });
    chain = [...planoVigente.filter((a) => idx(a) < ap), ...r.planoFluxoFuturo];
    prev = { futuras: r.planoFluxoFuturo, ap };
    prevOficial = oficial.planoVigente;
  }
  return linhas;
}
