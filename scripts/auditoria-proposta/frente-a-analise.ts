/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from "node:fs";
import * as path from "node:path";
import * as D from "./dados";
import * as N from "./nucleo";
import { OUT, wipB, demanda, pisoEquilibrio, prioridade } from "./frente-a";
import { prepararDespacho, despachar, linhasParaOcc, restricoesOk, type ConfigDespacho, type LinhaPostoD } from "@/features/escala/fluxo/postosDespacho";

const plano = JSON.parse(fs.readFileSync(path.join(OUT, "plano-B-meta.json"), "utf8"));
const prods = D.produtosRev("meta", wipB.wip);
const cfg: ConfigDespacho = { t0: 0, produtos: prods, recursos: N.recursos, pessoas: N.pessoas, operacaoDe: N.opDe, alvo: demanda, piso: pisoEquilibrio(), margem: N.pesosMargem, prioridade, blocos: N.blocos, limiteOp: N.NP, penalPiso: 1, saidaTeto: Object.fromEntries(prods.map((p) => [p.id, p.recorrentePorPeriodo ?? p.demandaFinal / N.H])), saidaPeso: 0.25 };
const Dp = prepararDespacho(cfg);
const ini: LinhaPostoD[] = plano.linhasPostos;
const occ = linhasParaOcc(cfg, Dp, ini);
const base = despachar(cfg, Dp, occ, true);
console.log("obj", Math.round(base.obj), "ociosas", base.linhasOciosas.length);
const util: number[] = [];
const rate = (pid: string, k: number, rid: string, t: number) => prods.find((p) => p.id === pid)!.etapas[k].alternativas.find((a) => a.recursoId === rid)!.pecasPorPosto[t];
const lcdAll: { t: number; rid: string; util: number; op: string; q: number }[] = [];
for (let t = 0; t < N.H; t++) {
  let i = 0;
  for (let r = 0; r < N.recursos.length; r++) if (occ[t][r]) {
    const det = base.detalhes[t][i++];
    const u = det.reduce((a, d) => a + d.pecas / rate(d.produtoId, d.etapaIdx, N.recursos[r].id, t), 0);
    util.push(u); lcdAll.push({ t, rid: N.recursos[r].id, util: u, op: Dp.ops[occ[t][r] - 1], q: det.reduce((a, d) => a + d.pecas, 0) });
  }
}
util.sort((a, b) => a - b);
console.log("utilização das linhas: n", util.length, "min", util[0].toFixed(2), "p10", util[Math.floor(util.length * 0.1)].toFixed(2), "mediana", util[Math.floor(util.length / 2)].toFixed(2), "<50%:", util.filter((u) => u < 0.5).length, "<80%:", util.filter((u) => u < 0.8).length);
console.log("linhas <60%:", lcdAll.filter((l) => l.util < 0.6).map((l) => `${N.periodos[l.t].rotulo} ${D.nomeM(l.rid)} ${(l.util * 100).toFixed(0)}%`).join("; "));
const porT = new Array(N.H).fill(0); ini.forEach((l) => porT[l.t]++);
console.log("postos/período", porT.join(","));
const idleT = porT.map((n, t) => ({ t, n })).filter((x) => x.n < N.pessoas[x.t]);
for (const { t } of idleT) {
  const out: any[] = [];
  for (let r = 0; r < N.recursos.length; r++) {
    if (occ[t][r] || (N.recursos[r].unidades[t] ?? 0) <= 0) continue;
    for (const o of Dp.opsDoRec[r]) {
      const o2 = occ.map((x) => x.slice()); o2[t][r] = o + 1;
      const ok = restricoesOk(cfg, Dp, o2, t);
      const d = despachar(cfg, Dp, o2, true);
      let idx = 0; for (let rr = 0; rr < r; rr++) if (o2[t][rr]) idx++;
      const q = d.detalhes[t][idx]?.reduce((a, x) => a + x.pecas, 0) ?? 0;
      out.push({ maq: D.nomeM(N.recursos[r].id), op: D.nomeO(Dp.ops[o]), restricoesOk: ok, pecasDaLinha: Math.round(q), deltaObj: +(d.obj - base.obj).toFixed(2) });
    }
  }
  let melhor = { d: -1e9, desc: "" };
  for (let r = 0; r < N.recursos.length; r++) {
    if (occ[t][r] || (N.recursos[r].unidades[t] ?? 0) <= 0) continue;
    for (const o of Dp.opsDoRec[r]) for (let t2 = 0; t2 < N.H; t2++) for (let r2 = 0; r2 < N.recursos.length; r2++) if (occ[t2][r2]) {
      const o2 = occ.map((x) => x.slice()); const v = o2[t2][r2]; o2[t2][r2] = 0; o2[t][r] = o + 1;
      if (!restricoesOk(cfg, Dp, o2, t) || !restricoesOk(cfg, Dp, o2, t2)) continue;
      const dd = despachar(cfg, Dp, o2).obj - base.obj;
      if (dd > melhor.d) melhor = { d: dd, desc: `+${D.nomeM(N.recursos[r].id)}/${D.nomeO(Dp.ops[o])}@${N.periodos[t].rotulo} -${D.nomeM(N.recursos[r2].id)}/${D.nomeO(Dp.ops[v - 1])}@${N.periodos[t2].rotulo}` };
    }
  }
  console.log(`PERÍODO ${N.periodos[t].rotulo}: ${porT[t]} postos de ${N.pessoas[t]}. Adições:`, JSON.stringify(out).slice(0, 1500));
  console.log("  melhor troca 1x1:", melhor.d.toFixed(3), melhor.desc);
}
for (const [t, n] of [[0, 3], [1, 2], [2, 1], [21, 1], [22, 3], [23, 5]] as [number, number][]) {
  const l = plano.linhas.filter((x: any) => x.data === N.slots[t].data && x.periodoId === N.slots[t].periodoId && x.maquinaId);
  console.log(N.periodos[t].rotulo, `(antes ${n} sem posto)`, "agora postos:", l.length, l.map((x: any) => `${D.nomeM(x.maquinaId)}:${D.nomeO(x.operacaoId)}:${x.pecas}`).join(" | "));
}
