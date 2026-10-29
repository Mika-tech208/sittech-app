// BACKTEST do estimador de produtividade esperada (src/features/escala/produtividade.ts) contra apontamentos reais de PROD.
// Uso: npx tsx --tsconfig <tsconfig> scripts/escala-produtividade/backtest.ts <ap.json> [modo]
//   ap.json = linhas de apontamentos_producao exportadas por SELECT (campos: d, per, hl, pini, pfim, status, mot, pid, eid, mid, mnome, qp, qr, meta).
//   modo: "grade" (padrão) | "estab" | "queda"
// Protocolo: para cada observação de cada posto (produto×etapa×máquina), prediz a razão real/meta usando SÓ o que foi lançado antes dela.
// Treino = alvos até 2026-10-07; teste = alvos a partir de 2026-10-08 (a escolha de parâmetros usa só o treino).
import { readFileSync } from "node:fs";
import { PRODUTIVIDADE_PADRAO, produtividadeEsperada, type ObsProdutividade, type OpcoesProdutividade } from "../../src/features/escala/produtividade";
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

interface Alvo { postoKey: string; poolKey: string; i: number; obs: ObsProdutividade; real: number; parcial: boolean; hist: ObsProdutividade[]; agora: number; proximos: number[] }
function alvos(todas: ObsProdutividade[], horizonte = 6): Alvo[] {
  const prod = todas.filter((a) => a.status === "produzindo" && a.meta > 0).sort((x, y) => (x.fimPeriodoMs as number) - (y.fimPeriodoMs as number) || x.lancadoEmMs - y.lancadoEmMs);
  const porPosto = new Map<string, ObsProdutividade[]>();
  prod.forEach((a) => { const k = `${a.produtoId}|${a.etapaId}|${a.maquinaId}`; porPosto.set(k, [...(porPosto.get(k) ?? []), a]); });
  const out: Alvo[] = [];
  // histórico relevante por alvo (mesmo pool + sem_producao da máquina) — só otimização; o estimador filtra igual
  const poolIdx = new Map<string, ObsProdutividade[]>(); const semIdx = new Map<string, ObsProdutividade[]>();
  todas.forEach((a) => { if (a.status === "produzindo") { const k = `${a.produtoId}|${a.etapaId}`; poolIdx.set(k, [...(poolIdx.get(k) ?? []), a]); } else { const k = a.maquinaId as string; semIdx.set(k, [...(semIdx.get(k) ?? []), a]); } });
  porPosto.forEach((lst, k) => lst.forEach((a, i) => {
    if (i < 1) return;
    out.push({ postoKey: k, poolKey: `${a.produtoId}|${a.etapaId}`, i, obs: a, real: a.boas / a.meta, parcial: (a.fimPeriodoMs as number) - a.lancadoEmMs > 3 * 60000,
      hist: [...(poolIdx.get(`${a.produtoId}|${a.etapaId}`) ?? []), ...(semIdx.get(a.maquinaId as string) ?? [])], agora: a.lancadoEmMs - 1, proximos: lst.slice(i, i + horizonte).map((x) => x.boas / x.meta) });
  }));
  return out;
}

// f atual do sistema: por POOL (produto×etapa), todas as linhas produzindo visíveis, n/(n+6), n<3 ⇒ 1
function fAtual(todas: ObsProdutividade[], a: Alvo): number {
  const v = todas.filter((x) => x.status === "produzindo" && x.meta > 0 && x.produtoId === a.obs.produtoId && x.etapaId === a.obs.etapaId && x.lancadoEmMs <= a.agora);
  return fatorDesempenho(v.length, v.reduce((s, x) => s + x.boas, 0), v.reduce((s, x) => s + x.meta, 0));
}

interface Met { n: number; mae: number; maeRel: number; vies: number; mae6: number; maeCompleto: number }
function avaliar(al: Alvo[], pred: (a: Alvo) => number): Met {
  const e = al.map((a) => ({ a, p: pred(a) }));
  const comp = e.filter((x) => !x.a.parcial);
  const h = e.filter((x) => x.a.proximos.length >= 3);
  return {
    n: e.length,
    mae: media(e.map((x) => Math.abs(x.p - x.a.real))),
    maeRel: media(e.map((x) => Math.abs(x.p - x.a.real) / Math.max(0.2, x.a.real))),
    vies: media(e.map((x) => x.p - x.a.real)),
    mae6: media(h.map((x) => Math.abs(x.p - media(x.a.proximos)))),
    maeCompleto: media(comp.map((x) => Math.abs(x.p - x.a.real))),
  };
}
const lin = (nome: string, m: Met) => `${nome.padEnd(46)} n=${String(m.n).padStart(4)} MAE=${f3(m.mae)} MAEcompl=${f3(m.maeCompleto)} MAErel=${f3(m.maeRel)} MAEdia(6)=${f3(m.mae6)} vies=${m.vies >= 0 ? "+" : ""}${f3(m.vies)}`;

