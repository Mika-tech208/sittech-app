/* eslint-disable @typescript-eslint/no-explicit-any */
// Validador de cadeia NO GRAFO DO MOTOR (Etiquetar/Embalar fundidos) para planos em linhas de alocação (legado real, candidatos). Cópia adaptada do D7.
import { planejarComFluxo } from "@/features/escala/fluxo";
import { prepararFluxo, type CtxFluxo } from "@/features/escala/fluxo/estado";
import { entradaForecastDoPlano } from "@/features/escala/fluxo/forecastBufferPlano";
import { validarCadeia } from "@/features/escala/fluxo/planejamentoCadeia";
import { chavePool, type AlocacaoEscala } from "@/features/escala/types";
import type { ContagemFisicaPar, DadosProducaoReal } from "@/features/escala/fluxo";
import { A, AGORA, EXT, H, entrada, estimador, nomeO, nomeP, porProduto, soma, n0, type CenWip } from "./dados";
export const legadoGerado = undefined as unknown;
// ---------------- planos do motor (legado, fluxo atual) ----------------
const pares = A.d.cfg.paresLegado;
const opcoes = { paresLegado: pares, fluxoMesmoPeriodo: false };
export function contagensDe(cen: CenWip): ContagemFisicaPar[] {
  const out: ContagemFisicaPar[] = [];
  porProduto.forEach((ps, pid) => {
    const v = cen.wip[nomeP(pid)];
    if (!v) return;
    for (let k = 0; k + 1 < ps.length; k++) out.push({ produtoId: pid, etapaOrigemId: ps[k].etapaId, etapaSeguinteId: ps[k + 1].etapaId, saldo: v[k] ?? 0, contadoEmMs: AGORA, informadoPor: `cenário ${cen.nome}` });
  });
  return out;
}
export function ctxDe(cen: CenWip): CtxFluxo {
  const c = contagensDe(cen);
  const dados: DadosProducaoReal = { apontamentos: [], agoraMs: AGORA, fechamentoMinutos: 10, planoVigente: [], ...(c.length ? { contagensFisicas: c } : {}) };
  return prepararFluxo(entrada, dados, opcoes);
}

