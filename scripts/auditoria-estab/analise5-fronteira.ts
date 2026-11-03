/* eslint-disable @typescript-eslint/no-explicit-any */
// PARTES 3/4 — FRONTEIRA CHURN × OBJETIVO determinística: subida de encosta (steepest ascent) sobre mudanças de UMA célula (t, máquina) a partir do plano anterior 54c9face com o WIP novo.
// Cada passo escolhe a mudança de maior ganho de objetivo; registra churn acumulado (células ≠ 54c9), objetivo (com poda do motor), pessoas sem posto e ganho marginal por célula.
import * as fs from "node:fs";
import { montar, avaliar, visaoMotor, postosDe, lerPlano, valorFinais, semPostoPorSlot, linhasParaOcc, despachar, restricoesOk, occParaLinhas, D14, type LinhaPostoD } from "./lib";

const c = montar(2400, `${D14}/plano-54c9.sql.out`);
const P0 = postosDe(c, lerPlano(`${D14}/plano-54c9.sql.out`));
const P1 = postosDe(c, lerPlano(`${D14}/plano-atual.sql.out`));
const C = c.cfg, D = c.D, R = C.recursos.length, H = D.H;
const occ0 = linhasParaOcc(C, D, P0);
const occ = occ0.map((x) => x.slice());
const objDe = () => despachar(C, D, occ).obj;
const churn = () => { let n = 0; for (let t = 0; t < H; t++) for (let r = 0; r < R; r++) if (occ[t][r] !== occ0[t][r]) n++; return n; };
const nome = (t: number, r: number) => `${c.e.slots[t].data.slice(8)}${c.e.slots[t].periodoId.toUpperCase()} ${c.nm(C.recursos[r].id)}`;
const passos: any[] = [];
const registra = (k: number, desc: string, ganho: number) => {
  const postos = occParaLinhas(C, D, occ.map((x) => x.slice()));
  const v = visaoMotor(c, postos); // com a poda do motor
  const d = avaliar(c, v.linhas), val = valorFinais(c, d);
  passos.push({ k, desc, ganho, churn: churn(), obj: d.obj, objSemPoda: objDe(), margem: val.margem, finais: val.total, semPosto: semPostoPorSlot(c, v.linhas).reduce((a, b) => a + b, 0) });
};
registra(0, "54c9face inalterado (com poda do motor)", 0);
for (let k = 1; k <= 60; k++) {
  const base = objDe();
  let melhor: { t: number; r: number; v: number; obj: number } | null = null;
  for (let t = C.t0; t < H; t++) for (let r = 0; r < R; r++) {
    const atual = occ[t][r];
    const valores = [0, ...D.opsDoRec[r].map((o) => o + 1)];
    for (const v of valores) {
      if (v === atual) continue;
      if (v !== 0 && (C.recursos[r].unidades[t] ?? 0) <= 0) continue;
      occ[t][r] = v;
      if (restricoesOk(C, D, occ, t)) { const o = objDe(); if (!melhor || o > melhor.obj + 1e-9) melhor = { t, r, v, obj: o }; }
      occ[t][r] = atual;
    }
  }
  if (!melhor || melhor.obj <= base + 1e-6) { registra(k, "(sem mudança de uma célula que melhore)", 0); break; }
  const m = melhor as { t: number; r: number; v: number; obj: number };
  const antes = occ[m.t][m.r];
  occ[m.t][m.r] = m.v;
  registra(k, `${antes === 0 ? "ENTRA" : m.v === 0 ? "SAI" : "TROCA OP"} ${nome(m.t, m.r)}`, m.obj - base);
}
const dReal = avaliar(c, P1), vReal = valorFinais(c, dReal);
console.log("| passo | mudança | ganho marginal | churn acumulado (células) | obj (poda) | margem R$ | peças | sem posto |");
console.log("|---|---|---:|---:|---:|---:|---:|---:|");
passos.forEach((p) => console.log(`| ${p.k} | ${p.desc} | ${p.ganho.toFixed(1)} | ${p.churn} | ${p.obj.toFixed(1)} | ${p.margem.toFixed(0)} | ${Math.round(p.finais)} | ${p.semPosto} |`));
console.log(`\nPLANO REAL: churn ${(() => { const f = (L: LinhaPostoD[]) => new Map(L.map((l) => [`${l.t}|${l.recursoId}`, l.operacaoId])); const a = f(P0), b = f(P1); let d = 0; new Set([...a.keys(), ...b.keys()]).forEach((k) => { if (a.get(k) !== b.get(k)) d++; }); return d; })()} células · obj ${dReal.obj.toFixed(1)} · margem ${vReal.margem.toFixed(0)} · peças ${Math.round(vReal.total)}`);
fs.writeFileSync(`${D14}/fronteira.json`, JSON.stringify({ passos, real: { obj: dReal.obj, margem: vReal.margem, finais: vReal.total } }, null, 1));
