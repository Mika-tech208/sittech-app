/* eslint-disable @typescript-eslint/no-explicit-any */
// OFFLINE / SÓ LEITURA. REPLAY do Conector 3/4 em dados reais recentes (semanas 12/10–02/11): MODELO ATUAL (dois produtos legados + fusão, corte-v1 como em PROD) × PRODUTO ÚNICO
// (gêmeo canônico montado a partir dos MESMOS dados: 1 item, 5 etapas do produto_canonico, apontamentos/contagens legados canonizados na leitura).
// Lê do CLONE local (SELECT via supabase-js/PostgREST do clone) — recusa qualquer URL que não seja 127.0.0.1/localhost. Nada é gravado: `aplicar` é em memória.
// Rodar:  set -a; source ~/Documents/sittech-clone/env.clone; set +a; scripts/fechamento/ts.sh scripts/produto-unico/replay.ts
// Variáveis: SEMANAS=2026-10-12,2026-10-19,... (padrão: as 4)  INSTANTES=gera,meio (padrão ambos)  OUT_JSON=<arquivo>  ORCAMENTO_MS=<ms por planejamento> (padrão 60000)
import * as fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { processarSemana, type EscalaIO } from "@/lib/escala/processar";
import { criarEscalaIO, resolverPrevisaoPorSemana } from "@/lib/escala/supabaseIO";
import { lerConfigFluxo } from "@/lib/escala/fluxo/parametrosFluxo";
import { carregarApontamentosBanco } from "@/lib/escala/fluxo/supabaseFluxo";
import { carregarContagensDeFechamento } from "@/lib/escala/fechamento/leitura";
import { paraReal } from "@/lib/escala/sombraServico";
import type { EstadoBruto, PayloadAplicacao } from "@/lib/escala/estado";
import { planejarSemanaComCorte, type ResultadoCorte } from "@/features/escala/fluxo/planoCorte";
import { verificarRestricoesDuras } from "@/features/escala/fluxo/restricoes";
import { expandirPorProduto } from "@/features/escala/distribuicao";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { AlocacaoEscala } from "@/features/escala/types";
import { type ParCanonico } from "@/features/produto-canonico/adaptadorMotor";
import { canonizarAlocacoes } from "@/features/produto-canonico/mapeamento";
import { lerModelosCanonicos } from "@/features/produto-canonico/modeloDb";
import type { ModeloCanonico } from "@/features/produto-canonico/tipos";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(URL)) { console.error(`RECUSADO: o replay só roda contra o CLONE local (URL=${URL})`); process.exit(2); }
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } });

const CONV = "27c229d7-f192-41eb-aad1-0c69ece53eba", AUTO = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee";
const SEMANAS = (process.env.SEMANAS ?? "2026-10-12,2026-10-19,2026-10-26,2026-11-02").split(",");
const INSTANTES = (process.env.INSTANTES ?? "gera,meio").split(",");
const ORCAMENTO_MS = Number(process.env.ORCAMENTO_MS ?? 60000);
const somarDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const arr = (x: any) => (Array.isArray(x) ? x : []);
async function sel(tabela: string, cols: string, f?: (q: any) => any) { const q = admin.from(tabela).select(cols); const r = await (f ? f(q) : q); if (r.error) throw new Error(`${tabela}: ${r.error.message}`); return r.data as any[]; }

interface Metricas {
  semana: string; instante: string; modelo: "ATUAL(legado+fusão)" | "PRODUTO ÚNICO"; status: string; corteUsado: boolean; motivo: string | null; segundos: number;
  demandaTotal: number; finalPlanejado: number; porOperacao: Record<string, number>; m8: number; parafusar: number; pctM8DoUpstream: number | null; pctM8PorDia: Record<string, number>;
  buffers: { b1: Mini; b2: Mini; b3: Mini }; wipInicial: { b1: number; b2: number; b3: number } | null;
  checagens: Record<string, number>; independente: { revezamento: number; outras: Record<string, number>; pessoaEmDoisPostos: number; doisNoPosto: number; m8OperadoresMax: number };
  objetivoValor: number | null; estoqueFinal: number; pessoaPeriodosConector: number; pessoaPeriodosOutros: number; pecasOutros: number;
  unico?: { porRota: any[]; trechoComum: any[] };
}
interface Mini { max: number; media: number; fim: number; negativos: number }
const mini = (v: number[]): Mini => ({ max: Math.max(0, ...v), media: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0, fim: Math.round(v[v.length - 1] ?? 0), negativos: v.filter((x) => x < -0.5).length });
const somaVet = (...vs: (number[] | undefined)[]) => { const n = Math.max(0, ...vs.map((v) => v?.length ?? 0)); return Array.from({ length: n }, (_, i) => vs.reduce((s, v) => s + (v?.[i] ?? 0), 0)); };

