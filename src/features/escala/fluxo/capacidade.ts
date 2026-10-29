// CAPACIDADE FÍSICA, SATURAÇÃO, VALOR MARGINAL e CUSTO DE OPORTUNIDADE por etapa/período (diagnóstico; não decide sozinho — a decisão usa a mesma re-simulação).
// Valor sem posto = ZERO: só máquinas selecionadas na Previsão (PoolEscala.maquinasIds), disponíveis (Paradas/bloqueios), pessoas presentes, material/WIP e absorção downstream.
import type { CtxFluxo } from "./estado";
import { calcularMarginais, capsDoPlano, rodar, selecionarFuturas } from "./avaliar";
import { modelo } from "./otimizar";
import { copiarCaps } from "./simulador";
import { precoDoGrupo } from "./financeiro";
import { chavePool, type AlocacaoEscala, type PoolEscala } from "../types";
import type { CapacidadeEtapaSlot, DecisaoEconomica, DiagnosticoCapacidade } from "./tipos";

const EPS = 1e-6;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function analisarCapacidade(ctx: CtxFluxo, alocacoes: AlocacaoEscala[], minimosPorNo?: Record<string, number[]>, limites?: Record<string, number>, nominais?: Record<string, Record<string, number>>): { capacidade: CapacidadeEtapaSlot[]; decisoes: DecisaoEconomica[] } {
  const T = ctx.entrada.slots.length;
  const m = modelo(ctx);
  const futuras = selecionarFuturas(ctx, alocacoes);
  const caps = capsDoPlano(ctx, futuras);
  const marg = calcularMarginais(ctx, alocacoes, limites);
  const ocup: Record<string, number[]> = {};
  Object.keys(ctx.grafo.nos).forEach((n) => (ocup[n] = new Array(T).fill(0)));
  futuras.forEach((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId) return;
    if ((a.pecasAdicional ?? 0) > 0 && !((a.pecas ?? 0) > 0)) return;
    const n = ctx.grafo.noDoPool[chavePool(a.produtoId, a.etapaId)];
    const t = ctx.idxSlot.get(`${a.data}|${a.periodoId}`);
    if (n && t !== undefined) ocup[n][t] += 1;
  });
  const gi = (n: string) => ctx.grafo.grupos.findIndex((g) => g.nos.includes(n));
  const valorUnit = (n: string) => precoDoGrupo(ctx, gi(n), true);
  const rows: CapacidadeEtapaSlot[] = [];
  const linhaDe = new Map<string, CapacidadeEtapaSlot>();
  const nosOrd = Object.keys(ctx.grafo.nos).sort();
  for (let t = ctx.aPartirDe; t < T; t++) {
    const slot = ctx.entrada.slots[t];
    const horas = Math.max(0.01, (slot.fimMin - slot.inicioMin) / 60);
    const totalOcup = nosOrd.reduce((s, n) => s + ocup[n][t], 0);
    const livres = Math.max(0, m.pessoas[t] - totalOcup);
    nosOrd.forEach((n) => {
      const no = ctx.grafo.nos[n];
      const pmax = m.maquinas[n][t].length;
      if (pmax === 0) return;
      const mu = m.mu[n][t];
      const pools = no.membros.map((k) => ctx.poolsPorChave.get(k) as PoolEscala);
      const nominal = Math.max(...pools.map((p) => nominais?.[chavePool(p.produtoId, p.etapaId)]?.[slot.periodoId] ?? (p.metas[slot.periodoId] ?? 0) / Math.max(1e-9, ctx.opcoes.fatoresEmbutidos?.[chavePool(p.produtoId, p.etapaId)] ?? 1)), 0);
      const V = marg[String(t)]?.[n] ?? [];
      const k = ocup[n][t];
      const vAdd = k < pmax ? (V[k] ?? 0) : 0;
      const vUlt = k > 0 ? V[k - 1] ?? 0 : 0;
      // produção da etapa com TODOS os postos (material/WIP e downstream) e com +1 posto: simulação exata
      const g = gi(n);
      const simCom = (postos: number) => {
        const c2 = copiarCaps(caps);
        c2[n].base[t] = postos * mu;
        const r = rodar(ctx, g, c2, "lo", limites, true);
        const i = t - ctx.aPartirDe;
        const ins = ctx.grafo.entradas[n];
        const wIni = ins.reduce((s, e) => s + (i === 0 ? ctx.iniAPartirDe.lo.W0[e] ?? 0 : r.traj[e][i - 1] ?? 0), 0);
        const prodPred = ins.reduce((s, e) => s + (r.x[ctx.grafo.arestas[e].origem]?.[i] ?? 0), 0);
        return { x: r.x[n][i] ?? 0, avail: ins.length === 0 ? Number.POSITIVE_INFINITY : wIni + prodPred };
      };
      const cheio = simCom(pmax);
      const capHumana = Math.min(pmax, m.pessoas[t]) * mu;
      const capEtapa = Math.min(capHumana, cheio.x);
      let diag: DiagnosticoCapacidade = "OK";
      if (k >= pmax) diag = "SATURADO_POR_POSTO";
      else if (vAdd > EPS) diag = livres <= 0 ? "GARGALO_PESSOA" : "OK";
      else {
        const um = simCom(k + 1);
        diag = um.x >= (k + 1) * mu - EPS ? "FOLGA_FUTURA" : um.avail <= um.x + EPS ? "GARGALO_WIP_MATERIAL" : "GARGALO_DOWNSTREAM";
      }
      const row: CapacidadeEtapaSlot = {
        slot: t, data: slot.data, periodoId: slot.periodoId, no: n, produtoId: no.produtoId, etapaId: no.etapaId, postosMaximos: pmax, postosOcupados: k, postosDisponiveis: pmax - k,
        postosMinimos: minimosPorNo?.[n]?.[t] ?? 0, pessoasElegiveis: m.pessoas[t], pessoasLivres: livres, produtividadeNominal: Math.round(nominal * 1000) / 1000, produtividadeEsperada: Math.round(mu * 1000) / 1000,
        receitaPorHoraPosto: r2(valorUnit(n) * mu / horas), capMaquinas: Math.round(pmax * mu * 1000) / 1000, capHumana: Math.round(capHumana * 1000) / 1000, capEtapa: Math.round(capEtapa * 1000) / 1000,
        producaoPlano: Math.round(Math.min(k * mu, cheio.avail === Number.POSITIVE_INFINITY ? k * mu : cheio.avail) * 1000) / 1000, valorMarginalAdicionar: r2(vAdd), valorMarginalUltimo: r2(vUlt), diagnostico: diag,
      };
      rows.push(row);
      linhaDe.set(`${t}|${n}`, row);
    });
  }
  // decisões: cada pessoa num posto, com o valor marginal do k-ésimo posto e a melhor alternativa livre no período (custo de oportunidade)
  const decisoes: DecisaoEconomica[] = [];
  const vistos = new Map<string, number>();
  futuras
    .filter((a) => a.maquinaId && a.produtoId && a.etapaId && !((a.pecasAdicional ?? 0) > 0 && !((a.pecas ?? 0) > 0)))
    .sort((a, b) => (ctxSlot(ctx, a) - ctxSlot(ctx, b)) || (a.maquinaId as string).localeCompare(b.maquinaId as string))
    .forEach((a) => {
      const t = ctxSlot(ctx, a);
      const n = ctx.grafo.noDoPool[chavePool(a.produtoId as string, a.etapaId as string)];
      const row = linhaDe.get(`${t}|${n}`);
      if (!row) return;
      const kk = (vistos.get(`${t}|${n}`) ?? 0) + 1;
      vistos.set(`${t}|${n}`, kk);
      const V = marg[String(t)]?.[n] ?? [];
      const valor = V[kk - 1] ?? 0;
      let alt: { no: string | null; valor: number } = { no: null, valor: 0 };
      rows.filter((r) => r.slot === t && r.no !== n && r.postosDisponiveis > 0).forEach((r) => { if (r.valorMarginalAdicionar > alt.valor) alt = { no: r.no, valor: r.valorMarginalAdicionar }; });
      const ha = valor > EPS || row.diagnostico === "OK" || row.diagnostico === "SATURADO_POR_POSTO";
      decisoes.push({
        slot: t, data: a.data, periodoId: a.periodoId, maquinaId: a.maquinaId as string, no: n, produtoId: a.produtoId as string, etapaId: a.etapaId as string, ordemPosto: kk,
        postosMaximos: row.postosMaximos, produtividadeEsperada: row.produtividadeEsperada, receitaMarginal: r2(valor), alternativa: { no: alt.no, valor: r2(alt.valor) }, ganhoLiquido: r2(valor - alt.valor),
        haMaterial: valor > EPS || row.diagnostico !== "GARGALO_WIP_MATERIAL", downstreamAbsorve: valor > EPS || row.diagnostico !== "GARGALO_DOWNSTREAM",
        texto: `Posto ${a.maquinaId} (${n}) em ${a.data} ${a.periodoId} é ocupado porque: posto ${kk} de ${row.postosMaximos}${ha ? "" : " (sem valor)"}, ${row.diagnostico === "GARGALO_WIP_MATERIAL" ? "SEM material/WIP" : "há material"}, ${row.diagnostico === "GARGALO_DOWNSTREAM" ? "downstream NÃO absorve" : "downstream absorve"}, produtividade esperada ${Math.round(row.produtividadeEsperada)} pç/período, receita marginal R$ ${r2(valor)}, alternativa seguinte R$ ${r2(alt.valor)}${alt.no ? ` (${alt.no})` : ""}, ganho líquido R$ ${r2(valor - alt.valor)}`,
      });
    });
  return { capacidade: rows, decisoes };
}

const ctxSlot = (ctx: CtxFluxo, a: AlocacaoEscala) => ctx.idxSlot.get(`${a.data}|${a.periodoId}`) ?? -1;
