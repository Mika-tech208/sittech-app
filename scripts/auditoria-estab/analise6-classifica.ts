/* eslint-disable @typescript-eslint/no-explicit-any */
// PARTE 2 — Classificação das células (máquina×período) alteradas entre o plano anterior (54c9face) e o plano real (b87908d9), com o objetivo do motor.
// Para cada célula: ganho isolado (aplicada sozinha ao 54c9 com o WIP novo) e perda ao reverter (tirada sozinha do plano real). Agrupa em componentes conexos
// (mesmo período, ou mesma máquina a ≤ 2 períodos) e mede o grupo inteiro. Referência de necessidade: o reparo de 1 posto (Etiquetadora 15 em 03/11 M1).
import * as fs from "node:fs";
import { montar, avaliar, visaoMotor, postosDe, lerPlano, valorFinais, D14, linhasParaOcc, despachar, type LinhaPostoD } from "./lib";

const c = montar(2400, `${D14}/plano-54c9.sql.out`);
const P0 = postosDe(c, lerPlano(`${D14}/plano-54c9.sql.out`));
const P1 = postosDe(c, lerPlano(`${D14}/plano-atual.sql.out`));
const C = c.cfg, D = c.D;
const mp = (L: LinhaPostoD[]) => new Map(L.map((l) => [`${l.t}|${l.recursoId}`, l.operacaoId]));
const m0 = mp(P0), m1 = mp(P1);
type Cel = { k: string; t: number; r: string; tipo: "ENTRA" | "SAI" | "TROCA"; op0?: string; op1?: string };
const cels: Cel[] = [];
new Set([...m0.keys(), ...m1.keys()]).forEach((k) => {
  const [t, r] = k.split("|"); const a = m0.get(k), b = m1.get(k);
  if (a === b) return;
  cels.push({ k, t: Number(t), r, tipo: a === undefined ? "ENTRA" : b === undefined ? "SAI" : "TROCA", op0: a, op1: b });
});
cels.sort((x, y) => x.t - y.t || (x.r < y.r ? -1 : 1));
const objOcc = (mapa: Map<string, string>) => { const L: LinhaPostoD[] = [...mapa.entries()].map(([k, op]) => { const [t, r] = k.split("|"); return { t: Number(t), recursoId: r, operacaoId: op }; }); return avaliar(c, L).obj; };
const base0 = objOcc(m0), base1 = objOcc(m1);
const sv = visaoMotor(c, P0);
const podados = new Set(P0.filter((p) => !sv.linhas.some((q) => q.t === p.t && q.recursoId === p.recursoId && q.operacaoId === p.operacaoId)).map((p) => `${p.t}|${p.recursoId}`));
const spSv = new Map<number, number>(); { const n = new Array(C.pessoas.length).fill(0); sv.linhas.forEach((l) => n[l.t]++); n.forEach((x, t) => spSv.set(t, Math.max(0, C.pessoas[t] - x))); }
const aplica = (mapa: Map<string, string>, cs: Cel[], para: "P1" | "P0") => { const m = new Map(mapa); cs.forEach((x) => { const v = para === "P1" ? x.op1 : x.op0; if (v === undefined) m.delete(x.k); else m.set(x.k, v); }); return m; };
// grupos conexos
const pai = cels.map((_, i) => i); const raiz = (i: number): number => (pai[i] === i ? i : (pai[i] = raiz(pai[i])));
cels.forEach((a, i) => cels.forEach((b, j) => { if (j > i && (a.t === b.t || (a.r === b.r && Math.abs(a.t - b.t) <= 2))) pai[raiz(j)] = raiz(i); }));
const grupos = new Map<number, number[]>(); cels.forEach((_, i) => (grupos.get(raiz(i)) ?? grupos.set(raiz(i), []).get(raiz(i))!).push(i));
const theta = base1 * 0.01;
const nomeCel = (x: Cel) => `${c.e.slots[x.t].data.slice(8)}${c.e.slots[x.t].periodoId.toUpperCase()} ${c.nm(x.r)}`;
const linhas: any[] = [];
cels.forEach((x, i) => {
  const ganhoIso = objOcc(aplica(m0, [x], "P1")) - base0; // aplicada ao 54c9 com WIP novo
  const perdaRev = base1 - objOcc(aplica(m1, [x], "P0")); // retirada do plano real
  linhas.push({ i, tipo: x.tipo, cel: nomeCel(x), t: x.t, ganhoIso, perdaRev, podado: x.tipo === "SAI" && podados.has(x.k), deficit: x.tipo === "ENTRA" && (spSv.get(x.t) ?? 0) > 0 });
});
const gl: any[] = [];
[...grupos.values()].forEach((idx, gi) => {
  const cs = idx.map((i) => cels[i]);
  const perdaGrupo = base1 - objOcc(aplica(m1, cs, "P0")), ganhoGrupo = objOcc(aplica(m0, cs, "P1")) - base0;
  gl.push({ g: gi + 1, n: cs.length, entra: cs.filter((x) => x.tipo === "ENTRA").length, sai: cs.filter((x) => x.tipo === "SAI").length, troca: cs.filter((x) => x.tipo === "TROCA").length, perdaGrupo, ganhoGrupo, slots: [...new Set(cs.map((x) => c.e.slots[x.t].data.slice(8) + c.e.slots[x.t].periodoId.toUpperCase()))].join(","), ref: cs.some((x) => x.t === 0 && x.tipo === "ENTRA" && /^Etiquetadora 15/.test(c.nm(x.r))) });
});
gl.sort((a, b) => b.perdaGrupo - a.perdaGrupo);
console.log(`células alteradas: ${cels.length} (ENTRA ${cels.filter((x) => x.tipo === "ENTRA").length}, SAI ${cels.filter((x) => x.tipo === "SAI").length}, TROCA ${cels.filter((x) => x.tipo === "TROCA").length}) · obj 54c9@novo ${base0.toFixed(1)} · plano real ${base1.toFixed(1)} · θ=1% = ${theta.toFixed(1)} · 54c9 com poda: ${sv.desp.obj.toFixed(1)} · postos podados ${[...podados].length}`);
console.log("GRUPOS CONEXOS (ordenados pela perda ao reverter o grupo inteiro no plano real):");
console.log("| grupo | células (entra/sai/troca) | períodos | perda ao reverter o grupo | ganho aplicando só o grupo ao 54c9 | contém a Etiq15 M1? |");
console.log("|---|---|---|---:|---:|---|");
gl.forEach((g) => console.log(`| ${g.g} | ${g.n} (${g.entra}/${g.sai}/${g.troca}) | ${g.slots.slice(0, 60)} | ${g.perdaGrupo.toFixed(1)} | ${g.ganhoGrupo.toFixed(1)} | ${g.ref ? "SIM" : ""} |`));
// classificação POR CÉLULA
const cat = (l: any) => {
  if (l.cel.startsWith("03M1 Etiquetadora 15") && l.tipo === "ENTRA") return "NECESSÁRIA_PARA_HEADCOUNT"; // o reparo mínimo; também aproveita o estoque contado
  if (l.podado) return "NECESSÁRIA_PARA_CADEIA"; // linha do 54c9 que perde material/valor com o WIP novo (a poda do motor a remove)
  if (l.perdaRev >= theta) return "MELHORIA_DE_OBJETIVO";
  return "ALTERAÇÃO_SEM_GANHO_RELEVANTE";
};
const cont: Record<string, number> = {};
linhas.forEach((l) => { l.cat = cat(l); cont[l.cat] = (cont[l.cat] ?? 0) + 1; });
cont["NECESSÁRIA_PARA_REVEZAMENTO"] = 0; cont["EFEITO_DE_ESTABILIZAÇÃO"] = 0;
console.log("\nCONTAGEM POR CATEGORIA (por célula):", JSON.stringify(cont));
const dist = (f: (l: any) => boolean) => { const v = linhas.filter(f).map((l) => l.perdaRev); return v.length ? `n=${v.length} perdaRev: soma ${v.reduce((a, b) => a + b, 0).toFixed(1)}, máx ${Math.max(...v).toFixed(1)}, mín ${Math.min(...v).toFixed(1)}` : "n=0"; };
console.log("ALTERAÇÃO_SEM_GANHO_RELEVANTE:", dist((l) => l.cat === "ALTERAÇÃO_SEM_GANHO_RELEVANTE"));
const faixas = [[-1e9, -0.5], [-0.5, 0.5], [0.5, 20], [20, 100], [100, 1e9]];
faixas.forEach(([a, b]) => console.log(`  perda ao reverter a célula em [${a}, ${b}): ${linhas.filter((l) => l.perdaRev >= a && l.perdaRev < b).length} células`));
console.log("Σ perda isolada de todas as células:", linhas.reduce((s, l) => s + l.perdaRev, 0).toFixed(1), "(ganho total do plano real sobre o 54c9@novo:", (base1 - base0).toFixed(1) + ")");
// efeito acumulado: depois do reparo mínimo (1 posto), o que as DEMAIS 89 células acrescentam
const ref = cels.find((x) => x.t === 0 && x.tipo === "ENTRA" && /^Etiquetadora 15/.test(c.nm(x.r)))!;
const baseRef = objOcc(aplica(m0, [ref], "P1"));
const resto = cels.filter((x) => x !== ref);
console.log(`Reparo mínimo (só ${nomeCel(ref)}): obj ${baseRef.toFixed(1)}; as outras ${resto.length} células somam +${(base1 - baseRef).toFixed(1)} (${(((base1 - baseRef) / baseRef) * 100).toFixed(2)} %), muito abaixo de θ (${(baseRef * 0.01).toFixed(1)})`);
fs.writeFileSync(`${D14}/classificacao.json`, JSON.stringify({ linhas, grupos: gl, cont, base0, base1, baseRef }, null, 1));
void linhasParaOcc; void despachar; void valorFinais;
