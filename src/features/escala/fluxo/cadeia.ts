// PLANEJAMENTO DE CADEIA — DIAGNÓSTICO (producao_real_cadeia_diagnostico). PURO. SÓ OBSERVA: nunca altera plano, WIP, apontamento, Allowed, score nem pessoas.
//
// Regra do chão: toda ligação é LOTE_PROXIMO_PERIODO (o que a etapa anterior produz em Tn só serve à seguinte em Tn+1; `fluxoMesmoPeriodo=false`). Logo o upstream tem de estar
// ligado UM período antes de o downstream precisar do material ("último período seguro").
//
// simularCadeia valida o plano escolhido período a período: estoque(início) + produção do período ANTERIOR − consumo = estoque seguinte; o consumo de um período é limitado ao
// disponível no INÍCIO dele. Violação = nó × período em que o plano quer produzir mais do que há de material. Nenhuma função lança (o chamador captura).
//
// CONFIANÇA explícita em cada diagnóstico (nunca transforma WIP estimado em verdade física):
//   "contagem_fisica" = WIP do par ancorado em contagem física · "wip_controle" = saldo confirmado do wip_controle · "estimada" = WIP estimado pelos apontamentos · "incerta" = estimado com células não confirmadas.

import type { AlocacaoEscala } from "../types";
import type { CtxFluxo } from "./estado";
import { capsDoPlano, selecionarFuturas } from "./avaliar";
import type { DiagnosticoItem } from "./tipos";

export const EPS_CADEIA = 1e-6;
const r1 = (v: number) => Math.round(v * 10) / 10;
/** Defasagem (períodos) entre produzir e poder consumir: 1 sob lote (fluxoMesmoPeriodo=false), 0 no regime contínuo. */
export const lagDe = (ctx: CtxFluxo) => (ctx.opcoes.fluxoMesmoPeriodo === false ? 1 : 0);
/** Limites do payload (jsonb): no máximo N itens de cada tipo por recálculo. */
export const MAX_CADEIA_INVALIDA = 12;
export const MAX_CADEIA_COBERTURA = 20;

export type ConfiancaCadeia = "contagem_fisica" | "wip_controle" | "estimada" | "incerta";

export interface ViolacaoCadeia {
  noId: string;
  produtoId: string;
  etapaId: string;
  slot: number; // índice absoluto do slot
  desejada: number;
  disponivel: number;
  deficit: number;
  /** último período em que ligar o upstream ainda entrega o material a tempo (slot absoluto) */
  ultimoSeguro: number;
  /** ligações de entrada do nó (ids de aresta) */
  entradas: string[];
}
export interface SimCadeia {
  violacoes: ViolacaoCadeia[];
  /** Σ déficits (peças) */
  deficit: number;
  /** estoque (peças) de cada ligação no INÍCIO de cada período a partir de aPartirDe */
  wip: Record<string, number[]>;
}

