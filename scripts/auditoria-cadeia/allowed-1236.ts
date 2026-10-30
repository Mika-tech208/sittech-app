/* eslint-disable @typescript-eslint/no-explicit-any */
// Allowed ANTIGO × NOVO no estado de 30/10 12:36:08 (OFFLINE). Mostra need / allowed / rem / consumoDownstream / pipelineHi por pool do Conector 3/4.
import { abrir, estadoEm, versaoEm } from "../auditoria-buffer/comum";
import { calcularDemanda } from "@/features/escala/fluxo/estado";
import { prepararFluxo } from "@/features/escala/fluxo/estado";

const A = abrir();
const { nome } = A;
const AGORA = Date.parse("2026-10-30T12:36:08-03:00");
const vigente = versaoEm("2026-10-30T12:36:08-03:00");
const E = estadoEm(A, AGORA, vigente, { mesmoPeriodo: false, ponte: true });
const linhas: any[] = [];
for (const [rot, cad] of [["ANTIGO", undefined], ["NOVO (allowed)", { allowed: true, saida: true }]] as const) {
  const ctx = prepararFluxo(E.ent, E.dados, { ...E.opcoes, ...(cad ? { cadeia: cad } : {}) });
  const dem = calcularDemanda(ctx);
  Object.entries(dem).forEach(([n, d]) => {
    const no = ctx.grafo.nos[n];
    const lbl = `${nome(no.etapaId)} | ${nome(no.produtoId).replace('Conector 3/4" - Maquina Automatica', "Con3/4 Auto").replace('Conector 3/4"', "Con3/4")}`;
    if (!/3\/4/.test(lbl)) return;
    const maq = [...new Set(no.membros.flatMap((m) => (ctx.poolsPorChave.get(m) as any).maquinasIds))].map((m: any) => nome(m)).join(",");
    linhas.push({ regra: rot, pool: lbl, maquinas: maq, need: Math.round(d.need), consumoDownstream: d.consumoDownstream === null ? null : Math.round(d.consumoDownstream), teto: d.teto === null ? null : Math.round(d.teto), pipelineHi: Math.round(d.pipelineHi), allowed: d.allowed === null ? null : Math.round(d.allowed), rem: Math.round(d.rem) });
  });
}
console.table(linhas);
