/* eslint-disable @typescript-eslint/no-explicit-any */
// PLANO REVERSO da semana 2026-11-02 — SOMBRA, OFFLINE (estado de PROD só por SELECT, cache em disco). Nada é gravado, nenhuma flag/semana é ativada.
// Entrada: SQL_DIR (SELECTs da Previsão), cache D2 (histórico/apontamentos), WIP_JSON (cenário D opcional). Saída: OUT=json  MD=markdown.
// Rodar: scratchpad/D7/ts.sh scripts/auditoria-reverso/plano-reverso-0211.ts   (≈ 1 min)
import * as fs from "node:fs";
import * as path from "node:path";
import { montarEstado } from "../auditoria-buffer/carga1102";
import { abrir, estadoEm } from "../auditoria-buffer/comum";
import { CACHE } from "../auditoria-buffer/carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { avaliarPlano, planejarComFluxo } from "@/features/escala/fluxo";
import { prepararFluxo, type CtxFluxo } from "@/features/escala/fluxo/estado";
import { entradaForecastDoPlano } from "@/features/escala/fluxo/forecastBufferPlano";
import { criarEstimadorPosto } from "@/features/escala/fluxo/produtividadePosto";
import { validarCadeia } from "@/features/escala/fluxo/planejamentoCadeia";
import { planejarReverso, explicarCadeia, type ProdutoRev, type RecursoRev, type ResultadoReverso, type ResultadoProdutoRev } from "@/features/escala/fluxo/planoReverso";
import { maquinaDisponivelNoSlot } from "@/features/escala/disponibilidade";
import { chavePool, type AlocacaoEscala, type PoolEscala } from "@/features/escala/types";
import type { ContagemFisicaPar, DadosProducaoReal } from "@/features/escala/fluxo";

const AGORA = Date.parse("2026-11-02T06:00:00-03:00");
const AGORA_HOJE = Date.parse("2026-10-30T12:20:52-03:00");
const EXT = Number(process.env.EXT ?? 1);
const n0 = (v: number) => Math.round(v).toLocaleString("pt-BR");
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("pt-BR");
const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);

// ---------------- estado da Previsão ----------------
const { estado } = montarEstado();
const montada = montarEntradaEscala(estado, AGORA);
const entrada = montada.entrada;
const slots = entrada.slots;
const H = slots.length;
const nomeP = (id: string) => (estado.nomesProdutos?.[id] ?? id).trim();
const nomeO = (id: string) => estado.nomesOperacao[id] ?? id;
const nomeM = (id: string) => (estado.nomesMaquinas?.[id] ?? id).trim();
const rotuloPeriodo = (i: number) => `${slots[i].data.slice(8)}/${slots[i].data.slice(5, 7)} ${slots[i].periodoId.toUpperCase()}`;
const periodos = slots.map((s, i) => ({ rotulo: rotuloPeriodo(i), duracaoMin: s.fimMin - s.inicioMin }));
const pessoas = slots.map((s) => {
  const aus = new Set((entrada.ausencias ?? []).filter((x) => x.data === s.data && (x.inicioMin === null || x.fimMin === null || (x.inicioMin < s.fimMin && x.fimMin > s.inicioMin))).map((x) => x.funcionarioId));
  return entrada.funcionarios.filter((f) => !aus.has(f.id)).length;
});

// ---------------- histórico (produtividade do posto) ----------------
const A = abrir();
const todos = [...A.hist, ...A.d.apontamentos];
const estimador = criarEstimadorPosto(todos, AGORA_HOJE, { janelaDias: 14, nMin: 3 });

// ---------------- WIP: projeção do fim de hoje (engine) ----------------
const tAloc = fs.readFileSync(path.join(CACHE, "aloc_now.sql.out"), "utf8");
const planoHoje: AlocacaoEscala[] = JSON.parse(tAloc.slice(tAloc.indexOf("{"))).rows.map((a: any) => ({
  data: a.data, periodoId: a.periodo_id, funcionarioId: a.funcionario_id, maquinaId: a.maquina_id, produtoId: a.produto_id, etapaId: a.etapa_id, operacaoId: a.operacao_id,
  pecas: Number(a.pecas), ...(Number(a.pecas_adicional) > 0 ? { pecasAdicional: Number(a.pecas_adicional) } : {}), motivoSemPosto: a.motivo_sem_posto, origem: a.origem === "manual" ? "manual" : "auto",
}));
const E0 = estadoEm(A, AGORA_HOJE, planoHoje, { mesmoPeriodo: false });
const av0 = avaliarPlano(E0.ent, E0.dados, [...E0.ent.congeladas, ...planoHoje.filter((a) => A.ix(a) >= E0.ap)], { ...E0.opcoes, fluxoMesmoPeriodo: false });
const wipFinal: Record<string, { lo: number; hi: number }> = Object.assign({}, ...av0.produtos.map((p) => p.wipFinal));