async function carregarBase(semana: string, agoraMs: number) {
  const prevId = await resolverPrevisaoPorSemana(admin, semana);
  if (!prevId) throw new Error(`sem Previsão em ${semana}`);
  const io = criarEscalaIO(admin, prevId);
  const estado = await io.carregarEstado(agoraMs);
  const params = await sel("escala_parametros", "chave, valor");
  const cfg = lerConfigFluxo(params);
  const cfgPlan = cfg.planejador?.config ?? {};
  const contagens = [...cfg.contagensFisicas, ...(await carregarContagensDeFechamento(admin).catch(() => []))];
  const apont = (await carregarApontamentosBanco(admin, semana)).map(paraReal);
  estado.producaoReal = { modoEfetivo: "ativo", limiar: cfg.limiar, paresLegado: cfg.paresLegado, contagensFisicas: contagens, mesmoPeriodo: false, apontamentos: apont, ...(cfg.cadeia ? { cadeia: cfg.cadeia } : {}) };
  const buscaExtra = process.env.BUSCA_ITER ? { busca: { ...(cfgPlan.busca ?? {}), iter: Number(process.env.BUSCA_ITER), reinicios: Number(process.env.BUSCA_REINICIOS ?? 2), semente: Number(process.env.BUSCA_SEMENTE ?? 1) } } : {};
  const objEx = process.env.OBJETIVO ? { objetivo: process.env.OBJETIVO } : {};
  estado.planejadorCorte = { config: { ...cfgPlan, ...buscaExtra, ...objEx, orcamentoMs: ORCAMENTO_MS } as any, vigenteDoPlanejador: false, distribuicaoSuportada: true, hashEntradaAnterior: null };
  return { estado, params, cfgPlan };
}

async function etapasCanonicas(CAN: string) {
  const et = await sel("roteiro_etapas", "id, produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3", (q) => q.eq("produto_id", CAN));
  const mq = await sel("roteiro_etapa_maquinas", "etapa_id, maquina_id", (q) => q.in("etapa_id", et.map((e) => e.id)));
  return et.map((e) => ({ id: String(e.id), produtoId: String(e.produto_id), operacaoId: String(e.operacao_id), ordem: Number(e.ordem), metas: Object.fromEntries(["m1", "m2", "m3", "t1", "t2", "t3"].map((p) => [p, Number(e[`meta_${p}`] ?? 0)])), maquinasCompativeis: mq.filter((m) => m.etapa_id === e.id).map((m) => String(m.maquina_id)) }));
}

/** Gêmeo canônico do estado: 1 item (Σ das duas rotas), 5 etapas do produto canônico, plano em ids canônicos; apontamentos/contagens ficam LEGADOS (o caminho de produção canoniza na leitura). */
async function gemeo(est: EstadoBruto, modelo: ModeloCanonico): Promise<EstadoBruto> {
  const CAN = modelo.produtoCanonicoId;
  const legados = est.itens.filter((i) => modelo.produtosLegado[i.produtoId]);
  const mapaE = (id: string) => modelo.etapasLegado[id]?.etapaCanonicaId ?? id;
  const maq: Record<string, string[]> = {};
  legados.forEach((i) => Object.entries(i.maquinasPorEtapa).forEach(([e, ms]) => { const c = mapaE(e); maq[c] = [...new Set([...(maq[c] ?? []), ...ms])]; }));
  const item = { produtoId: CAN, quantidade: legados.reduce((s, i) => s + i.quantidade, 0), quantidadeAdicional: legados.reduce((s, i) => s + (i.quantidadeAdicional ?? 0), 0), valorUnitario: legados[0]?.valorUnitario ?? 0, maquinasPorEtapa: maq };
  const etapasLeg = new Set(Object.keys(modelo.etapasLegado));
  return {
    ...est, itens: legados.length > 0 ? [...est.itens.filter((i) => !modelo.produtosLegado[i.produtoId]), item] : est.itens,
    etapas: legados.length > 0 ? [...est.etapas.filter((e) => !etapasLeg.has(e.id)), ...(await etapasCanonicas(CAN))] : est.etapas,
    alocacoes: canonizarAlocacoes(est.alocacoes, modelo),
    nomesProdutos: { ...(est.nomesProdutos ?? {}), [CAN]: "Conector 3/4 (Produto Único)" },
    produtoUnico: { modelo, cutover: est.semanaInicio },
  };
}

