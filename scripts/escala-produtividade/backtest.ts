// BACKTEST do estimador de produtividade esperada (src/features/escala/produtividade.ts) contra apontamentos reais de PROD.
// Uso: npx tsx --tsconfig <tsconfig> scripts/escala-produtividade/backtest.ts <ap.json> [modo]
//   ap.json = linhas de apontamentos_producao exportadas por SELECT (campos: d, per, hl, pini, pfim, status, mot, pid, eid, mid, mnome, qp, qr, meta).
//   modo: "grade" (padrão) | "estab" | "queda"
// Protocolo: para cada observação de cada posto (produto×etapa×máquina), prediz a razão real/meta usando SÓ o que foi lançado antes dela.
// Treino = alvos até 2026-10-07; teste = alvos a partir de 2026-10-08 (a escolha de parâmetros usa só o treino).
import { readFileSync } from "node:fs";
import { PRODUTIVIDADE_PADRAO, indicePorPeriodoDoDia, produtividadeEsperada, type ObsProdutividade, type OpcoesProdutividade } from "../../src/features/escala/produtividade";
import { fatorDesempenho } from "../../src/features/escala/desempenho";

type Linha = Record<string, string | null>;
const ms = (d: string, hhmmss: string) => Date.parse(`${d}T${hhmmss.slice(0, 8)}-03:00`);
export function carregar(path: string): ObsProdutividade[] {
  const rows = JSON.parse(readFileSync(path, "utf8")) as Linha[];
  return rows.map((r) => ({
    data: r.d as string, periodoId: r.per as string, funcionarioId: null, maquinaId: r.mid, produtoId: r.pid, etapaId: r.eid, operacaoId: r.oid,
    boas: Number(r.qp) - Number(r.qr), refugo: Number(r.qr), meta: r.meta ? Number(r.meta) : 0,
    status: r.status as "produzindo" | "sem_producao", motivo: r.mot,
    lancadoEmMs: ms(r.d as string, r.hl as string), fimPeriodoMs: ms(r.d as string, r.pfim as string), inicioPeriodoMs: ms(r.d as string, r.pini as string),
  }));
}

const DIV = "2026-10-08";
const media = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN);
const mediana = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const f3 = (x: number) => x.toFixed(3);

interface Alvo { postoKey: string; poolKey: string; i: number; obs: ObsProdutividade; real: number; parcial: boolean; hist: ObsProdutividade[]; agora: number; proximos: number[]; proxPer: string[] }
function alvos(todas: ObsProdutividade[], horizonte = 30): Alvo[] {
  const prod = todas.filter((a) => a.status === "produzindo" && a.meta > 0).sort((x, y) => (x.fimPeriodoMs as number) - (y.fimPeriodoMs as number) || x.lancadoEmMs - y.lancadoEmMs);
  const porPosto = new Map<string, ObsProdutividade[]>();
  prod.forEach((a) => { const k = `${a.produtoId}|${a.operacaoId}|${a.maquinaId}`; porPosto.set(k, [...(porPosto.get(k) ?? []), a]); });
  const out: Alvo[] = [];
  // histórico relevante por alvo (mesmo pool + sem_producao da máquina) — só otimização; o estimador filtra igual
  const poolIdx = new Map<string, ObsProdutividade[]>(); const semIdx = new Map<string, ObsProdutividade[]>();
  todas.forEach((a) => { if (a.status === "produzindo") { const k = `${a.produtoId}|${a.operacaoId}`; poolIdx.set(k, [...(poolIdx.get(k) ?? []), a]); } else { const k = a.maquinaId as string; semIdx.set(k, [...(semIdx.get(k) ?? []), a]); } });
  porPosto.forEach((lst, k) => lst.forEach((a, i) => {
    if (i < 1) return;
    out.push({ postoKey: k, poolKey: `${a.produtoId}|${a.operacaoId}`, i, obs: a, real: a.boas / a.meta, parcial: (a.fimPeriodoMs as number) - a.lancadoEmMs > 3 * 60000,
      hist: [...(poolIdx.get(`${a.produtoId}|${a.operacaoId}`) ?? []), ...(semIdx.get(a.maquinaId as string) ?? [])], agora: a.lancadoEmMs - 1, proximos: lst.slice(i, i + horizonte).map((x) => x.boas / x.meta), proxPer: lst.slice(i, i + horizonte).map((x) => x.periodoId) });
  }));
  return out;
}

