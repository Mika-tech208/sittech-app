/* eslint-disable @typescript-eslint/no-explicit-any */
// REPLAY da regra de preservação da atingibilidade com dados REAIS de PROD (somente leitura; usa o cache de buscar.ts).
// Uso: ts.sh scripts/escala-fluxo-atingibilidade/replay.ts [--agora ISO] [--desloc 1|2] [--out arq.json] [--maxit N]
import * as fs from "node:fs";
import { buscar, carregar } from "./carga";
import { montarEstadoAting } from "./estadoAting";
import { avaliarPlano, planejarComFluxo, verificarRestricoesDuras } from "@/features/escala/fluxo";
import { calcularChurn } from "@/features/escala/fluxo/planejar";
import { modelo, contagensDoPlano, varrerContagensPreservando } from "@/features/escala/fluxo/otimizar";
import { montarEstado } from "@/features/escala/fluxo/estado";
import type { AlocacaoEscala } from "@/features/escala/types";

const arg = (k: string) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? process.argv[i + 1] : undefined; };
const agoraMs = Date.parse(arg("agora") ?? "2026-10-28T09:45:00-03:00");
const desloc = (Number(arg("desloc") ?? 2) as 1 | 2);
const bruto = buscar({ semana: "2026-10-26", antesIso: "2026-10-28T08:50:00-03:00", depoisIso: "2999-01-01T00:00:00Z", usarCache: true });
const d = carregar(bruto);
const nome = (id: string) => (d.nomes[id] ?? id.slice(0, 8)).trim();
const opPorEtapa = new Map(d.decisao.entrada.pools.map((p) => [p.etapaId, p.operacaoId]));
const nomeEtapa = (id: string) => { const op = opPorEtapa.get(id); return op ? nome(op) : id.slice(0, 8); };
const nomeNo = (k: string) => { const [p, e] = k.split("|"); return `${nome(p).replace('Conector 3/4" - Maquina Automatica', "Conector 3/4 Autom.").replace('Conector 3/4"', "Conector 3/4 Conv.")}·${nomeEtapa(e)}`; };

const plano = d.planoAtual;
const maxIt = arg("maxit") ? Number(arg("maxit")) : undefined;
const off = montarEstadoAting(d, agoraMs, plano, desloc, { ...(maxIt !== undefined ? { maxIteracoes: maxIt } : {}) });
const on = montarEstadoAting(d, agoraMs, plano, desloc, { preservarAtingibilidade: true, ...(maxIt !== undefined ? { maxIteracoes: maxIt } : {}) });
const slots = off.slots;
const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
const fut = (l: AlocacaoEscala[]) => l.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) ?? -1) >= off.aPartirDe);
const vig = fut(plano);

const t0 = Date.now();
const rOff = planejarComFluxo(off.entrada, off.dados, off.opcoes);
const msOff = Date.now() - t0;
const t1 = Date.now();
const rOn = planejarComFluxo(on.entrada, on.dados, on.opcoes);
const msOn = Date.now() - t1;

const congel = on.entrada.congeladas;
const avalia = (l: AlocacaoEscala[]) => avaliarPlano(on.entrada, on.dados, [...congel, ...l], on.opcoes);
const planos: Record<string, AlocacaoEscala[]> = { vigente: vig, off: fut(rOff.resultado.alocacoes), on: fut(rOn.resultado.alocacoes) };

