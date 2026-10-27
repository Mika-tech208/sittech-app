// Extras por Rodada para os critérios F (Caixa Amarela), G (Conector), I (WIP ≤ teto) e J (explicabilidade).
import type { AlocacaoEscala } from "@/features/escala/types";
import type { Rodada } from "./rodar";

export const CXE = "238ca607-2111-4aff-9a19-a9ae6f20da7e|c765eb93-4597-405f-803a-91c7fab9ad8e"; // Caixa Amarela: Etiquetadora 16
export const CXM = "238ca607-2111-4aff-9a19-a9ae6f20da7e|f75cc037-a579-4e82-b457-3287dbb6f694"; // Caixa Amarela: Montagem (4 máquinas)
export const C_ETQ = "27c229d7-f192-41eb-aad1-0c69ece53eba|34371af3-2608-42cc-9ded-1f7815a635a8";
export const C_EMB = "27c229d7-f192-41eb-aad1-0c69ece53eba|b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4";
export const A_ROS = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee|1b72bf46-5d13-43c5-89b4-6169436085b7"; // Máquina 8
export const A_ETQ = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee|1863b452-77f3-4d5c-9c49-a6d28ae77131";
export const A_EMB = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee|fb96d08d-bd64-43d3-8694-40230c695c39";
export const M8 = "a118f430-f854-4e89-9e3c-ce6fcbbc52cf";
export const E15 = "49472af4-f5af-4427-992b-17a3f00a6c38";
export const E17 = "ba7adcbd-835c-45a3-92c6-f93fa87d3775";

type Linhas = AlocacaoEscala[];
const idxOf = (r: Rodada) => new Map(r.cen.entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));

/** produção planejada (peças, × f) e nº de postos por pool e por slot (somente slots ≥ aPartirDe). */
export function producaoPorPoolSlot(r: Rodada, linhas: Linhas) {
  const idx = idxOf(r);
  const f = r.cen.opcoes.fatorPorPool ?? {};
  const out: Record<string, Record<number, { pecas: number; postos: number }>> = {};
  linhas.forEach((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId) return;
    const i = idx.get(`${a.data}|${a.periodoId}`)!;
    if (i < r.cen.aPartirDe) return;
    const k = `${a.produtoId}|${a.etapaId}`;
    const o = ((out[k] ??= {})[i] ??= { pecas: 0, postos: 0 });
    o.pecas += (a.pecas ?? 0) * (f[k] ?? 1);
    o.postos += 1;
  });
  return out;
}

export function maquinasPorPool(r: Rodada, linhas: Linhas, chave: string) {
  const idx = idxOf(r);
  const m: Record<string, number> = {};
  linhas.forEach((a) => { if (a.maquinaId && `${a.produtoId}|${a.etapaId}` === chave && (idx.get(`${a.data}|${a.periodoId}`) ?? -1) >= r.cen.aPartirDe) m[a.maquinaId] = (m[a.maquinaId] ?? 0) + (a.pecas ?? 0); });
  return m;
}

const soma = (o: Record<number, { pecas: number; postos: number }> | undefined) => Object.values(o ?? {}).reduce((s, x) => s + x.pecas, 0);
const postos = (o: Record<number, { pecas: number; postos: number }> | undefined) => Object.values(o ?? {}).reduce((s, x) => s + x.postos, 0);

export interface ExtrasRodada {
  cx: { vigente: { E: number; M: number; postosE: number; postosM: number }; fluxo: { E: number; M: number; postosE: number; postosM: number }; base: { E: number; M: number; postosE: number; postosM: number }; porSlot: { slot: number; rot: string; vigE: number; vigM: number; fluE: number; fluM: number; baseE: number; baseM: number }[] };
  conector: { poolsFundidos: number; demandaComum: number[]; remLegadoEtq: number | null; remLegadoEmb: number | null; m8: { vigente: number; fluxo: number }; e15: { vigente: Record<string, number>; fluxo: Record<string, number> }; duplicidadeE15: number; linhasPorPool: { vigente: Record<string, number>; fluxo: Record<string, number> } };
  wipTeto: { chave: string; maxPipeHi: number; teto: number | null; ok: boolean | null; slotMax: number | null }[];
  pares: { chave: string; maxHi: number; slot: number }[];
  trajVigente: Record<string, [number, number, number][]>; // chave do par -> [slot, lo, hi]
  trajFluxo: Record<string, [number, number, number][]>;
  e15: { capacidadeFutura: number; defLegado: number; defFundido: number | null };
}