// f atual do sistema — FIEL ao que roda em PROD: por POOL (produto×etapa_id), só linhas da SEMANA corrente (visivelNoCorte filtra os slots da semana)
// lançadas antes do alvo, n/(n+6), n<3 ⇒ 1. (Nota: não corrige a troca de operação das etapas da Caixa Amarela de 21/10.)
const semanaDe = (d: string) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
function fAtual(todas: ObsProdutividade[], a: Alvo, acumulado = false): number {
  const sem = semanaDe(a.obs.data);
  const v = todas.filter((x) => x.status === "produzindo" && x.meta > 0 && x.produtoId === a.obs.produtoId && x.etapaId === a.obs.etapaId && x.lancadoEmMs <= a.agora && (acumulado || semanaDe(x.data) === sem));
  return fatorDesempenho(v.length, v.reduce((s, x) => s + x.boas, 0), v.reduce((s, x) => s + x.meta, 0));
}

interface Met { n: number; mae: number; maeRel: number; vies: number; mae30: number; maeCompleto: number; viesSemana: number }
type Pred = (a: Alvo) => number | [number, number];
// pred devolve p1 (próximo período) ou [p1, pH] (pH = previsão da MÉDIA dos próximos 30 períodos do posto ≈ uma semana)
function avaliar(al: Alvo[], pred: Pred): Met {
  const e = al.map((a) => { const r = pred(a); const [p1, pH] = Array.isArray(r) ? r : [r, r]; return { a, p: p1, pH }; });
  const comp = e.filter((x) => !x.a.parcial);
  const h = e.filter((x) => x.a.proximos.length >= 20);
  return {
    n: e.length,
    mae: media(e.map((x) => Math.abs(x.p - x.a.real))),
    maeRel: media(e.map((x) => Math.abs(x.p - x.a.real) / Math.max(0.2, x.a.real))),
    vies: media(e.map((x) => x.p - x.a.real)),
    mae30: media(h.map((x) => Math.abs(x.pH - media(x.a.proximos)))),
    viesSemana: media(h.map((x) => x.pH - media(x.a.proximos))),
    maeCompleto: media(comp.map((x) => Math.abs(x.p - x.a.real))),
  };
}
const lin = (nome: string, m: Met) => `${nome.padEnd(46)} n=${String(m.n).padStart(4)} MAE=${f3(m.mae)} MAEcompl=${f3(m.maeCompleto)} MAErel=${f3(m.maeRel)} MAEsem(30)=${f3(m.mae30)} viesSem=${m.viesSemana >= 0 ? "+" : ""}${f3(m.viesSemana)} vies=${m.vies >= 0 ? "+" : ""}${f3(m.vies)}`;