function grade(todas: ObsProdutividade[]) {
  const al = alvos(todas);
  const treino = al.filter((a) => a.obs.data < DIV), teste = al.filter((a) => a.obs.data >= DIV);
  console.log(`alvos: treino=${treino.length} teste=${teste.length}`);
  const base = (nome: string, pred: (a: Alvo) => number) => { console.log(lin(`[treino] ${nome}`, avaliar(treino, pred))); console.log(lin(`[teste ] ${nome}`, avaliar(teste, pred))); };
  base("(a) nominal puro (1,0)", () => 1);
  base("(b) f atual (pool, n/(n+6))", (a) => fAtual(todas, a));
  base("(d) média móvel simples posto (sem shrink)", (a) => { const r = produtividadeEsperada(a.hist, a.obs.produtoId as string, a.obs.etapaId as string, a.obs.maquinaId as string, a.agora, { meiaVida: Infinity, k: 0, c: Infinity, parcial: "incluir", prior: "nominal", idadeMaximaDias: null, amostraMinima: 1 }); return r.diagnostico.nivelBruto ?? 1; });
  base("(e) última observação do posto", (a) => { const h = todas.filter((x) => x.status === "produzindo" && x.meta > 0 && x.postoKey === undefined && x.produtoId === a.obs.produtoId && x.etapaId === a.obs.etapaId && x.maquinaId === a.obs.maquinaId && x.lancadoEmMs <= a.agora).sort((x, y) => y.lancadoEmMs - x.lancadoEmMs)[0]; return h ? h.boas / h.meta : 1; });
  const passo = (o: Partial<OpcoesProdutividade>) => (a: Alvo) => produtividadeEsperada(a.hist, a.obs.produtoId as string, a.obs.etapaId as string, a.obs.maquinaId as string, a.agora, o).fator;
  base("(c) estimador PADRÃO", passo({}));

  // varredura de um parâmetro por vez em torno do padrão + grade completa ordenada pelo TREINO
  const linhas: { nome: string; o: Partial<OpcoesProdutividade>; tr: Met; te: Met }[] = [];
  const mh = [6, 12, 20, 40, Infinity], ks = [0, 3, 6, 10, 15], cs = [Infinity, 3, 2.5, 2], parc = ["excluir", "incluir", "projetar"] as const, pri = ["nominal", "pool"] as const, ida = [null, 45];
  for (const meiaVida of mh) for (const k of ks) for (const c of cs) for (const parcial of parc) for (const prior of pri) for (const idadeMaximaDias of ida) {
    const o = { meiaVida, k, c, parcial, prior, idadeMaximaDias };
    const f = passo(o);
    linhas.push({ nome: `mv=${meiaVida} k=${k} c=${c} parcial=${parcial} prior=${prior} idade=${idadeMaximaDias}`, o, tr: avaliar(treino, f), te: avaliar(teste, f) });
  }
  const por = (f: (l: (typeof linhas)[number]) => number) => [...linhas].sort((x, y) => f(x) - f(y));
  console.log("\n== TOP 12 por MAE(completo) no TREINO (alvo = período completo; é o que o motor quer prever) ==");
  por((l) => l.tr.maeCompleto).slice(0, 12).forEach((l) => console.log(`${l.nome.padEnd(70)} treino=${f3(l.tr.maeCompleto)} teste=${f3(l.te.maeCompleto)} dia6(teste)=${f3(l.te.mae6)} vies(teste)=${f3(l.te.vies)}`));
  console.log("\n== TOP 12 por MAE do DIA (6 períodos) no TREINO ==");
  por((l) => l.tr.mae6).slice(0, 12).forEach((l) => console.log(`${l.nome.padEnd(70)} treino=${f3(l.tr.mae6)} teste=${f3(l.te.mae6)} MAEcompl(teste)=${f3(l.te.maeCompleto)}`));
  // efeito marginal de cada parâmetro (média do MAE completo de treino sobre as demais dimensões)
  const marg = (nome: string, chave: (l: (typeof linhas)[number]) => string) => {
    const g = new Map<string, number[]>(); linhas.forEach((l) => g.set(chave(l), [...(g.get(chave(l)) ?? []), l.tr.maeCompleto]));
    console.log(`marginal ${nome}: ` + [...g.entries()].map(([k, v]) => `${k}=${f3(media(v))}`).join("  "));
  };
  console.log("\n== efeito marginal (MAE completo, treino) ==");
  marg("meiaVida", (l) => String(l.o.meiaVida)); marg("k", (l) => String(l.o.k)); marg("c", (l) => String(l.o.c)); marg("parcial", (l) => String(l.o.parcial)); marg("prior", (l) => String(l.o.prior)); marg("idade", (l) => String(l.o.idadeMaximaDias));
}