export function extrasDe(r: Rodada): ExtrasRodada {
  const vig = r.cen.planoVigente, flu = r.planoFluxoFuturo, bas = r.baseRegenerado;
  const pv = producaoPorPoolSlot(r, vig), pf = producaoPorPoolSlot(r, flu), pb = producaoPorPoolSlot(r, bas);
  const slots = r.cen.entrada.slots;
  const todosSlots = new Set<number>([...Object.keys(pv[CXE] ?? {}), ...Object.keys(pv[CXM] ?? {}), ...Object.keys(pf[CXE] ?? {}), ...Object.keys(pf[CXM] ?? {})].map(Number));
  const g = (p: typeof pv, k: string, i: number) => p[k]?.[i]?.pecas ?? 0;
  const porSlot = [...todosSlots].sort((a, b) => a - b).map((i) => ({ slot: i, rot: `${slots[i].data.slice(5)} ${slots[i].periodoId}`, vigE: Math.round(g(pv, CXE, i)), vigM: Math.round(g(pv, CXM, i)), fluE: Math.round(g(pf, CXE, i)), fluM: Math.round(g(pf, CXM, i)), baseE: Math.round(g(pb, CXE, i)), baseM: Math.round(g(pb, CXM, i)) }));
  const cxs = (p: typeof pv) => ({ E: Math.round(soma(p[CXE])), M: Math.round(soma(p[CXM])), postosE: postos(p[CXE]), postosM: postos(p[CXM]) });
  const st = r.res.diagnostico.estado;
  const dm = (k: string) => st.demanda.find((x) => x.chave === k);
  const e15v = { ...maquinasPorPool(r, vig, C_ETQ), ...Object.fromEntries(Object.entries(maquinasPorPool(r, vig, A_ETQ)).map(([m, v]) => [m + "(auto)", v])) };
  const e15f = { ...maquinasPorPool(r, flu, C_ETQ), ...Object.fromEntries(Object.entries(maquinasPorPool(r, flu, A_ETQ)).map(([m, v]) => [m + "(auto)", v])) };
  // duplicidade de E15 no mesmo slot em dois pools (conv + auto)
  const idx = idxOf(r);
  const porSlotMaq = new Map<string, Set<string>>();
  flu.forEach((a) => { if (a.maquinaId === E15 || a.maquinaId === E17) { const k = `${idx.get(`${a.data}|${a.periodoId}`)}|${a.maquinaId}`; (porSlotMaq.get(k) ?? porSlotMaq.set(k, new Set()).get(k)!).add(`${a.produtoId}|${a.etapaId}`); } });
  const dup = [...porSlotMaq.values()].filter((s) => s.size > 1).length;
  // WIP ≤ teto derivado: Pipe_k(t) = Σ_{j≥k} W_j(t) por produto
  const trajPorChave = new Map(r.avFluxo.trajetoria.map((t) => [t.chave, t.porSlot]));
  const wipTeto: ExtrasRodada["wipTeto"] = [];
  const pares: ExtrasRodada["pares"] = [];
  r.avFluxo.trajetoria.forEach((t) => { let m = 0, s = -1; t.porSlot.forEach((x) => { if (x.hi > m) { m = x.hi; s = x.slot; } }); pares.push({ chave: t.chave, maxHi: Math.round(m), slot: s }); });
  const porProduto = new Map<string, { chave: string; ordem: number }[]>();
  r.cen.entrada.pools.forEach((p) => (porProduto.get(p.produtoId) ?? porProduto.set(p.produtoId, []).get(p.produtoId)!).push({ chave: `${p.produtoId}|${p.etapaId}`, ordem: p.ordemEtapa }));
  porProduto.forEach((lst) => {
    lst.sort((a, b) => a.ordem - b.ordem);
    lst.forEach((k, i) => {
      const traj = trajPorChave.get(k.chave);
      if (!traj) return; // etapa final não tem par de saída
      const d = dm(k.chave);
      const teto = d && d.consumoDownstream !== null && d.tetoPeriodo !== null && d.consumoDownstream !== undefined ? d.consumoDownstream + d.tetoPeriodo : null;
      const seguintes = lst.slice(i).map((x) => trajPorChave.get(x.chave)).filter(Boolean) as { slot: number; lo: number; hi: number }[][];
      let m = 0, ms: number | null = null;
      traj.forEach((x, j) => { const pipe = seguintes.reduce((s, tr) => s + (tr[j]?.hi ?? 0), 0); if (pipe > m) { m = pipe; ms = x.slot; } });
      const pipe0 = d ? d.pipeline.hi : 0;
      wipTeto.push({ chave: k.chave, maxPipeHi: Math.round(m), teto: teto === null ? null : Math.round(teto), ok: teto === null ? null : m <= Math.max(teto, pipe0) + 1e-6, slotMax: ms });
    });
  });
  return {
    cx: { vigente: cxs(pv), fluxo: cxs(pf), base: cxs(pb), porSlot },
    conector: {
      poolsFundidos: st.poolsFundidos.length, demandaComum: st.poolsFundidos.map((x) => Math.round(x.demandaComum)),
      remLegadoEtq: dm(C_ETQ) && dm(A_ETQ) ? Math.round(dm(C_ETQ)!.remLegado + dm(A_ETQ)!.remLegado) : null,
      remLegadoEmb: dm(C_EMB) && dm(A_EMB) ? Math.round(dm(C_EMB)!.remLegado + dm(A_EMB)!.remLegado) : null,
      m8: { vigente: Math.round(soma(pv[A_ROS])), fluxo: Math.round(soma(pf[A_ROS])) },
      linhasPorPool: { vigente: Object.fromEntries([C_ETQ, A_ETQ, C_EMB, A_EMB].map((k) => [k, postos(pv[k])])), fluxo: Object.fromEntries([C_ETQ, A_ETQ, C_EMB, A_EMB].map((k) => [k, postos(pf[k])])) }, e15: { vigente: e15v, fluxo: e15f }, duplicidadeE15: dup,
    },
    wipTeto, pares,
    trajVigente: Object.fromEntries(r.avVigente.trajetoria.map((t) => [t.chave, t.porSlot.map((x) => [x.slot, Math.round(x.lo), Math.round(x.hi)] as [number, number, number])])),
    trajFluxo: Object.fromEntries(r.avFluxo.trajetoria.map((t) => [t.chave, t.porSlot.map((x) => [x.slot, Math.round(x.lo), Math.round(x.hi)] as [number, number, number])])),
    e15: e15(r, st),
  };
}

// Etiquetadora 15 (atende Etiquetar convencional e automática): déficit = demanda restante das duas etapas − capacidade futura (meta × f) da máquina.
function e15(r: Rodada, st: Rodada["res"]["diagnostico"]["estado"]) {
  const f = r.cen.opcoes.fatorPorPool ?? {};
  let cap = 0;
  for (let t = r.cen.aPartirDe; t < r.cen.entrada.slots.length; t++) {
    const s = r.cen.entrada.slots[t];
    const pool = r.cen.entrada.pools.find((p) => `${p.produtoId}|${p.etapaId}` === C_ETQ);
    if (pool && pool.maquinasIds.includes(E15)) cap += (pool.metas[s.periodoId] ?? 0) * (f[C_ETQ] ?? 1);
  }
  const d = (k: string) => st.demanda.find((x) => x.chave === k);
  const leg = d(C_ETQ) && d(A_ETQ) ? d(C_ETQ)!.remLegado + d(A_ETQ)!.remLegado - cap : 0;
  const fus = st.poolsFundidos.find((x) => x.rotulo.toLowerCase().includes("etiq"));
  return { capacidadeFutura: Math.round(cap), defLegado: Math.round(leg), defFundido: fus ? Math.round(fus.demandaComum - cap) : null };
}