function grade(todas: ObsProdutividade[]) {
  const al = alvos(todas);
  const treino = al.filter((a) => a.obs.data < DIV), teste = al.filter((a) => a.obs.data >= DIV);
  console.log(`alvos: treino=${treino.length} teste=${teste.length}`);
  const base = (nome: string, pred: (a: Alvo) => number) => { console.log(lin(`[treino] ${nome}`, avaliar(treino, pred))); console.log(lin(`[teste ] ${nome}`, avaliar(teste, pred))); };
  base("(a) nominal puro (1,0)", () => 1);
  base("(b) f atual de PROD (pool, semana corrente)", (a) => fAtual(todas, a));
  base("(b2) f acumulado (pool, todo o histórico)", (a) => fAtual(todas, a, true));
  base("(d) média móvel simples posto (sem shrink)", (a) => { const r = produtividadeEsperada(a.hist, a.obs.produtoId as string, a.obs.etapaId as string, a.obs.maquinaId as string, a.agora, { operacaoId: a.obs.operacaoId, meiaVida: Infinity, k: 0, c: Infinity, parcial: "incluir", prior: "nominal", idadeMaximaDias: null, amostraMinima: 1 }); return r.diagnostico.nivelBruto ?? 1; });
  base("(e) última observação do posto", (a) => { const h = todas.filter((x) => x.status === "produzindo" && x.meta > 0 && x.postoKey === undefined && x.produtoId === a.obs.produtoId && x.operacaoId === a.obs.operacaoId && x.maquinaId === a.obs.maquinaId && x.lancadoEmMs <= a.agora).sort((x, y) => y.lancadoEmMs - x.lancadoEmMs)[0]; return h ? h.boas / h.meta : 1; });
  const passo = (o: Partial<OpcoesProdutividade>) => (a: Alvo) => produtividadeEsperada(a.hist, a.obs.produtoId as string, a.obs.etapaId as string, a.obs.maquinaId as string, a.agora, { operacaoId: a.obs.operacaoId, ...o }).fator;
  base("(c) estimador PADRÃO", passo({}));

  // FATIAS (treino+teste): onde cada método ganha ou perde
  {
    const cacheI = new Map<string, Record<string, number>>();
    const ixd = (a: Alvo) => { const d = a.obs.data; if (!cacheI.has(d)) cacheI.set(d, indicePorPeriodoDoDia(todas, Date.parse(`${d}T00:00:00-03:00`))); return cacheI.get(d) as Record<string, number>; };
    const est: Pred = (a) => produtividadeEsperada(a.hist, a.obs.produtoId as string, a.obs.etapaId as string, a.obs.maquinaId as string, a.agora, { operacaoId: a.obs.operacaoId, periodoId: a.obs.periodoId, indicePeriodo: ixd(a) }).fator;
    const maqPorPool = new Map<string, Set<string>>();
    al.forEach((a) => { const n = al.filter((x) => x.postoKey === a.postoKey).length; if (n >= 20) maqPorPool.set(a.poolKey, (maqPorPool.get(a.poolKey) ?? new Set()).add(a.postoKey)); });
    const dow = (a: Alvo) => (new Date(a.obs.data + "T12:00:00Z").getUTCDay() + 6) % 7;
    const fatias: [string, (a: Alvo) => boolean][] = [
      ["último período do dia (t3)", (a) => a.obs.periodoId === "t3"], ["demais períodos", (a) => a.obs.periodoId !== "t3"],
      ["seg/ter (início da semana)", (a) => dow(a) <= 1], ["qua–sex", (a) => dow(a) >= 2],
      ["pools com ≥2 máquinas com histórico", (a) => (maqPorPool.get(a.poolKey)?.size ?? 0) >= 2], ["pools com 1 máquina", (a) => (maqPorPool.get(a.poolKey)?.size ?? 0) < 2],
    ];
    console.log("\n== FATIAS (treino+teste; MAE do próximo período | viés) ==");
    fatias.forEach(([nome, f]) => {
      const sub = al.filter(f);
      const m = (pred: Pred) => avaliar(sub, pred);
      const x = m(() => 1), y = m((a) => fAtual(todas, a)), z = m(est);
      console.log(`${nome.padEnd(40)} n=${String(sub.length).padStart(4)}  nominal ${f3(x.mae)}|${x.vies >= 0 ? "+" : ""}${f3(x.vies)}   f atual ${f3(y.mae)}|${y.vies >= 0 ? "+" : ""}${f3(y.vies)}   estimador ${f3(z.mae)}|${z.vies >= 0 ? "+" : ""}${f3(z.vies)}`);
    });
  }
  // índice por período do dia calculado só com o passado (até 00:00 do dia do alvo), em cache por data
  const cacheIdx = new Map<string, Record<string, number>>();
  const idxDe = (a: Alvo) => { const d = a.obs.data; if (!cacheIdx.has(d)) cacheIdx.set(d, indicePorPeriodoDoDia(todas, Date.parse(`${d}T00:00:00-03:00`))); return cacheIdx.get(d) as Record<string, number>; };
  const passoAj = (o: Partial<OpcoesProdutividade>): Pred => (a) => {
    const ix = o.ajustePeriodo ? idxDe(a) : null;
    const p1 = produtividadeEsperada(a.hist, a.obs.produtoId as string, a.obs.etapaId as string, a.obs.maquinaId as string, a.agora, { ...o, operacaoId: a.obs.operacaoId, periodoId: a.obs.periodoId, ...(ix ? { indicePeriodo: ix } : {}) }).fator;
    if (!ix) return [p1, p1];
    const idxT = ix[a.obs.periodoId] ?? 1;
    return [p1, (p1 / idxT) * media(a.proxPer.map((per) => ix[per] ?? 1))];
  };
  const linhas: { nome: string; o: Partial<OpcoesProdutividade>; tr: Met; te: Met }[] = [];
  const add = (o: Partial<OpcoesProdutividade>) => { const f = passoAj(o); linhas.push({ nome: JSON.stringify(o, (_k, v) => (v === Infinity ? "inf" : v)), o, tr: avaliar(treino, f), te: avaliar(teste, f) }); };
  const mh = [6, 12, 20, 40, Infinity], ks = [0, 3, 6, 10, 15], cs = [Infinity, 3, 2.5, 2];
  // (1) varredura de um parâmetro por vez em torno do padrão (com e sem ajuste de período)
  for (const ajustePeriodo of [false, true]) {
    add({ ajustePeriodo });
    mh.forEach((meiaVida) => add({ ajustePeriodo, meiaVida }));
    ks.forEach((k) => add({ ajustePeriodo, k }));
    cs.forEach((c) => add({ ajustePeriodo, c }));
    (["excluir", "incluir", "projetar"] as const).forEach((parcial) => add({ ajustePeriodo, parcial }));
    (["nominal", "pool"] as const).forEach((prior) => add({ ajustePeriodo, prior }));
    [null, 21, 45, 90].forEach((idadeMaximaDias) => add({ ajustePeriodo, idadeMaximaDias }));
    // (2) grade meia-vida × k nos dois priors e com parcial incluído (t3 é 88% parcial)
    for (const prior of ["nominal", "pool"] as const) for (const parcial of ["excluir", "incluir"] as const) for (const meiaVida of mh) for (const k of ks) add({ ajustePeriodo, prior, parcial, meiaVida, k });
  }
  const por = (f: (l: (typeof linhas)[number]) => number) => [...linhas].sort((x, y) => f(x) - f(y));
  console.log(`\n${linhas.length} configurações`);
  console.log("\n== TOP 15 por MAE(período completo) no TREINO ==");
  por((l) => l.tr.maeCompleto).slice(0, 15).forEach((l) => console.log(`${l.nome.padEnd(110)} treino=${f3(l.tr.maeCompleto)} teste=${f3(l.te.maeCompleto)} sem30(treino/teste)=${f3(l.tr.mae30)}/${f3(l.te.mae30)} vies(teste)=${f3(l.te.vies)}`));
  console.log("\n== TOP 15 por MAE SEMANAL (média dos 30 períodos seguintes do posto) no TREINO ==");
  por((l) => l.tr.mae30).slice(0, 15).forEach((l) => console.log(`${l.nome.padEnd(110)} treino=${f3(l.tr.mae30)} teste=${f3(l.te.mae30)} MAEcompl(teste)=${f3(l.te.maeCompleto)}`));
  console.log("\n== varreduras de 1 parâmetro (MAE todos / completo / sem30 : treino | teste) ==");
  linhas.slice(0, 1).concat(linhas.filter((l) => Object.keys(l.o).length <= 2)).forEach((l) => console.log(`${l.nome.padEnd(60)} ${f3(l.tr.mae)} ${f3(l.tr.maeCompleto)} ${f3(l.tr.mae30)} | ${f3(l.te.mae)} ${f3(l.te.maeCompleto)} ${f3(l.te.mae30)}  vies ${f3(l.te.vies)}`));
}

