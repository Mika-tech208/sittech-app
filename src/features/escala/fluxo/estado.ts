// ESTADO DA PRODUÇÃO (spec §1–§2) — puro. Transforma apontamentos + plano vigente no estado de fluxo (boas lo/hi, WIP por par) e na demanda
// por pool que entra no motor (remPorPool).
//
// Convenções:
//   • período FECHADO: fimMs + fechamentoMinutos ≤ agoraMs. Só ele vira "confirmado / zero_confirmado / nao_confirmado".
//   • período não fechado antes de aPartirDe (em andamento/comprometido): "futuro"; linhas já lançadas contam como produção REAL (lo = hi);
//     máquinas sem linha produzem pela capacidade das linhas congeladas (projeção).
//   • apontamento só entra se lancadoEmMs ≤ agoraMs; lançamento depois do fechamento do período é "tardio" (entra no estado, só afeta o futuro).

import { maquinaDisponivelNoSlot } from "../disponibilidade";
import { chavePool, type AlocacaoEscala, type EntradaEscala, type PoolEscala } from "../types";
import { EPS } from "../folga";
import { construirGrafo, type Grafo } from "./grafo";
import { copiarCaps, indiceDeSlots, novaCap, simularGrupo, somarCapacidadeDeLinhas, type CapNo, type ResultadoSim } from "./simulador";
import {
  VERSAO_FLUXO, type CelulaProducao, type DadosProducaoReal, type DemandaFluxoPool, type DiagnosticoItem, type EstadoCelula, type EstadoEtapa, type EstadoFluxo,
  type EstadoProduto, type EstadoWipPar, type Intervalo, type OpcoesFluxo, type ProjecaoNoCorte,
} from "./tipos";

export type OpcoesInternas = OpcoesFluxo;

export interface IniScenario {
  B0: Record<string, number>;
  W0: Record<string, number>;
  L0: Record<string, number>;
}

export interface CtxFluxo {
  entrada: EntradaEscala;
  dados: DadosProducaoReal;
  opcoes: OpcoesInternas;
  grafo: Grafo;
  poolsPorChave: Map<string, PoolEscala>;
  idxSlot: Map<string, number>;
  fator: Record<string, number>;
  fechamentoMinutos: number;
  ultimoFechado: number;
  aPartirDe: number;
  celulas: CelulaProducao[];
  etapas: EstadoEtapa[];
  pares: EstadoWipPar[]; // no corte (último fechado)
  iniBoundary: { lo: IniScenario; hi: IniScenario };
  /** capacidades de linhas congeladas e produção real nos slots (ultimoFechado, aPartirDe) */
  capsFixas: Record<string, CapNo>;
  projLo: ResultadoSim | null;
  projHi: ResultadoSim | null;
  iniAPartirDe: { lo: IniScenario; hi: IniScenario };
  diagnosticos: DiagnosticoItem[];
}

const MIN = 60_000;
const r1 = (v: number) => Math.round(v * 1000) / 1000;

export function poolsDeEntrada(entrada: EntradaEscala): Map<string, PoolEscala> {
  return new Map(entrada.pools.map((p) => [chavePool(p.produtoId, p.etapaId), p]));
}

interface AptChave { linhas: DadosProducaoReal["apontamentos"] }

