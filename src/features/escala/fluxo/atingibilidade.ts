// ATINGIBILIDADE DA META SEMANAL — funções puras (regra geral; nenhum `if produto`).
//
// A quantidade da Previsão é COMPROMISSO. Para cada GRUPO (cadeia até o produto final):
//   máximo possível  M = final alcançável (cenário pessimista) com TODAS as máquinas disponíveis trabalhando em TODOS os períodos desde aPartirDe
//                    (pessoas não limitam; WIP/material, gargalo upstream, dias e períodos restantes limitam — é o simulador de fluxo);
//   atingível        M ≥ Q;       falta inevitável = max(0, Q − M);
//   produção obrigatória agora   = max(0, M − alcance com ZERO postos no período) ;  postos mínimos = ceil(obrigatória / capacidade por posto) (no fluxo, achado por re-simulação).
// Para o último elo isolado isto reduz a  ceil(max(0, restante_final − capacidade_máxima_DEPOIS) / capacidade_por_posto)  (`postosMinimosUltimoElo`).

import type { CtxFluxo } from "./estado";
import { modelo, TOL_ALCANCE } from "./otimizar";
import { novaCap, simularGrupo, type CapNo } from "./simulador";
import type { AtingibilidadeGrupo, AtingibilidadePlano } from "./tipos";

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Fórmula literal do último elo (sem o fluxo): postos mínimos agora para manter a meta atingível. */
export function postosMinimosUltimoElo(p: { restanteFinal: number; capacidadeMaximaDepois: number; capacidadePorPosto: number; postosMaximos?: number }): { producaoObrigatoriaAgora: number; postosMinimos: number; viavel: boolean } {
  const obrig = Math.max(0, p.restanteFinal - p.capacidadeMaximaDepois);
  const postos = p.capacidadePorPosto > 0 ? Math.max(0, Math.ceil(obrig / p.capacidadePorPosto - 1e-9)) : obrig > 0 ? Number.POSITIVE_INFINITY : 0;
  return { producaoObrigatoriaAgora: obrig, postosMinimos: postos, viavel: p.postosMaximos === undefined || postos <= p.postosMaximos };
}

const quantidades = (ctx: CtxFluxo): Record<string, number> => Object.fromEntries(Object.values(ctx.grafo.nos).map((n) => [n.id, n.quantidade]));
const cacheMax = new WeakMap<CtxFluxo, Record<string, number>>();

/** Máximo possível (lo) do final de cada grupo (chave = id do nó final), com tudo no máximo desde aPartirDe. Independe do plano. */
export function maximosPossiveis(ctx: CtxFluxo): Record<string, number> {
  const memo = cacheMax.get(ctx);
  if (memo) return memo;
  const m = modelo(ctx);
  const T = ctx.entrada.slots.length;
  const caps: Record<string, CapNo> = {};
  Object.keys(ctx.grafo.nos).forEach((n) => {
    caps[n] = novaCap(T);
    for (let t = ctx.aPartirDe; t < T; t++) caps[n].base[t] = m.maquinas[n][t].length * m.mu[n][t];
  });
  const out: Record<string, number> = {};
  ctx.grafo.grupos.forEach((g, gi) => {
    const ini = ctx.iniAPartirDe.lo;
    const r = simularGrupo(ctx.grafo, ctx.grafo.grupos[gi], {
      tIni: ctx.aPartirDe, tFim: T, cap: caps, B0: ini.B0, W0: ini.W0, L0: ini.L0, Q: quantidades(ctx), mesmoPeriodo: ctx.opcoes.fluxoMesmoPeriodo !== false,
    });
    out[g.sink] = Math.min(ctx.grafo.nos[g.sink].quantidade, r.B[g.sink]);
  });
  cacheMax.set(ctx, out);
  return out;
}

/** Atingibilidade de cada grupo dado o final (lo) que o plano avaliado entrega (`finalPorGrupo`, chave = id do nó final). */
export function calcularAtingibilidade(ctx: CtxFluxo, finalPorGrupo: Record<string, number>): AtingibilidadePlano {
  const max = maximosPossiveis(ctx);
  const Q = quantidades(ctx);
  const grupos: AtingibilidadeGrupo[] = ctx.grafo.grupos.map((g) => {
    const sink = ctx.grafo.nos[g.sink];
    const meta = Q[g.sink];
    const M = max[g.sink];
    const final = Math.min(meta, finalPorGrupo[g.sink] ?? 0);
    const atingivel = M >= meta - TOL_ALCANCE;
    const faltaEvitavel = Math.max(0, Math.min(meta, M) - final);
    const entregue = final >= meta - TOL_ALCANCE;
    return {
      grupo: g.sink,
      produtos: sink.membros.map((k) => {
        const p = ctx.poolsPorChave.get(k)!;
        return { produtoId: p.produtoId, etapaFinalId: p.etapaId, quantidade: p.quantidade };
      }),
      meta: r3(meta),
      restante: r3(Math.max(0, meta - (ctx.iniAPartirDe.lo.B0[g.sink] ?? 0))),
      maximoPossivel: r3(M),
      atingivel,
      faltaInevitavel: r3(Math.max(0, meta - M)),
      finalPrevisto: r3(final),
      faltaEvitavel: r3(faltaEvitavel),
      status: entregue ? "META_ATINGIDA_PELO_PLANO" : !atingivel ? "META_NAO_ATINGIVEL" : "META_EM_CONFLITO",
    };
  });
  const atingiveisPerdidas = grupos.filter((x) => x.atingivel && x.finalPrevisto < x.meta - TOL_ALCANCE).length;
  const deficitRelativo = grupos.reduce((s, x) => s + (x.atingivel ? x.faltaEvitavel / Math.max(1, x.meta) : 0), 0);
  return { grupos, atingiveisPerdidas, deficitRelativo: Math.round(deficitRelativo * 1e9) / 1e9 };
}
