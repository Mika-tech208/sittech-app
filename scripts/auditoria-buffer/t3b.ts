/* eslint-disable @typescript-eslint/no-explicit-any */
import { carregarTudo, nomeador, montarEstadoAting } from "./lib";
import { planejarComFluxo } from "@/features/escala/fluxo";
import { prepararFluxo, montarEstado } from "@/features/escala/fluxo/estado";
import { avaliarComCtx, capsDoPlano, rodar } from "@/features/escala/fluxo/avaliar";

const { d } = carregarTudo("2999-01-01T00:00:00Z");
const nome = nomeador(d.nomes);
const PC = "27c229d7-f192-41eb-aad1-0c69ece53eba", PA = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee";
const N: Record<string, string> = { Ros: `${PC}|ca90456c-9077-40f4-a058-bd0f467e87ec`, Paf: `${PC}|78aaa207-b8cc-412a-8a8b-d17bd95a1930`, Eti: `${PC}|34371af3-2608-42cc-9ded-1f7815a635a8`, Emb: `${PC}|b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4`, M8: `${PA}|1b72bf46-5d13-43c5-89b4-6169436085b7` };
const AGORA = Date.parse(process.env.AGORA ?? "2026-10-30T17:30:00Z");
const plano = d.versaoAntes!.linhas;
const modos: Record<string, Record<string, boolean>> = {
  "P0 conservador (PROD)": {},
  "A cont; B,C lote": { [N.Eti]: true },
  "A,B cont; C lote": { [N.Eti]: true, [N.Paf]: true, [N.M8]: true },
  "A,B,C cont": { [N.Eti]: true, [N.Paf]: true, [N.M8]: true, [N.Ros]: true },
  "A,C cont; B lote": { [N.Eti]: true, [N.Ros]: true },
};
for (const [lbl, map] of Object.entries(modos)) {
  const e = montarEstadoAting(d, AGORA, plano, 100 + 28, { fluxoMesmoPeriodo: false, fluxoMesmoPeriodoPorAresta: map }, true);
  const ctx = e.ctx;
  const st = montarEstado(ctx);
  console.log("\n####", lbl, "| aPartirDe", e.aPartirDe, "slots", ctx.entrada.slots.length);
  if (lbl.startsWith("P0")) { console.log("nos", Object.keys(ctx.grafo.nos).filter((k) => k.startsWith(PC) || k.startsWith(PA)).map((k) => nome(k.split("|")[0]) + ":" + nome(k.split("|")[1])).join(" ; ")); console.log("fator", JSON.stringify(Object.fromEntries(Object.entries(N).map(([k, v]) => [k, ctx.fator[v]])))); }
  const nomeEd = (id: string) => Object.entries(N).find(([, v]) => v === id)?.[0] ?? id.slice(0, 13);
  const lo = ctx.iniAPartirDe.lo.W0, hi = ctx.iniAPartirDe.hi.W0;
  console.log(" W0 inicio T2 (lo/hi):", Object.keys(lo).filter((k) => k.startsWith(PC) || k.startsWith(PA)).map((k) => `${nomeEd(k)}=${Math.round(lo[k])}/${Math.round(hi[k])}`).join("  "));
  const caps = capsDoPlano(ctx, plano.filter((a) => (ctx.idxSlot.get(`${a.data}|${a.periodoId}`) ?? -1) >= ctx.aPartirDe));
  for (const cen of ["lo", "hi"] as const) {
    const gi = ctx.grafo.grupos.findIndex((g) => g.nos.includes(N.Paf));
    const r = rodar(ctx, gi, caps, cen, st.remPorPool, true);
    const T = ctx.entrada.slots.length;
    for (let t = 28; t < T; t++) {
      const i = t - ctx.aPartirDe;
      console.log(`  ${cen} T${t - 26}: x ` + ["Ros", "Paf", "M8", "Eti", "Emb"].map((k) => `${k}=${Math.round(r.x[N[k]]?.[i] ?? 0)}(cap ${Math.round(caps[N[k]]?.base[t] ?? 0)}+${Math.round(caps[N[k]]?.adic[t] ?? 0)})`).join(" ") + " | W fim: " + Object.keys(r.traj).filter((k) => k.startsWith(PC) || k.startsWith(PA)).map((k) => `${nomeEd(k)}=${Math.round(r.traj[k][i])}`).join(" "));
    }
    console.log(`  ${cen} final Emb B=${Math.round(r.B[N.Emb])} (Q ${ctx.grafo.nos[N.Emb].quantidade})`);
  }
}
