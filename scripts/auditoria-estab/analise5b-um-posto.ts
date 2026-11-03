/* eslint-disable @typescript-eslint/no-explicit-any */
// Valida o REPARO DE 1 POSTO (54c9face + Etiquetadora 15 em M1): plano completo do motor (pessoas, revezamento bloco + ponte M3→T1, cadeia, ≤12) e comparação com o plano real.
import * as fs from "node:fs";
import { montar, avaliar, postosDe, lerPlano, valorFinais, planoDoMotor, linhasComDetalhes, D14 } from "./lib";
const c = montar(2400, `${D14}/plano-54c9.sql.out`);
const P0 = postosDe(c, lerPlano(`${D14}/plano-54c9.sql.out`));
const P1 = postosDe(c, lerPlano(`${D14}/plano-atual.sql.out`));
const ETQ = c.cfg.recursos.find((r) => /^Etiquetadora 15/.test(c.nm(r.id)))!;
const ri = c.cfg.recursos.indexOf(ETQ), op = c.D.ops[c.D.opsDoRec[ri][0]];
const R1 = [...P0, { t: 0, recursoId: ETQ.id, operacaoId: op }];
const plano = planoDoMotor(c, R1);
const d = avaliar(c, R1), v = valorFinais(c, d), ld = linhasComDetalhes(c.cfg, R1, d);
const etqM1 = ld.filter((l) => l.linha.t === 0 && l.linha.recursoId === ETQ.id).reduce((s, l) => s + l.detalhes.reduce((a, b) => a + b.pecas, 0), 0);
console.log(`REPARO DE 1 POSTO: ${R1.length} postos · obj ${d.obj.toFixed(1)} · finais ${Math.round(v.total)} · margem ${v.margem.toFixed(1)} · Etiquetadora 15 em M1 = ${Math.round(etqM1)} peças`);
console.log("motor com pessoas:", JSON.stringify(plano.validacao), "avisos:", plano.avisos.slice(0, 3).join(" | "));
const semPosto = plano.linhas.filter((l) => !l.maquinaId).length;
console.log(`linhas ${plano.linhas.length} · pessoas-período sem posto ${semPosto} · postos iguais ao 54c9 (máq×período): ${R1.filter((p) => P0.some((q) => q.t === p.t && q.recursoId === p.recursoId)).length}/${P0.length}`);
const dR = avaliar(c, P1), vR = valorFinais(c, dR);
console.log(`PLANO REAL: obj ${dR.obj.toFixed(1)} · finais ${Math.round(vR.total)} · margem ${vR.margem.toFixed(1)} ⇒ o reparo de 1 posto tem ${((d.obj / dR.obj) * 100).toFixed(2)} % do objetivo, ${((v.margem / vR.margem) * 100).toFixed(2)} % da margem e ${((v.total / vR.total) * 100).toFixed(2)} % das peças do plano real`);
fs.writeFileSync(`${D14}/reparo-1-posto.json`, JSON.stringify({ obj: d.obj, margem: v.margem, finais: v.total, validacao: plano.validacao }, null, 1));