// ---------------- produtos / rotas ----------------
const porProduto = new Map<string, PoolEscala[]>();
entrada.pools.forEach((p) => (porProduto.get(p.produtoId) ?? porProduto.set(p.produtoId, []).get(p.produtoId)!).push(p));
porProduto.forEach((ps) => ps.sort((a, b) => a.ordemEtapa - b.ordemEtapa));
const ehAutomatica = (id: string) => /Autom/i.test(nomeP(id));
const taxaPosto = (pool: PoolEscala, maq: string, t: number, mundo: "meta" | "hist") => {
  const meta = pool.metas[slots[t].periodoId] ?? 0;
  if (mundo === "meta") return meta;
  const tx = estimador({ produtoId: pool.produtoId, operacaoId: pool.operacaoId, maquinaId: maq });
  return meta * (tx.fonte === "historico" ? tx.razao : 1);
};
const maquinasTodas = [...new Set(entrada.pools.flatMap((p) => p.maquinasIds))];
const recursos: RecursoRev[] = maquinasTodas.map((m) => ({ id: m, rotulo: nomeM(m), unidades: slots.map((s) => (maquinaDisponivelNoSlot(entrada, m, s) ? 1 : 0)) }));
function produtosRev(mundo: "meta" | "hist", wip: Record<string, number[]>): ProdutoRev[] {
  return [...porProduto.entries()].map(([pid, ps]) => ({
    id: pid, rotulo: nomeP(pid), demandaFinal: ps[0].quantidade, valorUnitario: ps[0].valorUnitario, recorrentePorPeriodo: ps[0].quantidade / H,
    wipInicial: wip[nomeP(pid)] ?? new Array(Math.max(0, ps.length - 1)).fill(0),
    etapas: ps.map((p) => ({ id: p.etapaId, rotulo: `${nomeO(p.operacaoId)}`, alternativas: p.maquinasIds.map((m) => ({ recursoId: m, pecasPorPosto: slots.map((_, t) => taxaPosto(p, m, t, mundo)) })) })),
  }));
}