// ESTABILIDADE: após UM período ruim (razão 0,5, completo) quanto a estimativa mexe? Mede em todos os postos/instantes com ≥10 obs.
function estab(todas: ObsProdutividade[], opcoes: Partial<OpcoesProdutividade>[], rotulos: string[]) {
  const al = alvos(todas).filter((a) => a.i >= 10 && a.obs.data >= "2026-09-22");
  const amostra = al.filter((_, i) => i % 5 === 0);
  const ruim = (a: Alvo, r: number, ordem: number): ObsProdutividade => ({ ...a.obs, boas: a.obs.meta * r, lancadoEmMs: a.agora + ordem, fimPeriodoMs: a.agora + ordem + 60000 });
  const calc = (rot: string, est: (hist: ObsProdutividade[], a: Alvo) => number) => {
    const d1: number[] = [], d3: number[] = [];
    amostra.forEach((a) => {
      const e0 = est(todas, a), e1 = est([...todas, ruim(a, 0.5, 1)], { ...a, agora: a.agora + 10 }), e3 = est([...todas, ruim(a, 0.7, 1), ruim(a, 0.7, 2), ruim(a, 0.7, 3)], { ...a, agora: a.agora + 10 });
      d1.push(e0 - e1); d3.push(e0 - e3);
    });
    console.log(`${rot.padEnd(40)} queda média após 1 período a 0,50: ${f3(media(d1))} (máx ${f3(Math.max(...d1))})   após 3 períodos a 0,70: ${f3(media(d3))}`);
  };
  console.log(`estabilidade: ${amostra.length} (posto, instante) amostrados`);
  calc("(b) f atual (pool)", (h, a) => { const v = h.filter((x) => x.status === "produzindo" && x.meta > 0 && x.produtoId === a.obs.produtoId && x.etapaId === a.obs.etapaId && x.lancadoEmMs <= a.agora); return fatorDesempenho(v.length, v.reduce((s, x) => s + x.boas, 0), v.reduce((s, x) => s + x.meta, 0)); });
  calc("(e) última observação", (h, a) => { const x = h.filter((y) => y.status === "produzindo" && y.meta > 0 && y.produtoId === a.obs.produtoId && y.etapaId === a.obs.etapaId && y.maquinaId === a.obs.maquinaId && y.lancadoEmMs <= a.agora).sort((p, q) => q.lancadoEmMs - p.lancadoEmMs)[0]; return x ? x.boas / x.meta : 1; });
  calc("EWMA α=0,3 do posto (sem proteção)", (h, a) => { const v = h.filter((y) => y.status === "produzindo" && y.meta > 0 && y.produtoId === a.obs.produtoId && y.etapaId === a.obs.etapaId && y.maquinaId === a.obs.maquinaId && y.lancadoEmMs <= a.agora).sort((p, q) => p.lancadoEmMs - q.lancadoEmMs); let e = 1; v.forEach((y) => (e = 0.3 * (y.boas / y.meta) + 0.7 * e)); return e; });
  opcoes.forEach((o, i) => calc(rotulos[i], (h, a) => produtividadeEsperada(h, a.obs.produtoId as string, a.obs.etapaId as string, a.obs.maquinaId as string, a.agora, o).fator));
}

// QUEDA CONSISTENTE: série sintética 24 períodos a 1,0 e depois 0,80 constante — quantos períodos até o fator refletir a queda?
function queda(opcoes: Partial<OpcoesProdutividade>[], rotulos: string[]) {
  const base = Date.parse("2026-10-05T07:12:00-03:00");
  const serie = (n1: number, n2: number, r2: number): ObsProdutividade[] => Array.from({ length: n1 + n2 }, (_, i) => ({
    data: "x", periodoId: "m1", funcionarioId: null, maquinaId: "m", produtoId: "p", etapaId: "e", operacaoId: null, boas: 1000 * (i < n1 ? 1 : r2), refugo: 0, meta: 1000, status: "produzindo" as const, motivo: null,
    lancadoEmMs: base + i * 5_400_000, fimPeriodoMs: base + i * 5_400_000 - 60_000,
  }));
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