export function prepararFluxo(entrada: EntradaEscala, dados: DadosProducaoReal, opcoes: OpcoesInternas = {}): CtxFluxo {
  const diagnosticos: DiagnosticoItem[] = [];
  const grafo = construirGrafo(entrada.pools, { paresLegado: opcoes.paresLegado, ligacoes: opcoes.ligacoes, fatoresEmbutidos: opcoes.fatoresEmbutidos });
  diagnosticos.push(...grafo.diagnosticos);
  const poolsPorChave = poolsDeEntrada(entrada);
  const idxSlot = indiceDeSlots(entrada.slots);
  const fator = opcoes.fatorPorPool ?? {};
  const fech = dados.fechamentoMinutos ?? 10;
  const T = entrada.slots.length;
  const aPartirDe = Math.min(Math.max(entrada.aPartirDe, 0), T);
  let ultimoFechado = -1;
  entrada.slots.forEach((s) => {
    if (s.fimMs + fech * MIN <= dados.agoraMs) ultimoFechado = s.indice;
  });
  ultimoFechado = Math.min(ultimoFechado, aPartirDe - 1);

  // ---- apontamentos visíveis, por (slot, máquina) ----
  const apt = new Map<string, AptChave>();
  dados.apontamentos.forEach((a) => {
    if (a.lancadoEmMs > dados.agoraMs || !a.maquinaId) return;
    const t = idxSlot.get(`${a.data}|${a.periodoId}`);
    if (t === undefined || t >= aPartirDe) return;
    const k = `${t}|${a.maquinaId}`;
    if (!apt.has(k)) apt.set(k, { linhas: [] });
    apt.get(k)!.linhas.push(a);
  });
  // ---- planejado por (slot, máquina) a partir do plano vigente ----
  const plano = new Map<string, { pool: string; planejado: number }>();
  dados.planoVigente.forEach((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId) return;
    const t = idxSlot.get(`${a.data}|${a.periodoId}`);
    if (t === undefined || t >= aPartirDe) return;
    const k = `${t}|${a.maquinaId}`;
    const pool = chavePool(a.produtoId, a.etapaId);
    const atual = plano.get(k);
    plano.set(k, { pool, planejado: (atual?.planejado ?? 0) + (a.pecas ?? 0) + (a.pecasAdicional ?? 0) });
  });

  // ---- células ----
  const celulas: CelulaProducao[] = [];
  const nosB = (): Record<string, Intervalo> => Object.fromEntries(Object.keys(grafo.nos).map((n) => [n, { lo: 0, hi: 0 }]));
  const Bfech = nosB();
  const capsFixas: Record<string, CapNo> = {};
  Object.keys(grafo.nos).forEach((n) => (capsFixas[n] = novaCap(T)));
  const ignorar = new Set<string>();
  const refugoPorEtapa: Record<string, number> = {};
  const naoConf: Record<string, { n: number; planejado: number }> = {};
  const zeroPorEtapa: Record<string, number> = {};
  const tardiosPorEtapa: Record<string, number> = {};
  const foraPlano: Record<string, number> = {};

  const chavesSlotMaq = new Set<string>([...apt.keys(), ...plano.keys()]);
  const ordenadas = [...chavesSlotMaq].sort((a, b) => {
    const [ta, ma] = a.split("|");
    const [tb, mb] = b.split("|");
    return Number(ta) - Number(tb) || (ma < mb ? -1 : ma > mb ? 1 : 0);
  });
  ordenadas.forEach((chave) => {
    const [ts, maquinaId] = chave.split("|");
    const t = Number(ts);
    const slot = entrada.slots[t];
    const fechado = t <= ultimoFechado;
    const linhas = apt.get(chave)?.linhas ?? [];
    const plan = plano.get(chave);
    const tardio = linhas.some((l) => l.lancadoEmMs > slot.fimMs + fech * MIN);
    const base = { slot: t, data: slot.data, periodoId: slot.periodoId, maquinaId };
    const dividirChave = (k: string) => {
      const [produtoId, etapaId] = k.split("|");
      return { produtoId, etapaId };
    };
    const produzindo = linhas.filter((l) => l.status === "produzindo");
    if (produzindo.length > 0) {
      ignorar.add(chave);
      const porPool = new Map<string, { boas: number; refugo: number }>();
      produzindo.forEach((l) => {
        const k = l.produtoId && l.etapaId ? chavePool(l.produtoId, l.etapaId) : plan?.pool;
        if (!k) return;
        const cur = porPool.get(k) ?? { boas: 0, refugo: 0 };
        cur.boas += Math.max(0, l.boas);
        cur.refugo += Math.max(0, l.refugo);
        porPool.set(k, cur);
      });
      [...porPool.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([k, v]) => {
        const no = grafo.noDoPool[k];
        if (!no) return;
        celulas.push({ ...base, ...dividirChave(k), estado: "confirmado", boas: { lo: v.boas, hi: v.boas }, refugo: v.refugo, planejado: plan?.pool === k ? plan.planejado : 0, motivo: null, tardio });
        refugoPorEtapa[k] = (refugoPorEtapa[k] ?? 0) + v.refugo;
        if (fechado) {
          Bfech[no].lo += v.boas;
          Bfech[no].hi += v.boas;
        } else capsFixas[no].real[t] += v.boas;
        if (plan && plan.pool !== k) foraPlano[k] = (foraPlano[k] ?? 0) + 1;
        if (tardio) tardiosPorEtapa[k] = (tardiosPorEtapa[k] ?? 0) + 1;
      });
      return;
    }
    if (linhas.length > 0) {
      ignorar.add(chave);
      const k = plan?.pool ?? (linhas[0].produtoId && linhas[0].etapaId ? chavePool(linhas[0].produtoId as string, linhas[0].etapaId as string) : null);
      if (!k || !grafo.noDoPool[k]) return;
      const motivo = linhas[0].motivo ?? "outro";
      celulas.push({ ...base, ...dividirChave(k), estado: "zero_confirmado", boas: { lo: 0, hi: 0 }, refugo: 0, planejado: plan?.pool === k ? plan.planejado : 0, motivo, tardio });
      zeroPorEtapa[k] = (zeroPorEtapa[k] ?? 0) + 1;
      if (motivo === "falta_material") {
        diagnosticos.push({ codigo: "SEM_PRODUCAO_FALTA_MATERIAL", severidade: "aviso", slot: t, ...dividirChave(k), mensagem: `Sem produção por falta de material em ${maquinaId} (${slot.data} ${slot.periodoId}): etapa temporariamente inviável`, detalhes: { maquinaId } });
      }
      if (tardio) tardiosPorEtapa[k] = (tardiosPorEtapa[k] ?? 0) + 1;
      return;
    }
    if (!plan || !grafo.noDoPool[plan.pool]) return;
    const estado: EstadoCelula = fechado ? "nao_confirmado" : "futuro";
    celulas.push({ ...base, ...dividirChave(plan.pool), estado, boas: { lo: 0, hi: fechado ? plan.planejado : 0 }, refugo: 0, planejado: plan.planejado, motivo: null, tardio: false });
    if (fechado) {
      Bfech[grafo.noDoPool[plan.pool]].hi += plan.planejado;
      const cur = naoConf[plan.pool] ?? { n: 0, planejado: 0 };
      naoConf[plan.pool] = { n: cur.n + 1, planejado: cur.planejado + plan.planejado };
    }
  });

  // linhas congeladas (slots entre o último fechado e aPartirDe): capacidade das máquinas SEM linha apontada.
  // Fonte: entrada.congeladas + (se faltar) o plano vigente do mesmo (slot, pessoa).
  const chaveLinha = (a: AlocacaoEscala) => `${a.data}|${a.periodoId}|${a.funcionarioId}`;
  const jaCongeladas = new Set(entrada.congeladas.map(chaveLinha));
  const congeladasFut = [
    ...entrada.congeladas,
    ...dados.planoVigente.filter((a) => (idxSlot.get(`${a.data}|${a.periodoId}`) ?? Number.POSITIVE_INFINITY) < aPartirDe && !jaCongeladas.has(chaveLinha(a))),
  ];
  somarCapacidadeDeLinhas(capsFixas, grafo, poolsPorChave, idxSlot, congeladasFut, fator, ultimoFechado + 1, aPartirDe, ignorar);

  // ---- etapas (estado agregado por pool) ----
  const ordemFinal = new Set(grafo.grupos.map((g) => g.sink));
  const etapas: EstadoEtapa[] = [...poolsPorChave.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, p]) => {
    const cs = celulas.filter((c) => chavePool(c.produtoId, c.etapaId) === k && c.slot <= ultimoFechado);
    return {
      produtoId: p.produtoId, etapaId: p.etapaId, ordemEtapa: p.ordemEtapa, final: ordemFinal.has(grafo.noDoPool[k]) && grafo.nos[grafo.noDoPool[k]].membros.includes(k),
      quantidade: p.quantidade, boas: { lo: cs.reduce((s, c) => s + c.boas.lo, 0), hi: cs.reduce((s, c) => s + c.boas.hi, 0) }, refugo: refugoPorEtapa[k] ?? 0,
      periodosNaoConfirmados: new Set(cs.filter((c) => c.estado === "nao_confirmado").map((c) => c.slot)).size,
      periodosZeroConfirmado: new Set(cs.filter((c) => c.estado === "zero_confirmado").map((c) => c.slot)).size,
      celulasNaoConfirmadas: cs.filter((c) => c.estado === "nao_confirmado").length,
    };
  });
  Object.entries(naoConf).sort().forEach(([k, v]) => {
    const [produtoId, etapaId] = k.split("|");
    diagnosticos.push({ codigo: "PRODUCAO_NAO_CONFIRMADA", severidade: "aviso", produtoId, etapaId, mensagem: `${v.n} posto(s)-período fechado(s) sem apontamento: produção entre 0 e ${Math.round(v.planejado)} peças (nunca assumida como planejada)`, detalhes: { celulas: v.n, planejado: r1(v.planejado) } });
  });
  Object.entries(tardiosPorEtapa).sort().forEach(([k, n]) => {
    const [produtoId, etapaId] = k.split("|");
    diagnosticos.push({ codigo: "AJUSTE_TARDIO", severidade: "info", produtoId, etapaId, mensagem: `${n} lançamento(s) chegaram após o fechamento do período: entram no estado, sem reescrever o passado`, detalhes: { celulas: n } });
  });
  Object.entries(foraPlano).sort().forEach(([k, n]) => {
    const [produtoId, etapaId] = k.split("|");
    diagnosticos.push({ codigo: "APONTAMENTO_FORA_DO_PLANO", severidade: "info", produtoId, etapaId, mensagem: `${n} apontamento(s) em pool diferente do planejado para a máquina/período`, detalhes: { celulas: n } });
  });

  // ---- WIP por aresta no corte ----
  const confirmados = dados.wipConfirmado ?? [];
  const pares: EstadoWipPar[] = [];
  const iniLo: IniScenario = { B0: {}, W0: {}, L0: {} };
  const iniHi: IniScenario = { B0: {}, W0: {}, L0: {} };
  Object.keys(grafo.nos).forEach((n) => {
    iniLo.B0[n] = Bfech[n].lo;
    iniHi.B0[n] = Bfech[n].hi;
  });
  Object.values(grafo.arestas).sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((e) => {
    const a = Bfech[e.origem];
    const d = Bfech[e.destino];
    const bruto: Intervalo = { lo: a.lo - e.peso * d.hi, hi: a.hi - e.peso * d.lo };
    let wip: Intervalo = { lo: Math.max(0, bruto.lo), hi: Math.max(0, bruto.hi) };
    const conf = confirmados.find((c) => c.produtoId === e.produtoId && c.etapaOrigemId === e.etapaOrigemId && c.etapaSeguinteId === e.etapaSeguinteId);
    let origem: EstadoWipPar["origem"] = "estimado";
    let confianca: EstadoWipPar["confianca"];
    const incerto = (etapas.find((x) => chavePool(x.produtoId, x.etapaId) === e.chavePar)?.celulasNaoConfirmadas ?? 0) > 0 ||
      grafo.nos[e.destino].membros.some((m) => (etapas.find((x) => chavePool(x.produtoId, x.etapaId) === m)?.celulasNaoConfirmadas ?? 0) > 0);
    const negativo = bruto.hi < -EPS;
    if (conf) {
      origem = "confirmado";
      const saldo = Math.max(0, conf.saldo);
      wip = { lo: saldo, hi: Math.max(saldo, wip.hi) };
      confianca = "alta";
      diagnosticos.push({ codigo: "WIP_CONFIRMADO_USADO", severidade: "info", produtoId: e.produtoId, etapaId: e.etapaOrigemId, mensagem: `Saldo de WIP confirmado (${Math.round(saldo)}) usado como piso do par`, detalhes: { saldo: r1(saldo) } });
    } else {
      confianca = incerto || bruto.lo < -EPS ? "baixa" : "media";
    }
    if (negativo && !conf) {
      diagnosticos.push({
        codigo: "WIP_NEGATIVO_ESTIMADO", severidade: "aviso", produtoId: e.produtoId, etapaId: e.etapaOrigemId,
        mensagem: `WIP estimado negativo (${Math.round(bruto.hi)}) mesmo no melhor caso: piso 0. Causas possíveis: estoque inicial desconhecido, apontamento inconsistente ou lançamento atrasado`, detalhes: { brutoHi: r1(bruto.hi), brutoLo: r1(bruto.lo) },
      });
    }
    pares.push({ produtoId: e.produtoId, etapaOrigemId: e.etapaOrigemId, etapaSeguinteId: e.etapaSeguinteId, origem, confianca, wip: { lo: r1(wip.lo), hi: r1(wip.hi) }, bruto: { lo: r1(bruto.lo), hi: r1(bruto.hi) }, negativo });
    iniLo.W0[e.id] = wip.lo;
    iniLo.L0[e.id] = wip.lo;
    iniHi.W0[e.id] = wip.hi;
    iniHi.L0[e.id] = wip.hi;
  });

  // ---- projeção até aPartirDe (linhas congeladas + produção real dos períodos não fechados) ----
  const projetar = (ini: IniScenario) => {
    const params = (cap: Record<string, CapNo>) => ({
      tIni: ultimoFechado + 1, tFim: aPartirDe, cap, B0: ini.B0, W0: ini.W0, L0: ini.L0, Q: Object.fromEntries(Object.values(grafo.nos).map((n) => [n.id, n.quantidade])), mesmoPeriodo: opcoes.fluxoMesmoPeriodo !== false,
    });
    const B: Record<string, number> = { ...ini.B0 };
    const W: Record<string, number> = { ...ini.W0 };
    const L: Record<string, number> = { ...ini.L0 };
    const x: Record<string, number[]> = {};
    const traj: Record<string, number[]> = {};
    grafo.grupos.forEach((g) => {
      const r = simularGrupo(grafo, g, params(capsFixas));
      Object.assign(B, r.B);
      Object.assign(W, r.W);
      Object.assign(L, r.L);
      Object.assign(x, r.x);
      Object.assign(traj, r.traj);
    });
    return { B, W, L, x, traj, baseLeft: {}, bloqueadoPelaMeta: 0, desperdicioBase: 0 } as ResultadoSim;
  };
  const projLo = projetar(iniLo);
  const projHi = projetar(iniHi);
  const iniAPartirDe = {
    lo: { B0: projLo.B, W0: projLo.W, L0: projLo.L },
    hi: { B0: projHi.B, W0: projHi.W, L0: { ...projHi.W } },
  };

  return {
    entrada, dados, opcoes, grafo, poolsPorChave, idxSlot, fator, fechamentoMinutos: fech, ultimoFechado, aPartirDe, celulas, etapas, pares,
    iniBoundary: { lo: iniLo, hi: iniHi }, capsFixas, projLo, projHi, iniAPartirDe, diagnosticos,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Capacidade futura e demanda de fluxo
// ---------------------------------------------------------------------------------------------------------------------------------

export function capacidadeFuturaDoNo(ctx: CtxFluxo, noId: string): { total: number; tetoPeriodo: number } {
  const no = ctx.grafo.nos[noId];
  const pools = no.membros.map((m) => ctx.poolsPorChave.get(m) as PoolEscala);
  const maquinas = [...new Set(pools.flatMap((p) => p.maquinasIds))].sort();
  let total = 0;
  let teto = 0;
  let tetoTodas = 0;
  for (let t = ctx.aPartirDe; t < ctx.entrada.slots.length; t++) {
    const slot = ctx.entrada.slots[t];
    const mu = Math.max(...pools.map((p) => (p.metas[slot.periodoId] ?? 0) * (ctx.fator[chavePool(p.produtoId, p.etapaId)] ?? 1)), 0);
    if (mu <= 0) continue;
    const disp = maquinas.filter((m) => maquinaDisponivelNoSlot(ctx.entrada, m, slot)).length;
    total += disp * mu;
    teto = Math.max(teto, disp * mu);
    tetoTodas = Math.max(tetoTodas, maquinas.length * mu);
  }
  return { total, tetoPeriodo: teto > 0 ? teto : tetoTodas };
}

export interface DemandaNo {
  need: number; // D_k
  allowed: number | null;
  consumoDownstream: number | null;
  teto: number | null;
  pipelineLo: number;
  pipelineHi: number;
  rem: number;
  limitadoPorUtilidade: boolean;
}

export function calcularDemanda(ctx: CtxFluxo): Record<string, DemandaNo> {
  const { grafo } = ctx;
  const W = (e: string, cen: "lo" | "hi") => Math.max(0, ctx.iniAPartirDe[cen].W0[e] ?? 0);
  const out: Record<string, DemandaNo> = {};
  const cap: Record<string, { total: number; tetoPeriodo: number }> = {};
  Object.keys(grafo.nos).forEach((n) => (cap[n] = capacidadeFuturaDoNo(ctx, n)));
  grafo.grupos.forEach((g) => {
    const rev = [...g.nos].reverse();
    // pipeline à frente do nó (estoque nas arestas à frente; sem partilha por peso: é limite superior conservador)
    const pipeLo: Record<string, number> = {};
    const pipeHi: Record<string, number> = {};
    const capDown: Record<string, number | null> = {}; // capacidade (peças) das etapas seguintes, limitada pela mais lenta; ignora pessoas
    const need: Record<string, number> = {};
    rev.forEach((n) => {
      const no = grafo.nos[n];
      if (no.succ === null) {
        pipeLo[n] = 0;
        pipeHi[n] = 0;
        capDown[n] = null;
        need[n] = Math.max(0, no.quantidade - (ctx.iniAPartirDe.lo.B0[n] ?? 0));
        return;
      }
      const e = grafo.arestas[n];
      const s = no.succ;
      pipeLo[n] = W(e.id, "lo") + e.peso * pipeLo[s]; // para a DEMANDA a parte do estoque à frente é repartida pelo peso do ramo
      pipeHi[n] = W(e.id, "hi") + pipeHi[s]; // para o TETO, o estoque à frente conta inteiro (conservador)
      capDown[n] = capDown[s] === null ? cap[s].total : Math.min(cap[s].total, capDown[s] as number);
      need[n] = Math.max(0, e.peso * need[s] - W(e.id, "lo"));
    });
    rev.forEach((n) => {
      const no = grafo.nos[n];
      if (no.succ === null) {
        out[n] = { need: need[n], allowed: null, consumoDownstream: null, teto: null, pipelineLo: 0, pipelineHi: 0, rem: need[n], limitadoPorUtilidade: false };
        return;
      }
      const e = grafo.arestas[n];
      const m = no.succ;
      const C = capDown[n] as number;
      // ramos irmãos que também alimentam `m`: cada um reivindica o que consegue entregar (estoque + produção possível, limitada à sua demanda),
      // no máximo a sua parte proporcional da capacidade. O que sobra é utilizável por este ramo (nunca menos que a sua parte proporcional).
      let reivindicado = 0;
      grafo.entradas[m].filter((o) => o !== e.id).forEach((o) => {
        const eo = grafo.arestas[o];
        reivindicado += Math.min(W(o, "hi") + Math.min(need[eo.origem], cap[eo.origem].total), eo.peso * C);
      });
      const consumo = Math.max(e.peso * C, C - reivindicado);
      const teto = cap[n].tetoPeriodo;
      const allowed = Math.max(0, consumo + teto - pipeHi[n]);
      const rem = Math.min(need[n], allowed);
      out[n] = { need: need[n], allowed, consumoDownstream: consumo, teto, pipelineLo: pipeLo[n], pipelineHi: pipeHi[n], rem, limitadoPorUtilidade: allowed + 1e-9 < need[n] };
    });
  });
  return out;
}

// rem legado do motor para um pool: Q − créditos congelados (idêntico a gerarEscala)
export function remLegado(entrada: EntradaEscala): Record<string, number> {
  const idx = indiceDeSlots(entrada.slots);
  const rem: Record<string, number> = {};
  entrada.pools.forEach((p) => (rem[chavePool(p.produtoId, p.etapaId)] = Math.max(0, p.quantidade)));
  entrada.congeladas.forEach((a: AlocacaoEscala) => {
    const i = idx.get(`${a.data}|${a.periodoId}`);
    if (i === undefined || i >= entrada.aPartirDe) return;
    if (a.maquinaId && a.produtoId && a.etapaId) {
      const k = chavePool(a.produtoId, a.etapaId);
      if (k in rem) rem[k] = Math.max(0, rem[k] - a.pecas);
    }
  });
  return rem;
}

export function estadoDaProducao(entrada: EntradaEscala, dados: DadosProducaoReal, opcoes: OpcoesInternas = {}): EstadoFluxo {
  const ctx = prepararFluxo(entrada, dados, opcoes);
  return montarEstado(ctx);
}

export function montarEstado(ctx: CtxFluxo): EstadoFluxo {
  const { grafo, entrada } = ctx;
  const diagnosticos = [...ctx.diagnosticos];
  const dem = calcularDemanda(ctx);
  const legado = remLegado(entrada);
  const remPorPool: Record<string, number> = {};
  const demanda: DemandaFluxoPool[] = [];
  [...ctx.poolsPorChave.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([k, p]) => {
    const n = grafo.noDoPool[k];
    const d = dem[n];
    const ehRep = n === k;
    const pipe: Intervalo = { lo: r1(d.pipelineLo), hi: r1(d.pipelineHi) };
    remPorPool[k] = ehRep ? r1(d.rem) : 0;
    demanda.push({
      chave: k, produtoId: p.produtoId, etapaId: p.etapaId, final: grafo.nos[n].final, remLegado: r1(legado[k]), demandaFluxo: ehRep ? r1(d.need) : 0,
      tetoUtilidade: d.allowed === null ? null : r1(d.allowed), consumoDownstream: d.consumoDownstream === null ? null : r1(d.consumoDownstream), tetoPeriodo: d.teto === null ? null : r1(d.teto),
      pipeline: pipe, remFluxo: remPorPool[k], limitadoPorUtilidade: d.limitadoPorUtilidade,
    });
    if (ehRep && d.limitadoPorUtilidade) {
      diagnosticos.push({
        codigo: "TETO_UTILIDADE_APLICADO", severidade: "info", produtoId: p.produtoId, etapaId: p.etapaId,
        mensagem: `Demanda de fluxo ${Math.round(d.need)} limitada a ${Math.round(d.rem)}: o que a(s) etapa(s) seguinte(s) consegue(m) consumir + 1 período não passa disso`, detalhes: { demanda: r1(d.need), teto: r1(d.rem) },
      });
    }
  });
  // produtos finais
  const produtos: EstadoProduto[] = [];
  grafo.grupos.forEach((g) => {
    const sink = grafo.nos[g.sink];
    const Blo = ctx.iniAPartirDe.lo.B0[g.sink] ?? 0;
    const Bhi = ctx.iniAPartirDe.hi.B0[g.sink] ?? 0;
    const bFech = ctx.iniBoundary;
    sink.membros.forEach((m) => {
      const p = ctx.poolsPorChave.get(m) as PoolEscala;
      const frac = sink.quantidade > 0 ? p.quantidade / sink.quantidade : 1 / sink.membros.length;
      const R = Math.max(0, sink.quantidade - Blo);
      void Bhi;
      produtos.push({
        produtoId: p.produtoId, etapaFinalId: p.etapaId, quantidadeFinal: p.quantidade,
        boasFinais: { lo: r1(bFech.lo.B0[g.sink] * frac), hi: r1(bFech.hi.B0[g.sink] * frac) },
        demandaFinalRestante: r1(Math.max(0, sink.quantidade - bFech.lo.B0[g.sink]) * frac), demandaFinalRestanteMin: r1(Math.max(0, sink.quantidade - bFech.hi.B0[g.sink]) * frac),
        restanteEmAPartirDe: r1(R * frac),
      });
      if (R <= 1e-9) diagnosticos.push({ codigo: "DEMANDA_FINAL_ATENDIDA", severidade: "info", produtoId: p.produtoId, etapaId: p.etapaId, mensagem: "Demanda final já atendida pelo confirmado: nada a produzir" });
    });
  });
  produtos.sort((a, b) => (a.produtoId < b.produtoId ? -1 : 1));
  const proj: ProjecaoNoCorte = { aPartirDe: ctx.aPartirDe, boas: {}, wip: {} };
  Object.keys(grafo.nos).sort().forEach((n) => (proj.boas[n] = { lo: r1(ctx.iniAPartirDe.lo.B0[n] ?? 0), hi: r1(ctx.iniAPartirDe.hi.B0[n] ?? 0) }));
  Object.keys(grafo.arestas).sort().forEach((e) => (proj.wip[e] = { lo: r1(ctx.iniAPartirDe.lo.W0[e] ?? 0), hi: r1(ctx.iniAPartirDe.hi.W0[e] ?? 0) }));
  return {
    versao: VERSAO_FLUXO, agoraMs: ctx.dados.agoraMs, fechamentoMinutos: ctx.fechamentoMinutos, ultimoFechado: ctx.ultimoFechado, aPartirDe: ctx.aPartirDe,
    celulas: ctx.celulas, etapas: ctx.etapas, produtos, pares: ctx.pares, projecao: proj, demanda, remPorPool, poolsFundidos: grafo.fusoes, diagnosticos,
  };
}

export { copiarCaps };
