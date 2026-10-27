// REPLAY COMPLETO DA SEMANA (encadeado): percorre os fechamentos em ordem cronológica como se a Escala de fluxo estivesse ATIVA desde o 1º recálculo.
// Em cada fechamento i: plano vigente = executado/vigente gravado até c_i (passado) + plano de FLUXO produzido no fechamento anterior para c_i+1 em diante.
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
  let prev: { futuras: AlocacaoEscala[]; ap: number } | null = null;
  let prevOficial: AlocacaoEscala[] | null = null;
  for (const d of fechamentos) {
    const base = montarCenario(d, apontamentos, { offset, paresLegado: PARES_LEGADO_PROD });
    const slots = base.entrada.slots;
    const idx = (a: { data: string; periodoId: string }) => slots.findIndex((s) => s.data === a.data && s.periodoId === a.periodoId);
    const c = d.entrada.c;
    // plano vigente do mundo "fluxo ativo": gravado até c; fluxo anterior a partir de c+1
    let planoVigente = base.planoVigente;
    if (prev) {
      const passado = base.planoVigente.filter((a) => idx(a) <= c);
      const futuroFluxo = prev.futuras.filter((a) => idx(a) >= c + 1);
      const cobertos = new Set(futuroFluxo.map((a) => `${a.data}|${a.periodoId}|${a.funcionarioId}`));
      const resto = base.planoVigente.filter((a) => idx(a) > c && !cobertos.has(`${a.data}|${a.periodoId}|${a.funcionarioId}`));
      planoVigente = [...passado, ...futuroFluxo, ...resto];
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
    prev = { futuras: r.planoFluxoFuturo, ap };
    prevOficial = oficial.planoVigente;
  }
  return linhas;
}
