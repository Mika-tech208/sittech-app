import { produtosRev, recursos, periodos, pessoas, PRINCIPAL, nomeP, conv, aut } from "./dados";
import { otimizarAlvos } from "@/features/escala/fluxo/propostaCorte";
const prods = produtosRev("meta", PRINCIPAL.wip);
const base = { periodos, recursos, produtos: prods, pessoas, extensaoPeriodos: 1 };
const pino = prods.find(p => /^Pino/.test(p.rotulo))!.id, plug = prods.find(p => /^Plug/.test(p.rotulo))!.id;
for (const nome of ["pecas", "valor"]) {
  const pesos = Object.fromEntries(prods.map(p => [p.id, nome === "pecas" ? 1 : (p.valorUnitario ?? 0)]));
  const t0 = Date.now();
  const r = otimizarAlvos({ base, pesos, grupos: [[aut, conv], [pino, plug]], opAval: { semAntecipacao: true }, maxAval: 40000 });
  console.log(nome, "ms", Date.now() - t0, "aval", r.avaliacoes, "obj", Math.round(r.objetivo), Object.fromEntries(Object.entries(r.melhor.entregue).map(([k, v]) => [nomeP(k), Math.round(v)])), "pico", r.melhor.picoPostos, r.melhor.viavel);
}