// ---------------- cenários de WIP inicial (início de 03/11) ----------------
const conv = [...porProduto.keys()].find((id) => /^Conector 3\/4"$/.test(nomeP(id)) || (nomeP(id).startsWith('Conector 3/4"') && !ehAutomatica(id))) as string;
const aut = [...porProduto.keys()].find((id) => ehAutomatica(id)) as string;
const cx = [...porProduto.keys()].find((id) => /Caixa/i.test(nomeP(id))) as string;
const NC = nomeP(conv), NA = nomeP(aut), NX = nomeP(cx);
const wipDoEngine = (cen: "lo" | "hi") => {
  const o: Record<string, number[]> = {};
  porProduto.forEach((ps, pid) => { o[nomeP(pid)] = ps.slice(0, -1).map((p) => Math.round(wipFinal[chavePool(pid, p.etapaId)]?.[cen] ?? 0)); });
  return o;
};
interface CenWip { nome: string; rotulo: string; wip: Record<string, number[]>; confianca: string; principal?: boolean }
const cenarios: CenWip[] = [
  { nome: "A", rotulo: "A · contagem 30/10 12:00 (6.000/6.000/3.600) tomada como estoque do início de 03/11 (OTIMISTA: ignora o resto de hoje)", wip: { [NC]: [6000, 6000, 3600], [NA]: [0, 0], [NX]: [2300] }, confianca: "baixa (contagem de 12:00, anterior ao consumo de T1–T3; arredondada)" },
  { nome: "B", rotulo: "B · estoque efetivo corrigido (Parafusar→Etiquetar −2.300 = 3.700; Rosquear→Parafusar ≈3.200; Etiquetar→Embalar 3.600)", wip: { [NC]: [3200, 3700, 3600], [NA]: [0, 0], [NX]: [2300] }, confianca: "baixa (estimado a partir da parada das 14:50 e da conservação PE+EE)" },
  { nome: "C", rotulo: "C · zero em todas as ligações", wip: { [NC]: [0, 0, 0], [NA]: [0, 0], [NX]: [0] }, confianca: "limite inferior (sem hipótese)" },
  { nome: "E-lo", rotulo: "E · projetado pelo motor para o FIM DE HOJE (T3 de 30/10 incluso), pessimista (lo)", wip: wipDoEngine("lo"), confianca: "média (reconstrução ±0,3 período; depende do plano de hoje ser cumprido)" },
  { nome: "E-hi", rotulo: "E · projetado pelo motor para o fim de hoje, otimista (hi)", wip: wipDoEngine("hi"), confianca: "média/baixa (limite superior do intervalo)" },
];
if (process.env.WIP_JSON && fs.existsSync(process.env.WIP_JSON)) {
  const j = JSON.parse(fs.readFileSync(process.env.WIP_JSON, "utf8"));
  Object.entries(j).filter(([k]) => k.startsWith("D")).forEach(([k, v]) => cenarios.unshift({ nome: k, rotulo: `D · contagem física final do dia (${k}) — PRINCIPAL`, wip: v as any, confianca: "alta (contagem por local informada pelo usuário)", principal: true }));
}
const PRINCIPAL = cenarios.find((c) => c.principal) ?? cenarios.find((c) => c.nome === "B")!;

// ---------------- modos da Máquina 8 ----------------
type Modo = "A_so_convencional" | "B_conv+M8" | "C_M8_prioridade";
function rodarReverso(cen: CenWip, mundo: "meta" | "hist", modo: Modo, ext = EXT, limitar = false): { res: ResultadoReverso; prods: ProdutoRev[] } {
  let prods = produtosRev(mundo, cen.wip);
  if (modo === "A_so_convencional") prods = prods.filter((p) => p.id !== aut);
  if (modo === "C_M8_prioridade") prods = [...prods.filter((p) => p.id === aut), ...prods.filter((p) => p.id !== aut)];
  const res = planejarReverso({ periodos, recursos, produtos: prods, pessoas, extensaoPeriodos: ext, compartilhamento: modo === "C_M8_prioridade" ? "prioridade" : "proporcional", limitarPorPessoas: limitar });
  return { res, prods };
}

// ---------------- planos do motor (legado, fluxo atual) ----------------
const pares = A.d.cfg.paresLegado;
const opcoes = { paresLegado: pares, fluxoMesmoPeriodo: false };
function contagensDe(cen: CenWip): ContagemFisicaPar[] {
  const out: ContagemFisicaPar[] = [];
  porProduto.forEach((ps, pid) => {
    const v = cen.wip[nomeP(pid)];
    if (!v) return;
    for (let k = 0; k + 1 < ps.length; k++) out.push({ produtoId: pid, etapaOrigemId: ps[k].etapaId, etapaSeguinteId: ps[k + 1].etapaId, saldo: v[k] ?? 0, contadoEmMs: AGORA, informadoPor: `cenário ${cen.nome}` });
  });
  return out;
}
const legado = gerarEscala(entrada).alocacoes;
const fluxoPorCen = new Map<string, AlocacaoEscala[]>();
const ctxPorCen = new Map<string, CtxFluxo>();
for (const cen of cenarios) {
  const c = contagensDe(cen);
  const dados: DadosProducaoReal = { apontamentos: [], agoraMs: AGORA, fechamentoMinutos: 10, planoVigente: [], ...(c.length ? { contagensFisicas: c } : {}) };
  fluxoPorCen.set(cen.nome, planejarComFluxo(entrada, dados, opcoes).resultado.alocacoes);
  ctxPorCen.set(cen.nome, prepararFluxo(entrada, dados, opcoes));
}

// ---------------- métricas de uma "produção por nó" na cadeia do motor ----------------
interface Metr {
  plano: string; mundo: string; pecasFinais: number; receita: number; wipFinal: number; estoqueSaidaUtil: number; faltaMaterialPecas: number; postosSemMaterial: number; periodosComPostoSemMaterial: number;
  violacoes: number; primeiraFalta: string | null; cadeiaValida: boolean; upstreamEsquecidoPecas: number; upstreamPostosFaltantes: number; pessoasSemPosto: number; ligacoesInvalidas: { ligacao: string; periodo: string; falta: number }[];
  pecasPorProduto?: Record<string, number>;
}
function validarNosNoMotor(ctx: CtxFluxo, nome: string, mundo: "meta" | "hist", cen: CenWip, producao: { prod: Record<string, number[]>; postos?: Record<string, number[]> } | AlocacaoEscala[], ref?: { prod: Record<string, number[]>; postos: Record<string, number[]> }): { m: Metr; nodeProd: Record<string, number[]>; nodePostos: Record<string, number[]> } {
  const alocs = Array.isArray(producao) ? producao : legado; // para plano reverso usamos só a estrutura
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

/** Converte o resultado reverso em produção por (pool) e postos por (pool), para o grafo do motor. */
function reversoComoNos(res: ResultadoReverso) {
  const prod: Record<string, number[]> = {}, postos: Record<string, number[]> = {};
  res.produtos.forEach((p) => p.etapas.forEach((e) => {
    const k = chavePool(p.produtoId, e.etapaId);
    prod[k] = p.plano[e.etapaId];
    postos[k] = e.postosObrigatorios.map((v, t) => v + e.postosAntecipacao[t]);
  }));
  return { prod, postos };
}
function reversoObrigatorioComoNos(res: ResultadoReverso) {
  const prod: Record<string, number[]> = {}, postos: Record<string, number[]> = {};
  res.produtos.forEach((p) => p.etapas.forEach((e) => { const k = chavePool(p.produtoId, e.etapaId); prod[k] = e.producaoObrigatoria; postos[k] = e.postosObrigatorios; }));
  return { prod, postos };
}

// ======================================================================================================================
const out: any = { gerado: "offline/sombra", semana: "2026-11-02", periodos: periodos.map((p) => p.rotulo), pessoasDisponiveis: pessoas, cenarios: cenarios.map((c) => ({ nome: c.nome, rotulo: c.rotulo, wip: c.wip, confianca: c.confianca })), reverso: {}, comparacao: [], metaXhist: {}, calendario: { diasProdutivos: estado.diasProdutivos, periodos: H } };
const md: string[] = [];
const P = (s = "") => md.push(s);
const MODOS: Modo[] = ["A_so_convencional", "B_conv+M8", "C_M8_prioridade"];

// 1) reverso: todos os cenários × mundos × modos
for (const cen of cenarios) for (const mundo of ["meta", "hist"] as const) for (const modo of MODOS) {
  const { res } = rodarReverso(cen, mundo, modo);
  (out.reverso[cen.nome] ??= {})[`${mundo}|${modo}`] = {
    headcountMinimo: res.headcountMinimo, picoComAntecipacao: res.picoComAntecipacao, periodosComDeficit: res.periodosComDeficit.length,
    produtos: res.produtos.map((p) => ({ produto: p.rotulo, demanda: p.demandaFinal, entregavel: p.entregavel, falta: p.faltaFinal, gargalo: p.etapas.find((e) => e.etapaId === p.gargaloEtapaId)?.rotulo ?? null, wipSaida: p.ligacoes.map((l) => l.wipProjetado[H]), postosPeriodo: p.etapas.map((e) => ({ etapa: e.rotulo, obrig: soma(e.postosObrigatorios), antec: soma(e.postosAntecipacao) })) })),
  };
}

// 2) comparação legado × fluxo × reverso (cenários principais × mundos)
const cenComp = [PRINCIPAL, ...["A", "B", "C", "E-lo"].map((n) => cenarios.find((c) => c.nome === n)!).filter((c) => c !== PRINCIPAL)];
for (const cen of cenComp) for (const mundo of ["meta", "hist"] as const) {
  const ctx = ctxPorCen.get(cen.nome)!;
  const { res } = rodarReverso(cen, mundo, "B_conv+M8");
  const refNos = reversoObrigatorioComoNos(res);
  // referência por nó do grafo
  const refProd: Record<string, number[]> = {}, refPostos: Record<string, number[]> = {};
  Object.entries(refNos.prod).forEach(([k, v]) => { const n = ctx.grafo.noDoPool[k]; refProd[n] ??= new Array(H).fill(0); refPostos[n] ??= new Array(H).fill(0); v.forEach((x, t) => (refProd[n][t] += x)); refNos.postos[k].forEach((x, t) => (refPostos[n][t] += x)); });
  const ref = { prod: refProd, postos: refPostos };
  const L = validarNosNoMotor(ctx, "legado (gerarEscala)", mundo, cen, legado, ref).m;
  const F = validarNosNoMotor(ctx, "fluxo atual (planejarComFluxo)", mundo, cen, fluxoPorCen.get(cen.nome)!, ref).m;
  const resL = rodarReverso(cen, mundo, "B_conv+M8", EXT, true).res;
  const R = validarNosNoMotor(ctx, "REVERSO com 12 pessoas (obrigatório + antecipação que sobra)", mundo, cen, reversoComoNos(resL), ref).m;
  const Ro = validarNosNoMotor(ctx, "reverso NECESSIDADE FÍSICA completa (exige mais de 12 pessoas)", mundo, cen, reversoObrigatorioComoNos(res), ref).m;
  R.pessoasSemPosto = 0; Ro.pessoasSemPosto = res.periodosComDeficit.length; // Ro: períodos com déficit de pessoas
  out.comparacao.push({ cenario: cen.nome, mundo, planos: [L, F, R, Ro], headcountReverso: { minimo: res.headcountMinimo, pico: res.picoComAntecipacao, periodosComDeficit: res.periodosComDeficit.length } });
}

// 3) meta × histórico por etapa (cenário principal, modo B)
{
  const rm = rodarReverso(PRINCIPAL, "meta", "B_conv+M8").res, rh = rodarReverso(PRINCIPAL, "hist", "B_conv+M8").res;
  const linhas: any[] = [];
  rm.produtos.forEach((pm, i) => pm.etapas.forEach((em, k) => {
    const eh = rh.produtos[i].etapas[k];
    const a = soma(em.postosObrigatorios), b = soma(eh.postosObrigatorios), pa = soma(em.producaoObrigatoria), pb = soma(eh.producaoObrigatoria);
    const dif = a > 0 ? (b - a) / a : 0;
    linhas.push({ produto: pm.rotulo, etapa: em.rotulo, postosMeta: a, postosHist: b, difPostosPct: dif * 100, pecasMeta: pa, pecasHist: pb, entregavelMeta: pm.entregavel, entregavelHist: rh.produtos[i].entregavel });
  }));
  // distribuição da razão histórico/meta por POSTO (máquina) — a base física da divergência
  const razoes: any[] = [];
  entrada.pools.forEach((p) => p.maquinasIds.forEach((m) => { const tx = estimador({ produtoId: p.produtoId, operacaoId: p.operacaoId, maquinaId: m }); razoes.push({ produto: nomeP(p.produtoId), etapa: nomeO(p.operacaoId), maquina: nomeM(m), razao: tx.razao, n: tx.n, fonte: tx.fonte }); }));
  out.metaXhist = { linhas, razoesPorPosto: razoes };
}

// ======================================================================================================================
// RELATÓRIO
// ======================================================================================================================
P(`# Plano reverso (backward planning) — semana 02/11/2026 — SOMBRA / OFFLINE`);
P();
P(`Gerado em ${new Date().toISOString()} · nada foi escrito em PROD · semana 02/11 **não** ativada (\`producao_real_semanas_ativas\` = ["2026-10-26"]) · motor ativo intocado.`);
P(`Calendário: dias produtivos ${estado.diasProdutivos.join(", ")} (02/11 Finados = NÃO produtiva) × 6 períodos (M1..T3) = **${H} períodos**. Pessoas disponíveis por período: ${[...new Set(pessoas)].join("/")} (equipe produtiva ativa; 0 ausências/indisponibilidades na semana).`);
P(`Regra: todas as ligações = LOTE (produção de Tn só serve em Tn+1). Produtividade por produto×operação×máquina (nunca por pessoa). Extensão do horizonte: ${EXT} período(s) de demanda recorrente da semana seguinte (09/11) para valorar o estoque de saída (limitado pela demanda conhecida).`);
P();
P(`## 0. Cenários de WIP inicial (estoque no início de 03/11)`);
P(`| Cenário | Rótulo | Conector 3/4 (Ros→Paf / Paf→Etiq / Etiq→Emb) | Automática (M8→Etiq / Etiq→Emb) | Caixa Amarela | Confiança |`);
P(`|---|---|---|---|---|---|`);
cenarios.forEach((c) => P(`| ${c.nome}${c.principal ? " (PRINCIPAL)" : ""} | ${c.rotulo} | ${(c.wip[NC] ?? []).map(n0).join(" / ")} | ${(c.wip[NA] ?? []).map(n0).join(" / ")} | ${(c.wip[NX] ?? []).map(n0).join(" / ")} | ${c.confianca} |`));
P(`\nCenário principal desta rodada: **${PRINCIPAL.nome}**${PRINCIPAL.principal ? "" : " (D — contagem física final do dia — ainda não informado; coloque os números em `WIP_JSON` e rode de novo, ≈1 min)"}.`);

// -------- Conector 3/4 convencional: tabela de necessidade --------
const modoMain: Modo = "B_conv+M8";
function tabelaConector(cen: CenWip, mundo: "meta" | "hist") {
  const { res } = rodarReverso(cen, mundo, modoMain);
  const pc = res.produtos.find((p) => p.produtoId === conv) as ResultadoProdutoRev;
  const pa = res.produtos.find((p) => p.produtoId === aut) as ResultadoProdutoRev;
  const [ros, paf, eti, emb] = pc.etapas;
  const m8 = pa.etapas[0], etiA = pa.etapas[1], embA = pa.etapas[2];
  P(`\n### Conector 3/4 · cenário ${cen.nome} · produtividade pela ${mundo === "meta" ? "META" : "HISTÓRICA do posto"} · modo B (convencional + Máquina 8 como rota própria da Automática; Etiquetadora 15 e Embalagem 17 com UMA capacidade)`);
  P(`Quantidades = peças a produzir no período (obrigatório + antecipação útil entre parênteses quando houver). Postos-período = peças ÷ peças por posto. WIP = estoque no INÍCIO do período, com o plano.`);
  P(`| Período | Rosquear | Parafusar | Máquina 8 (Autom.) | Etiquetar (conv + Autom.) | Embalar (conv + Autom.) | WIP Ros→Paf | WIP Paf→Etiq | WIP Etiq→Emb | WIP M8→Etiq | postos R / P / M8 / E / B |`);
  P(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|`);
  const q = (e: any, t: number) => { const o = e.producaoObrigatoria[t], a = e.producaoAntecipacao[t]; return o + a > 0.5 ? `${n0(o)}${a > 0.5 ? ` (+${n0(a)})` : ""}` : "·"; };
  const ps = (e: any, t: number) => e.postosObrigatorios[t] + e.postosAntecipacao[t];
  for (let t = 0; t < H; t++) {
    const etQ = (eti.producaoObrigatoria[t] + etiA.producaoObrigatoria[t]), etA = eti.producaoAntecipacao[t] + etiA.producaoAntecipacao[t];
    const emQ = emb.producaoObrigatoria[t] + embA.producaoObrigatoria[t], emA = emb.producaoAntecipacao[t] + embA.producaoAntecipacao[t];
    P(`| ${periodos[t].rotulo} | ${q(ros, t)} | ${q(paf, t)} | ${q(m8, t)} | ${etQ + etA > 0.5 ? `${n0(etQ)}${etA > 0.5 ? ` (+${n0(etA)})` : ""}` : "·"} | ${emQ + emA > 0.5 ? `${n0(emQ)}${emA > 0.5 ? ` (+${n0(emA)})` : ""}` : "·"} | ${n0(pc.ligacoes[0].wipProjetado[t])} | ${n0(pc.ligacoes[1].wipProjetado[t])} | ${n0(pc.ligacoes[2].wipProjetado[t])} | ${n0(pa.ligacoes[0].wipProjetado[t])} | ${n1(ps(ros, t))} / ${n1(ps(paf, t))} / ${n1(ps(m8, t))} / ${n1(ps(eti, t) + ps(etiA, t))} / ${n1(ps(emb, t) + ps(embA, t))} |`);
  }
  P(`| **Σ** | ${n0(soma(ros.producaoObrigatoria))} (+${n0(soma(ros.producaoAntecipacao))}) | ${n0(soma(paf.producaoObrigatoria))} (+${n0(soma(paf.producaoAntecipacao))}) | ${n0(soma(m8.producaoObrigatoria))} (+${n0(soma(m8.producaoAntecipacao))}) | ${n0(soma(eti.producaoObrigatoria) + soma(etiA.producaoObrigatoria))} | ${n0(soma(emb.producaoObrigatoria) + soma(embA.producaoObrigatoria))} | | | | | postos-período Σ: R ${n1(soma(ros.postosObrigatorios))} · P ${n1(soma(paf.postosObrigatorios))} · M8 ${n1(soma(m8.postosObrigatorios))} · E ${n1(soma(eti.postosObrigatorios) + soma(etiA.postosObrigatorios))} · B ${n1(soma(emb.postosObrigatorios) + soma(embA.postosObrigatorios))} |`);
  P(`\nEntregável: convencional ${n0(pc.entregavel)} de ${n0(pc.demandaFinal)} (falta ${n0(pc.faltaFinal)}) · Automática ${n0(pa.entregavel)} de ${n0(pa.demandaFinal)} (falta ${n0(pa.faltaFinal)}). Gargalo conv: ${pc.etapas.find((e) => e.etapaId === pc.gargaloEtapaId)?.rotulo ?? "(demanda atendida)"}; Autom: ${pa.etapas.find((e) => e.etapaId === pa.gargaloEtapaId)?.rotulo ?? "(demanda atendida)"}. Avisos: ${[...pc.avisos, ...pa.avisos].join(" | ") || "—"}`);
  return { res, pc, pa };
}
P(`\n## 1. Conector 3/4 — plano reverso (primeira entrega)`);
const main = tabelaConector(PRINCIPAL, "meta");
tabelaConector(PRINCIPAL, "hist");

// item 5: tabela principal por produto (linhas de uso)
P(`\n### Tabela de uso (item 5) — Conector 3/4 convencional, cenário ${PRINCIPAL.nome}, meta. Só períodos de uso com necessidade.`);
P(`| Período de uso | Etapa downstream | Qtd necessária | WIP disponível | Necessidade líquida | Etapa upstream que precisa produzir | Último período seguro p/ produzir | Postos-período |`);
P(`|---|---|---:|---:|---:|---|---|---:|`);
main.pc.ligacoes.slice().reverse().forEach((lg) => lg.linhas.forEach((l) => P(`| ${l.periodoRotulo} | ${l.etapaDownstream} | ${n0(l.quantidadeNecessaria)} | ${n0(l.wipDisponivel)} | ${n0(l.necessidadeLiquida)} | ${l.etapaUpstream} | ${l.ultimoPeriodoSeguroRotulo ?? "(coberta pelo WIP)"} | ${n1(l.postosPeriodoNecessarios)} |`)));

// item 6: cadeia legível
P(`\n### Explicação em cadeia (item 6) — cenário ${PRINCIPAL.nome}, meta`);
{
  const rot = main.pc.etapas.map((e) => e.rotulo);
  const usos = [0, 1, 2, 3, 4, 8, 16, 23].filter((t) => main.pc.etapas[3].producaoObrigatoria[t] > 0);
  usos.slice(0, 5).forEach((t) => P(`- **${periodos[t].rotulo}**: ${explicarCadeia(main.pc, t, rot)}`));
}

// -------- todos os produtos --------
P(`\n## 2. Todos os produtos da Previsão — entregável, gargalo e postos (cenário ${PRINCIPAL.nome}, modo B)`);
for (const mundo of ["meta", "hist"] as const) {
  const { res } = rodarReverso(PRINCIPAL, mundo, modoMain);
  P(`\n**Produtividade pela ${mundo === "meta" ? "META" : "HISTÓRICA"}**`);
  P(`| Produto | Demanda final | Entregável | Falta | Gargalo | Postos-período obrigatórios por etapa | Antecipação útil (postos-período) | WIP de saída (por ligação) |`);
  P(`|---|---:|---:|---:|---|---|---:|---|`);
  res.produtos.forEach((p) => P(`| ${p.rotulo} | ${n0(p.demandaFinal)} | ${n0(p.entregavel)} | ${n0(p.faltaFinal)} | ${p.etapas.find((e) => e.etapaId === p.gargaloEtapaId)?.rotulo ?? "—"} | ${p.etapas.map((e) => `${e.rotulo} ${n1(soma(e.postosObrigatorios))}`).join(" · ")} | ${n1(soma(p.etapas.map((e) => soma(e.postosAntecipacao))))} | ${p.ligacoes.map((l) => n0(l.wipProjetado[H])).join(" / ") || "—"} |`));
}

// -------- cenários M8 --------
P(`\n## 3. Máquina 8 = rota alternativa (cenário ${PRINCIPAL.nome}, meta) — NÃO se soma convencional + M8 para a mesma peça`);
P(`A M8 (Rosquear+Parafusar, 1 operador) produz a rota "Automática" (Máquina 8→Etiquetar→Embalar). Etiquetadora 15 e Embalagem 17 são UM recurso cada, somando as entradas das duas rotas.`);
P(`| Modo | Conv entregável | Autom entregável | Σ final | Receita (R$) | Postos-período R+P (conv) | postos-período M8 | Postos-período Etiq. 15 | Postos-período Emb. 17 | Pessoas (mín. obrigatório / pico c/ antecipação) | Períodos com déficit (de ${H}) | WIP de saída Σ |`);
P(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|`);
const nomeModo: Record<Modo, string> = { A_so_convencional: "A · só convencional (M8 desligada)", "B_conv+M8": "B · convencional + M8 (proporcional à demanda)", C_M8_prioridade: "C · maior participação da M8 (Automática com prioridade)" };
for (const modo of MODOS) {
  const { res } = rodarReverso(PRINCIPAL, "meta", modo);
  const pc = res.produtos.find((p) => p.produtoId === conv)!, pa = res.produtos.find((p) => p.produtoId === aut);
  const recId = (nome: string) => recursos.filter((r) => r.rotulo.startsWith(nome)).map((r) => r.id);
  const uso = (ids: string[]) => soma(ids.map((i) => soma(res.usoPorRecurso[i].obrigatorio)));
  P(`| ${nomeModo[modo]} | ${n0(pc.entregavel)} | ${pa ? n0(pa.entregavel) : "—"} | ${n0(pc.entregavel + (pa?.entregavel ?? 0))} | ${n0(pc.receita + (pa?.receita ?? 0))} | ${n1(soma(pc.etapas[0].postosObrigatorios) + soma(pc.etapas[1].postosObrigatorios))} | ${pa ? n1(soma(pa.etapas[0].postosObrigatorios)) : "0"} | ${n1(uso(recId("Etiquetadora 15")))} | ${n1(uso(recId("Embalagem 17")))} | ${res.headcountMinimo} / ${res.picoComAntecipacao} | ${res.periodosComDeficit.length} | ${n0(soma(pc.ligacoes.map((l) => l.wipProjetado[H])) + (pa ? soma(pa.ligacoes.map((l) => l.wipProjetado[H])) : 0))} |`);
}
{
  const m8id = recursos.find((r) => r.rotulo.startsWith("Maquina Automatica"))?.id;
  const { res } = rodarReverso(PRINCIPAL, "meta", "C_M8_prioridade");
  if (m8id) P(`\nUtilização da M8 no modo C: ${n1(soma(res.usoPorRecurso[m8id].obrigatorio))} de ${soma(recursos.find((r) => r.id === m8id)!.unidades)} postos-período disponíveis (a Previsão já pede da M8 toda a capacidade dela para a Automática: não há "maior participação" a ganhar além do que já está em B).`);
}

P(`\n**Com as 12 pessoas (plano obrigatório limitado às pessoas, produtos por valor por posto-período)**`);
P(`| Modo | Conv | Autom | Caixa Amarela | Pino | Plug | Σ peças finais | Receita (R$) | Falta total vs demanda |`);
P(`|---|---:|---:|---:|---:|---:|---:|---:|---:|`);
for (const modo of MODOS) {
  const { res } = rodarReverso(PRINCIPAL, "meta", modo, EXT, true);
  const g = (id: string) => res.produtos.find((p) => p.produtoId === id)?.entregavel ?? 0;
  const pino = [...porProduto.keys()].find((i) => /^Pino/.test(nomeP(i)))!, plug = [...porProduto.keys()].find((i) => /^Plug/.test(nomeP(i)))!;
  P(`| ${nomeModo[modo]} | ${n0(g(conv))} | ${n0(g(aut))} | ${n0(g(cx))} | ${n0(g(pino))} | ${n0(g(plug))} | ${n0(soma(res.produtos.map((p) => p.entregavel)))} | ${n0(soma(res.produtos.map((p) => p.receita)))} | ${n0(soma(res.produtos.map((p) => p.faltaFinal)))} |`);
}

// -------- headcount --------
P(`\n## 4. Headcount por período (cenário ${PRINCIPAL.nome}, modo B, meta) — postos obrigatórios × pessoas disponíveis`);
for (const mundo of ["meta", "hist"] as const) {
  const { res } = rodarReverso(PRINCIPAL, mundo, modoMain);
  P(`\n**${mundo === "meta" ? "META" : "HISTÓRICA"}** · mínimo obrigatório (pico) = **${res.headcountMinimo}** · pico com antecipação útil = ${res.picoComAntecipacao} · disponíveis = ${Math.max(...pessoas)} · períodos com déficit = ${res.periodosComDeficit.length}/${H}`);
  if (mundo === "meta") {
    P(`| Período | Postos obrigatórios | Antecipação útil | Pessoas | Folga | Déficit | Etapa com mais postos |`);
    P(`|---|---:|---:|---:|---:|---:|---|`);
    res.headcount.forEach((h) => P(`| ${h.rotulo} | ${h.postosObrigatorios} | ${h.postosAntecipacao} | ${h.pessoasDisponiveis} | ${h.folga} | ${h.deficit || "·"} | ${(h.etapaMaisPostos ?? "—").replace(" | ", " · ")} |`));
  }
}

// -------- comparação --------
P(`\n## 5. Comparação LEGADO × FLUXO ATUAL × PLANO REVERSO (validação de cadeia, lote de 1 período)`);
P(`Simulador otimista (mesma dinâmica que escolhe o plano). Cadeia validada no grafo do motor (Etiquetar/Embalar da convencional e da Automática fundidos: uma pilha, uma capacidade). "Upstream esquecido" = máx. déficit acumulado de produção upstream (Ros/Paf/M8) frente ao reverso obrigatório; "postos faltantes" = Σ postos-período que o reverso pede a mais em nós upstream.`);
for (const c of out.comparacao) {
  P(`\n**Cenário ${c.cenario} · produtividade ${c.mundo === "meta" ? "META" : "HISTÓRICA"}** (headcount do reverso: mínimo ${c.headcountReverso.minimo}, pico ${c.headcountReverso.pico}, períodos com déficit ${c.headcountReverso.periodosComDeficit})`);
  P(`| Plano | Cadeia | Peças finais | Receita (R$) | WIP final (Σ) | Estoque de saída útil | Falta de material (pç) | Postos-período sem material | Períodos com posto sem material | 1ª falta | Upstream esquecido (pç) | Postos upstream faltantes | Pessoas sem posto / períodos c/ déficit de pessoas |`);
  P(`|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|`);
  (c.planos as Metr[]).forEach((m) => P(`| ${m.plano} | ${m.cadeiaValida ? "VÁLIDA" : "CADEIA_INVALIDA"} (${m.violacoes} viol.) | ${n0(m.pecasFinais)} | ${n0(m.receita)} | ${n0(m.wipFinal)} | ${n0(m.estoqueSaidaUtil)} | ${n0(m.faltaMaterialPecas)} | ${n1(m.postosSemMaterial)} | ${m.periodosComPostoSemMaterial} | ${m.primeiraFalta ?? "—"} | ${n0(m.upstreamEsquecidoPecas)} | ${n1(m.upstreamPostosFaltantes)} | ${m.pessoasSemPosto} |`));
}
P(`\nLigações/períodos inválidos (primeiros) — LEGADO e FLUXO, cenário ${PRINCIPAL.nome}, meta:`);
{
  const c = out.comparacao.find((x: any) => x.cenario === PRINCIPAL.nome && x.mundo === "meta");
  if (c) (c.planos as Metr[]).slice(0, 2).forEach((m) => P(`- ${m.plano}: ${m.ligacoesInvalidas.length ? m.ligacoesInvalidas.map((l) => `${l.ligacao} @ ${l.periodo} (falta ${n0(l.falta)})`).join("; ") : "nenhuma"}`));
}
P(`\nNão avaliados no reverso (é plano de necessidade, sem pessoa): revezamento/ponte M3→T1 (checados na alocação, não aqui), churn (não há plano anterior), nº de reparos (0: o reverso não repara, constrói válido). Máquinas fora da Previsão: 0 nos três (o motor e o reverso só usam as máquinas selecionadas). Dependência de WIP estimado: todos os cenários A/B/E são estimados (confiança acima); só C (zero) e D (contagem final) não dependem de estimativa.`);

// -------- meta × histórico --------
P(`\n## 6. Meta × histórico (cenário ${PRINCIPAL.nome}, modo B) — diferença por etapa e distribuição`);
{
  const l: any[] = out.metaXhist.linhas;
  P(`| Produto | Etapa | Postos-período (meta) | Postos-período (histórico) | Diferença % | Entregável meta | Entregável hist. |`);
  P(`|---|---|---:|---:|---:|---:|---:|`);
  l.forEach((x) => P(`| ${x.produto} | ${x.etapa} | ${n1(x.postosMeta)} | ${n1(x.postosHist)} | ${x.difPostosPct >= 0 ? "+" : ""}${n1(x.difPostosPct)}% | ${n0(x.entregavelMeta)} | ${n0(x.entregavelHist)} |`));
  const r: any[] = out.metaXhist.razoesPorPosto.filter((x: any) => x.fonte === "historico");
  const sem = out.metaXhist.razoesPorPosto.filter((x: any) => x.fonte !== "historico").length;
  const dif = r.map((x) => Math.abs(x.razao - 1) * 100).sort((a, b) => a - b);
  const q = (p: number) => (dif.length ? dif[Math.min(dif.length - 1, Math.floor(p * (dif.length - 1)))] : NaN);
  P(`\nDistribuição de |histórico ÷ meta − 1| por POSTO (produto×operação×máquina; ${r.length} postos com ≥3 amostras na janela de 14 dias, ${sem} sem amostra suficiente ⇒ meta): mín ${n1(dif[0])}% · p25 ${n1(q(0.25))}% · mediana ${n1(q(0.5))}% · p75 ${n1(q(0.75))}% · p90 ${n1(q(0.9))}% · máx ${n1(dif[dif.length - 1])}%.`);
  P(`| Posto | Razão hist/meta | n |`); P(`|---|---:|---:|`);
  r.sort((a, b) => a.razao - b.razao).forEach((x) => P(`| ${x.produto} · ${x.etapa} · ${x.maquina} | ${x.razao.toFixed(3)} | ${x.n} |`));
  const dEtapa = l.map((x) => Math.abs(x.difPostosPct)).sort((a, b) => a - b);
  const qe = (p: number) => dEtapa[Math.min(dEtapa.length - 1, Math.floor(p * (dEtapa.length - 1)))];
  P(`\nDistribuição de |diferença| de postos-período por ETAPA (${dEtapa.length} etapas): mín ${n1(dEtapa[0])}% · p25 ${n1(qe(0.25))}% · mediana ${n1(qe(0.5))}% · p75 ${n1(qe(0.75))}% · máx ${n1(dEtapa[dEtapa.length - 1])}%.`);
  const corte = Math.max(5, Math.round(qe(0.5)));
  P(`**Proposta de corte (a partir da distribuição, não fixada a priori)**: ALTA CONFIANÇA quando |diferença| ≤ ${corte}% (≈ mediana das etapas, piso 5%); BAIXA CONFIANÇA acima disso. Classificação resultante: ${l.map((x) => `${x.produto} · ${x.etapa}: ${Math.abs(x.difPostosPct) <= corte ? "ALTA" : "BAIXA"}`).join("; ")}.`);
}

// -------- sensibilidade ao WIP --------
P(`\n## 7. Sensibilidade ao WIP inicial (modo B, meta)`);
P(`| Cenário | Conv. entregável | Autom. entregável | Σ final | Rosquear Σ (obrig.) | Parafusar Σ | M8 Σ | Postos-período R+P+M8 (obrig.) | 1ª produção de Rosquear / Parafusar | Headcount mín. | Déficit (períodos) |`);
P(`|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|`);
for (const cen of cenarios) for (const mundo of ["meta", "hist"] as const) {
  const { res } = rodarReverso(cen, mundo, modoMain);
  const pc = res.produtos.find((p) => p.produtoId === conv)!, pa = res.produtos.find((p) => p.produtoId === aut)!;
  const first = (v: number[]) => { const i = v.findIndex((x) => x > 0.5); return i < 0 ? "—" : periodos[i].rotulo; };
  P(`| ${cen.nome} · ${mundo} | ${n0(pc.entregavel)} | ${n0(pa.entregavel)} | ${n0(pc.entregavel + pa.entregavel)} | ${n0(soma(pc.etapas[0].producaoObrigatoria))} | ${n0(soma(pc.etapas[1].producaoObrigatoria))} | ${n0(soma(pa.etapas[0].producaoObrigatoria))} | ${n1(soma(pc.etapas[0].postosObrigatorios) + soma(pc.etapas[1].postosObrigatorios) + soma(pa.etapas[0].postosObrigatorios))} | ${first(pc.etapas[0].producaoObrigatoria)} / ${first(pc.etapas[1].producaoObrigatoria)} | ${res.headcountMinimo} | ${res.periodosComDeficit.length} |`);
}

// -------- resposta central --------
P(`\n## 8. O que precisa começar AGORA nas etapas anteriores (cenário ${PRINCIPAL.nome}, meta, modo B)`);
{
  const { res } = rodarReverso(PRINCIPAL, "meta", modoMain);
  P(`| Produto | Etapa | Primeiros períodos (03/11): peças → postos-período | Início da produção |`);
  P(`|---|---|---|---|`);
  res.produtos.forEach((p) => p.etapas.forEach((e, k) => {
    const idx = [0, 1, 2, 3].filter((t) => e.producaoObrigatoria[t] + e.producaoAntecipacao[t] > 0.5);
    const first = e.producaoObrigatoria.findIndex((v) => v > 0.5);
    P(`| ${p.rotulo} | ${e.rotulo}${k < p.etapas.length - 1 ? " (upstream)" : ""} | ${idx.length ? idx.map((t) => `${periodos[t].rotulo}: ${n0(e.producaoObrigatoria[t] + e.producaoAntecipacao[t])} pç → ${n1(e.postosObrigatorios[t] + e.postosAntecipacao[t])}`).join(" · ") : "nada nos 4 primeiros períodos"} | ${first < 0 ? "—" : periodos[first].rotulo} |`);
  }));
  const hc = res.headcount.slice(0, 4);
  P(`\nPostos obrigatórios nos 4 primeiros períodos: ${hc.map((h) => `${h.rotulo}=${h.postosObrigatorios}`).join(", ")} (pessoas ${pessoas[0]}).`);
}
P(`\n## 9. Recomendação`);
{
  for (const mundo of ["meta", "hist"] as const) {
    const full = rodarReverso(PRINCIPAL, mundo, modoMain).res, lim = rodarReverso(PRINCIPAL, mundo, modoMain, EXT, true).res;
    const dem = soma(full.produtos.map((p) => p.demandaFinal)), fisico = soma(full.produtos.map((p) => p.entregavel)), com12 = soma(lim.produtos.map((p) => p.entregavel));
    const faltaFisica = dem - fisico;
    const v = full.periodosComDeficit.length === 0 ? (faltaFisica < 1 ? "CABE com 12 pessoas" : "CABE COM RESTRIÇÕES (as pessoas bastam; a demanda física excede a capacidade das máquinas)") : com12 >= 0.9 * fisico ? "CABE COM RESTRIÇÕES" : "NÃO CABE";
    P(`- Produtividade ${mundo === "meta" ? "meta" : "histórica"}: demanda total ${n0(dem)} pç; a capacidade física das máquinas/WIP entrega no máximo ${n0(fisico)} (falta física ${n0(faltaFisica)}); isso exige headcount mínimo de ${full.headcountMinimo} (déficit em ${full.periodosComDeficit.length}/${H} períodos contra ${Math.max(...pessoas)} pessoas); com 12 pessoas entrega ${n0(com12)} (${n1((100 * com12) / fisico)}% do fisicamente possível, ${n1((100 * com12) / dem)}% da demanda) ⇒ **${v}**.`);
  }
}
out.principal = PRINCIPAL.nome;
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
fs.writeFileSync(process.env.MD ?? "/dev/stdout", md.join("\n") + "\n");
