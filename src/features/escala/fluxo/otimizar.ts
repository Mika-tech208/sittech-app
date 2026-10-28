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

export interface Modelo {
  mu: Record<string, number[]>; // capacidade de 1 posto do nó no slot (max dos membros × f)
  maquinas: Record<string, string[][]>; // nó -> slot -> máquinas disponíveis
  pessoas: number[]; // pessoas disponíveis no slot
}

export function modelo(ctx: CtxFluxo): Modelo {
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

interface EstadoSim { B: Record<string, number>; W: Record<string, number>; L: Record<string, number>; baseLeft: Record<string, number> }

export class Avaliador {
  caps: Record<string, CapNo> = {};
  private snap: EstadoSim[] = [];
  cursor: number;
  private Q: Record<string, number>;
  constructor(private ctx: CtxFluxo, private m: Modelo, private cnt: Contagens, private limites: Record<string, number>) {
    const T = ctx.entrada.slots.length;
    this.cursor = ctx.aPartirDe;
    this.Q = Object.fromEntries(Object.values(ctx.grafo.nos).map((n) => [n.id, n.quantidade]));
    Object.keys(ctx.grafo.nos).forEach((n) => {
      this.caps[n] = novaCap(T);
      for (let t = ctx.aPartirDe; t < T; t++) this.caps[n].base[t] = cnt[n][t] * m.mu[n][t];
    });
    const ini = ctx.iniAPartirDe.lo;
    this.snap = ctx.grafo.grupos.map((g) => ({
      B: Object.fromEntries(g.nos.map((n) => [n, ini.B0[n] ?? 0])),
      W: Object.fromEntries(g.arestas.map((e) => [e, ini.W0[e] ?? 0])),
      L: Object.fromEntries(g.arestas.map((e) => [e, ini.L0[e] ?? 0])),
      baseLeft: Object.fromEntries(g.nos.map((n) => [n, Math.max(0, limites[n] ?? Math.max(0, this.Q[n] - (ini.B0[n] ?? 0)))])),
    }));
  }
  private pesoGrupo(gi: number): number {
    if (!this.ctx.opcoes.ponderarPorValor) return 1;
    const v = this.ctx.grafo.nos[this.ctx.grafo.grupos[gi].sink].valorUnitario;
    return v > 0 ? v : 1;
  }
  private rodar(gi: number, de: number, ate: number, st: EstadoSim) {
    return simularGrupo(this.ctx.grafo, this.ctx.grafo.grupos[gi], {
      tIni: de, tFim: ate, cap: this.caps, B0: st.B, W0: st.W, L0: st.L, Q: this.Q, baseLeft0: st.baseLeft, mesmoPeriodo: this.ctx.opcoes.fluxoMesmoPeriodo !== false,
    });
  }
  /** valor do grupo a partir do cursor (cenário pessimista): peças finais entregues até o fim da semana */
  valor(gi: number): number {
    const sink = this.ctx.grafo.grupos[gi].sink;
    const r = this.rodar(gi, this.cursor, this.ctx.entrada.slots.length, this.snap[gi]);
    return this.pesoGrupo(gi) * Math.min(this.Q[sink], r.B[sink]);
  }
  /** Alcance do grupo (cenário pessimista) a partir do cursor com o slot do cursor COMO ESTÁ e TODOS os slots posteriores no MÁXIMO possível
   *  (todas as máquinas disponíveis × meta; pessoas não limitam — cota superior). Base da regra de preservação da atingibilidade. */
  valorFuturoMax(gi: number): number {
    const g = this.ctx.grafo.grupos[gi];
    const T = this.ctx.entrada.slots.length;
    const salvo = g.nos.map((n) => this.caps[n].base.slice(this.cursor + 1, T));
    g.nos.forEach((n) => {
      for (let s = this.cursor + 1; s < T; s++) this.caps[n].base[s] = this.m.maquinas[n][s].length * this.m.mu[n][s];
    });
    const v = this.valor(gi);
    g.nos.forEach((n, i) => {
      for (let s = this.cursor + 1; s < T; s++) this.caps[n].base[s] = salvo[i][s - this.cursor - 1];
    });
    return v;
  }
  /** meta (Q) e já entregue (B no cursor, cenário pessimista) do nó final do grupo */
  metaEEntregue(gi: number): { Q: number; B: number } {
    const sink = this.ctx.grafo.grupos[gi].sink;
    return { Q: this.Q[sink], B: this.snap[gi].B[sink] };
  }
  set(n: string, t: number, k: number) {
    this.cnt[n][t] = k;
    this.caps[n].base[t] = k * this.m.mu[n][t];
  }
  /** fixa o slot do cursor e avança o estado salvo */
  avancar() {
    this.ctx.grafo.grupos.forEach((_, gi) => {
      const r = this.rodar(gi, this.cursor, this.cursor + 1, this.snap[gi]);
      this.snap[gi] = { B: r.B, W: r.W, L: r.L, baseLeft: r.baseLeft };
    });
    this.cursor++;
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
  let alterados = 0;

  for (let t = ctx.aPartirDe; t < T; t++) {
    const K = m.pessoas[t];
    const candidatos = nos.filter((n) => m.maquinas[n][t].length > 0);
    if (candidatos.length > 0) {
      const antigo: Record<string, number> = Object.fromEntries(candidatos.map((n) => [n, cnt[n][t]]));
      const grupos = [...new Set(candidatos.map((n) => grupoIdx[n]))];
      const valorAntigo = Object.fromEntries(grupos.map((gi) => [gi, av.valor(gi)]));

      // guloso: zera o slot e vai somando o posto de maior ganho (re-simulação exata do grupo)
      candidatos.forEach((n) => av.set(n, t, 0));
      const usadas = new Set<string>();
      const novo: Record<string, number> = Object.fromEntries(candidatos.map((n) => [n, 0]));
      const valorGrupo: Record<number, number> = Object.fromEntries(grupos.map((gi) => [gi, av.valor(gi)]));
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
      const somaNovo = grupos.reduce((s, gi) => s + valorGrupo[gi], 0);
      const somaAntigo = grupos.reduce((s, gi) => s + valorAntigo[gi], 0);
      if (somaNovo > somaAntigo + 1e-6) {
        if (candidatos.some((n) => novo[n] !== antigo[n])) alterados++;
      } else {
        candidatos.forEach((n) => av.set(n, t, antigo[n])); // nunca troca por algo pior (guloso não é ótimo)
      }
    }
    av.avancar();
  }
  return { contagens: cnt, slotsAlterados: alterados };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// PRESERVAÇÃO DA ATINGIBILIDADE DA META SEMANAL (tier 1 da função objetivo) — regra geral, sem `if produto`.
//
// Em cada slot (varredura cronológica), para cada GRUPO (cadeia até um produto final) calcula-se:
//   alvo      = alcance máximo do produto final (cenário pessimista) se, a partir deste slot, TODAS as máquinas disponíveis de todas as etapas
//               trabalharem em todos os slots (cota superior; pessoas não limitam). É Q quando a meta é atingível; senão o máximo possível.
//   mínimos   = menor nº de postos por etapa NESTE slot que ainda mantém o alcance = alvo com tudo no máximo depois
//               (produção_obrigatória_agora = alvo − alcance com zero postos agora; postos_mínimos = ceil(obrigatória / capacidade_por_posto),
//               e, no fluxo, o mínimo é achado por re-simulação exata: material/WIP, gargalo upstream, dias restantes).
// Os mínimos entram ANTES do guloso de peças finais (tier 2): uma pessoa nunca é tirada de um produto cuja meta ainda é atingível só porque outra operação
// rende mais peças absolutas. Se os mínimos de todos os grupos não cabem nas pessoas/máquinas do slot, vale a prioridade global:
// maior falta relativa primeiro, depois a ordem estável dos grupos; o que ficar de fora vira META_NAO_ATINGIVEL por conflito (diagnóstico). Metas fisicamente
// inatingíveis NÃO reservam postos (seguem o ganho de peças finais).
// ---------------------------------------------------------------------------------------------------------------------------------

export const TOL_ALCANCE = 0.5; // peças
/** Offset de tier somado ao valor marginal dos postos mínimos (sempre acima de qualquer ganho de peças finais). */
export const OFFSET_TIER1 = 1e7;

export interface PreservacaoSlot {
  slot: number;
  grupo: string; // id do nó final
  alvo: number; // alcance máximo (peças finais) com tudo no máximo desde este slot
  meta: number; // Q do grupo
  atingivel: boolean; // alvo ≥ meta
  producaoObrigatoria: number; // alvo − alcance com ZERO postos neste slot
  minimos: Record<string, number>; // nó -> nº mínimo de postos neste slot
  atendido: boolean; // os mínimos escolhidos mantêm o alvo (false = não coube: conflito de pessoas/máquinas)
}

export interface ResultadoVarredura {
  contagens: Contagens;
  slotsAlterados: number;
  minimos: Contagens;
  preservacao: PreservacaoSlot[];
}

/** Varredura cronológica COM preservação da atingibilidade (tier 1) antes do ganho de peças finais (tier 2). */
export function varrerContagensPreservando(ctx: CtxFluxo, inicial: Contagens, limites: Record<string, number>, fixo = false, informativo = false): ResultadoVarredura {
  // informativo (só com fixo): calcula os mínimos de TODOS os grupos, inclusive os de meta inatingível (para manter o máximo possível), sem limite de pessoas — só para relatório
  const T = ctx.entrada.slots.length;
  const m = modelo(ctx);
  const cnt: Contagens = Object.fromEntries(Object.entries(inicial).map(([k, v]) => [k, [...v]]));
  const minimos: Contagens = Object.fromEntries(Object.keys(inicial).map((k) => [k, new Array(T).fill(0)]));
  const av = new Avaliador(ctx, m, cnt, limites);
  const nos = Object.values(ctx.grafo.nos).map((n) => n.id).sort();
  const grupoIdx: Record<string, number> = {};
  ctx.grafo.grupos.forEach((g, gi) => g.nos.forEach((n) => (grupoIdx[n] = gi)));
  const preservacao: PreservacaoSlot[] = [];
  let alterados = 0;

  for (let t = ctx.aPartirDe; t < T; t++) {
    const K = informativo && fixo ? Number.POSITIVE_INFINITY : m.pessoas[t];
    const candidatos = nos.filter((n) => m.maquinas[n][t].length > 0);
    if (candidatos.length > 0) {
      const antigo: Record<string, number> = Object.fromEntries(candidatos.map((n) => [n, cnt[n][t]]));
      const grupos = [...new Set(candidatos.map((n) => grupoIdx[n]))].sort((a, b) => a - b);
      const nosDe = (gi: number) => candidatos.filter((n) => grupoIdx[n] === gi);
      const valorAntigo = Object.fromEntries(grupos.map((gi) => [gi, av.valor(gi)]));

      // 1) alvo: tudo no máximo a partir deste slot (inclusive)
      const alvo: Record<number, number> = {};
      grupos.forEach((gi) => {
        nosDe(gi).forEach((n) => av.set(n, t, m.maquinas[n][t].length));
        alvo[gi] = av.valorFuturoMax(gi);
      });
      // 2) zera o slot; produção obrigatória = o que se perde sem nenhum posto aqui
      candidatos.forEach((n) => av.set(n, t, 0));
      const meta: Record<number, number> = {};
      const obrig: Record<number, number> = {};
      grupos.forEach((gi) => {
        meta[gi] = av.metaEEntregue(gi).Q;
        obrig[gi] = Math.max(0, alvo[gi] - av.valorFuturoMax(gi));
      });
      const atingivel = (gi: number) => alvo[gi] >= meta[gi] - TOL_ALCANCE;
      // Só metas ATINGÍVEIS entram no tier 1; as inatingíveis (máximo possível < meta) seguem o tier 2 (peças finais) e o diagnóstico META_NAO_ATINGIVEL.
      const ordem = grupos.filter((gi) => atingivel(gi) || (informativo && fixo)).sort((a, b) => {
        const ra = av.metaEEntregue(a);
        const rb = av.metaEEntregue(b);
        const fa = ra.Q > 0 ? (ra.Q - ra.B) / ra.Q : 0;
        const fb = rb.Q > 0 ? (rb.Q - rb.B) / rb.Q : 0;
        return fb - fa || a - b;
      });

      // 3) mínimos por grupo (guloso aditivo de menor nº de postos + poda), em ordem de prioridade global
      const usadas = new Set<string>();
      const novo: Record<string, number> = Object.fromEntries(candidatos.map((n) => [n, 0]));
      const minSlot: Record<string, number> = Object.fromEntries(candidatos.map((n) => [n, 0]));
      const maquinaLivre = (n: string): string | null => {
        const livres = m.maquinas[n][t].filter((x) => !usadas.has(x));
        if (livres.length === 0 || novo[n] >= m.maquinas[n][t].length) return null;
        const disputa = (x: string) => candidatos.filter((o) => o !== n && m.maquinas[o][t].includes(x)).length;
        return [...livres].sort((a, b) => disputa(a) - disputa(b) || (a < b ? -1 : 1))[0];
      };
      let escolhidos = 0;
      const atendido: Record<number, boolean> = {};
      // Parte do máximo (todas as máquinas livres do grupo) e PODA: o guloso aditivo emperra na complementaridade (etapa anterior × seguinte só rendem juntas).
      // 1) remove postos enquanto o alcance seguir ≥ alvo (etapas finais primeiro); 2) se ainda exceder as pessoas, remove o de menor perda de alcance (⇒ conflito).
      const ordemPoda = (gi: number) => [...nosDe(gi)].sort((x, y) => ctx.grafo.nos[y].ordem - ctx.grafo.nos[x].ordem || (x < y ? -1 : 1));
      for (const gi of ordem) {
        const meus: { n: string; maq: string }[] = [];
        for (const n of nosDe(gi)) {
          for (let maq = maquinaLivre(n); maq !== null; maq = maquinaLivre(n)) {
            novo[n] += 1;
            usadas.add(maq);
            meus.push({ n, maq });
          }
          av.set(n, t, novo[n]);
        }
        const remove = (i: number) => {
          const p = meus.splice(i, 1)[0];
          novo[p.n] -= 1;
          usadas.delete(p.maq);
          av.set(p.n, t, novo[p.n]);
        };
        const desfaz = (p: { n: string; maq: string }, i: number) => {
          meus.splice(i, 0, p);
          novo[p.n] += 1;
          usadas.add(p.maq);
          av.set(p.n, t, novo[p.n]);
        };
        let mudou = true;
        while (mudou) {
          mudou = false;
          for (const n of ordemPoda(gi)) {
            const i = meus.findIndex((q) => q.n === n);
            if (i < 0) continue;
            const p = meus[i];
            remove(i);
            if (av.valorFuturoMax(gi) >= alvo[gi] - TOL_ALCANCE) mudou = true;
            else desfaz(p, i);
          }
        }
        while (escolhidos + meus.length > K && meus.length > 0) {
          let melhor = { i: 0, v: Number.NEGATIVE_INFINITY };
          for (let i = meus.length - 1; i >= 0; i--) {
            const p = meus[i];
            remove(i);
            const v = av.valorFuturoMax(gi);
            desfaz(p, i);
            if (v > melhor.v + EPS_G) melhor = { i, v };
          }
          remove(melhor.i);
        }
        escolhidos += meus.length;
        atendido[gi] = av.valorFuturoMax(gi) >= alvo[gi] - TOL_ALCANCE;
        nosDe(gi).forEach((n) => (minSlot[n] = novo[n]));
      }

      if (fixo) {
        // modo diagnóstico: NÃO altera o plano; só informa os mínimos que a regra exigiria em cada período, dado o estado que ESTE plano produz até aqui
        candidatos.forEach((n) => av.set(n, t, antigo[n]));
        grupos.forEach((gi) => {
          const mins: Record<string, number> = {};
          nosDe(gi).forEach((n) => {
            mins[n] = minSlot[n];
            minimos[n][t] = mins[n];
          });
          preservacao.push({ slot: t, grupo: ctx.grafo.grupos[gi].sink, alvo: alvo[gi], meta: meta[gi], atingivel: atingivel(gi), producaoObrigatoria: obrig[gi], minimos: mins, atendido: atendido[gi] === true });
        });
        av.avancar();
        continue;
      }

      // 4) tier 2: guloso de peças finais com as pessoas que sobraram (igual a varrerContagens)
      const valorGrupo: Record<number, number> = Object.fromEntries(grupos.map((gi) => [gi, av.valor(gi)]));
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
      const somaNovo = grupos.reduce((s, gi) => s + valorGrupo[gi], 0);
      const somaAntigo = grupos.reduce((s, gi) => s + valorAntigo[gi], 0);
      const deficit = () => ordem.reduce((s, gi) => s + Math.max(0, alvo[gi] - av.valorFuturoMax(gi)) / Math.max(1, meta[gi]), 0);
      const defNovo = deficit();
      candidatos.forEach((n) => av.set(n, t, antigo[n]));
      const defAntigo = deficit();
      const aceita = defNovo < defAntigo - 1e-9 || (defNovo <= defAntigo + 1e-9 && somaNovo > somaAntigo + 1e-6);
      if (aceita) {
        candidatos.forEach((n) => av.set(n, t, novo[n]));
        if (candidatos.some((n) => novo[n] !== antigo[n])) alterados++;
      } // senão: contagens antigas (já restauradas) — nunca troca por algo pior (guloso não é ótimo)
      grupos.forEach((gi) => {
        const mins: Record<string, number> = {};
        nosDe(gi).forEach((n) => {
          mins[n] = Math.min(minSlot[n], cnt[n][t]);
          minimos[n][t] = mins[n];
        });
        preservacao.push({ slot: t, grupo: ctx.grafo.grupos[gi].sink, alvo: alvo[gi], meta: meta[gi], atingivel: atingivel(gi), producaoObrigatoria: obrig[gi], minimos: mins, atendido: atendido[gi] === true });
      });
    }
    av.avancar();
  }
  return { contagens: cnt, slotsAlterados: alterados, minimos, preservacao };
}

/** Tabela de valor marginal que reproduz as contagens: o k-ésimo posto de um nó vale o ganho de remover o último (≥ ε); fora das contagens, 0. */
export function tabelaMarginal(ctx: CtxFluxo, contagens: Contagens, limites: Record<string, number>, minimos?: Contagens): Record<string, Record<string, number[]>> {
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
      const obrig = Math.min(n, minimos?.[no.id]?.[t] ?? 0); // postos mínimos de preservação da atingibilidade: tier 1 (offset acima de qualquer ganho de peças)
      const lista = new Array(nmax).fill(0).map((_, k) => (k < n ? Math.round(v * 1000) / 1000 + (k < obrig ? OFFSET_TIER1 : 0) : 0));
      (out[String(t)] ??= {})[no.id] = lista;
    }
  });
  return out;
}
