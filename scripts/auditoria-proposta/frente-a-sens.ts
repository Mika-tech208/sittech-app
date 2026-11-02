/* eslint-disable @typescript-eslint/no-explicit-any */
// Sensibilidade A/B/C(/D), meta × histórica, Máquina 8 −10%: o plano EQUILIBRIO muda? Período a período nos primeiros períodos.
import * as fs from "node:fs";
import * as path from "node:path";
import * as D from "./dados";
import * as N from "./nucleo";
import { OUT, wipB, wipA, wipC, wipDpath, entradaPlanejador, escalarM8, resumo, semPosto, postosPorPeriodo, slotIdx } from "./frente-a";
import { planejarFuturo, type SaidaPlanejador } from "@/features/escala/fluxo/planejadorFuturo";
import type { LinhaPostoD } from "@/features/escala/fluxo/postosDespacho";

const base = JSON.parse(fs.readFileSync(path.join(OUT, "plano-B-meta.json"), "utf8"));
const iniB: LinhaPostoD[] = base.linhasPostos;
const cenarios: { nome: string; wip: Record<string, number[]>; mundo: "meta" | "hist"; m8: number }[] = [
  { nome: "B·meta (base)", wip: wipB.wip, mundo: "meta", m8: 1 },
  { nome: "A·meta", wip: wipA.wip, mundo: "meta", m8: 1 },
  { nome: "C·meta", wip: wipC.wip, mundo: "meta", m8: 1 },
  { nome: "B·hist", wip: wipB.wip, mundo: "hist", m8: 1 },
  { nome: "A·hist", wip: wipA.wip, mundo: "hist", m8: 1 },
  { nome: "C·hist", wip: wipC.wip, mundo: "hist", m8: 1 },
  { nome: "B·meta·M8−10%", wip: wipB.wip, mundo: "meta", m8: 0.9 },
  { nome: "B·hist·M8−10% adicional", wip: wipB.wip, mundo: "hist", m8: 0.9 },
];
if (fs.existsSync(wipDpath)) { const j = JSON.parse(fs.readFileSync(wipDpath, "utf8")); Object.entries(j).filter(([k]) => k.startsWith("D")).forEach(([k, v]) => cenarios.push({ nome: `${k}·meta`, wip: v as any, mundo: "meta", m8: 1 })); }
const out: any[] = [];
const rowsSalvas: Record<string, any[]> = {};
const sig = (rows: { t: number; rid: string; op: string }[], tmax: number) => new Set(rows.filter((r) => r.t <= tmax).map((r) => `${r.t}|${r.rid}|${r.op}`));
const rowsDe = (ls: LinhaPostoD[]) => ls.map((l) => ({ t: l.t, rid: l.recursoId, op: l.operacaoId }));
const prodUp = (s: SaidaPlanejador, tmax: number) => Object.fromEntries(s.porProduto.map((p) => [N.nomeCurto(p.produtoId), 0])); void prodUp;
const planos: Record<string, SaidaPlanejador> = {};
for (const c of cenarios) {
  const prods = escalarM8(D.produtosRev(c.mundo, c.wip), c.m8);
  const t0 = Date.now();
  const s = c.nome.startsWith("B·meta (base)") ? ({ linhas: base.linhas, linhasPostos: iniB, porProduto: base.porProduto, validacao: base.validacao, producao: base.producao, wip: base.wip, avisos: [], objetivoValor: 0 } as SaidaPlanejador) : planejarFuturo(entradaPlanejador(prods, { linhasIniciais: iniB, busca: { iter: 1500000, reinicios: 2, semente: 5 } }));
  planos[c.nome] = s;
  const r = resumo(s);
  const A8 = soma8(s);
  rowsSalvas[c.nome] = s.linhasPostos.map((l) => [l.t, D.nomeM(l.recursoId), D.nomeO(l.operacaoId)]);
  out.push({ nome: c.nome, pecas: r.pecas, margem: r.margem, fin: Object.fromEntries(Object.entries(r.fin).map(([k, v]) => [N.nomeCurto(k), Math.round(v as number)])), semPosto: semPosto(s), val: s.validacao, ms: Date.now() - t0, a8: A8 });
  console.error(c.nome, Math.round(r.pecas), Math.round(r.margem), JSON.stringify(s.validacao));
}
function soma8(s: SaidaPlanejador) { return Math.round(s.porProduto.find((p) => p.produtoId === D.aut)!.programado); }
// comparação período a período vs base (primeiros 4 períodos e semana)
const bs = sig(rowsDe(iniB), 3), bsAll = sig(rowsDe(iniB), 99);
const periodoRows = (s: SaidaPlanejador, t: number) => s.linhasPostos.filter((l) => l.t === t).map((l) => `${D.nomeM(l.recursoId).replace("Maquina Automatica", "M8")}/${D.nomeO(l.operacaoId)}`).sort();
const comp: any[] = [];
for (const c of cenarios.slice(1)) {
  const s = planos[c.nome];
  const sg = sig(rowsDe(s.linhasPostos), 3), sgAll = sig(rowsDe(s.linhasPostos), 99);
  const inter = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length;
  const porPer = [0, 1, 2, 3].map((t) => { const a = new Set(periodoRows(planos["B·meta (base)"], t)), b = new Set(periodoRows(s, t)); return `${N.periodos[t].rotulo}: ${[...a].filter((x) => !b.has(x)).length} saem / ${[...b].filter((x) => !a.has(x)).length} entram`; });
  const prodPeriodo = (sa: SaidaPlanejador, t: number) => { const o: Record<string, number> = {}; Object.entries(sa.producao).forEach(([pid, es]) => Object.entries(es).forEach(([eid, v]) => { const k = `${N.nomeCurto(pid)}·${D.nomeO(N.opDe(pid, eid))}`; o[k] = (o[k] ?? 0) + (v[t] ?? 0); })); return o; };
  const up0 = [0, 1, 2, 3].map((t) => { const a = prodPeriodo(planos["B·meta (base)"], t), b = prodPeriodo(s, t); const keys = new Set([...Object.keys(a), ...Object.keys(b)]); let dif = 0, tot = 0; keys.forEach((k) => { dif += Math.abs((a[k] ?? 0) - (b[k] ?? 0)); tot += a[k] ?? 0; }); return { periodo: N.periodos[t].rotulo, difAbsPecas: Math.round(dif), pecasBase: Math.round(tot), difPct: +(100 * dif / Math.max(1, tot)).toFixed(1) }; });
  comp.push({ nome: c.nome, mesmasLinhasPrimeiros4: `${inter(bs, sg)}/${bs.size}`, mesmasLinhasSemana: `${inter(bsAll, sgAll)}/${bsAll.size}`, porPeriodo: porPer, upstream: up0 });
}
// o plano BASE rodando com M8 a 90% SEM replanejar (as mesmas linhas): perda, validade e utilização
import { prepararDespacho, despachar, linhasParaOcc, type ConfigDespacho } from "@/features/escala/fluxo/postosDespacho";
const rodarFixo = (fator: number, mundo: "meta" | "hist") => {
  const prods = escalarM8(D.produtosRev(mundo, wipB.wip), fator);
  const cfg: ConfigDespacho = { t0: 0, produtos: prods, recursos: N.recursos, pessoas: N.pessoas, operacaoDe: N.opDe, alvo: Object.fromEntries(prods.map((p) => [p.id, p.demandaFinal])), piso: {}, margem: N.pesosMargem, prioridade: [D.aut, D.conv, N.pino, N.plug, D.cx], blocos: N.blocos, limiteOp: N.NP, saidaTeto: Object.fromEntries(prods.map((p) => [p.id, p.recorrentePorPeriodo ?? 0])), saidaPeso: 0.25 };
  const Dp = prepararDespacho(cfg);
  const d = despachar(cfg, Dp, linhasParaOcc(cfg, Dp, iniB), true);
  const rate = (pid: string, k: number, rid: string, t: number) => prods.find((p) => p.id === pid)!.etapas[k].alternativas.find((a) => a.recursoId === rid)!.pecasPorPosto[t];
  const occ = linhasParaOcc(cfg, Dp, iniB);
  const utils: number[] = []; const baixas: string[] = [];
  for (let t = 0; t < N.H; t++) { let i = 0; for (let r = 0; r < N.recursos.length; r++) if (occ[t][r]) { const det = d.detalhes[t][i++]; const u = det.reduce((a, x) => a + x.pecas / rate(x.produtoId, x.etapaIdx, N.recursos[r].id, t), 0); utils.push(u); if (u < 0.7) baixas.push(`${N.periodos[t].rotulo} ${D.nomeM(N.recursos[r].id)} ${(u * 100).toFixed(0)}%`); } }
  return { fin: Object.fromEntries(Object.entries(d.finais).map(([k, v]) => [N.nomeCurto(k), Math.round(v)])), pecas: Math.round(N.soma(Object.values(d.finais))), margem: Math.round(N.soma(Object.entries(d.finais).map(([k, v]) => v * N.econ[k].margem))), ociosas: d.linhasOciosas.length, linhasAbaixo70: baixas.length, baixas: baixas.slice(0, 20), utilMedia: +(N.soma(utils) / utils.length).toFixed(3) };
};
const fixo = { m8_100: rodarFixo(1, "meta"), m8_90: rodarFixo(0.9, "meta"), hist_m8_100: rodarFixo(1, "hist"), hist_m8_90: rodarFixo(0.9, "hist") };
console.error(JSON.stringify(fixo));
fs.writeFileSync(path.join(OUT, "sensibilidade.json"), JSON.stringify({ out, comp, fixo, rowsSalvas }, null, 1));

