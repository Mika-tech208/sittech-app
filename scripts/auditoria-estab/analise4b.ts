/* eslint-disable @typescript-eslint/no-explicit-any */
// valor MARGINAL da Embalagem 17 em cada período para o plano atual (se houvesse pessoa de sobra) — mostra que embalar mais cedo é neutro no objetivo
import { montar, avaliar, postosDe, lerPlano, D14, chave } from "./lib";
const c = montar(2400, `${D14}/plano-54c9.sql.out`);
const P1 = postosDe(c, lerPlano(`${D14}/plano-atual.sql.out`));
const EMB = c.cfg.recursos.find((r) => /^Embalagem 17/.test(c.nm(r.id)))!;
const ri = c.cfg.recursos.indexOf(EMB);
const op = c.D.ops[c.D.opsDoRec[ri][0]];
const dA = avaliar(c, P1);
const S = c.e.slots;
const linhas: string[] = [];
for (let t = 0; t < S.length; t++) {
  if (P1.some((p) => p.t === t && p.recursoId === EMB.id)) { linhas.push(`${S[t].data.slice(8)}${S[t].periodoId.toUpperCase()}: já ocupada`); continue; }
  const d = avaliar(c, [...P1, { t, recursoId: EMB.id, operacaoId: op }]);
  linhas.push(`${S[t].data.slice(8)}${S[t].periodoId.toUpperCase()}: Δobj ${(d.obj - dA.obj).toFixed(2)}`);
}
console.log("Δ objetivo de ACRESCENTAR a Embalagem 17 (13ª pessoa hipotética) em cada período livre do plano atual:\n" + linhas.join(" | "));
void chave;