// ---------------- métricas de uma "produção por nó" na cadeia do motor ----------------
export interface Metr {
  plano: string; mundo: string; pecasFinais: number; receita: number; wipFinal: number; estoqueSaidaUtil: number; faltaMaterialPecas: number; postosSemMaterial: number; periodosComPostoSemMaterial: number;
  violacoes: number; primeiraFalta: string | null; cadeiaValida: boolean; upstreamEsquecidoPecas: number; upstreamPostosFaltantes: number; pessoasSemPosto: number; ligacoesInvalidas: { ligacao: string; periodo: string; falta: number }[];
  pecasPorProduto?: Record<string, number>;
}
export function validarNosNoMotor(ctx: CtxFluxo, nome: string, mundo: "meta" | "hist", cen: CenWip, producao: { prod: Record<string, number[]>; postos?: Record<string, number[]> } | AlocacaoEscala[], ref?: { prod: Record<string, number[]>; postos: Record<string, number[]> }): { m: Metr; nodeProd: Record<string, number[]>; nodePostos: Record<string, number[]> } {
  const alocs = Array.isArray(producao) ? producao : []; // para plano reverso usamos só a estrutura
  const rotuloNo = (k: string) => { const p = entrada.pools.find((x) => chavePool(x.produtoId, x.etapaId) === k); return p ? `${nomeO(p.operacaoId)} ${nomeP(p.produtoId).replace('Conector 3/4"', 'Con3/4').replace(' - Maquina Automatica', ' Autom')}` : k; };
  const { entrada: ef, mapa } = entradaForecastDoPlano(ctx, alocs, { rotuloNo, ...(mundo === "hist" ? { estimador } : {}), mesmoPeriodo: false });
  const grafo = ctx.grafo;
  // WIP do cenário por ligação do grafo
  const wip = new Map<string, number>();
  porProduto.forEach((ps, pid) => {
    const v = cen.wip[nomeP(pid)] ?? [];
    for (let k = 0; k + 1 < ps.length; k++) {
      const o = grafo.noDoPool[chavePool(pid, ps[k].etapaId)], d = grafo.noDoPool[chavePool(pid, ps[k + 1].etapaId)];
      const lg = ef.ligacoes.find((l) => l.origem === o && l.destino === d);
      if (lg) wip.set(lg.id, (wip.get(lg.id) ?? 0) + (v[k] ?? 0));
    }
  });
  ef.ligacoes.forEach((l) => { l.wipInicial = wip.get(l.id) ?? 0; l.wipInicialHi = l.wipInicial; });
  ef.nos.forEach((n) => (n.demandaRestante = null));
  let nodeProd: Record<string, number[]> = Object.fromEntries(ef.nos.map((n) => [n.id, n.producaoPrevista.slice()]));
  let nodePostos: Record<string, number[]> = Object.fromEntries(ef.nos.map((n) => [n.id, (n.postosPrevistos ?? new Array(H).fill(0)).slice()]));
  if (!Array.isArray(producao)) {
    nodeProd = Object.fromEntries(ef.nos.map((n) => [n.id, new Array(H).fill(0)]));
    nodePostos = Object.fromEntries(ef.nos.map((n) => [n.id, new Array(H).fill(0)]));
    Object.entries(producao.prod).forEach(([k, v]) => { const n = grafo.noDoPool[k]; v.forEach((x, t) => (nodeProd[n][t] += x)); });
    Object.entries(producao.postos ?? {}).forEach(([k, v]) => { const n = grafo.noDoPool[k]; v.forEach((x, t) => (nodePostos[n][t] += x)); });
  }
  const sim = validarCadeia(ef, nodeProd, { usarCapacidadeMaxima: false });
  const finais = ef.nos.filter((n) => !ef.ligacoes.some((l) => l.origem === n.id));
  const valorNo = (id: string) => Math.max(...(mapa.poolDoNo[id]?.membros ?? [id]).map((k) => entrada.pools.find((p) => chavePool(p.produtoId, p.etapaId) === k)?.valorUnitario ?? 0));
  const efFinal = (id: string) => soma(sim.nos.find((n) => n.noId === id)!.efetiva);
  const pecasFinais = soma(finais.map((n) => efFinal(n.id)));
  const receita = soma(finais.map((n) => efFinal(n.id) * valorNo(n.id)));
  const saldoFim = sim.ligacoes.map((l) => l.saldoFinal[l.saldoFinal.length - 1] ?? 0);
  const recPorPeriodo = (l: { destino: string }) => Math.max(...(mapa.poolDoNo[l.destino]?.membros ?? []).map((k) => entrada.pools.find((p) => chavePool(p.produtoId, p.etapaId) === k)?.quantidade ?? 0)) / H;
  const estoqueUtil = soma(ef.ligacoes.map((l, i) => Math.min(saldoFim[i], recPorPeriodo(l) * EXT)));
  const falta = soma(sim.nos.map((n) => soma(n.semMaterial)));
  const psm = soma(sim.nos.map((n) => soma(n.postosSemMaterial)));
  const periodosPSM = new Set<number>();
  sim.nos.forEach((n) => n.postosSemMaterial.forEach((v, t) => { if (v > 0.05) periodosPSM.add(t); }));
  const primeira = sim.violacoes.length ? sim.violacoes.reduce((a, b) => (b.periodo < a.periodo ? b : a)) : null;
  // upstream esquecido vs referência (reverso obrigatório no mesmo mundo)
  let esquecido = 0, faltPostos = 0;
  if (ref) {
    const upstream = ef.nos.filter((n) => ef.ligacoes.some((l) => l.origem === n.id));
    upstream.forEach((n) => {
      const cr = ref.prod[n.id] ?? new Array(H).fill(0), cp = nodeProd[n.id];
      let a = 0, b = 0, mx = 0;
      for (let t = 0; t < H; t++) { a += cr[t]; b += cp[t]; mx = Math.max(mx, a - b); }
      esquecido += mx;
      faltPostos += soma(cr.map((_, t) => Math.max(0, (ref.postos[n.id]?.[t] ?? 0) - (nodePostos[n.id]?.[t] ?? 0))));
    });
  }
  const semPosto = Array.isArray(producao) ? producao.filter((a) => !a.maquinaId).length : 0;
  const rot = (id: string) => ef.nos.find((n) => n.id === id)?.rotulo ?? id;
  return {
    nodeProd, nodePostos,
    m: {
      plano: nome, mundo, pecasFinais, receita, wipFinal: soma(saldoFim), estoqueSaidaUtil: estoqueUtil, faltaMaterialPecas: falta, postosSemMaterial: psm, periodosComPostoSemMaterial: periodosPSM.size, violacoes: sim.violacoes.length,
      primeiraFalta: primeira ? `${primeira.periodoRotulo} (${rot(primeira.noId)}: falta ${n0(primeira.falta)})` : null, cadeiaValida: sim.valido, upstreamEsquecidoPecas: esquecido, upstreamPostosFaltantes: faltPostos, pessoasSemPosto: semPosto,
      ligacoesInvalidas: sim.violacoes.slice(0, 12).map((v) => ({ ligacao: rot(v.noId), periodo: v.periodoRotulo, falta: Math.round(v.falta) })),
    },
  };
}

