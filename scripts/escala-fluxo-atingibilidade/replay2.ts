/* eslint-disable @typescript-eslint/no-explicit-any */
// REPLAY financeiro: plano vigente (PROD) × objetivo peças/off × peças/atingibilidade × financeiro/atingibilidade (alvo), mesmo estado real. Somente leitura.
// Uso: ts.sh replay2.ts [--agora ISO] [--desloc N (1|2; >=100: slot absoluto)] [--sem-vigente-futuro] [--out arq.json]
import * as fs from "node:fs";
import { buscar, carregar } from "./carga";
import { montarEstadoAting } from "./estadoAting";
import { avaliarPlano, planejarComFluxo, verificarRestricoesDuras, type OpcoesFluxo } from "@/features/escala/fluxo";
import { calcularChurn } from "@/features/escala/fluxo/planejar";
import { contagensDoPlano, varrerContagensPreservando } from "@/features/escala/fluxo/otimizar";
import { analisarCapacidade } from "@/features/escala/fluxo/capacidade";
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
// margem FICTÍCIA — só para testar a arquitetura do modo C (não existe margem confiável em PROD; ver docs/escala-economia-dados.md). NUNCA usar como número real.
const FICTICIA: Record<string, number> = { "Caixa Amarela 4x2": 0.5, 'Conector 3/4 Conv.': 0.3, "Conector 3/4 Autom.": 0.35, Pino: 0.6, "Plug Macho": 0.2, 'Conector 1.1/4"': 0.4 };
const margemFicticia = (produtoId: string) => { const preco = d.decisao.entrada.pools.find((p) => p.produtoId === produtoId)?.valorUnitario ?? 0; return { valor: preco * (FICTICIA[nome(produtoId)] ?? 0.3), natureza: "contribuicao" as const, fonte: "FICTICIA (teste de arquitetura)", confiavel: true }; };
const KS = (arg("ks") ?? "1,2,3,5,7,10,100").split(",").map(Number);
const MODOS = (process.env.MODOS ?? "4").length > 0;
void MODOS;
const configs: Record<string, Partial<OpcoesFluxo>> = {
  A_pecas: {},
  B_receita: { objetivo: "financeiro", atingibilidadeModo: "ativo", atingibilidadeK: 2 },
  C_lucroHora_nominal: { objetivo: "lucro_hora", produtividadeBase: "nominal", atingibilidadeModo: "ativo", atingibilidadeK: 2 },
  D_lucroHora_real: { objetivo: "lucro_hora", atingibilidadeModo: "ativo", atingibilidadeK: 2 },
  D_lucroHora_real_k1: { objetivo: "lucro_hora", atingibilidadeModo: "ativo", atingibilidadeK: 1 },
  D_lucroHora_real_k5: { objetivo: "lucro_hora", atingibilidadeModo: "ativo", atingibilidadeK: 5 },
  D_lucroHora_real_k10: { objetivo: "lucro_hora", atingibilidadeModo: "ativo", atingibilidadeK: 10 },
  D_lucroHora_real_k100: { objetivo: "lucro_hora", atingibilidadeModo: "ativo", atingibilidadeK: 100 },
};
const medir: Partial<OpcoesFluxo> = { objetivo: "financeiro", atingibilidadeModo: "sombra", economiaSlots: 99 };
const est = montarEstadoAting(d, agoraMs, d.planoAtual, desloc, medir, bloco);
const estL = montarEstadoAting(d, agoraMs, d.planoAtual, desloc, { objetivo: "lucro_hora", atingibilidadeModo: "sombra", economiaSlots: 99 }, bloco);
const out: any = { agora: arg("agora"), primeiroPeriodoMutavel: `${slots[base.aPartirDe].data} ${slots[base.aPartirDe].periodoId}`, planos: {} };
const planos: Record<string, { aloc: AlocacaoEscala[]; ms?: number; escolhido?: string; diag?: string[]; eco?: any }> = { vigente: { aloc: vig } };
for (const [nm, op] of Object.entries(configs)) {
  const e = montarEstadoAting(d, agoraMs, planoDeEntrada, desloc, op, bloco);
  const t0 = Date.now();
  const r = planejarComFluxo(e.entrada, e.dados, { ...e.opcoes, economiaSlots: 2 });
  planos[nm] = { aloc: fut(r.resultado.alocacoes), ms: Date.now() - t0, escolhido: r.diagnostico.planoEscolhido, diag: r.diagnostico.diagnosticos.filter((x) => ["PRODUTO_SACRIFICADO", "META_NAO_ATINGIVEL", "ATINGIBILIDADE_NAO_PRESERVADA_CUSTO", "MARGEM_INDISPONIVEL"].includes(x.codigo)).map((x) => x.mensagem), eco: r.diagnostico.economia ? { nivel: r.diagnostico.economia.nivel, limite: r.diagnostico.economia.limiteEconomico, decisoes: r.diagnostico.economia.decisoes.filter((x) => x.slot === e.aPartirDe).slice(0, 30).map((x) => x.texto.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (id) => nome(id))) } : undefined };
  if (r.diagnostico.violacoes.length) out.violacoes = { ...(out.violacoes ?? {}), [nm]: r.diagnostico.violacoes.length };
}
for (const [nm, p] of Object.entries(planos)) {
  const av = avaliarPlano(est.entrada, est.dados, [...est.entrada.congeladas, ...p.aloc], est.opcoes);
  const fin = av.financeiro!;
  const avL = avaliarPlano(estL.entrada, estL.dados, [...estL.entrada.congeladas, ...p.aloc], estL.opcoes);
  const finL = avL.financeiro!;
  out.planos[nm] = {
    escolhido: p.escolhido, ms: p.ms, diag: p.diag, eco: p.eco,
    lucro: { projetado: finL.total.rsProjetadoFechamento, faltaInevitavel: finL.total.rsFaltaInevitavel, porProduto: Object.fromEntries(finL.produtos.map((x) => [nome(x.produtoId), x.rsProjetadoFechamento])) },
    total: { ...fin.total, pecasFinal: Math.round(av.totais.finalEntregueLo), wipFinal: Math.round(av.totais.wipFinalLo), excessoWip: Math.round(av.totais.excessoWip), atingiveisPerdidas: av.atingibilidade!.atingiveisPerdidas },
    churnVsVigente: calcularChurn(est.ctx, p.aloc),
    violacoesDuras: verificarRestricoesDuras(est.entrada, p.aloc).length,
    violacoesPorTipo: (() => { const m: Record<string, number> = {}; verificarRestricoesDuras(est.entrada, p.aloc).forEach((v) => { const k = `${v.tipo}:${nome(v.funcionarioId ?? "?")}`; m[k] = (m[k] ?? 0) + 1; }); return m; })(),
    postosOcupados: p.aloc.filter((a) => a.maquinaId).length, semPosto: p.aloc.filter((a) => !a.maquinaId).length,
    produtos: fin.produtos.map((x) => ({ produto: nome(x.produtoId), preco: x.precoCongelado, meta: x.meta, realizado: x.realizadoFinal, restante: x.restante, maximo: x.maximoProduzivel, atingivel: x.metaAtingivel, faltaInevitavel: x.faltaInevitavel, projetado: x.finalProjetado, rsProjetado: x.rsProjetadoFechamento, rsFaltaProj: x.rsFaltaProjetada, rsFaltaInevitavel: x.rsFaltaInevitavel })),
    capacidade: (() => { const cnt = contagensDoPlano(est.ctx, p.aloc); const mins = varrerContagensPreservando(est.ctx, cnt, {}, true).minimos; return analisarCapacidade(est.ctx, [...est.entrada.congeladas, ...p.aloc], mins).capacidade.filter((c) => c.slot === base.aPartirDe).map((c) => ({ no: nomeNo(c.no), postosMax: c.postosMaximos, ocupados: c.postosOcupados, disp: c.postosDisponiveis, minimos: c.postosMinimos, pessoas: c.pessoasElegiveis, nominal: c.produtividadeNominal, esperada: c.produtividadeEsperada, rsPorHora: c.receitaPorHoraPosto, capMaq: c.capMaquinas, capEtapa: c.capEtapa, vAdd: c.valorMarginalAdicionar, vUlt: c.valorMarginalUltimo, diag: c.diagnostico })); })(),
    wipPorPar: Object.fromEntries(av.produtos.flatMap((q) => Object.entries(q.wipFinal).map(([k, v]) => [nomeNo(k), `${Math.round(v.lo)}`]))),
    postos: Object.fromEntries(Object.entries(contagensDoPlano(est.ctx, p.aloc)).map(([n, a]) => [nomeNo(n), a.slice(base.aPartirDe).join(" ")])),
  };
}
const txt = JSON.stringify(out, null, 1);
if (arg("out")) fs.writeFileSync(arg("out") as string, txt); else console.log(txt);