// ESTABILIDADE: após UM período ruim (razão 0,5, completo) quanto a estimativa mexe? Mede em todos os postos/instantes com ≥10 obs.
function estab(todas: ObsProdutividade[], opcoes: Partial<OpcoesProdutividade>[], rotulos: string[]) {
  const al = alvos(todas).filter((a) => a.i >= 10 && a.obs.data >= "2026-09-22");
  const amostra = al.filter((_, i) => i % 5 === 0);
  const ruim = (a: Alvo, r: number, ordem: number): ObsProdutividade => ({ ...a.obs, boas: a.obs.meta * r, lancadoEmMs: a.agora + ordem, fimPeriodoMs: a.agora + ordem + 60000 });
  const calc = (rot: string, est: (hist: ObsProdutividade[], a: Alvo) => number) => {
    const d1: number[] = [], d3: number[] = [];
    amostra.forEach((a) => {
      const sem = todas.filter((x) => x !== a.obs); // o próprio alvo não entra (evita empate de instante)
      const e0 = est(sem, a), e1 = est([...sem, ruim(a, 0.5, 1)], { ...a, agora: a.agora + 10 }), e3 = est([...sem, ruim(a, 0.7, 1), ruim(a, 0.7, 2), ruim(a, 0.7, 3)], { ...a, agora: a.agora + 10 });
      d1.push(e0 - e1); d3.push(e0 - e3);
    });
    console.log(`${rot.padEnd(40)} queda média após 1 período a 0,50: ${f3(media(d1))} (máx ${f3(Math.max(...d1))})   após 3 períodos a 0,70: ${f3(media(d3))}`);
  };
  console.log(`estabilidade: ${amostra.length} (posto, instante) amostrados`);
  [false, true].forEach((acum) => calc(acum ? "(b2) f acumulado (pool, histórico todo)" : "(b) f atual de PROD (pool, semana corrente)", (h, a) => { const sem = semanaDe(a.obs.data); const v = h.filter((x) => x.status === "produzindo" && x.meta > 0 && x.produtoId === a.obs.produtoId && x.etapaId === a.obs.etapaId && x.lancadoEmMs <= a.agora && (acum || semanaDe(x.data) === sem)); return fatorDesempenho(v.length, v.reduce((s, x) => s + x.boas, 0), v.reduce((s, x) => s + x.meta, 0)); }));
  calc("(e) última observação", (h, a) => { const x = h.filter((y) => y.status === "produzindo" && y.meta > 0 && y.produtoId === a.obs.produtoId && y.operacaoId === a.obs.operacaoId && y.maquinaId === a.obs.maquinaId && y.lancadoEmMs <= a.agora).sort((p, q) => q.lancadoEmMs - p.lancadoEmMs)[0]; return x ? x.boas / x.meta : 1; });
  calc("EWMA α=0,3 do posto (sem proteção)", (h, a) => { const v = h.filter((y) => y.status === "produzindo" && y.meta > 0 && y.produtoId === a.obs.produtoId && y.operacaoId === a.obs.operacaoId && y.maquinaId === a.obs.maquinaId && y.lancadoEmMs <= a.agora).sort((p, q) => p.lancadoEmMs - q.lancadoEmMs); let e = 1; v.forEach((y) => (e = 0.3 * (y.boas / y.meta) + 0.7 * e)); return e; });
  opcoes.forEach((o, i) => calc(rotulos[i], (h, a) => produtividadeEsperada(h, a.obs.produtoId as string, a.obs.etapaId as string, a.obs.maquinaId as string, a.agora, { operacaoId: a.obs.operacaoId, ...o }).fator));
}

