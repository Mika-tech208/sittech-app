// AVALIAÇÃO DE PLANO (régua única) — simula o fluxo do plano a partir do estado projetado em aPartirDe.
// Usada IGUALMENTE para o plano oficial (base) e para o inteligente: mesmas suposições, mesmo simulador.

import { maquinaDisponivelNoSlot } from "../disponibilidade";
import { chavePool, type AlocacaoEscala, type EntradaEscala, type PoolEscala } from "../types";
import { calcularDemanda, capacidadeFuturaDoNo, prepararFluxo, type CtxFluxo, type OpcoesInternas } from "./estado";
import { calcularAtingibilidade, maximosPossiveis } from "./atingibilidade";
import { calcularFinanceiro, objetivoFinanceiro, precoDoGrupo } from "./financeiro";
import { copiarCaps, novaCap, simularGrupo, somarCapacidadeDeLinhas, type CapNo, type ResultadoSim } from "./simulador";
import {
  VERSAO_FLUXO, type AvaliacaoPlano, type AvaliacaoProduto, type DadosProducaoReal, type GargaloFluxo, type Intervalo, type PostoContribuicao, type TotaisAvaliacao, type TrajetoriaWip,
} from "./tipos";

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface OpcoesAvaliacao {
  limites?: Record<string, number>; // rem explícito (por chave de pool representante) com que o plano foi gerado
  contribuicoes?: boolean; // default true
  marginais?: boolean; // default false
  trajetoria?: boolean; // default true
}

interface RodadaGrupo { lo: ResultadoSim; hi: ResultadoSim }

export function capsDoPlano(ctx: CtxFluxo, futuras: AlocacaoEscala[]): Record<string, CapNo> {
  const T = ctx.entrada.slots.length;
  const caps: Record<string, CapNo> = {};
  Object.keys(ctx.grafo.nos).forEach((n) => (caps[n] = novaCap(T)));
  somarCapacidadeDeLinhas(caps, ctx.grafo, ctx.poolsPorChave, ctx.idxSlot, futuras, ctx.fator, ctx.aPartirDe, T);
  return caps;
}

export function quantidades(ctx: CtxFluxo): Record<string, number> {
  return Object.fromEntries(Object.values(ctx.grafo.nos).map((n) => [n.id, n.quantidade]));
}

export function rodar(ctx: CtxFluxo, gi: number, caps: Record<string, CapNo>, cen: "lo" | "hi", limites: Record<string, number> | undefined, trajetoria: boolean): ResultadoSim {
  const g = ctx.grafo.grupos[gi];
  const ini = ctx.iniAPartirDe[cen];
  return simularGrupo(ctx.grafo, g, {
    tIni: ctx.aPartirDe, tFim: ctx.entrada.slots.length, cap: caps, B0: ini.B0, W0: ini.W0, L0: ini.L0, Q: quantidades(ctx),
    ...(limites ? { limiteFut: { desde: ctx.aPartirDe, valor: limites } } : {}), mesmoPeriodo: ctx.opcoes.fluxoMesmoPeriodo !== false, trajetoria,
  });
}

export function pesoDoGrupo(ctx: CtxFluxo, gi: number): number {
  if (!ctx.opcoes.ponderarPorValor) return 1;
  const p = precoDoGrupo(ctx, gi, true); // preço CONGELADO da Previsão × peso comercial manual (default 1)
  return p > 0 ? p : 1;
}

/** Capacidade (peças) que UMA linha de alocação soma ao nó/slot — a mesma regra de `somarCapacidadeDeLinhas`, para aplicar/retirar linhas uma a uma. */
export function capacidadeDaLinha(ctx: CtxFluxo, a: AlocacaoEscala): { no: string; t: number; tipo: "base" | "adic"; valor: number } | null {
  if (!a.maquinaId || !a.produtoId || !a.etapaId) return null;
  const t = ctx.idxSlot.get(`${a.data}|${a.periodoId}`);
  if (t === undefined) return null;
  const k = chavePool(a.produtoId, a.etapaId);
  const no = ctx.grafo.noDoPool[k];
  const pool = ctx.poolsPorChave.get(k);
  if (!no || !pool) return null;
  const mu = (pool.metas[a.periodoId] ?? 0) * (ctx.fator[k] ?? 1);
  if (mu <= 0) return null;
  if ((a.pecasAdicional ?? 0) > 0 && !((a.pecas ?? 0) > 0)) return { no, t, tipo: "adic", valor: Math.min(mu, a.pecasAdicional as number) };
  return { no, t, tipo: "base", valor: mu };
}

