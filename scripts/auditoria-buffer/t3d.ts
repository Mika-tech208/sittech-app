/* eslint-disable @typescript-eslint/no-explicit-any */
import { carregarTudo, nomeador, montarEstadoAting } from "./lib";
import { montarEstado } from "@/features/escala/fluxo/estado";
import { avaliarComCtx } from "@/features/escala/fluxo/avaliar";
import { chavePool } from "@/features/escala/types";

const { d: d0 } = carregarTudo("2999-01-01T00:00:00Z");
const nome = nomeador(d0.nomes);
const PC = "27c229d7-f192-41eb-aad1-0c69ece53eba", PA = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee";
const N: Record<string, string> = { Ros: `${PC}|ca90456c-9077-40f4-a058-bd0f467e87ec`, Paf: `${PC}|78aaa207-b8cc-412a-8a8b-d17bd95a1930`, Eti: `${PC}|34371af3-2608-42cc-9ded-1f7815a635a8`, Emb: `${PC}|b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4`, M8: `${PA}|1b72bf46-5d13-43c5-89b4-6169436085b7` };
const AGORA = Date.parse("2026-10-30T17:30:00Z");
const M8PILHA = Number(process.env.M8PILHA ?? 0);
const ROSCONT = process.env.ROSCONT === "1";
const plano = d0.versaoAntes!.linhas;
const T14_20 = Date.parse("2026-10-30T17:20:00Z");
const ext = (p: string, a: string, b: string, s: number) => ({ produtoId: p, etapaOrigemId: a, etapaSeguinteId: b, saldo: s, contadoEmMs: T14_20, informadoPor: "audit", observacao: "fim de T1 (derivado: contagem 12:00 + apontado T1; Paf>Eti sem rateio do ramo Auto)" });
const dx: any = { ...d0, cfg: { ...d0.cfg, contagensFisicas: [...d0.cfg.contagensFisicas,
  ext(PC, "78aaa207-b8cc-412a-8a8b-d17bd95a1930", "34371af3-2608-42cc-9ded-1f7815a635a8", Number(process.env.PAF ?? 3350)),
  ext(PC, "34371af3-2608-42cc-9ded-1f7815a635a8", "b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4", Number(process.env.EMB ?? 850)),
  ext(PC, "ca90456c-9077-40f4-a058-bd0f467e87ec", "78aaa207-b8cc-412a-8a8b-d17bd95a1930", 6000),
  ext(PA, "1b72bf46-5d13-43c5-89b4-6169436085b7", "1863b452-77f3-4d5c-9c49-a6d28ae77131", M8PILHA),
] } };
const modo = process.env.LOTE_TUDO === "1" ? {} : { [N.Eti]: true, [N.Paf]: false, [N.M8]: false, [N.Ros]: ROSCONT };
const e = montarEstadoAting(dx, AGORA, plano, 100 + 29, { fluxoMesmoPeriodo: false, fluxoMesmoPeriodoPorAresta: modo }, true);
const ctx = e.ctx; const st = montarEstado(ctx);
const I = ctx.iniAPartirDe;
const ed = (id: string) => Object.entries(N).find(([, v]) => v === id)?.[0] ?? (id.startsWith("238ca607") ? "CxEtiq>Mont" : id.slice(0, 12));
console.log("MODO Ros>Paf", ROSCONT ? "continuo" : "lote", "| M8 pilha", M8PILHA);
console.log("W0 inicio T3 lo/hi:", Object.keys(I.lo.W0).filter((k) => k.startsWith(PC) || k.startsWith(PA)).map((k) => `${ed(k)}=${Math.round(I.lo.W0[k])}/${Math.round(I.hi.W0[k])}`).join(" "));
console.log("pares:", st.pares.filter((p: any) => p.produtoId === PC || p.produtoId === PA).map((p: any) => `${nome(p.etapaOrigemId)}>${nome(p.etapaSeguinteId)}=${p.wip.lo}-${p.wip.hi}`).join(" ; "));
const pools = ctx.poolsPorChave;
const pool = (k: string) => pools.get(k)!;
console.log("metas t3 x fator:", Object.entries(N).map(([k, v]) => `${k}=${Math.round((pool(v).metas["t3"] ?? 0) * (ctx.fator[v] ?? 1))} (meta ${pool(v).metas["t3"]}, f ${(ctx.fator[v] ?? 1).toFixed(3)}, maq ${pool(v).maquinasIds.map((m: string) => nome(m)).join("/")}, op ${pool(v).operacaoId.slice(0, 6)}, vu ${pool(v).valorUnitario})`).join("\n  "));
console.log("metas m1 (terça) x fator:", Object.entries(N).map(([k, v]) => `${k}=${Math.round((pool(v).metas["m1"] ?? 0) * (ctx.fator[v] ?? 1))}`).join(" "));
// operacoes por pool para revezamento
const opsPool = [...pools.entries()].map(([k, p]) => `${nome(p.produtoId)}|${nome(p.etapaId)} op=${p.operacaoId.slice(0, 8)}`);
console.log("OPS", opsPool.join("\n  "));
// exposicao da tarde por pessoa
const aptT1 = d0.apontamentos.filter((a) => a.data === "2026-10-30" && a.periodoId === "t1" && a.funcionarioId);
const opId = (p: string | null, et: string | null) => (p && et && pools.get(chavePool(p, et))?.operacaoId?.slice(0, 8)) || "?";
const exp: Record<string, string[]> = {};
plano.filter((l) => l.data === "2026-10-30" && (l.periodoId === "t1" || l.periodoId === "t2") && l.maquinaId).forEach((l) => (exp[nome(l.funcionarioId)] ??= []).push(`${l.periodoId}:plan:${nome(l.produtoId)}/${nome(l.etapaId)}[${opId(l.produtoId, l.etapaId)}]`));
aptT1.forEach((a) => (exp[nome(a.funcionarioId)] ??= []).push(`t1:apont:${nome(a.produtoId)}/${nome(a.etapaId)}[${a.operacaoId?.slice(0, 8)}]`));
console.log("EXPOSICAO tarde:"); Object.entries(exp).sort().forEach(([k, v]) => console.log("  ", k.padEnd(30), v.join(" | ")));
console.log("equipe", ctx.entrada.funcionarios.length, "ausencias", JSON.stringify(ctx.entrada.ausencias.map((a: any) => [nome(a.funcionarioId), a.data, a.inicioMin, a.fimMin])));
console.log("INDISP", JSON.stringify(ctx.entrada.indisponibilidades.map((x: any) => [nome(x.maquinaId), new Date(x.desdeMs - 3*3600e3).toISOString().slice(5,16), x.liberadaEmMs === null ? "aberta" : new Date(x.liberadaEmMs - 3*3600e3).toISOString().slice(5,16)])));
console.log("maq indisp", JSON.stringify(ctx.entrada.indisponibilidades.map((x: any) => nome(x.maquinaId))), "inativas", (ctx.entrada.maquinasInativas ?? []).map(nome).join(","), "indispPrev", ctx.entrada.maquinasIndisponiveisPrevisao.map(nome).join(","));

