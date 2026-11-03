/* eslint-disable @typescript-eslint/no-explicit-any */
// PARTE 2 (método robusto) — CAMINHO de reparo: parte do reparo mínimo (54c9 + Etiquetadora 15 em M1) e aplica, na ordem de MAIOR ganho incremental, as demais células da diferença para o plano real,
// ou como célula isolada ou como PAR (uma célula que sai + uma que entra, mesma máquina a ≤ 3 períodos, ou mesmo período — um deslocamento). Mostra quantas células "pagam" e quanto.
import * as fs from "node:fs";
import { montar, avaliar, postosDe, lerPlano, D14, planoDoMotor, visaoMotor, valorFinais, semPostoPorSlot, type LinhaPostoD } from "./lib";
const c = montar(2400, `${D14}/plano-54c9.sql.out`);
const P0 = postosDe(c, lerPlano(`${D14}/plano-54c9.sql.out`));
const P1 = postosDe(c, lerPlano(`${D14}/plano-atual.sql.out`));
const mp = (L: LinhaPostoD[]) => new Map(L.map((l) => [`${l.t}|${l.recursoId}`, l.operacaoId]));
const m0 = mp(P0), m1 = mp(P1);
const obj = (m: Map<string, string>) => avaliar(c, [...m.entries()].map(([k, op]) => { const [t, r] = k.split("|"); return { t: Number(t), recursoId: r, operacaoId: op }; })).obj;
const nome = (k: string) => { const [t, r] = k.split("|"); return `${c.e.slots[+t].data.slice(8)}${c.e.slots[+t].periodoId.toUpperCase()} ${c.nm(r)}`; };
const dif = [...new Set([...m0.keys(), ...m1.keys()])].filter((k) => m0.get(k) !== m1.get(k));
const cur = new Map(m0);
let restantes = [...dif];
const refNaoEstaNoReal = !dif.some((k) => k.startsWith("0|") && /^Etiquetadora 15/.test(c.nm(k.split("|")[1])));
let o = obj(cur); const o0 = o;
console.log(`partida: 54c9face@WIP novo obj ${o.toFixed(1)} ; plano real ${obj(m1).toFixed(1)} ; ${restantes.length} células a aplicar; θ=1% = ${(o * 0.01).toFixed(1)} ; a Etiquetadora 15 em M1 (reparo de 1 posto) ${refNaoEstaNoReal ? "NÃO faz parte do plano real" : "faz parte do plano real"}`);
const viavel = (m: Map<string, string>) => { const n = new Array(c.cfg.pessoas.length).fill(0); m.forEach((_, k) => n[+k.split("|")[0]]++); return n.every((x, t) => x <= c.cfg.pessoas[t]); }; // ≤ pessoas em cada período
const aplica = (m: Map<string, string>, ks: string[]) => { const n = new Map(m); ks.forEach((k) => { const v = m1.get(k); if (v === undefined) n.delete(k); else n.set(k, v); }); return n; };
const passos: any[] = [];
const tipo = (k: string) => (m0.get(k) === undefined ? "ENTRA" : m1.get(k) === undefined ? "SAI" : "TROCA");
for (let it = 0; it < 120 && restantes.length; it++) {
  type Op = { ks: string[]; obj: number };
  const ops: Op[] = [];
  restantes.forEach((k) => { const n = aplica(cur, [k]); if (viavel(n)) ops.push({ ks: [k], obj: obj(n) }); });
  const ents = restantes.filter((k) => tipo(k) === "ENTRA"), sais = restantes.filter((k) => tipo(k) === "SAI");
  sais.forEach((s) => ents.forEach((e) => { const [ts, rs] = s.split("|"), [te, re] = e.split("|"); if (ts === te || (rs === re && Math.abs(+ts - +te) <= 3)) { const n = aplica(cur, [s, e]); if (viavel(n)) ops.push({ ks: [s, e], obj: obj(n) }); } }));
  // ganho por célula alterada (favorece o que rende mais por célula)
  ops.sort((a, b) => (b.obj - o) / b.ks.length - (a.obj - o) / a.ks.length);
  const m = ops[0];
  if (m.obj - o <= 1e-6) break;
  passos.push({ n: passos.length + 1, desc: m.ks.map((k) => `${tipo(k)} ${nome(k)}`).join(" + "), ganho: m.obj - o, cel: m.ks.length });
  m.ks.forEach((k) => { const v = m1.get(k); if (v === undefined) cur.delete(k); else cur.set(k, v); });
  o = m.obj; restantes = restantes.filter((k) => !m.ks.includes(k));
}
const final = obj(m1);
const cum: number[] = []; let ac = o0, cel = 0;
console.log("| passo | mudança(s) | células | ganho incremental | acumulado sobre o 54c9@novo | células acumuladas |");
console.log("|---|---|---:|---:|---:|---:|");
passos.forEach((p) => { ac += p.ganho; cel += p.cel; cum.push(ac - o0); console.log(`| ${p.n} | ${p.desc.slice(0, 110)} | ${p.cel} | ${p.ganho.toFixed(1)} | ${(ac - o0).toFixed(1)} | ${cel} |`); });
console.log(`\nCélulas aplicadas com ganho incremental > 0: ${cel}; restantes ${restantes.length} (acopladas/neutras): efeito líquido ao completar o plano real = ${(final - o).toFixed(1)}`);
const faixa = (a: number, b: number) => passos.filter((p) => p.ganho / p.cel >= a && p.ganho / p.cel < b).reduce((s, p) => s + p.cel, 0);
console.log(`Ganho por célula: ≥ 20 → ${faixa(20, 1e9)} células ; 5–20 → ${faixa(5, 20)} ; 1–5 → ${faixa(1, 5)} ; < 1 → ${faixa(0, 1)}`);
console.log(`Total: 54c9@novo ${o0.toFixed(1)} → plano real ${final.toFixed(1)} (+${(final - o0).toFixed(1)} = ${(((final - o0) / o0) * 100).toFixed(2)} %) com ${dif.length} células; limiar θ = ${(o0 * 0.01).toFixed(1)}`);
fs.writeFileSync(`${D14}/caminho.json`, JSON.stringify({ passos, o0, final, restantes: restantes.map(nome) }, null, 1));

// VALIDAÇÃO do estado alcançado pelo caminho (≈ 22 células): poda do motor, pessoas, revezamento/ponte, cadeia, ≤12
const finalPostos: LinhaPostoD[] = [...cur.entries()].map(([k, op]) => { const [t, r] = k.split("|"); return { t: Number(t), recursoId: r, operacaoId: op }; });
const dv = avaliar(c, finalPostos), vv = valorFinais(c, dv), mv = visaoMotor(c, finalPostos), plano = planoDoMotor(c, finalPostos);
const celDiff = (A: Map<string, string>, B: Map<string, string>) => [...new Set([...A.keys(), ...B.keys()])].filter((k) => A.get(k) !== B.get(k)).length;
console.log(`ESTADO DO CAMINHO (${passos.reduce((a, p) => a + p.cel, 0)} células aplicadas): obj ${dv.obj.toFixed(1)} · margem ${vv.margem.toFixed(1)} · peças ${Math.round(vv.total)} · churn vs 54c9 ${celDiff(m0, cur)} · poda mantém ${mv.linhas.length}/${finalPostos.length} postos · sem posto ${semPostoPorSlot(c, finalPostos).reduce((a, b) => a + b, 0)} · motor: ${JSON.stringify(plano.validacao)}`);
console.log(`vs plano real: obj ${(dv.obj - final).toFixed(1)} · churn vs plano real ${celDiff(cur, m1)}`);
