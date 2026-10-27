// OTIMIZAÇÃO EM NÍVEL DE CONTAGENS (valor marginal por re-simulação) — puro.
//
// O motor decide POSTOS e PESSOAS; o fluxo só precisa saber QUANTOS postos de cada pool valem a pena em cada slot. Esta etapa varre os slots em
// ordem cronológica (Gauss-Seidel no tempo): para o slot t, dado o resto do plano (slots anteriores já atualizados, posteriores como estavam),
// escolhe por guloso com re-simulação exata os postos de maior ganho de peças finais, até acabar as pessoas disponíveis. Isso captura a
// complementaridade (etapa anterior só vale se a seguinte consome; a seguinte só vale se há material) sem tratar cada posto isoladamente.
// O resultado vira a tabela de valor marginal (EntradaEscala.ordemPostos) que o motor usa para escolher os postos — as pessoas, o revezamento
// e as demais restrições continuam sendo decididos (e garantidos) pelo motor.

import { maquinaDisponivelNoSlot } from "../disponibilidade";
import { sobrepoe } from "../tempo";
import { chavePool, type AlocacaoEscala, type PoolEscala } from "../types";
import { selecionarFuturas } from "./avaliar";
import type { CtxFluxo } from "./estado";
import { novaCap, simularGrupo, type CapNo } from "./simulador";

export type Contagens = Record<string, number[]>; // nó -> nº de postos do PREVISTO por slot absoluto

const EPS_G = 1e-9;
export const VALOR_MINIMO_SELECIONADO = 1e-3;

interface Modelo {
  mu: Record<string, number[]>; // capacidade de 1 posto do nó no slot (max dos membros × f)
  maquinas: Record<string, string[][]>; // nó -> slot -> máquinas disponíveis
  pessoas: number[]; // pessoas disponíveis no slot
}

function modelo(ctx: CtxFluxo): Modelo {
  const T = ctx.entrada.slots.length;
  const mu: Record<string, number[]> = {};
  const maquinas: Record<string, string[][]> = {};
  Object.values(ctx.grafo.nos).forEach((no) => {
    const pools = no.membros.map((m) => ctx.poolsPorChave.get(m) as PoolEscala);
    const todas = [...new Set(pools.flatMap((p) => p.maquinasIds))].sort();
    mu[no.id] = new Array(T).fill(0);
    maquinas[no.id] = [];
    for (let t = 0; t < T; t++) {
      const slot = ctx.entrada.slots[t];
      mu[no.id][t] = Math.max(...pools.map((p) => (p.metas[slot.periodoId] ?? 0) * (ctx.fator[chavePool(p.produtoId, p.etapaId)] ?? 1)), 0);
      maquinas[no.id][t] = t >= ctx.aPartirDe && mu[no.id][t] > 0 ? todas.filter((m) => maquinaDisponivelNoSlot(ctx.entrada, m, slot)) : [];
    }
  });
  const pessoas = ctx.entrada.slots.map((slot) =>
    [...new Set(ctx.entrada.funcionarios.map((f) => f.id))].filter(
      (f) => !ctx.entrada.ausencias.some((a) => a.funcionarioId === f && a.data === slot.data && (a.inicioMin === null || a.fimMin === null || sobrepoe(a.inicioMin, a.fimMin, slot.inicioMin, slot.fimMin)))
    ).length
  );
  return { mu, maquinas, pessoas };
}

export function contagensDoPlano(ctx: CtxFluxo, alocacoes: AlocacaoEscala[]): Contagens {
  const T = ctx.entrada.slots.length;
  const cnt: Contagens = {};
  Object.keys(ctx.grafo.nos).forEach((n) => (cnt[n] = new Array(T).fill(0)));
  selecionarFuturas(ctx, alocacoes).forEach((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId) return;
    if ((a.pecasAdicional ?? 0) > 0 && !((a.pecas ?? 0) > 0)) return; // carga adicional não entra na decisão de contagens
    const n = ctx.grafo.noDoPool[chavePool(a.produtoId, a.etapaId)];
    const t = ctx.idxSlot.get(`${a.data}|${a.periodoId}`);
    if (n && t !== undefined) cnt[n][t] += 1;
  });
  return cnt;
}

class Avaliador {
  caps: Record<string, CapNo> = {};
  constructor(private ctx: CtxFluxo, private m: Modelo, private cnt: Contagens, private limites: Record<string, number>) {
    const T = ctx.entrada.slots.length;
    Object.keys(ctx.grafo.nos).forEach((n) => {
      this.caps[n] = novaCap(T);
      for (let t = ctx.aPartirDe; t < T; t++) this.caps[n].base[t] = cnt[n][t] * m.mu[n][t];
    });
  }
  private pesoGrupo(gi: number): number {
    if (!this.ctx.opcoes.ponderarPorValor) return 1;
    const v = this.ctx.grafo.nos[this.ctx.grafo.grupos[gi].sink].valorUnitario;
    return v > 0 ? v : 1;
  }
  /** valor do grupo: peças finais (pessimista) + 1e-3 × (otimista) — o otimista só desempata */
  valor(gi: number): number {
    const g = this.ctx.grafo.grupos[gi];
    const T = this.ctx.entrada.slots.length;
    const f = (cen: "lo" | "hi") => {
      const ini = this.ctx.iniAPartirDe[cen];
      const r = simularGrupo(this.ctx.grafo, g, {
        tIni: this.ctx.aPartirDe, tFim: T, cap: this.caps, B0: ini.B0, W0: ini.W0, L0: ini.L0, Q: Object.fromEntries(Object.values(this.ctx.grafo.nos).map((n) => [n.id, n.quantidade])),
        limiteFut: { desde: this.ctx.aPartirDe, valor: this.limites }, mesmoPeriodo: this.ctx.opcoes.fluxoMesmoPeriodo !== false,
      });
      return Math.min(this.ctx.grafo.nos[g.sink].quantidade, r.B[g.sink]);
    };
    return this.pesoGrupo(gi) * (f("lo") + 1e-3 * f("hi"));
  }
  set(n: string, t: number, k: number) {
    this.cnt[n][t] = k;
    this.caps[n].base[t] = k * this.m.mu[n][t];
  }
}

