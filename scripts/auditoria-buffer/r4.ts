/* eslint-disable @typescript-eslint/no-explicit-any */
import { carregarTudo, versoes, nomeador, montarEstadoAting, slotsDa } from "./lib";
import { planejarComFluxo } from "@/features/escala/fluxo";
import { prepararFluxo, montarEstado, calcularDemanda } from "@/features/escala/fluxo/estado";
import { avaliarComCtx, capsDoPlano, rodar, selecionarFuturas } from "@/features/escala/fluxo/avaliar";
import { contagensDoPlano, tabelaMarginal, varrerContagens } from "@/features/escala/fluxo/otimizar";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { copiarCaps } from "@/features/escala/fluxo/simulador";
import type { AlocacaoEscala, EntradaEscala, SlotEscala } from "@/features/escala/types";
import { chavePool } from "@/features/escala/types";

const { d } = carregarTudo();
const nome = nomeador(d.nomes);
const V = versoes();
const PC = "27c229d7-f192-41eb-aad1-0c69ece53eba";
const AGORA = Date.parse(process.env.AGORA ?? "2026-10-30T15:36:30Z");
const iT1 = 27;
const NODES: Record<string, string> = { Ros: `${PC}|ca90456c-9077-40f4-a058-bd0f467e87ec`, Paf: `${PC}|78aaa207-b8cc-412a-8a8b-d17bd95a1930`, Eti: `${PC}|34371af3-2608-42cc-9ded-1f7815a635a8`, Emb: `${PC}|b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4`, M8: "a027ac97-ffd1-4834-8ed0-d3a94aac4aee|1b72bf46-5d13-43c5-89b4-6169436085b7" };
const ROT: Record<string, string> = Object.fromEntries(Object.entries(NODES).map(([k, v]) => [v, k]));

function estender(ent: EntradaEscala, nDias: number): EntradaEscala {
  const slots = [...ent.slots];
  const sexta = ent.slots.filter((s) => s.data === "2026-10-30");
  for (let k = 1; k <= nDias; k++) {
    const dMs = 86400000 * (k + 3); // Tue 03/11 = +4 dias, depois +5...
    sexta.forEach((s, i) => {
      const dt = new Date(Date.parse(s.data + "T12:00:00Z") + dMs).toISOString().slice(0, 10);
      slots.push({ ...s, data: dt, indice: slots.length, primeiroDoDia: i === 0, inicioMs: s.inicioMs + dMs, fimMs: s.fimMs + dMs });
    });
  }
  return { ...ent, slots };
}