export function selecionarFuturas(ctx: CtxFluxo, alocacoes: AlocacaoEscala[]): AlocacaoEscala[] {
  return alocacoes.filter((a) => (ctx.idxSlot.get(`${a.data}|${a.periodoId}`) ?? -1) >= ctx.aPartirDe);
}

export function avaliarComCtx(ctx: CtxFluxo, alocacoes: AlocacaoEscala[], op: OpcoesAvaliacao = {}): AvaliacaoPlano {
  const { grafo } = ctx;
  const futuras = selecionarFuturas(ctx, alocacoes);
  const caps = capsDoPlano(ctx, futuras);
  const traj = op.trajetoria !== false;
  const rodadas: RodadaGrupo[] = grafo.grupos.map((_, gi) => ({ lo: rodar(ctx, gi, caps, "lo", op.limites, traj), hi: rodar(ctx, gi, caps, "hi", op.limites, traj) }));
  const dem = calcularDemanda(ctx);

  const produtos: AvaliacaoProduto[] = [];
  const trajetoria: TrajetoriaWip[] = [];
  const postos: PostoContribuicao[] = [];
  const totais: TotaisAvaliacao = { faltaFinalLo: 0, faltaFinalHi: 0, finalEntregueLo: 0, finalEntregueHi: 0, faltaPonderada: 0, wipFinalLo: 0, wipFinalHi: 0, wipLegadoResidual: 0, excessoWip: 0, capacidadeGargalo: 0, capacidadeDesperdicada: 0, excessoFinal: 0 };
  const T = ctx.entrada.slots.length;
  const finalPorGrupo: Record<string, number> = {};
  const medirAtingibilidade = (ctx.opcoes.atingibilidadeModo ?? "off") !== "off";

  grafo.grupos.forEach((g, gi) => {
    const { lo, hi } = rodadas[gi];
    finalPorGrupo[g.sink] = lo.B[g.sink];
    const sink = grafo.nos[g.sink];
    const Q = sink.quantidade;
    const entLo = Math.min(Q, lo.B[g.sink]);
    const entHi = Math.min(Q, hi.B[g.sink]);
    const w = pesoDoGrupo(ctx, gi);
    totais.faltaFinalLo += Q - entLo;
    totais.faltaFinalHi += Q - entHi;
    totais.finalEntregueLo += entLo;
    totais.finalEntregueHi += entHi;
    totais.faltaPonderada += (Q - entLo) * w;
    totais.excessoFinal += lo.bloqueadoPelaMeta;
    totais.capacidadeDesperdicada += lo.desperdicioBase;

    // WIP final / legado / excesso por aresta
    const wipFinal: Record<string, Intervalo> = {};
    const legado: Record<string, number> = {};
    g.arestas.forEach((e) => {
      const ar = grafo.arestas[e];
      wipFinal[ar.chavePar] = { lo: r3(lo.W[e]), hi: r3(hi.W[e]) };
      legado[ar.chavePar] = r3(lo.L[e]);
      totais.wipFinalLo += lo.W[e];
      totais.wipFinalHi += hi.W[e];
      totais.wipLegadoResidual += lo.L[e];
      const w0hi = ctx.iniAPartirDe.hi.W0[e] ?? 0;
      const teto = Math.max(w0hi, capacidadeFuturaDoNo(ctx, ar.origem).tetoPeriodo);
      totais.excessoWip += Math.max(0, hi.W[e] - teto);
      if (objetivoFinanceiro(ctx.opcoes)) totais.excessoWip2p = (totais.excessoWip2p ?? 0) + Math.max(0, hi.W[e] - Math.max(w0hi, 2 * capacidadeFuturaDoNo(ctx, ar.origem).tetoPeriodo));
      if (traj) {
        trajetoria.push({
          chave: ar.chavePar,
          porSlot: lo.traj[e].map((v, i) => ({ slot: ctx.aPartirDe + i, lo: r3(v), hi: r3(hi.traj[e][i]) })),
        });
      }
    });

    // gargalo de fluxo: potencial = (capacidade futura do plano + estoque) que a etapa deixa passar até o final
    const capSum = (n: string) => caps[n].base.slice(ctx.aPartirDe, T).reduce((s, v) => s + v, 0) + caps[n].adic.slice(ctx.aPartirDe, T).reduce((s, v) => s + v, 0);
    const Wlo = (e: string) => Math.max(0, ctx.iniAPartirDe.lo.W0[e] ?? 0);
    const alem: Record<string, number> = {};
    const pesoCaminho: Record<string, number> = {};
    [...g.nos].reverse().forEach((n) => {
      const no = grafo.nos[n];
      if (no.succ === null) {
        alem[n] = 0;
        pesoCaminho[n] = 1;
        return;
      }
      alem[n] = Wlo(n) + alem[no.succ];
      pesoCaminho[n] = pesoCaminho[no.succ] * grafo.arestas[n].peso;
    });
    let melhor: { n: string; pot: number } | null = null;
    g.nos.forEach((n) => {
      const no = grafo.nos[n];
      const pot = no.succ === null ? capSum(n) : (capSum(n) + Wlo(n)) / Math.max(pesoCaminho[n], 1e-9) + alem[no.succ];
      if (melhor === null || pot < melhor.pot - 1e-9 || (Math.abs(pot - melhor.pot) <= 1e-9 && no.ordem >= grafo.nos[melhor.n].ordem)) melhor = { n, pot };
    });
    const Rf = dem[g.sink].need;
    const gargalo: GargaloFluxo | null = melhor === null ? null : { produtoId: grafo.nos[(melhor as { n: string }).n].produtoId, etapaId: grafo.nos[(melhor as { n: string }).n].etapaId, potencial: r3((melhor as { pot: number }).pot), folga: r3((melhor as { pot: number }).pot - Rf) };
    totais.capacidadeGargalo += melhor === null ? 0 : Math.min((melhor as { pot: number }).pot, Rf);

    sink.membros.forEach((m) => {
      const p = ctx.poolsPorChave.get(m) as PoolEscala;
      const frac = Q > 0 ? p.quantidade / Q : 1 / sink.membros.length;
      produtos.push({
        produtoId: p.produtoId, etapaFinalId: p.etapaId, quantidadeFinal: p.quantidade, finalEntregue: { lo: r3(entLo * frac), hi: r3(entHi * frac) },
        faltaFinal: { lo: r3((Q - entLo) * frac), hi: r3((Q - entHi) * frac) }, wipFinal, wipLegadoResidual: legado, gargaloFluxo: gargalo,
      });
    });

    // contribuição de cada posto (remoção marginal na re-simulação, cenário pessimista)
    if (op.contribuicoes !== false) {
      futuras.forEach((a) => {
        if (!a.maquinaId || !a.produtoId || !a.etapaId) return;
        const t = ctx.idxSlot.get(`${a.data}|${a.periodoId}`) as number;
        const k = chavePool(a.produtoId, a.etapaId);
        const n = grafo.noDoPool[k];
        if (!n || grafo.nos[n].grupo !== g.id || !g.nos.includes(n)) return;
        const pool = ctx.poolsPorChave.get(k) as PoolEscala;
        const mu = (pool.metas[a.periodoId] ?? 0) * (ctx.fator[k] ?? 1);
        if (mu <= 0) return;
        const c2 = copiarCaps(caps);
        if ((a.pecasAdicional ?? 0) > 0 && !((a.pecas ?? 0) > 0)) c2[n].adic[t] = Math.max(0, c2[n].adic[t] - Math.min(mu, a.pecasAdicional as number));
        else c2[n].base[t] = Math.max(0, c2[n].base[t] - mu);
        const sem = rodar(ctx, gi, c2, "lo", op.limites, false);
        const v = Math.min(Q, lo.B[g.sink]) - Math.min(Q, sem.B[g.sink]);
        if (v > 1e-6) postos.push({ slot: t, data: a.data, periodoId: a.periodoId, maquinaId: a.maquinaId, funcionarioId: a.funcionarioId, produtoId: a.produtoId, etapaId: a.etapaId, pecasFinais: r3(v) });
      });
    }
  });

  postos.sort((x, y) => x.slot - y.slot || (x.maquinaId < y.maquinaId ? -1 : x.maquinaId > y.maquinaId ? 1 : 0));
  const marginais = op.marginais ? calcularMarginais(ctx, alocacoes, op.limites) : {};
  (Object.keys(totais) as (keyof TotaisAvaliacao)[]).forEach((k) => (totais[k] = r3(totais[k] as number)));
  return {
    versao: VERSAO_FLUXO, produtos, totais, trajetoria, postos, marginais, diagnosticos: ctx.diagnosticos,
    ...(medirAtingibilidade ? { atingibilidade: calcularAtingibilidade(ctx, finalPorGrupo) } : {}),
    ...(medirAtingibilidade || objetivoFinanceiro(ctx.opcoes) ? { financeiro: calcularFinanceiro(ctx, finalPorGrupo, maximosPossiveis(ctx)) } : {}),
  };
}

