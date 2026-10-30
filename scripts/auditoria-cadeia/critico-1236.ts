/* eslint-disable @typescript-eslint/no-explicit-any */
// TESTE CRÍTICO com o plano de PROD das 12:36 (OFFLINE): o diagnóstico novo identifica "Etiquetadora 15 em T3 exige material que não estará disponível"? Qual upstream religar, em que período, quanto produzir, WIP resultante.
import { abrir, estadoEm, versaoEm } from "../auditoria-buffer/comum";
import { planejarComFluxo } from "@/features/escala/fluxo";
import { simularCadeia } from "@/features/escala/fluxo/cadeia";
import { pedirReposicao } from "@/features/escala/fluxo/cadeiaReparo";
import { montarEstado, prepararFluxo } from "@/features/escala/fluxo/estado";
import { gerarEscala } from "@/features/escala/gerarEscala";

const A = abrir();
const { nome, slots, ix } = A;
const vig = versaoEm("2026-10-30T12:36:08-03:00");
const E = estadoEm(A, Date.parse("2026-10-30T12:36:08-03:00"), vig, { mesmoPeriodo: false, ponte: true });
const lb = (p: string, e: string) => `${nome(e)} ${nome(p).replace('Conector 3/4" - Maquina Automatica', "Con3/4 Auto").replace('Conector 3/4"', "Con3/4")}`;
const op = { ...E.opcoes, cadeia: { diagnostico: true, allowed: true, saida: true } };
const B = planejarComFluxo(E.ent, E.dados, E.opcoes); // plano de PROD (flags desligadas)
const ctx = prepararFluxo(E.ent, E.dados, op);
const planoB = B.resultado.alocacoes;
console.log("## PLANO DAS 12:36 (pessoa → posto, só cadeia Conector 3/4)");
for (let s = E.ap; s < slots.length; s++) {
  const l = planoB.filter((a) => ix(a) === s && a.maquinaId && /3\/4/.test(nome(a.produtoId)));
  console.log(`${slots[s].periodoId}: ` + (l.map((a) => `${nome(a.funcionarioId).split(" ")[0]}→${nome(a.maquinaId)}(${nome(a.etapaId)})`).join(", ") || "—"));
}
const sim = simularCadeia(ctx, planoB);
console.log("\n## DIAGNÓSTICO (camada 1) — violações do Conector 3/4");
sim.violacoes.filter((v) => /3\/4/.test(nome(v.produtoId))).forEach((v) => console.log(`- ${lb(v.produtoId, v.etapaId)} ${v.proximoDia ? "PRÓX.DIA" : slots[v.slot].periodoId}: quer ${Math.round(v.desejada)}, material ${Math.round(v.disponivel)} (déficit ${Math.round(v.deficit)}); ligar upstream até ${v.ultimoSeguro >= slots.length ? "PRÓX.DIA" : slots[v.ultimoSeguro]?.periodoId}`));
console.log("\n## WIP por ligação (início do período) no plano B");
Object.entries(sim.wip).forEach(([e, w]) => { const ar = ctx.grafo.arestas[e]; if (/3\/4/.test(nome(ar.produtoId))) console.log(`${lb(ar.produtoId, ar.etapaOrigemId)} → ${nome(ar.etapaSeguinteId)}: ${w.map((x) => Math.round(x)).join(" / ")}`); });
for (const v of [0, 1]) {
  const rep = pedirReposicao(ctx, planoB, v);
  const rem = { ...B.diagnostico.estado.remPorPool };
  const dem = (ctx as any); void dem;
  const remAug: Record<string, number> = { ...montarEstado(ctx).remPorPool }; // rem do Allowed novo + a reposição pedida (como em planejar.ts)
  Object.entries(rep.remExtra).forEach(([k, q]) => (remAug[k] = (remAug[k] ?? 0) + q));
  const res = gerarEscala({ ...E.ent, remPorPool: remAug, reposicaoMinima: rep.minimos });
  const s2 = simularCadeia(ctx, res.alocacoes);
  console.log(`\n## REPARO variante ${v}: reposição pedida (postos mínimos por período; +${rep.postosExtra} posto-período)`);
  Object.entries(rep.minimos).sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([s, m]) => Object.entries(m).forEach(([k, n]) => { const [p, e] = k.split("|"); if (/3\/4/.test(nome(p))) console.log(`- ${slots[Number(s)].periodoId}: ${lb(p, e)} ≥ ${n} posto(s) (≈ ${Math.round(rep.remExtra[k] ?? 0)} pç totais pedidas ao pool)`); }));
  console.log("inevitáveis:", rep.inevitaveis.filter((x) => /3\/4/.test(nome(x.produtoId))).map((x) => `${lb(x.produtoId, x.etapaId)} ${slots[x.slot]?.periodoId ?? "PRÓX.DIA"} ${Math.round(x.deficit)}`).join("; ") || "—");
  console.log(`déficit de material: ${Math.round(sim.deficit)} → ${Math.round(s2.deficit)}`);
  Object.entries(s2.wip).forEach(([e, w]) => { const ar = ctx.grafo.arestas[e]; if (/3\/4/.test(nome(ar.produtoId))) console.log(`  WIP ${lb(ar.produtoId, ar.etapaOrigemId)}→${nome(ar.etapaSeguinteId)}: ${w.map((x) => Math.round(x)).join(" / ")}`); });
}
