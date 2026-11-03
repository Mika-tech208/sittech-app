/* eslint-disable @typescript-eslint/no-explicit-any */
// ANÁLISE 1: avalia, com o objetivo do motor, o plano anterior (54c9face), o plano atual (b87908d9) e o replay, com o WIP antigo (Paf→Etiq=0) e o novo (2.400).
import { montar, avaliar, visaoMotor, postosDe, chave, lerPlano, valorFinais, semPostoPorSlot, restricoesTodas, D14, planoDoMotor } from "./lib";

const c0 = montar(0, `${D14}/plano-54c9.sql.out`); // WIP antigo
const c1 = montar(2400, `${D14}/plano-54c9.sql.out`); // WIP novo
const P0 = postosDe(c1, lerPlano(`${D14}/plano-54c9.sql.out`));
const P1 = postosDe(c1, lerPlano(`${D14}/plano-atual.sql.out`));
const PR = postosDe(c1, lerPlano(`${D14}/replay-linhas.json`));
console.log("postos: P0", P0.length, "P1", P1.length, "replay", PR.length, "| restricoes duras do despacho P0/P1:", restricoesTodas(c1, P0), restricoesTodas(c1, P1));
const rot = (c: any, nome: string, postos: any[]) => {
  const d = avaliar(c, postos), v = valorFinais(c, d), mv = visaoMotor(c, postos);
  const ocios = d.linhasOciosas.map((l) => `${c.e.slots[l.t].data.slice(8)}${c.e.slots[l.t].periodoId.toUpperCase()}:${c.nm(l.recursoId)}`);
  const sp = semPostoPorSlot(c, postos).map((x, t) => (x ? `${c.e.slots[t].data.slice(8)}${c.e.slots[t].periodoId.toUpperCase()}:${x}` : "")).filter(Boolean);
  const spm = semPostoPorSlot(c, mv.linhas).map((x, t) => (x ? `${c.e.slots[t].data.slice(8)}${c.e.slots[t].periodoId.toUpperCase()}:${x}` : "")).filter(Boolean);
  console.log(`${nome}: obj ${d.obj.toFixed(1)} · finais ${Math.round(v.total)} (Conv ${Math.round(v.porProd[c.m.produtos.find((p: any) => p.id.startsWith("27c2"))!.id])}) · margem ${v.margem.toFixed(1)} · ociosas ${ocios.length} ${ocios.join(",")} · sem posto (postos<pessoas) ${sp.join(",") || "—"} · visão do motor (poda): obj ${mv.desp.obj.toFixed(1)} postos ${mv.linhas.length} sem posto ${spm.join(",") || "—"}`);
  return { d, mv };
};
console.log("--- WIP ANTIGO (Paf→Etiq=0)"); rot(c0, "P0 @antigo", P0);
console.log("--- WIP NOVO (2.400)"); const a = rot(c1, "P0 @novo ", P0); const b = rot(c1, "P1 atual", P1); rot(c1, "replay  ", PR);
void a; void b;
// o que o motor entregaria para P0 sem mover postos (sv do ganho θ)
const sv = visaoMotor(c1, P0);
console.log(`sv (vigente avaliado iter 0): obj ${sv.desp.obj.toFixed(1)} ; plano atual obj ${avaliar(c1, P1).obj.toFixed(1)} ; ganho relativo ${(((avaliar(c1, P1).obj - sv.desp.obj) / sv.desp.obj) * 100).toFixed(2)} % (θ = ${(c1.CONFIG.ganhoMinimoRel ?? 0.01) * 100} %)`);
void planoDoMotor;