async function rodar(rotulo: "ATUAL(legado+fusão)" | "PRODUTO ÚNICO", semana: string, instante: string, agoraMs: number, estado: EstadoBruto, criar: boolean, nomeOp: (id: string) => string, finalIds: Set<string>): Promise<Metricas> {
  const nomeOp2 = (opId: string) => estado.nomesOperacao[opId] ?? opId;
  let payload: PayloadAplicacao | null = null;
  let rc: ResultadoCorte | null = null;
  let registro: any = null;
  let portao: any = null;
  const io: EscalaIO = {
    carregarEstado: async () => JSON.parse(JSON.stringify(estado)),
    aplicar: async (p) => { payload = p; return { versoes: Object.fromEntries(p.dias.map((d) => [d.data, 1])) }; },
    registrarFluxo: async (r) => { registro = r; },
    gravarSnapshotsWip: async () => undefined,
  };
  const t0 = Date.now();
  const r = await processarSemana(io, {
    agoraMs, criarSeNaoExiste: criar, maxTentativas: 1,
    planejadorCorte: ((...a: Parameters<typeof planejarSemanaComCorte>) => { const x = planejarSemanaComCorte(...a); rc = x; return x; }) as typeof planejarSemanaComCorte,
    portaoPublicacao: (c) => {
      const v = verificarRestricoesDuras(c.entrada, c.alocacoes, { somenteLinhasNovas: true });
      const porTipo: Record<string, number> = {};
      v.forEach((x) => (porTipo[x.tipo] = (porTipo[x.tipo] ?? 0) + 1));
      const ls = c.alocacoes.filter((a) => a.maquinaId);
      const cont = (k: (a: AlocacaoEscala) => string) => { const m = new Map<string, number>(); ls.forEach((a) => m.set(k(a), (m.get(k(a)) ?? 0) + 1)); return [...m.values()].filter((n) => n > 1).length; };
      const m8 = new Map<string, number>(); ls.filter((a) => /Rosquear \+ Parafusar/.test(a.operacaoId ? nomeOp2(a.operacaoId) : "")).forEach((a) => m8.set(`${a.data}|${a.periodoId}|${a.maquinaId}`, (m8.get(`${a.data}|${a.periodoId}|${a.maquinaId}`) ?? 0) + 1));
      portao = { revezamento: porTipo["revezamento"] ?? 0, outras: Object.fromEntries(Object.entries(porTipo).filter(([k]) => k !== "revezamento")), pessoaEmDoisPostos: cont((a) => `${a.data}|${a.periodoId}|${a.funcionarioId}`), doisNoPosto: cont((a) => `${a.data}|${a.periodoId}|${a.maquinaId}`), m8OperadoresMax: Math.max(0, ...m8.values()) };
      return null;
    },
  });
  const seg = (Date.now() - t0) / 1000;
  const base: Metricas = {
    semana, instante, modelo: rotulo, status: r.status, corteUsado: r.corte?.usado === true, motivo: r.motivoIgnorado ?? r.corte?.motivoFalha ?? null, segundos: Math.round(seg * 10) / 10,
    demandaTotal: 0, finalPlanejado: 0, porOperacao: {}, m8: 0, parafusar: 0, pctM8DoUpstream: null, pctM8PorDia: {}, buffers: { b1: mini([]), b2: mini([]), b3: mini([]) }, wipInicial: null,
    objetivoValor: null, estoqueFinal: 0, pessoaPeriodosConector: 0, pessoaPeriodosOutros: 0, pecasOutros: 0, checagens: {}, independente: portao ?? { revezamento: -1, outras: {}, pessoaEmDoisPostos: -1, doisNoPosto: -1, m8OperadoresMax: -1 },
  };
  if (!payload || !rc) return base;
  const p = payload as PayloadAplicacao, R = rc as ResultadoCorte;
  base.checagens = Object.fromEntries(Object.entries(R.checagens as any).filter(([, v]) => typeof v === "number")) as Record<string, number>;
  // soma por operação das linhas FUTURAS do Conector (distribuição expandida por produto/etapa); canônico: etapa já é canônica
  const futuras = expandirPorProduto(p.alocacoes as AlocacaoEscala[]).filter((a) => a.maquinaId && a.etapaId && (a.produtoId === CONV || a.produtoId === AUTO || a.produtoId === (estado.produtoUnico?.modelo.produtoCanonicoId ?? "")));
  const porDia: Record<string, { m8: number; par: number }> = {};
  futuras.forEach((a) => {
    const op = nomeOp(a.etapaId as string);
    base.porOperacao[op] = (base.porOperacao[op] ?? 0) + a.pecas;
    if (finalIds.has(a.etapaId as string)) base.finalPlanejado += a.pecas;
    const d = (porDia[a.data] ??= { m8: 0, par: 0 });
    if (/Rosquear \+ Parafusar/.test(op)) d.m8 += a.pecas;
    if (op === "Parafusar") d.par += a.pecas;
  });
  const ehCon = (pid: string | null) => pid === CONV || pid === AUTO || pid === estado.produtoUnico?.modelo.produtoCanonicoId;
  const com = (p.alocacoes as AlocacaoEscala[]).filter((a) => a.maquinaId);
  base.pessoaPeriodosConector = com.filter((a) => (a.distribuicao?.length ? a.distribuicao.some((d) => ehCon(d.produtoId)) : ehCon(a.produtoId))).length;
  base.pessoaPeriodosOutros = com.length - base.pessoaPeriodosConector;
  base.pecasOutros = Math.round(expandirPorProduto(com).filter((a) => !ehCon(a.produtoId)).reduce((s, a) => s + a.pecas, 0));
  base.m8 = base.porOperacao["Rosquear + Parafusar"] ?? 0;
  base.parafusar = base.porOperacao["Parafusar"] ?? 0;
  base.pctM8DoUpstream = base.m8 + base.parafusar > 0 ? Math.round((1000 * base.m8) / (base.m8 + base.parafusar)) / 10 : null;
  Object.entries(porDia).sort().forEach(([d, v]) => { base.pctM8PorDia[d] = v.m8 + v.par > 0 ? Math.round((1000 * v.m8) / (v.m8 + v.par)) / 10 : 0; });
  base.demandaTotal = estado.itens.filter((i) => i.produtoId === CONV || i.produtoId === AUTO || i.produtoId === estado.produtoUnico?.modelo.produtoCanonicoId).reduce((s, i) => s + i.quantidade, 0);
  // buffers (estoque no início de cada período, soma das ligações físicas)
  const w = (R.saida?.wip ?? {}) as Record<string, number[][]>;
  const chaveCanon = Object.keys(w).find((k) => k.endsWith("#CONV"));
  if (chaveCanon) { base.buffers = { b1: mini(w[chaveCanon][0] ?? []), b2: mini(w[chaveCanon][1] ?? []), b3: mini(w[chaveCanon][2] ?? []) }; }
  else if (w[CONV]) { base.buffers = { b1: mini(w[CONV][0] ?? []), b2: mini(somaVet(w[CONV][1], w[AUTO]?.[0])), b3: mini(somaVet(w[CONV][2], w[AUTO]?.[1])) }; }
  base.objetivoValor = R.saida ? Math.round(R.saida.objetivoValor * 100) / 100 : null;
  base.estoqueFinal = base.buffers.b1.fim + base.buffers.b2.fim + base.buffers.b3.fim;
  // WIP inicial por buffer (pares do registro do planejador)
  const pares: ParCanonico[] = (registro?.wip?.pares ?? []) as any;
  if (pares.length) {
    const mid = (x: ParCanonico) => (x.wip.lo + x.wip.hi) / 2;
    const nome = (id: string) => (estado.etapas.find((e) => e.id === id) ? nomeOp(id) : id);
    const soma = (f: (o: string, s: string, pid: string) => boolean) => Math.round(pares.filter((x) => f(nome(x.etapaOrigemId.replace("@A", "")), nome(x.etapaSeguinteId.replace("@A", "")), x.produtoId)).reduce((s, x) => s + mid(x), 0));
    base.wipInicial = { b1: soma((o, s) => o === "Rosquear" && s === "Parafusar"), b2: soma((o, s) => (o === "Parafusar" || /Rosquear \+ Parafusar/.test(o)) && s === "Etiquetar"), b3: soma((o, s) => o === "Etiquetar" && s === "Embalar") };
  }
  if (R.unico?.resumo) base.unico = { porRota: R.unico.resumo.porRota.map((x) => ({ rota: x.rotulo, entregue: x.entregue, pct: x.pctDoTotal, disponivel: x.disponivel })), trechoComum: R.unico.resumo.trechoComum };
  return base;
}

