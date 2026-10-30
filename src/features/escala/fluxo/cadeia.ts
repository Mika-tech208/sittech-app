// PLANEJAMENTO DE CADEIA — CAMADA 1: DIAGNÓSTICO (producao_real_cadeia_diagnostico). PURO. NUNCA altera o plano.
//
// Regra do chão: toda ligação é LOTE_PROXIMO_PERIODO (o que a etapa anterior produz em Tn só serve à seguinte em Tn+1; `fluxoMesmoPeriodo=false`). Logo o upstream tem de estar ligado
// UM período antes de o downstream precisar do material ("último período seguro").
//
// simularCadeia valida o plano período a período (estoque início + produção do período ANTERIOR − consumo = estoque seguinte; consumo ≤ disponível no INÍCIO do período) e inclui UM
// período extra, informativo: o 1º do PRÓXIMO dia produtivo (estoque de saída), com consumo = min(capacidade do nó, demanda futura conhecida) — nunca infinito.
// As camadas 2 (Allowed/estoque de saída: estado.ts, planejar.ts) e 3 (reparo: cadeiaReparo.ts) reutilizam esta simulação. Nenhuma função lança.

import { chavePool, type AlocacaoEscala, type PoolEscala } from "../types";
import { capacidadeProximoDiaDoNo, demandaFuturaConhecida, type CtxFluxo } from "./estado";
import { capsDoPlano, selecionarFuturas } from "./avaliar";
import type { DiagnosticoItem } from "./tipos";

export const EPS_CADEIA = 1e-6;
const r1 = (v: number) => Math.round(v * 10) / 10;
/** Defasagem (períodos) entre produzir e poder consumir: 1 sob lote (fluxoMesmoPeriodo=false), 0 no regime contínuo. */
export const lagDe = (ctx: CtxFluxo) => (ctx.opcoes.fluxoMesmoPeriodo === false ? 1 : 0);

export interface ViolacaoCadeia {
  noId: string;
  produtoId: string;
  etapaId: string;
  slot: number; // índice absoluto do slot; === slots.length ⇒ 1º período do próximo dia produtivo
  proximoDia: boolean;
  desejada: number;
  disponivel: number;
  deficit: number;
  /** último período em que ligar o upstream ainda entrega o material a tempo (slot absoluto) */
  ultimoSeguro: number;
}
export interface SimCadeia {
  violacoes: ViolacaoCadeia[];
  /** Σ déficits (peças), incluindo o próximo dia — a "penalidade de cadeia" */
  deficit: number;
  /** estoque (peças) de cada ligação no INÍCIO de cada período a partir de aPartirDe (último índice = início do próximo dia) */
  wip: Record<string, number[]>;
}

export interface ExtraCadeia {
  /** produção extra (peças) por nó × slot absoluto — overlay do reparo, só para simular */
  producao: Record<string, Record<number, number>>;
}

export const muDoNo = (ctx: CtxFluxo, noId: string, periodoId: string): number =>
  Math.max(...ctx.grafo.nos[noId].membros.map((m) => { const p = ctx.poolsPorChave.get(m) as PoolEscala; return (p.metas[periodoId] ?? 0) * (ctx.fator[chavePool(p.produtoId, p.etapaId)] ?? 1); }), 0);

/** Valida a cadeia do plano (cenário de WIP `cen`, default pessimista "lo"). Linhas anteriores a aPartirDe são ignoradas (passado congelado). */
export function simularCadeia(ctx: CtxFluxo, linhas: AlocacaoEscala[], op: { cen?: "lo" | "hi"; extra?: ExtraCadeia; semProximoDia?: boolean } = {}): SimCadeia {
  const { grafo } = ctx;
  const T = ctx.entrada.slots.length;
  const a0 = ctx.aPartirDe;
  const lag = lagDe(ctx);
  const caps = capsDoPlano(ctx, selecionarFuturas(ctx, linhas));
  const W: Record<string, number> = { ...ctx.iniAPartirDe[op.cen ?? "lo"].W0 };
  const violacoes: ViolacaoCadeia[] = [];
  const wip: Record<string, number[]> = {};
  Object.keys(grafo.arestas).forEach((e) => (wip[e] = []));
  let deficit = 0;
  const known = new Map(grafo.grupos.map((g) => [g.id, demandaFuturaConhecida(ctx, g.sink)]));
  for (let t = a0; t < T + (op.semProximoDia ? 0 : 1); t++) {
    const prox = t === T;
    Object.keys(grafo.arestas).forEach((e) => wip[e].push(Math.max(0, W[e] ?? 0)));
    const Wini = { ...W };
    grafo.grupos.forEach((g) => {
      g.nos.forEach((n) => {
        const no = grafo.nos[n];
        const ins = grafo.entradas[n];
        if (prox && ins.length === 0) return;
        const desejada = prox
          ? Math.min(capacidadeProximoDiaDoNo(ctx, n), known.get(g.id) as number)
          : (caps[n].base[t] ?? 0) + (caps[n].adic[t] ?? 0) + (op.extra?.producao[n]?.[t] ?? 0);
        if (desejada <= EPS_CADEIA) return;
        const disp = (e: string) => Math.max(0, lag === 0 ? W[e] : Wini[e]);
        const avail = ins.length === 0 ? Number.POSITIVE_INFINITY : ins.reduce((s, e) => s + disp(e), 0);
        const prod = Math.min(desejada, avail);
        if (desejada - prod > EPS_CADEIA && ins.length > 0) {
          violacoes.push({ noId: n, produtoId: no.produtoId, etapaId: no.etapaId, slot: t, proximoDia: prox, desejada, disponivel: avail, deficit: desejada - prod, ultimoSeguro: t - lag });
          deficit += desejada - prod;
        }
        if (prox) return;
        if (ins.length > 0 && prod > EPS_CADEIA) {
          const tot = ins.reduce((s, e) => s + disp(e), 0);
          ins.forEach((e) => { W[e] -= tot > EPS_CADEIA ? (disp(e) / tot) * prod : 0; });
        }
        if (no.succ !== null) W[n] = (W[n] ?? 0) + prod;
      });
    });
  }
  return { violacoes, deficit, wip };
}

