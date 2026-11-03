/* eslint-disable @typescript-eslint/no-explicit-any */
// PARTE 3 — REPARO MÍNIMO: a partir do plano anterior (54c9face) e do WIP novo (2.400), adiciona/troca o MENOR número de postos para ficar com 0 pessoa sem posto (todo posto com valor positivo
// depois da poda do motor), cadeia/material válidos (por construção do despacho), revezamento+ponte (conferido pelo motor com pessoas) e piso. Compara com o plano real (b87908d9).
import { montar, avaliar, visaoMotor, postosDe, chave, lerPlano, valorFinais, semPostoPorSlot, restricoesTodas, planoDoMotor, D14, type LinhaPostoD } from "./lib";

const c = montar(2400, `${D14}/plano-54c9.sql.out`);
const P0 = postosDe(c, lerPlano(`${D14}/plano-54c9.sql.out`));
const P1 = postosDe(c, lerPlano(`${D14}/plano-atual.sql.out`));
const nomeSlot = (t: number) => `${c.e.slots[t].data.slice(8)}${c.e.slots[t].periodoId.toUpperCase()}`;
const dist = (A: LinhaPostoD[], B: LinhaPostoD[]) => { const a = new Set(A.map(chave)), b = new Set(B.map(chave)); let d = 0; a.forEach((k) => !b.has(k) && d++); b.forEach((k) => !a.has(k) && d++); return d; };
const distMaqPer = (A: LinhaPostoD[], B: LinhaPostoD[]) => { const f = (L: LinhaPostoD[]) => new Set(L.map((l) => `${l.t}|${l.recursoId}`)); const a = f(A), b = f(B); let d = 0; a.forEach((k) => !b.has(k) && d++); b.forEach((k) => !a.has(k) && d++); return d; };

const base = visaoMotor(c, P0);
console.log(`P0 @novo WIP: ${P0.length} postos; visão do motor (poda) ${base.linhas.length} postos obj ${base.desp.obj.toFixed(1)}; P1 real obj ${avaliar(c, P1).obj.toFixed(1)}`);
const podados = P0.filter((p) => !base.linhas.some((q) => chave(q) === chave(p)));
console.log("postos de P0 que perdem valor com o WIP novo (a poda do motor os remove):", podados.map((p) => `${nomeSlot(p.t)} ${c.nm(p.recursoId)}`).join(" · ") || "nenhum");

// REPARO GREEDY: cobre as pessoas sem posto com o posto de maior ganho de objetivo (que sobreviva à poda)
let S: LinhaPostoD[] = base.linhas.map((l) => ({ ...l }));
let obj = base.desp.obj;
const adicionados: string[] = [];
for (let it = 0; it < 30; it++) {
  const sp = semPostoPorSlot(c, S);
  const alvos = sp.map((x, t) => (x > 0 ? t : -1)).filter((t) => t >= 0);
  if (alvos.length === 0) break;
  let melhor: { cand: LinhaPostoD; obj: number; linhas: LinhaPostoD[] } | null = null;
  for (const t of alvos) {
    const ocup = new Set(S.filter((p) => p.t === t).map((p) => p.recursoId));
    c.cfg.recursos.forEach((r, ri) => {
      if (ocup.has(r.id) || (r.unidades[t] ?? 0) <= 0) return;
      c.D.opsDoRec[ri].forEach((o) => {
        const cand = { t, recursoId: r.id, operacaoId: c.D.ops[o] };
        const v = visaoMotor(c, [...S, cand]);
        if (!v.linhas.some((q) => chave(q) === chave(cand))) return; // a poda o removeria: sem valor
        if (!melhor || v.desp.obj > melhor.obj) melhor = { cand, obj: v.desp.obj, linhas: v.linhas };
      });
    });
  }
  if (!melhor) { console.log("sem candidato com valor positivo para os slots:", alvos.map(nomeSlot).join(",")); break; }
  const m = melhor as { cand: LinhaPostoD; obj: number; linhas: LinhaPostoD[] };
  adicionados.push(`${nomeSlot(m.cand.t)} ${c.nm(m.cand.recursoId)} (+${(m.obj - obj).toFixed(1)})`);
  S = m.linhas.map((l) => ({ ...l })); obj = m.obj;
}
console.log("REPARO — postos acrescentados:", adicionados.join(" · ") || "nenhum");
const dReparo = avaliar(c, S), vR = valorFinais(c, dReparo);
const sp = semPostoPorSlot(c, S).reduce((a, b) => a + b, 0);
const plano = planoDoMotor(c, S);
console.log(`PLANO REPARADO: ${S.length} postos · sem posto ${sp} · obj ${dReparo.obj.toFixed(1)} · finais ${Math.round(vR.total)} · margem ${vR.margem.toFixed(1)} | motor com pessoas: cadeiaValida ${plano.validacao.cadeiaValida} semMaterial ${plano.validacao.semMaterial} violacoesDuras ${plano.validacao.violacoesDuras} atribuicaoOk ${plano.validacao.atribuicaoOk} maxPostos ${plano.validacao.maxPostosSimultaneos}`);
const vP1 = valorFinais(c, avaliar(c, P1));
console.log(`PLANO REAL (b87908d9): ${P1.length} postos · obj ${avaliar(c, P1).obj.toFixed(1)} · finais ${Math.round(vP1.total)} · margem ${vP1.margem.toFixed(1)}`);
console.log(`CHURN (postos máquina×período×operação) — mínimo: ${dist(P0, S)} (máq×período ${distMaqPer(P0, S)}) | real do motor: ${dist(P0, P1)} (máq×período ${distMaqPer(P0, P1)}) | P0 → P1 só máq×período: removidos ${P0.filter((p) => !P1.some((q) => q.t === p.t && q.recursoId === p.recursoId)).length}, acrescentados ${P1.filter((p) => !P0.some((q) => q.t === p.t && q.recursoId === p.recursoId)).length}`);
console.log(`Ganho do objetivo sobre P0@novo: reparo +${(dReparo.obj - avaliar(c, P0).obj).toFixed(1)} (${(((dReparo.obj - avaliar(c, P0).obj) / avaliar(c, P0).obj) * 100).toFixed(2)}%) · real +${(avaliar(c, P1).obj - avaliar(c, P0).obj).toFixed(1)} (${(((avaliar(c, P1).obj - avaliar(c, P0).obj) / avaliar(c, P0).obj) * 100).toFixed(2)}%)`);
void restricoesTodas;