// QUEDA CONSISTENTE: série sintética 24 períodos a 1,0 e depois 0,80 constante — quantos períodos até o fator refletir a queda?
function queda(opcoes: Partial<OpcoesProdutividade>[], rotulos: string[]) {
  const base = Date.parse("2026-10-05T07:12:00-03:00");
  const serie = (n1: number, n2: number, r2: number): ObsProdutividade[] => Array.from({ length: n1 + n2 }, (_, i) => ({
    data: "x", periodoId: "m1", funcionarioId: null, maquinaId: "m", produtoId: "p", etapaId: "e", operacaoId: null, boas: 1000 * (i < n1 ? 1 : r2), refugo: 0, meta: 1000, status: "produzindo" as const, motivo: null,
    lancadoEmMs: base + i * 5_400_000, fimPeriodoMs: base + i * 5_400_000 - 60_000,
  }));
  {
    const s = serie(24, 40, 0.8);
    const tr = Array.from({ length: 40 }, (_, t) => { const v = s.slice(0, 24 + t + 1); return fatorDesempenho(v.length, v.reduce((a, x) => a + x.boas, 0), v.reduce((a, x) => a + x.meta, 0)); });
    const prim = (lim: number) => { const i = tr.findIndex((x) => x <= lim); return i < 0 ? ">40" : String(i + 1); };
    console.log(`${"(b) f atual (acumulado do pool)".padEnd(34)} fator após 1/3/6/12/24 períodos a 0,80: ${[0, 2, 5, 11, 23].map((i) => f3(tr[i])).join(" / ")}   períodos p/ ≤0,95: ${prim(0.95)}  ≤0,90: ${prim(0.9)}  ≤0,85: ${prim(0.85)}`);
  }
  opcoes.forEach((o, j) => {
    const s = serie(24, 40, 0.8);
    const tr = Array.from({ length: 40 }, (_, t) => produtividadeEsperada(s.slice(0, 24 + t + 1), "p", "e", "m", s[24 + t].lancadoEmMs, o).fator);
    const prim = (lim: number) => { const i = tr.findIndex((x) => x <= lim); return i < 0 ? ">40" : String(i + 1); };
    console.log(`${rotulos[j].padEnd(34)} fator após 1/3/6/12/24 períodos a 0,80: ${[0, 2, 5, 11, 23].map((i) => f3(tr[i])).join(" / ")}   períodos p/ ≤0,95: ${prim(0.95)}  ≤0,90: ${prim(0.9)}  ≤0,85: ${prim(0.85)}`);
  });
}

if (process.argv[1]?.endsWith("backtest.ts")) {
  const todas = carregar(process.argv[2]);
  const modo = process.argv[3] ?? "grade";
  const cand: Partial<OpcoesProdutividade>[] = [{}, { meiaVida: 6 }, { meiaVida: 20 }, { k: 2 }, { k: 12 }, { c: Infinity, k: 0, meiaVida: 12, prior: "nominal" }];
  const rot = ["PADRÃO", "PADRÃO meia-vida 6", "PADRÃO meia-vida 20", "PADRÃO k=2", "PADRÃO k=12", "sem proteção/sem shrink (mv 12)"];
  if (modo === "grade") grade(todas);
  if (modo === "estab") estab(todas, cand, rot);
  if (modo === "queda") queda(cand, rot);
}