/** Valida a cadeia do plano (cenário de WIP `cen`, default pessimista "lo"). Linhas anteriores a aPartirDe são ignoradas (passado congelado). Não escreve em nada. */
export function simularCadeia(ctx: CtxFluxo, linhas: AlocacaoEscala[], op: { cen?: "lo" | "hi" } = {}): SimCadeia {
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
  for (let t = a0; t < T; t++) {
    Object.keys(grafo.arestas).forEach((e) => wip[e].push(Math.max(0, W[e] ?? 0)));
    const Wini = { ...W };
    grafo.grupos.forEach((g) => {
      g.nos.forEach((n) => {
        const no = grafo.nos[n];
        const ins = grafo.entradas[n];
        const desejada = (caps[n].base[t] ?? 0) + (caps[n].adic[t] ?? 0);
        if (desejada <= EPS_CADEIA) return;
        const disp = (e: string) => Math.max(0, lag === 0 ? W[e] : Wini[e]);
        const avail = ins.length === 0 ? Number.POSITIVE_INFINITY : ins.reduce((s, e) => s + disp(e), 0);
        const prod = Math.min(desejada, avail);
        if (desejada - prod > EPS_CADEIA && ins.length > 0) {
          violacoes.push({ noId: n, produtoId: no.produtoId, etapaId: no.etapaId, slot: t, desejada, disponivel: avail, deficit: desejada - prod, ultimoSeguro: t - lag, entradas: ins });
          deficit += desejada - prod;
        }
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

/** Confiança do WIP de um conjunto de ligações (a pior): contagem física > wip_controle > estimada > incerta. Só descreve; não muda nada. */
export function confiancaDasLigacoes(ctx: CtxFluxo, arestas: string[]): ConfiancaCadeia {
  const ordem: ConfiancaCadeia[] = ["contagem_fisica", "wip_controle", "estimada", "incerta"];
  let pior = 0;
  arestas.forEach((id) => {
    const e = ctx.grafo.arestas[id];
    const par = ctx.pares.find((p) => p.produtoId === e.produtoId && p.etapaOrigemId === e.etapaOrigemId && p.etapaSeguinteId === e.etapaSeguinteId);
    const c: ConfiancaCadeia = !par ? "incerta" : par.fonteConfirmacao === "contagem_fisica" ? "contagem_fisica" : par.fonteConfirmacao === "wip_controle" ? "wip_controle" : par.confianca === "baixa" ? "incerta" : "estimada";
    pior = Math.max(pior, ordem.indexOf(c));
  });
  return ordem[pior];
}

const rotuloSlot = (ctx: CtxFluxo, s: number) => (s < 0 ? "antes da semana" : s >= ctx.entrada.slots.length ? "fim da semana" : `${ctx.entrada.slots[s].data} ${ctx.entrada.slots[s].periodoId}`);

/**
 * Diagnósticos do plano FINAL: CADEIA_INVALIDA (até 12: nó, período, produção planejada, material disponível, déficit, último período seguro, ação sugerida, confiança) e CADEIA_COBERTURA
 * (até 20 ligações: só as com ruptura prevista ou cobertura < 2 períodos). Severidade: aviso (INVALIDA) / info (COBERTURA). Nenhum é alerta da Escala.
 */
export function diagnosticosDeCadeia(ctx: CtxFluxo, sim: SimCadeia, linhas: AlocacaoEscala[]): DiagnosticoItem[] {
  const out: DiagnosticoItem[] = sim.violacoes.slice(0, MAX_CADEIA_INVALIDA).map((x) => {
    const conf = confiancaDasLigacoes(ctx, x.entradas);
    const porLigacao = x.entradas.map((e) => confiancaDasLigacoes(ctx, [e])).join("|");
    return {
      codigo: "CADEIA_INVALIDA" as const, severidade: "aviso" as const, produtoId: x.produtoId, etapaId: x.etapaId, slot: x.slot,
      mensagem: `Cadeia sem material em ${rotuloSlot(ctx, x.slot)}: produção planejada ${Math.round(x.desejada)}, material disponível ${Math.round(x.disponivel)}, déficit ${Math.round(x.deficit)}. Ação sugerida: o upstream precisava ter sido ligado até ${rotuloSlot(ctx, x.ultimoSeguro)} (confiança do WIP: ${conf}${x.entradas.length > 1 ? `; por ligação de entrada: ${porLigacao}` : ""})`,
      detalhes: {
        noId: x.noId, periodo: rotuloSlot(ctx, x.slot), producaoPlanejada: r1(x.desejada), materialDisponivel: r1(x.disponivel), deficit: r1(x.deficit), ultimoSeguro: x.ultimoSeguro, ultimoSeguroPeriodo: rotuloSlot(ctx, x.ultimoSeguro),
        acaoSugerida: `ligar o upstream até ${rotuloSlot(ctx, x.ultimoSeguro)}`, confiancaWip: conf, confiancaPorLigacao: porLigacao, totalViolacoes: sim.violacoes.length, planoAlterado: false,
      },
    };
  });
  const caps = capsDoPlano(ctx, selecionarFuturas(ctx, linhas));
  const a0 = ctx.aPartirDe;
  const T = ctx.entrada.slots.length;
  const itens = Object.values(ctx.grafo.arestas).map((e) => {
    const consumo = Array.from({ length: Math.max(0, T - a0) }, (_, i) => (caps[e.destino].base[a0 + i] ?? 0) + (caps[e.destino].adic[a0 + i] ?? 0));
    const med = consumo.length > 0 ? consumo.reduce((s, v) => s + v, 0) / consumo.length : 0;
    const w0 = sim.wip[e.id]?.[0] ?? 0;
    const ruptura = sim.violacoes.filter((v) => v.noId === e.destino).sort((a, b) => a.slot - b.slot)[0];
    return { e, med, w0, ruptura, cob: med > 0 ? w0 / med : null };
  }).filter((x) => x.med > 0 && (x.ruptura || (x.cob !== null && x.cob < 2)))
    .sort((a, b) => (a.cob ?? 99) - (b.cob ?? 99)).slice(0, MAX_CADEIA_COBERTURA);
  itens.forEach(({ e, med, w0, ruptura, cob }) => {
    const conf = confiancaDasLigacoes(ctx, [e.id]);
    out.push({
      codigo: "CADEIA_COBERTURA", severidade: "info", produtoId: e.produtoId, etapaId: e.etapaOrigemId,
      mensagem: `Ligação com ${rotuloSlot(ctx, a0)} como 1º período alterável: estoque ${Math.round(w0)}, consumo planejado ${Math.round(med)}/período, cobertura ${cob !== null ? r1(cob) : "—"} período(s)${ruptura ? `, ruptura em ${rotuloSlot(ctx, ruptura.slot)} (ligar o upstream até ${rotuloSlot(ctx, ruptura.ultimoSeguro)})` : ", sem ruptura prevista"} (confiança do WIP: ${conf})`,
      detalhes: { wipInicial: r1(w0), consumoPorPeriodo: r1(med), coberturaPeriodos: cob !== null ? r1(cob) : null, rupturaSlot: ruptura ? ruptura.slot : null, ultimoSeguro: ruptura ? ruptura.ultimoSeguro : null, deficit: ruptura ? r1(ruptura.deficit) : 0, confiancaWip: conf, planoAlterado: false },
    });
  });
  return out;
}
