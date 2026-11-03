/* eslint-disable @typescript-eslint/no-explicit-any */
// PARTES 3/4 — (1) valida a reconstrução: buscaLocal(P0, 150k, semente 1) = plano real; (2) curva churn × objetivo para λ (penalidade por célula alterada), 3 sementes; (3) o que teria acontecido hoje.
import { montar, avaliar, visaoMotor, postosDe, chave, lerPlano, valorFinais, semPostoPorSlot, planoDoMotor, buscaLocal, D14, type LinhaPostoD } from "./lib";
import { saPenalizada } from "./sa";

const c = montar(2400, `${D14}/plano-54c9.sql.out`);
const P0 = postosDe(c, lerPlano(`${D14}/plano-54c9.sql.out`));
const P1 = postosDe(c, lerPlano(`${D14}/plano-atual.sql.out`));
const celulas = (A: LinhaPostoD[], B: LinhaPostoD[]) => { const f = (L: LinhaPostoD[]) => new Map(L.map((l) => [`${l.t}|${l.recursoId}`, l.operacaoId])); const a = f(A), b = f(B); let d = 0; new Set([...a.keys(), ...b.keys()]).forEach((k) => { if (a.get(k) !== b.get(k)) d++; }); return d; };
// (1) validação: o motor (λ=0)
const real = buscaLocal(c.cfg, P0, { iter: 150000, reinicios: 1, semente: 1 });
const igualReal = real.linhas.length === P1.length && celulas(real.linhas, P1) === 0;
console.log(`(1) buscaLocal(P0, 150k it, 1 reinício, semente 1) reproduz o postos do plano real? ${igualReal} (células diferentes ${celulas(real.linhas, P1)}) obj ${real.desp.obj.toFixed(1)} vs real ${avaliar(c, P1).obj.toFixed(1)}`);
const objP0 = avaliar(c, P0).obj, svObj = visaoMotor(c, P0).desp.obj;
console.log(`P0@novo obj ${objP0.toFixed(1)} · sv(poda) ${svObj.toFixed(1)} · θ=1% exige ≥ ${(svObj * 1.01).toFixed(1)}; resultado da busca ${real.desp.obj.toFixed(1)} ⇒ ${real.desp.obj > svObj * 1.01 ? "troca" : "retém"}`);
// (2) curva
const lambdas = [0, 0.5, 1, 2, 4, 8, 16, 32, 64, 128];
const linhasTab: string[] = [];
const resultados: Record<string, any> = {};
for (const lam of lambdas) {
  const rs: any[] = [];
  for (const sem of [1, 2, 3]) {
    const r = saPenalizada(c, P0, P0, lam, { iter: 150000, semente: sem });
    const v = visaoMotor(c, r.postos); // poda do motor
    const d = avaliar(c, v.linhas), val = valorFinais(c, d);
    const sp = semPostoPorSlot(c, v.linhas).reduce((a, b) => a + b, 0);
    rs.push({ sem, churn: celulas(P0, v.linhas), churnVsReal: celulas(P1, v.linhas), obj: d.obj, margem: val.margem, finais: val.total, sp });
  }
  const m = (k: string) => rs.reduce((s, x) => s + x[k], 0) / rs.length;
  resultados[lam] = rs;
  linhasTab.push(`| ${lam} | ${rs.map((x) => x.churn).join("/")} (média ${m("churn").toFixed(0)}) | ${m("obj").toFixed(0)} (${Math.min(...rs.map((x) => x.obj)).toFixed(0)}–${Math.max(...rs.map((x) => x.obj)).toFixed(0)}) | ${m("margem").toFixed(0)} | ${m("finais").toFixed(0)} | ${rs.map((x) => x.sp).join("/")} |`);
  console.log(linhasTab[linhasTab.length - 1]);
}
console.log("| λ | churn (células máq×período) por semente | obj médio (min–max) | margem R$ média | peças finais média | pessoas-período sem posto |");
console.log(linhasTab.join("\n"));
import * as fs from "node:fs";
fs.writeFileSync(`${D14}/curva-lambda.json`, JSON.stringify({ lambdas, resultados, objP0, svObj, objReal: avaliar(c, P1).obj }, null, 1));
void chave; void planoDoMotor;