const contagem = (l: AlocacaoEscala[]) => {
  const ctx = on.ctx;
  const c = contagensDoPlano(ctx, l);
  return c;
};
const out: any = {
  agora: new Date(agoraMs - 3 * 3600_000).toISOString(), aPartirDe: off.aPartirDe, slotAPartirDe: `${slots[off.aPartirDe].data} ${slots[off.aPartirDe].periodoId}`, ms: { off: msOff, on: msOn },
  escolhido: { off: rOff.diagnostico.planoEscolhido, on: rOn.diagnostico.planoEscolhido }, violacoes: { off: rOff.diagnostico.violacoes.length, on: rOn.diagnostico.violacoes.length },
  churnVsVigente: { off: calcularChurn(off.ctx, rOff.resultado.alocacoes), on: calcularChurn(on.ctx, rOn.resultado.alocacoes) },
  produtos: {} as any, postosPorSlot: {} as any, tuplas: rOn.diagnostico.iteracoes.map((i) => ({ i: i.indice, tupla: i.tupla, esc: i.escolhida })),
};
const atVig = avalia(vig).atingibilidade!;
for (const [pn, pl] of Object.entries(planos)) {
  const av = avalia(pl);
  const at = av.atingibilidade!;
  out.produtos[pn] = at.grupos.map((g) => ({ produto: g.produtos.map((p) => nome(p.produtoId).replace('Conector 3/4" - Maquina Automatica', "Conector 3/4 Autom.").replace('Conector 3/4"', "Conector 3/4 Conv.")).join(" + "), meta: g.meta, restante: g.restante, maximoPossivel: g.maximoPossivel, atingivel: g.atingivel, faltaInevitavel: g.faltaInevitavel, finalPrevisto: g.finalPrevisto, faltaEvitavel: g.faltaEvitavel, status: g.status }));
  out.produtos[pn + "_tot"] = { final: av.totais.finalEntregueLo, falta: av.totais.faltaFinalLo, wipFinal: av.totais.wipFinalLo, excessoWip: av.totais.excessoWip, atingiveisPerdidas: at.atingiveisPerdidas, deficit: at.deficitRelativo };
  out.wipFinal ??= {};
  out.wipFinal[pn] = Object.fromEntries(av.produtos.flatMap((p) => Object.entries(p.wipFinal).map(([k, v]) => [nomeNo(k), `${Math.round(v.lo)}-${Math.round(v.hi)}`])));
  // contagem de postos por nó e slot
  const c = contagem(pl);
  out.postosPorSlot[pn] = Object.fromEntries(Object.entries(c).map(([n, arr]) => [nomeNo(n), arr.slice(off.aPartirDe).join(" ")]));
}
// postos mínimos exigidos pela regra (sobre cada plano, estado que o plano produz)
const estado = montarEstado(on.ctx);
out.pessoasPorSlot = modelo(on.ctx).pessoas.slice(off.aPartirDe).join(" ");
for (const pn of ["vigente", "on"]) {
  const v = varrerContagensPreservando(on.ctx, contagem(planos[pn]), estado.remPorPool, true, true);
  out.postosPorSlot["min_" + pn] = Object.fromEntries(Object.entries(v.minimos).map(([n, arr]) => [nomeNo(n), arr.slice(off.aPartirDe).join(" ")]));
  out["obrig_" + pn] = v.preservacao.filter((x) => x.slot <= off.aPartirDe + 1).map((x) => ({ slot: `${slots[x.slot].data} ${slots[x.slot].periodoId}`, grupo: nomeNo(x.grupo), alvo: Math.round(x.alvo), meta: x.meta, atingivel: x.atingivel, producaoObrigatoria: Math.round(x.producaoObrigatoria), minimos: Object.fromEntries(Object.entries(x.minimos).map(([n, k]) => [nomeNo(n), k])), atendido: x.atendido }));
}
out.atingibilidadeDiag = rOn.diagnostico.atingibilidade ? { antes: rOn.diagnostico.atingibilidade.antes.grupos.map((g) => ({ ...g, produtos: undefined, grupo: nomeNo(g.grupo) })) } : null;
out.diag = rOn.diagnostico.diagnosticos.filter((x) => x.codigo === "META_NAO_ATINGIVEL" || x.codigo === "POSTOS_MINIMOS_APLICADOS").map((x) => x.mensagem);
out.violVigente = verificarRestricoesDuras(on.entrada, vig).length;
void atVig;
const txt = JSON.stringify(out, null, 1);
if (arg("out")) fs.writeFileSync(arg("out") as string, txt); else console.log(txt);