(async () => {
  const modelos = await lerModelosCanonicos(admin as any);
  const modelo = modelos[0];
  if (!modelo) throw new Error("clone sem modelo canônico");
  const resultados: Metricas[] = [];
  for (const semana of SEMANAS) {
    for (const instante of INSTANTES) {
      const segunda = semana;
      const agoraMs = instante === "gera" ? epochMsNoFuso(segunda, "06:00") : epochMsNoFuso(somarDias(segunda, 2), "12:50");
      if (instante === "meio" && !(await sel("escala_producao_dias", "data", (q) => q.eq("data", somarDias(segunda, 2)))).length) { console.log(`(${semana} meio: sem Escala gravada nesta semana — pulado)`); continue; }
      let { estado } = await carregarBase(semana, agoraMs);
      if (instante === "gera") estado = { ...estado, diasExistentes: [], alocacoes: [] };
      const nomeOpLeg = (id: string) => { const e = estado.etapas.find((x) => x.id === id); return e ? (estado.nomesOperacao[e.operacaoId] ?? "?") : "?"; };
      const finLeg = new Set(estado.etapas.filter((e) => (e.produtoId === CONV || e.produtoId === AUTO) && nomeOpLeg(e.id) === "Embalar").map((e) => e.id));
      console.log(`\n== ${semana} ${instante} (${new Date(agoraMs).toISOString()}) ==`);
      const A = await rodar("ATUAL(legado+fusão)", semana, instante, agoraMs, estado, instante === "gera", nomeOpLeg, finLeg);
      console.log(`  ATUAL   ${A.status} usado=${A.corteUsado} final=${Math.round(A.finalPlanejado)} M8=${Math.round(A.m8)} Paraf=${Math.round(A.parafusar)} obj=${A.objetivoValor} pp(con/out)=${A.pessoaPeriodosConector}/${A.pessoaPeriodosOutros} outros=${A.pecasOutros} estFim=${A.estoqueFinal} ${A.segundos}s ${A.motivo ?? ""}`);
      const gem = await gemeo(estado, modelo);
      const nomeOpCan = (id: string) => { const e = gem.etapas.find((x) => x.id === id); return e ? (gem.nomesOperacao[e.operacaoId] ?? "?") : "?"; };
      const finCan = new Set(gem.etapas.filter((e) => e.produtoId === modelo.produtoCanonicoId && nomeOpCan(e.id) === "Embalar").map((e) => e.id));
      const B = await rodar("PRODUTO ÚNICO", semana, instante, agoraMs, gem, instante === "gera", nomeOpCan, finCan);
      console.log(`  ÚNICO   ${B.status} usado=${B.corteUsado} final=${Math.round(B.finalPlanejado)} M8=${Math.round(B.m8)} Paraf=${Math.round(B.parafusar)} obj=${B.objetivoValor} pp(con/out)=${B.pessoaPeriodosConector}/${B.pessoaPeriodosOutros} outros=${B.pecasOutros} estFim=${B.estoqueFinal} ${B.segundos}s ${B.motivo ?? ""}`);
      resultados.push(A, B);
    }
  }
  if (process.env.OUT_JSON) fs.writeFileSync(process.env.OUT_JSON, JSON.stringify(resultados, null, 1));
  console.log("\nOK (nada foi gravado)");
})().catch((e) => { console.error("ERRO", e); process.exit(1); });