interface Var { id: string; dias: number; capNaoLimita: string[]; }
function rodarVar(v: Var, mesmoPeriodo = false) {
  const e = montarEstadoAting(d, AGORA, V["08:59"].linhas, 100 + iT1, { fluxoMesmoPeriodo: mesmoPeriodo ? undefined : false }, true);
  const entrada = v.dias > 0 ? estender(e.entrada, v.dias) : e.entrada;
  const ctx = prepararFluxo(entrada, e.dados, e.opcoes);
  const st = montarEstado(ctx);
  const dem = calcularDemanda(ctx);
  const rem: Record<string, number> = { ...st.remPorPool };
  v.capNaoLimita.forEach((r) => { const k = NODES[r]; rem[k] = dem[ctx.grafo.noDoPool[k]].need; });
  // mini-planejador: P0 + varreduras de valor marginal
  const ent0: EntradaEscala = { ...entrada, remPorPool: rem };
  const p0 = gerarEscala(ent0);
  let cont = contagensDoPlano(ctx, p0.alocacoes);
  let plano = p0.alocacoes;
  for (let i = 0; i < 4; i++) {
    const vv = varrerContagens(ctx, cont, rem);
    cont = vv.contagens;
    const tab = tabelaMarginal(ctx, cont, rem);
    const r = gerarEscala({ ...ent0, ordemPostos: { valorMarginal: tab } });
    plano = r.alocacoes;
    if (vv.slotsAlterados === 0) break;
  }
  const av = avaliarComCtx(ctx, plano, { contribuicoes: false, trajetoria: true, limites: rem });
  // contagem de postos por nó/slot
  const idx = ctx.idxSlot;
  const cnt: Record<string, number[]> = {};
  Object.keys(NODES).forEach((k) => (cnt[k] = new Array(entrada.slots.length).fill(0)));
  const adic: Record<string, number[]> = {};
  Object.keys(NODES).forEach((k) => (adic[k] = new Array(entrada.slots.length).fill(0)));
  plano.filter((a) => a.maquinaId && a.produtoId && a.etapaId).forEach((a) => {
    const kk = Object.entries(NODES).find(([, val]) => val === chavePool(a.produtoId!, a.etapaId!));
    const t = idx.get(`${a.data}|${a.periodoId}`)!;
    if (kk && t >= iT1) { if ((a.pecasAdicional ?? 0) > 0 && !((a.pecas ?? 0) > 0)) adic[kk[0]][t]++; else cnt[kk[0]][t]++; }
  });
  const traj: Record<string, any[]> = {};
  av.trajetoria.forEach((tj) => { const par = d.nomes[tj.chave.split("|")[1]]; if (tj.chave.startsWith(PC) || tj.chave.startsWith("a027")) traj[`${nome(tj.chave.split("|")[0])}:${par}`] = tj.porSlot.map((p) => `${Math.round(p.lo)}`); });
  return { v, rem, dem: Object.fromEntries(Object.entries(NODES).map(([k, kk]) => [k, { need: Math.round(dem[ctx.grafo.noDoPool[kk]].need), allowed: dem[ctx.grafo.noDoPool[kk]].allowed === null ? null : Math.round(dem[ctx.grafo.noDoPool[kk]].allowed as number), rem: Math.round(rem[kk]) }])), cnt, adic, traj, falta: Math.round(av.totais.faltaFinalLo), final: Math.round(av.totais.finalEntregueLo), wipFinal: Math.round(av.totais.wipFinalLo), entrada };
}

const variantes: Var[] = [
  { id: "A  horizonte real (sexta T3), cap padrão", dias: 0, capNaoLimita: [] },
  { id: "B  horizonte real, cap de Parafusar levantado", dias: 0, capNaoLimita: ["Paf"] },
  { id: "C  horizonte real, cap de Parafusar e Rosquear levantados", dias: 0, capNaoLimita: ["Paf", "Ros"] },
  { id: "D  horizonte +1 dia útil (ter 03/11), cap padrão", dias: 1, capNaoLimita: [] },
  { id: "E  horizonte +2 dias úteis, cap padrão", dias: 2, capNaoLimita: [] },
  { id: "F  horizonte +3 dias úteis, cap padrão", dias: 3, capNaoLimita: [] },
];
const out: any[] = [];
for (const v of variantes) {
  const r = rodarVar(v);
  console.log("\n#####", v.id, "| falta", r.falta, "final", r.final, "wipFinal", r.wipFinal);
  console.log(" demanda/cap:", JSON.stringify(r.dem));
  const T = r.entrada.slots.length;
  for (let t = iT1; t < T; t++) {
    const s = r.entrada.slots[t];
    console.log(`  ${s.data.slice(5)} ${s.periodoId}: ` + Object.keys(NODES).map((k) => `${k}=${r.cnt[k][t]}${r.adic[k][t] ? "(+" + r.adic[k][t] + "adic)" : ""}`).join(" "));
  }
  Object.entries(r.traj).forEach(([k, a]) => console.log("  W fim de cada slot", k, a.slice(0, 9 + 0).join(",")));
  out.push({ id: v.id, falta: r.falta, final: r.final, rem: r.rem, dem: r.dem, cnt: r.cnt, adic: r.adic, traj: r.traj });
}
require("node:fs").writeFileSync("/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/auditoria-1030/D1/out/r4.json", JSON.stringify(out));