// ---------- candidatos ----------
const T3 = plano.filter((l) => l.data === "2026-10-30" && l.periodoId === "t3");
const resto = plano.filter((l) => !(l.data === "2026-10-30" && l.periodoId === "t3"));
const mid = (nm: string) => Object.entries(d0.nomes).find(([, v]) => v.trim() === nm)?.[0] as string;
const fid = (nm: string) => T3.find((l) => nome(l.funcionarioId) === nm)!.funcionarioId;
const linha = (pessoa: string, key: string, maqNome: string, extra: any = {}) => {
  const p = pool(N[key]);
  return { data: "2026-10-30", periodoId: "t3", funcionarioId: fid(pessoa), maquinaId: mid(maqNome), produtoId: p.produtoId, etapaId: p.etapaId, operacaoId: p.operacaoId, pecas: Math.round(p.metas["t3"] ?? 0), motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, origem: "auto" as const, ...extra };
};
const lim = { ...st.remPorPool };
Object.values(N).forEach((k) => { lim[k] = 1e9; });
function avalia(titulo: string, trocas: { remover: string[]; add: any[] }) {
  const novo = [...resto, ...T3.filter((l) => !trocas.remover.includes(nome(l.funcionarioId))), ...trocas.add];
  const av = avaliarComCtx(ctx, novo, { contribuicoes: false, trajetoria: true, limites: lim });
  return { titulo, av, novo, ...trocas };
}
const base = avalia("MANTER T3 atual", { remover: [], add: [] });
const vu = (p: string, et: string) => pool(chavePool(p, et))?.valorUnitario ?? 0;
function resumo(r: ReturnType<typeof avalia>) {
  const dl: string[] = []; let dR = 0, dRhi = 0;
  r.av.produtos.forEach((p, i) => {
    const b = base.av.produtos[i];
    const dlo = p.finalEntregue.lo - b.finalEntregue.lo, dhi = p.finalEntregue.hi - b.finalEntregue.hi;
    if (Math.abs(dlo) > 0.5 || Math.abs(dhi) > 0.5) dl.push(`${nome(p.produtoId)}|${nome(p.etapaFinalId)} ${Math.round(dlo)}/${Math.round(dhi)}`);
    dR += dlo * vu(p.produtoId, p.etapaFinalId); dRhi += dhi * vu(p.produtoId, p.etapaFinalId);
  });
  const w = (cen: "lo" | "hi") => Object.fromEntries(r.av.trajetoria.filter((t) => t.chave.startsWith(PC) || t.chave.startsWith(PA) || t.chave.startsWith("238ca607")).map((t) => [ed(t.chave), Math.round(t.porSlot[t.porSlot.length - 1][cen])]));
  return { dlo_hi_pecas_finais: dl.join("; ") || "0", dR_lo: Math.round(dR), dR_hi: Math.round(dRhi), Wfim_lo: w("lo"), Wfim_hi: w("hi"), WIPfinal: Math.round(r.av.totais.wipFinalLo) };
}
console.log("\nBASE:", JSON.stringify(resumo(base)));
console.log("BASE traj lo (slots 2,3):", base.av.trajetoria.filter((t) => t.chave.startsWith(PC) || t.chave.startsWith(PA)).map((t) => ed(t.chave) + ":" + t.porSlot.map((s) => Math.round(s.lo)).join(",")).join(" "));
// valor marginal HOJE de cada linha T3 atual (remoção unitária)
console.log("\nVALOR MARGINAL HOJE de cada pessoa do T3 atual (remover a linha, pessoa fica sem posto):");
for (const l of T3) {
  const r = avalia("x", { remover: [nome(l.funcionarioId)], add: [] });
  console.log("  ", nome(l.funcionarioId).padEnd(28), nome(l.maquinaId).padEnd(24), nome(l.produtoId) + "|" + nome(l.etapaId), JSON.stringify(resumo(r).dlo_hi_pecas_finais), "R$lo", resumo(r).dR_lo, "R$hi", resumo(r).dR_hi);
}
const out: any = { base: resumo(base) };
const cfgs: [string, { remover: string[]; add: any[] }][] = [
  ["+1 Paf9 (Luana: sai Ros6 adic)", { remover: ["Luana"], add: [linha("Luana", "Paf", "Parafusadeira 9")] }],
  ["+2 Paf 9,10 (Luana + Aly[Pino 220])", { remover: ["Luana", "Aly"], add: [linha("Luana", "Paf", "Parafusadeira 9"), linha("Aly", "Paf", "Parafusadeira 10")] }],
  ["+2 Paf 9,10 (Luana + Sara[Et15])", { remover: ["Luana", "Sara Perez Valera"], add: [linha("Luana", "Paf", "Parafusadeira 9"), linha("Sara Perez Valera", "Paf", "Parafusadeira 10")] }],
  ["+2 Paf 9,10 (Sara[Et15] + Tania[Emb17])", { remover: ["Sara Perez Valera", "Tania"], add: [linha("Sara Perez Valera", "Paf", "Parafusadeira 9"), linha("Tania", "Paf", "Parafusadeira 10")] }],
  ["+M8 (Luana)", { remover: ["Luana"], add: [linha("Luana", "M8", "Maquina Automatica 8")] }],
  ["+M8 (Sara[Et15])", { remover: ["Sara Perez Valera"], add: [linha("Sara Perez Valera", "M8", "Maquina Automatica 8")] }],
  ["M8 + Paf9 (Luana->Paf9, Aly->M8)", { remover: ["Luana", "Aly"], add: [linha("Luana", "Paf", "Parafusadeira 9"), linha("Aly", "M8", "Maquina Automatica 8")] }],
  ["2 Paf + M8 (Luana, Sara, Tania)", { remover: ["Luana", "Sara Perez Valera", "Tania"], add: [linha("Luana", "Paf", "Parafusadeira 9"), linha("Sara Perez Valera", "Paf", "Parafusadeira 10"), linha("Tania", "M8", "Maquina Automatica 8")] }],
  ["2 Paf + M8 (Luana, Aly, Sara)", { remover: ["Luana", "Aly", "Sara Perez Valera"], add: [linha("Luana", "Paf", "Parafusadeira 9"), linha("Aly", "Paf", "Parafusadeira 10"), linha("Sara Perez Valera", "M8", "Maquina Automatica 8")] }],
  ["+2 Paf 9,10 (Samantha[Et16 CA, valor 0] + Luana[Ros6 adic, valor 0])", { remover: ["Samantha Gonzalez Leon", "Luana"], add: [linha("Samantha Gonzalez Leon", "Paf", "Parafusadeira 9"), linha("Luana", "Paf", "Parafusadeira 10")] }],
  ["+1 Paf (Samantha) , Luana mantem Ros6", { remover: ["Samantha Gonzalez Leon"], add: [linha("Samantha Gonzalez Leon", "Paf", "Parafusadeira 9")] }],
  ["+2 Paf (Samantha, Tania[Emb17 340pç])", { remover: ["Samantha Gonzalez Leon", "Tania"], add: [linha("Samantha Gonzalez Leon", "Paf", "Parafusadeira 9"), linha("Tania", "Paf", "Parafusadeira 10")] }],
  ["3 pessoas: Luana->Paf10, Tania->Paf9, Sara->M8 (Et15/Emb17 vazios)", { remover: ["Luana", "Tania", "Sara Perez Valera"], add: [linha("Luana", "Paf", "Parafusadeira 10"), linha("Tania", "Paf", "Parafusadeira 9"), linha("Sara Perez Valera", "M8", "Maquina Automatica 8")] }],
  ["2 pessoas: Luana->Paf10, Tania->Paf9 (Sara fica Et15)", { remover: ["Luana", "Tania"], add: [linha("Luana", "Paf", "Parafusadeira 10"), linha("Tania", "Paf", "Parafusadeira 9")] }],
  ["2 pessoas: Luana->Paf10, Tania->M8 (Sara fica Et15)", { remover: ["Luana", "Tania"], add: [linha("Luana", "Paf", "Parafusadeira 10"), linha("Tania", "M8", "Maquina Automatica 8")] }],
  ["LOTE: Luana->Paf10 + Sara->M8", { remover: ["Luana", "Sara Perez Valera"], add: [linha("Luana", "Paf", "Parafusadeira 10"), linha("Sara Perez Valera", "M8", "Maquina Automatica 8")] }],
  ["LOTE: Luana->Paf10 + Sara->M8 + Samantha->Paf9", { remover: ["Luana", "Sara Perez Valera", "Samantha Gonzalez Leon"], add: [linha("Luana", "Paf", "Parafusadeira 10"), linha("Sara Perez Valera", "M8", "Maquina Automatica 8"), linha("Samantha Gonzalez Leon", "Paf", "Parafusadeira 9")] }],
  ["LOTE: Luana->Paf10 + Sara->Paf9 (se Sara puder Parafusar)", { remover: ["Luana", "Sara Perez Valera"], add: [linha("Luana", "Paf", "Parafusadeira 10"), linha("Sara Perez Valera", "Paf", "Parafusadeira 9")] }],
  ["LOTE: Luana->Paf10 + Sara->M8 + Aly->Paf9", { remover: ["Luana", "Sara Perez Valera", "Aly"], add: [linha("Luana", "Paf", "Parafusadeira 10"), linha("Sara Perez Valera", "M8", "Maquina Automatica 8"), linha("Aly", "Paf", "Parafusadeira 9")] }],
  ["LOTE: Luana->Paf10 + Sara->M8 + Tania->Paf9 (tira Emb17)", { remover: ["Luana", "Sara Perez Valera", "Tania"], add: [linha("Luana", "Paf", "Parafusadeira 10"), linha("Sara Perez Valera", "M8", "Maquina Automatica 8"), linha("Tania", "Paf", "Parafusadeira 9")] }],
  ["SEM Ros6 adic (Luana sem posto)", { remover: ["Luana"], add: [] }],
  ["Luana mantem Ros6 + 2 Paf (Sara,Tania)", { remover: ["Sara Perez Valera", "Tania"], add: [linha("Sara Perez Valera", "Paf", "Parafusadeira 9"), linha("Tania", "Paf", "Parafusadeira 10")] }],
];
console.log("\nCONFIGURACOES T3 (efeito HOJE; Wfim = estoque no fim de T3 => base da terça M1):");
for (const [t, c] of cfgs) {
  const r = avalia(t, c); const s = resumo(r); out[t] = s;
  const x = (k: string) => Math.round(r.av.trajetoria.length ? 0 : 0);
  const wv = (k: string) => (s.Wfim_lo as any)[k] ?? 0;
  const etiM1 = Math.min(Math.round(pool(N.Eti).metas["m1"] ?? 0), wv("Paf") + wv("M8")); const embM1 = Math.min(Math.round(pool(N.Emb).metas["m1"] ?? 0), wv("Eti"));
  console.log(" *", t, "\n     dFinalHoje(lo/hi):", s.dlo_hi_pecas_finais, "| dR$ lo", s.dR_lo, "hi", s.dR_hi, "| Wfim lo", JSON.stringify(s.Wfim_lo), "hi", JSON.stringify(s.Wfim_hi));
  console.log("     TERCA (lote): M1 Emb final", embM1, "pç (R$", Math.round(embM1 * vu(PC, "b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4")), ") | M1 Etiq produz", etiM1, "pç => Emb final em M2 (R$", Math.round(etiM1 * vu(PC, "b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4")), ")");
}
require("node:fs").writeFileSync(`${process.env.OUT ?? "/tmp"}/t3d-${ROSCONT ? "rosC" : "rosL"}-m8${M8PILHA}.json`, JSON.stringify(out, null, 1));
