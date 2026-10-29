// Tabela meta × real por posto (markdown) + estimativa vigente. Uso: tsx tabela.ts <ap.json> [agoraISO]
import { readFileSync } from "node:fs";
import { carregar } from "./backtest";
import { indicePorPeriodoDoDia, produtividadeEsperada } from "../../src/features/escala/produtividade";

const path = process.argv[2];
const nomes = new Map<string, string>();
(JSON.parse(readFileSync(path, "utf8")) as Record<string, string | null>[]).forEach((r) => { if (r.mid) nomes.set(r.mid, (r.mnome ?? "").trim()); if (r.pid) nomes.set(r.pid, (r.pnome ?? "").trim()); if (r.oid) nomes.set(r.oid, `${(r.onome ?? "").trim()}`); });
const todas = carregar(path);
const agora = process.argv[3] ? Date.parse(process.argv[3]) : Math.max(...todas.map((a) => a.lancadoEmMs)) + 1;
const prod = todas.filter((a) => a.status === "produzindo" && a.meta > 0);
const q = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); if (!s.length) return NaN; const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.min(lo + 1, s.length - 1); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const semana = (d: string) => { const t = new Date(d + "T12:00:00Z"); const wd = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - wd); return t.toISOString().slice(0, 10); };
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "–");
const pond = (rows: typeof prod) => (rows.length ? rows.reduce((s, a) => s + a.boas, 0) / rows.reduce((s, a) => s + a.meta, 0) : NaN);

const postos = new Map<string, typeof prod>();
prod.forEach((a) => { const k = `${a.produtoId}|${a.operacaoId}|${a.maquinaId}`; postos.set(k, [...(postos.get(k) ?? []), a]); });
const ix = indicePorPeriodoDoDia(todas, agora);
console.log(`índice por período do dia: ${Object.entries(ix).sort().map(([k, v]) => `${k}=${v.toFixed(2)}`).join(" ")}\n`);
console.log("| Posto (máquina) | Produto · etapa | n | mediana | p10–p90 | pond. | sem 19/10 | sem 26/10 | 28/10 | fator esperado (IC80) | fonte | t3 |");
console.log("|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---:|");
[...postos.entries()].sort((a, b) => b[1].length - a[1].length).filter(([, v]) => v.length >= 15).forEach(([k, v]) => {
  const [p, e, m] = k.split("|");
  const r = v.map((a) => a.boas / a.meta);
  const w = (s: string) => pond(v.filter((a) => semana(a.data) === s));
  const hoje = pond(v.filter((a) => a.data === "2026-10-28"));
  const op = { operacaoId: e };
  const est = produtividadeEsperada(todas, p, e, m, agora, op);
  const est3 = produtividadeEsperada(todas, p, e, m, agora, { ...op, periodoId: "t3" });
  console.log(`| ${nomes.get(m)} | ${nomes.get(p)} · ${nomes.get(e)} | ${v.length} | ${pct(q(r, 0.5))} | ${pct(q(r, 0.1))}–${pct(q(r, 0.9))} | ${pct(pond(v))} | ${pct(w("2026-10-19"))} | ${pct(w("2026-10-26"))} | ${pct(hoje)} | ${pct(est.fator)} (${pct(est.intervalo.lo)}–${pct(est.intervalo.hi)}) | ${est.fonte} | ${pct(est3.fator)} |`);
});
