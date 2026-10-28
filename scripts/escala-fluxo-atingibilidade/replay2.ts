// REPLAY financeiro: plano vigente (PROD) × objetivo peças/off × peças/atingibilidade × financeiro/atingibilidade (alvo), mesmo estado real. Somente leitura.
// Uso: ts.sh replay2.ts [--agora ISO] [--desloc N (1|2; >=100: slot absoluto)] [--sem-vigente-futuro] [--out arq.json]
import * as fs from "node:fs";
import { buscar, carregar } from "./carga";
import { montarEstadoAting } from "./estadoAting";
import { avaliarPlano, planejarComFluxo, verificarRestricoesDuras, type OpcoesFluxo } from "@/features/escala/fluxo";
import { calcularChurn } from "@/features/escala/fluxo/planejar";
import { contagensDoPlano } from "@/features/escala/fluxo/otimizar";
import type { AlocacaoEscala } from "@/features/escala/types";

const arg = (k: string) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? process.argv[i + 1] : undefined; };
const agoraMs = Date.parse(arg("agora") ?? "2026-10-28T09:45:00-03:00");
const desloc = Number(arg("desloc") ?? 2);
const bloco = process.argv.includes("--bloco"); // revezamento por bloco (manhã/tarde) como restrição dura (feat/escala-rev-bloco)
const d = carregar(buscar({ semana: "2026-10-26", antesIso: "2026-10-28T08:50:00-03:00", depoisIso: "2999-01-01T00:00:00Z", usarCache: true }));
const nome = (id: string) => (d.nomes[id] ?? id.slice(0, 8)).trim().replace('Conector 3/4" - Maquina Automatica', "Conector 3/4 Autom.").replace('Conector 3/4"', "Conector 3/4 Conv.");
const opPorEtapa = new Map(d.decisao.entrada.pools.map((p) => [p.etapaId, p.operacaoId]));
const nomeNo = (k: string) => { const [p, e] = k.split("|"); const op = opPorEtapa.get(e); return `${nome(p)}·${op ? nome(op) : e.slice(0, 6)}`; };

const base = montarEstadoAting(d, agoraMs, d.planoAtual, desloc, {}, bloco);
const slots = base.slots;
const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
const fut = (l: AlocacaoEscala[]) => l.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) ?? -1) >= base.aPartirDe);
const vig = fut(d.planoAtual);
const zero = process.argv.includes("--zero"); // 29–30/10 "do zero": os planos das configurações partem SEM o plano vigente futuro (não há candidato vigente)
const planoDeEntrada = zero ? d.planoAtual.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) ?? 99) < base.aPartirDe) : d.planoAtual;
const configs: Record<string, Partial<OpcoesFluxo>> = {
  pecas_off: {},
  pecas_ating: { atingibilidadeModo: "ativo" },
  fin_ating: { objetivo: "financeiro", atingibilidadeModo: "ativo" },
  fin_off: { objetivo: "financeiro", atingibilidadeModo: "off" },
};
const medir: Partial<OpcoesFluxo> = { objetivo: "financeiro", atingibilidadeModo: "sombra" };
const est = montarEstadoAting(d, agoraMs, d.planoAtual, desloc, medir, bloco);
const out: any = { agora: arg("agora"), primeiroPeriodoMutavel: `${slots[base.aPartirDe].data} ${slots[base.aPartirDe].periodoId}`, planos: {} };
const planos: Record<string, { aloc: AlocacaoEscala[]; ms?: number; escolhido?: string; diag?: string[] }> = { vigente: { aloc: vig } };
for (const [nm, op] of Object.entries(configs)) {
  const e = montarEstadoAting(d, agoraMs, planoDeEntrada, desloc, op, bloco);
  const t0 = Date.now();
  const r = planejarComFluxo(e.entrada, e.dados, e.opcoes);
  planos[nm] = { aloc: fut(r.resultado.alocacoes), ms: Date.now() - t0, escolhido: r.diagnostico.planoEscolhido, diag: r.diagnostico.diagnosticos.filter((x) => ["PRODUTO_SACRIFICADO", "META_NAO_ATINGIVEL"].includes(x.codigo)).map((x) => x.mensagem) };
  if (r.diagnostico.violacoes.length) out.violacoes = { ...(out.violacoes ?? {}), [nm]: r.diagnostico.violacoes.length };
}
for (const [nm, p] of Object.entries(planos)) {
  const av = avaliarPlano(est.entrada, est.dados, [...est.entrada.congeladas, ...p.aloc], est.opcoes);
  const fin = av.financeiro!;
  out.planos[nm] = {
    escolhido: p.escolhido, ms: p.ms, diag: p.diag,
    total: { ...fin.total, pecasFinal: Math.round(av.totais.finalEntregueLo), wipFinal: Math.round(av.totais.wipFinalLo), excessoWip: Math.round(av.totais.excessoWip), atingiveisPerdidas: av.atingibilidade!.atingiveisPerdidas },
    churnVsVigente: calcularChurn(est.ctx, p.aloc),
    violacoesDuras: verificarRestricoesDuras(est.entrada, p.aloc).length,
    violacoesPorTipo: (() => { const m: Record<string, number> = {}; verificarRestricoesDuras(est.entrada, p.aloc).forEach((v) => { const k = `${v.tipo}:${nome(v.funcionarioId ?? "?")}`; m[k] = (m[k] ?? 0) + 1; }); return m; })(),
    postosOcupados: p.aloc.filter((a) => a.maquinaId).length, semPosto: p.aloc.filter((a) => !a.maquinaId).length,
    produtos: fin.produtos.map((x) => ({ produto: nome(x.produtoId), preco: x.precoCongelado, meta: x.meta, realizado: x.realizadoFinal, restante: x.restante, maximo: x.maximoProduzivel, atingivel: x.metaAtingivel, faltaInevitavel: x.faltaInevitavel, projetado: x.finalProjetado, rsProjetado: x.rsProjetadoFechamento, rsFaltaProj: x.rsFaltaProjetada, rsFaltaInevitavel: x.rsFaltaInevitavel })),
    wipPorPar: Object.fromEntries(av.produtos.flatMap((q) => Object.entries(q.wipFinal).map(([k, v]) => [nomeNo(k), `${Math.round(v.lo)}`]))),
    postos: Object.fromEntries(Object.entries(contagensDoPlano(est.ctx, p.aloc)).map(([n, a]) => [nomeNo(n), a.slice(base.aPartirDe).join(" ")])),
  };
}
const txt = JSON.stringify(out, null, 1);
if (arg("out")) fs.writeFileSync(arg("out") as string, txt); else console.log(txt);