/** Uma varredura cronológica. Devolve as novas contagens e quantos slots mudaram. */
export function varrerContagens(ctx: CtxFluxo, inicial: Contagens, limites: Record<string, number>): { contagens: Contagens; slotsAlterados: number } {
  const T = ctx.entrada.slots.length;
  const m = modelo(ctx);
  const cnt: Contagens = Object.fromEntries(Object.entries(inicial).map(([k, v]) => [k, [...v]]));
  const av = new Avaliador(ctx, m, cnt, limites);
  const nos = Object.values(ctx.grafo.nos).map((n) => n.id).sort();
  const grupoIdx: Record<string, number> = {};
  ctx.grafo.grupos.forEach((g, gi) => g.nos.forEach((n) => (grupoIdx[n] = gi)));
  const valorTotal = () => ctx.grafo.grupos.reduce((s, _, gi) => s + av.valor(gi), 0);
  let alterados = 0;

  for (let t = ctx.aPartirDe; t < T; t++) {
    const K = m.pessoas[t];
    const candidatos = nos.filter((n) => m.maquinas[n][t].length > 0);
    if (candidatos.length === 0) continue;
    const antigo: Record<string, number> = Object.fromEntries(candidatos.map((n) => [n, cnt[n][t]]));
    const valorAntigo = valorTotal();

    // guloso: zera o slot e vai somando o posto de maior ganho (re-simulação exata do grupo)
    candidatos.forEach((n) => av.set(n, t, 0));
    const usadas = new Set<string>();
    const novo: Record<string, number> = Object.fromEntries(candidatos.map((n) => [n, 0]));
    const valorGrupo: number[] = ctx.grafo.grupos.map((_, gi) => av.valor(gi));
    let escolhidos = 0;
    const maquinaLivre = (n: string): string | null => {
      const livres = m.maquinas[n][t].filter((x) => !usadas.has(x));
      if (livres.length === 0 || novo[n] >= m.maquinas[n][t].length) return null;
      // escolhe a máquina menos disputada por outros nós (para não bloquear quem só tem ela)
      const disputa = (x: string) => candidatos.filter((o) => o !== n && m.maquinas[o][t].includes(x)).length;
      return [...livres].sort((a, b) => disputa(a) - disputa(b) || (a < b ? -1 : 1))[0];
    };
    while (escolhidos < K) {
      let melhor: { n: string; ganho: number; maq: string } | null = null;
      for (const n of candidatos) {
        const maq = maquinaLivre(n);
        if (maq === null) continue;
        const gi = grupoIdx[n];
        av.set(n, t, novo[n] + 1);
        const ganho = av.valor(gi) - valorGrupo[gi];
        av.set(n, t, novo[n]);
        if (ganho > EPS_G && (melhor === null || ganho > melhor.ganho + EPS_G)) melhor = { n, ganho, maq };
      }
      if (melhor === null) break;
      novo[melhor.n] += 1;
      usadas.add(melhor.maq);
      av.set(melhor.n, t, novo[melhor.n]);
      valorGrupo[grupoIdx[melhor.n]] += melhor.ganho;
      escolhidos++;
    }
    const valorNovo = valorTotal();
    if (valorNovo > valorAntigo + 1e-6) {
      if (candidatos.some((n) => novo[n] !== antigo[n])) alterados++;
    } else {
      candidatos.forEach((n) => av.set(n, t, antigo[n])); // nunca troca por algo pior (guloso não é ótimo)
    }
  }
  return { contagens: cnt, slotsAlterados: alterados };
}

/** Tabela de valor marginal que reproduz as contagens: o k-ésimo posto de um nó vale o ganho de remover o último (≥ ε); fora das contagens, 0. */
export function tabelaMarginal(ctx: CtxFluxo, contagens: Contagens, limites: Record<string, number>): Record<string, Record<string, number[]>> {
  const T = ctx.entrada.slots.length;
  const m = modelo(ctx);
  const cnt: Contagens = Object.fromEntries(Object.entries(contagens).map(([k, v]) => [k, [...v]]));
  const av = new Avaliador(ctx, m, cnt, limites);
  const out: Record<string, Record<string, number[]>> = {};
  Object.values(ctx.grafo.nos).forEach((no) => {
    const gi = ctx.grafo.grupos.findIndex((g) => g.nos.includes(no.id));
    const base = av.valor(gi);
    for (let t = ctx.aPartirDe; t < T; t++) {
      const nmax = m.maquinas[no.id][t].length;
      if (nmax === 0) continue;
      const n = Math.min(cnt[no.id][t], nmax);
      let v = 0;
      if (n > 0) {
        av.set(no.id, t, n - 1);
        v = Math.max(VALOR_MINIMO_SELECIONADO, base - av.valor(gi));
        av.set(no.id, t, cnt[no.id][t]);
      }
      const lista = new Array(nmax).fill(0).map((_, k) => (k < n ? Math.round(v * 1000) / 1000 : 0));
      (out[String(t)] ??= {})[no.id] = lista;
    }
  });
  return out;
}
