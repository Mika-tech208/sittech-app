/* eslint-disable @typescript-eslint/no-explicit-any */
// Valor marginal em R$ (preço CONGELADO) de UMA pessoa em M2 de 28/10: plano vigente de PROD × mover essa pessoa para outro posto, com a Previsão/estado reais.
// Uso: ts.sh marginal.ts [--agora ISO] [--desloc 1]
import { buscar, carregar } from "./carga";
import { montarEstadoAting } from "./estadoAting";
import { avaliarPlano } from "@/features/escala/fluxo";
import type { AlocacaoEscala } from "@/features/escala/types";

const arg = (k: string) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? process.argv[i + 1] : undefined; };
const d = carregar(buscar({ semana: "2026-10-26", antesIso: "2026-10-28T08:50:00-03:00", depoisIso: "2999-01-01T00:00:00Z", usarCache: true }));
const nome = (id: string) => (d.nomes[id] ?? id.slice(0, 8)).trim().replace('Conector 3/4" - Maquina Automatica', "Conector 3/4 Autom.").replace('Conector 3/4"', "Conector 3/4 Conv.");
const e = montarEstadoAting(d, Date.parse(arg("agora") ?? "2026-10-28T09:00:00-03:00"), d.planoAtual, Number(arg("desloc") ?? 1), { objetivo: "financeiro", atingibilidadeModo: "sombra" });
const slot = e.slots[e.aPartirDe];
const nomeEtapa = (id: string) => { const p = e.entrada.pools.find((x) => x.etapaId === id); return p ? nome(p.operacaoId) : id.slice(0, 6); };
const doSlot = d.planoAtual.filter((a) => a.data === slot.data && a.periodoId === slot.periodoId);
console.log(`Slot ${slot.data} ${slot.periodoId}: ${doSlot.filter((a) => a.maquinaId).length} postos`);
const porPool = new Map<string, AlocacaoEscala[]>();
doSlot.filter((a) => a.maquinaId).forEach((a) => { const k = `${nome(a.produtoId as string)}·${nomeEtapa(a.etapaId as string)}`; (porPool.get(k) ?? porPool.set(k, []).get(k)!).push(a); });
porPool.forEach((v, k) => console.log("  ", k, v.length, "posto(s)"));
const total = (aloc: AlocacaoEscala[]) => { const av = avaliarPlano(e.entrada, e.dados, [...e.entrada.congeladas, ...aloc.filter((a) => (e.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? -1) >= e.aPartirDe)], e.opcoes); return { rs: av.financeiro!.total.rsProjetadoFechamento, pecas: av.totais.finalEntregueLo, prod: Object.fromEntries(av.financeiro!.produtos.map((p) => [nome(p.produtoId), Math.round(p.finalProjetado)])) }; };
const base = total(d.planoAtual);
console.log("vigente: R$", base.rs, "peças", Math.round(base.pecas), JSON.stringify(base.prod));
const pools = e.entrada.pools;
const maquinasPool = (produto: string, etapaNome: string) => pools.find((p) => nome(p.produtoId) === produto && nome(p.operacaoId) === etapaNome);
// move uma pessoa do pool `de` para o pool `para` (primeira máquina livre do pool destino no slot)
function mover(de: string, para: string) {
  const [pd, ed] = de.split("·"), [pp, ep] = para.split("·");
  const linhas = porPool.get(de);
  const destino = maquinasPool(pp, ep);
  if (!linhas?.length || !destino) return null;
  const usadas = new Set(doSlot.map((a) => a.maquinaId));
  const livre = destino.maquinasIds.find((m) => !usadas.has(m));
  if (!livre) return { erro: "sem máquina livre no destino" };
  const alvo = linhas[linhas.length - 1];
  const nova = d.planoAtual.map((a) => (a === alvo ? { ...a, maquinaId: livre, produtoId: destino.produtoId, etapaId: destino.etapaId, operacaoId: destino.operacaoId, pecas: destino.metas[slot.periodoId] } : a));
  const t = total(nova);
  return { dR: t.rs - base.rs, dPecas: t.pecas - base.pecas, prod: t.prod, de: `${pd}·${ed}` };
}
const pares = process.argv.filter((a) => a.includes(">")).map((a) => a.split(">"));
const cand = pares.length ? pares : [...porPool.keys()].flatMap((a) => [...porPool.keys()].filter((b) => b !== a).map((b) => [a, b]));
for (const [a, b] of cand) { const r = mover(a, b); if (r && !("erro" in r)) console.log(`mover 1 pessoa ${a} → ${b}: ΔR$ ${r.dR.toFixed(2)}  Δpeças ${Math.round(r.dPecas)}`); }
