/* eslint-disable @typescript-eslint/no-explicit-any */
import { carregarTudo, versoes, nomeador, montarEstadoAting } from "./lib";
import { planejarComFluxo } from "@/features/escala/fluxo";
import { prepararFluxo, montarEstado, calcularDemanda } from "@/features/escala/fluxo/estado";
import { capsDoPlano, rodar } from "@/features/escala/fluxo/avaliar";
import { copiarCaps } from "@/features/escala/fluxo/simulador";
import { chavePool } from "@/features/escala/types";

const { d } = carregarTudo();
const V = versoes();
const PC = "27c229d7-f192-41eb-aad1-0c69ece53eba", PA = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee";
const NODES: Record<string, string> = { Ros: `${PC}|ca90456c-9077-40f4-a058-bd0f467e87ec`, Paf: `${PC}|78aaa207-b8cc-412a-8a8b-d17bd95a1930`, M8: `${PA}|1b72bf46-5d13-43c5-89b4-6169436085b7` };
const e = montarEstadoAting(d, Date.parse("2026-10-30T15:36:30Z"), V["08:59"].linhas, 127, { fluxoMesmoPeriodo: false }, true);
const r = planejarComFluxo(e.entrada, e.dados, e.opcoes);
const ctx = prepararFluxo(e.entrada, e.dados, e.opcoes);
const st = montarEstado(ctx);
const dem = calcularDemanda(ctx);
const fut = r.resultado.alocacoes.filter((a) => (ctx.idxSlot.get(`${a.data}|${a.periodoId}`) ?? -1) >= 27);
const caps = capsDoPlano(ctx, fut);
const gi = ctx.grafo.grupos.findIndex((g) => g.nos.includes(ctx.grafo.noDoPool[NODES.Paf]));
const sink = ctx.grafo.grupos[gi].sink;
const giA = ctx.grafo.grupos.findIndex((g) => g.nos.includes(ctx.grafo.noDoPool[NODES.M8]));
console.log("grupos Conv/Auto são o mesmo grupo?", gi === giA, "| sink", ctx.grafo.nos[sink].membros.map((m) => m.slice(0, 8)));
const limitesEngine = st.remPorPool;
const limitesLivre = { ...limitesEngine, ...Object.fromEntries(Object.entries(NODES).map(([k, v]) => [v, dem[ctx.grafo.noDoPool[v]].need])) };
const muDe = (nodeKey: string, t: number) => { const k = NODES[nodeKey]; const p = ctx.poolsPorChave.get(k)!; return (p.metas[ctx.entrada.slots[t].periodoId] ?? 0) * (ctx.fator[k] ?? 1); };
const base = (lim: any) => rodar(ctx, gi, caps, "lo", lim, true);
const b0 = { eng: base(limitesEngine), livre: base(limitesLivre) };
const pafEtiKey = Object.keys(b0.eng.W).find((k) => k.startsWith(PC) && k.includes("78aaa207"))!;
console.log("BASE (plano reproduzido): final(lo) engine-lim", Math.round(b0.eng.B[sink]), "| W(Paf>Eti) fim T3", Math.round(b0.eng.W[pafEtiKey]));
console.log("posto adicional (1) | ganho em peças finais até sexta T3 [limite do motor rem=0] | [limite levantado] | Δ estoque Paf>Eti ao fim de T3 [limite levantado] | Δ peças Etiquetadas na sexta [limite levantado]");
const etiNode = ctx.grafo.noDoPool[`${PC}|34371af3-2608-42cc-9ded-1f7815a635a8`];
for (const k of ["Paf", "M8", "Ros"]) {
  for (let t = 27; t < 30; t++) {
    const n = ctx.grafo.noDoPool[NODES[k]];
    const mu = muDe(k, t);
    const out: any = {};
    for (const [lbl, lim] of [["eng", limitesEngine], ["livre", limitesLivre]] as const) {
      const c2 = copiarCaps(caps); c2[n].base[t] += mu;
      const r2 = rodar(ctx, gi, c2, "lo", lim, true);
      out[lbl] = { dFinal: r2.B[sink] - b0[lbl].B[sink], dW: r2.W[pafEtiKey] - b0[lbl].W[pafEtiKey], dEti: r2.B[etiNode] - b0[lbl].B[etiNode] };
    }
    console.log(`+1 ${k} em ${ctx.entrada.slots[t].periodoId.toUpperCase()} (mu=${Math.round(mu)}): ${Math.round(out.eng.dFinal)} | ${Math.round(out.livre.dFinal)} | ${Math.round(out.livre.dW)} | ${Math.round(out.livre.dEti)}`);
  }
}
// Trajetória por período do plano reproduzido (para a tabela)
const tr: any = {};
Object.entries(b0.eng.traj).forEach(([k, v]) => { tr[k.slice(0, 8) + "…" + k.slice(-8)] = (v as number[]).map((x) => Math.round(x)); });
console.log("trajetoria W (plano reproduzido):", JSON.stringify(tr));
console.log("produção por nó e slot (plano reproduzido):");
Object.entries(b0.eng.x).forEach(([k, v]) => console.log("  ", ctx.grafo.nos[k].membros[0].slice(-8), (v as number[]).map((x) => Math.round(x)).join(",")));
