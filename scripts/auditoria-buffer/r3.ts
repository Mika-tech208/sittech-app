/* eslint-disable @typescript-eslint/no-explicit-any */
import { carregarTudo, versoes, nomeador, slotsDa } from "./lib";
const { d } = carregarTudo();
const nome = nomeador(d.nomes);
const V = versoes();
for (const k of Object.keys(V)) {
  console.log("==", k);
  V[k].linhas.filter((a) => a.data === "2026-10-30" && ["t1","t2","t3"].includes(a.periodoId) && a.produtoId && /Con3\/4|Conector 3/.test(nome(a.produtoId))).forEach((a) =>
    console.log(" ", a.periodoId, nome(a.funcionarioId), nome(a.maquinaId), nome(a.etapaId), "pecas", Math.round(a.pecas), "adic", a.pecasAdicional ?? 0, a.tipoAdicional ?? "", a.origem));
  // quem está sem posto / fora
  const sp = V[k].linhas.filter((a) => a.data === "2026-10-30" && ["t1","t2","t3"].includes(a.periodoId) && !a.maquinaId);
  console.log("  sem posto:", sp.map((a) => `${a.periodoId}:${nome(a.funcionarioId)}:${a.motivoSemPosto}`).join(", "));
}
