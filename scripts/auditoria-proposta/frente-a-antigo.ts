/* eslint-disable @typescript-eslint/no-explicit-any */
// Teste de antecipação sobre o plano ANTERIOR (candidato D9, 15 pessoa-períodos sem posto): vizinhança exaustiva 1-adição e 1×1 (adiciona numa folga e remove em qualquer outro lugar).
import * as fs from "node:fs";
import * as path from "node:path";
import * as D from "./dados";
import * as N from "./nucleo";
import { OUT, wipB, demanda, pisoEquilibrio, prioridade, linhasDeCand } from "./frente-a";
import { prepararDespacho, despachar, linhasParaOcc, restricoesOk, type ConfigDespacho } from "@/features/escala/fluxo/postosDespacho";

const prods = D.produtosRev("meta", wipB.wip);
const cfg: ConfigDespacho = { t0: 0, produtos: prods, recursos: N.recursos, pessoas: N.pessoas, operacaoDe: N.opDe, alvo: demanda, piso: pisoEquilibrio(), margem: N.pesosMargem, prioridade, blocos: N.blocos, limiteOp: N.NP, penalPiso: 1, saidaTeto: Object.fromEntries(prods.map((p) => [p.id, p.recorrentePorPeriodo ?? p.demandaFinal / N.H])), saidaPeso: 0.25 };
const Dp = prepararDespacho(cfg);
const ini = linhasDeCand();
const occ = linhasParaOcc(cfg, Dp, ini);
const base = despachar(cfg, Dp, occ, true);
const porT = new Array(N.H).fill(0); ini.forEach((l) => porT[l.t]++);
const idle = porT.map((n, t) => ({ t, livres: N.pessoas[t] - n })).filter((x) => x.livres > 0);
const res: any[] = [];
for (const { t, livres } of idle) {
  const adds: any[] = [];
  for (let r = 0; r < N.recursos.length; r++) {
    if (occ[t][r] || (N.recursos[r].unidades[t] ?? 0) <= 0) continue;
    for (const o of Dp.opsDoRec[r]) {
      const o2 = occ.map((x) => x.slice()); o2[t][r] = o + 1;
      const ok = restricoesOk(cfg, Dp, o2, t);
      const d = despachar(cfg, Dp, o2, true);
      let idx = 0; for (let rr = 0; rr < r; rr++) if (o2[t][rr]) idx++;
      const q = d.detalhes[t][idx]?.reduce((a, x) => a + x.pecas, 0) ?? 0;
      adds.push({ maq: D.nomeM(N.recursos[r].id), op: D.nomeO(Dp.ops[o]), restricoesOk: ok, pecas: Math.round(q), dObj: +(d.obj - base.obj).toFixed(1) });
    }
  }
  let melhor = { d: -1e9, desc: "" };
  for (let r = 0; r < N.recursos.length; r++) {
    if (occ[t][r] || (N.recursos[r].unidades[t] ?? 0) <= 0) continue;
    for (const o of Dp.opsDoRec[r]) for (let t2 = 0; t2 < N.H; t2++) for (let r2 = 0; r2 < N.recursos.length; r2++) if (occ[t2][r2]) {
      const o2 = occ.map((x) => x.slice()); const v = o2[t2][r2]; o2[t2][r2] = 0; o2[t][r] = o + 1;
      if (!restricoesOk(cfg, Dp, o2, t) || !restricoesOk(cfg, Dp, o2, t2)) continue;
      const dd = despachar(cfg, Dp, o2).obj - base.obj;
      if (dd > melhor.d) melhor = { d: dd, desc: `+${D.nomeM(N.recursos[r].id)}/${D.nomeO(Dp.ops[o])}@${N.periodos[t].rotulo} −${D.nomeM(N.recursos[r2].id)}/${D.nomeO(Dp.ops[v - 1])}@${N.periodos[t2].rotulo}` };
    }
  }
  const melhorAdd = adds.filter((a) => a.restricoesOk).sort((a, b) => b.dObj - a.dObj)[0];
  res.push({ periodo: N.periodos[t].rotulo, livres, candidatos: adds.length, melhorAdd, melhorTroca1x1: { dObj: +melhor.d.toFixed(1), desc: melhor.desc }, addsComPecas: adds.filter((a) => a.pecas > 0).length, addsComDeltaPositivo: adds.filter((a) => a.dObj > 0.5 && a.restricoesOk).length });
}
console.log(JSON.stringify({ objBaseAntigo: Math.round(base.obj), res }, null, 1));
fs.writeFileSync(path.join(OUT, "antigo-vizinhanca.json"), JSON.stringify({ objBaseAntigo: base.obj, res }, null, 1));