const rotuloSlot = (ctx: CtxFluxo, s: number) => (s >= ctx.entrada.slots.length ? "próx. dia produtivo (1º período)" : s < 0 ? "antes da semana" : `${ctx.entrada.slots[s].data} ${ctx.entrada.slots[s].periodoId}`);

/** Diagnósticos de cadeia do plano: CADEIA_INVALIDA (até 12 itens: nó, período, déficit, último período seguro) + CADEIA_COBERTURA (por ligação: estoque, consumo planejado, cobertura em períodos, ruptura). */
export function diagnosticosDeCadeia(ctx: CtxFluxo, sim: SimCadeia, linhas: AlocacaoEscala[]): DiagnosticoItem[] {
  const out: DiagnosticoItem[] = sim.violacoes.slice(0, 12).map((x) => ({
    codigo: "CADEIA_INVALIDA" as const, severidade: x.proximoDia ? ("info" as const) : ("aviso" as const), produtoId: x.produtoId, etapaId: x.etapaId, slot: x.slot,
    mensagem: `Cadeia sem material em ${rotuloSlot(ctx, x.slot)}: o posto quer ${Math.round(x.desejada)} peça(s) e há ${Math.round(x.disponivel)} (déficit ${Math.round(x.deficit)}); o upstream teria de ligar até ${rotuloSlot(ctx, x.ultimoSeguro)}`,
    detalhes: { deficit: r1(x.deficit), desejada: r1(x.desejada), disponivel: r1(x.disponivel), ultimoSeguro: x.ultimoSeguro, proximoDia: x.proximoDia, totalViolacoes: sim.violacoes.length },
  }));
  const caps = capsDoPlano(ctx, selecionarFuturas(ctx, linhas));
  const a0 = ctx.aPartirDe;
  const T = ctx.entrada.slots.length;
  Object.values(ctx.grafo.arestas).forEach((e) => {
    const consumo = Array.from({ length: Math.max(0, T - a0) }, (_, i) => (caps[e.destino].base[a0 + i] ?? 0) + (caps[e.destino].adic[a0 + i] ?? 0));
    const med = consumo.length > 0 ? consumo.reduce((s, v) => s + v, 0) / consumo.length : 0;
    const w0 = sim.wip[e.id]?.[0] ?? 0;
    const ruptura = sim.violacoes.filter((v) => v.noId === e.destino).sort((a, b) => a.slot - b.slot)[0];
    out.push({
      codigo: "CADEIA_COBERTURA", severidade: "info", produtoId: e.produtoId, etapaId: e.etapaOrigemId,
      mensagem: `Ligação ${rotuloSlot(ctx, a0)}: estoque ${Math.round(w0)}, consumo planejado ${Math.round(med)}/período, cobertura ${med > 0 ? r1(w0 / med) : "—"} período(s)${ruptura ? `, ruptura em ${rotuloSlot(ctx, ruptura.slot)} (ligar o upstream até ${rotuloSlot(ctx, ruptura.ultimoSeguro)})` : ", sem ruptura prevista"}`,
      detalhes: { wipInicial: r1(w0), consumoPorPeriodo: r1(med), coberturaPeriodos: med > 0 ? r1(w0 / med) : null, rupturaSlot: ruptura ? ruptura.slot : null, ultimoSeguro: ruptura ? ruptura.ultimoSeguro : null, deficit: ruptura ? r1(ruptura.deficit) : 0 },
    });
  });
  return out;
}