/** Valor marginal (peças finais, cenário pessimista) do n-ésimo posto do nó em cada slot futuro, mantendo o resto do plano. */
export function calcularMarginais(ctx: CtxFluxo, alocacoes: AlocacaoEscala[], limites?: Record<string, number>): Record<string, Record<string, number[]>> {
  const { grafo } = ctx;
  const futuras = selecionarFuturas(ctx, alocacoes);
  const caps = capsDoPlano(ctx, futuras);
  const T = ctx.entrada.slots.length;
  const out: Record<string, Record<string, number[]>> = {};
  grafo.grupos.forEach((g, gi) => {
    const w = pesoDoGrupo(ctx, gi);
    g.nos.forEach((n) => {
      const no = grafo.nos[n];
      const pools = no.membros.map((m) => ctx.poolsPorChave.get(m) as PoolEscala);
      const maquinas = [...new Set(pools.flatMap((p) => p.maquinasIds))].sort();
      for (let t = ctx.aPartirDe; t < T; t++) {
        const slot = ctx.entrada.slots[t];
        const mu = Math.max(...pools.map((p) => (p.metas[slot.periodoId] ?? 0) * (ctx.fator[chavePool(p.produtoId, p.etapaId)] ?? 1)), 0);
        if (mu <= 0) continue;
        const nmax = maquinas.filter((m) => maquinaDisponivelNoSlot(ctx.entrada, m, slot)).length;
        if (nmax === 0) continue;
        const original = caps[n].base[t];
        const F: number[] = [];
        for (let k = 0; k <= nmax; k++) {
          caps[n].base[t] = k * mu;
          const r = rodar(ctx, gi, caps, "lo", limites, false);
          F.push(Math.min(no.quantidade, r.B[g.sink]) * w);
        }
        caps[n].base[t] = original;
        const V: number[] = [];
        for (let k = 0; k < nmax; k++) V.push(r3(Math.max(0, F[k + 1] - F[k])));
        for (let k = 1; k < V.length; k++) V[k] = Math.min(V[k], V[k - 1]);
        (out[String(t)] ??= {})[n] = V;
      }
    });
  });
  return out;
}

export function avaliarPlano(entrada: EntradaEscala, dados: DadosProducaoReal, alocacoes: AlocacaoEscala[], opcoes: OpcoesInternas = {}): AvaliacaoPlano {
  const ctx = prepararFluxo(entrada, dados, opcoes);
  return avaliarComCtx(ctx, alocacoes, {
    contribuicoes: true, marginais: opcoes.incluirMarginais === true, trajetoria: opcoes.incluirTrajetoria !== false, limites: opcoes.limitesRemPorPool,
  });
}
