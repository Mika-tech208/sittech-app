/* eslint-disable @typescript-eslint/no-explicit-any */
// CARREGADOR da PROPOSTA 02/11 (sombra, offline): estado da Previsão (SELECTs em PROD já gravados em SQL_DIR), histórico (cache D2) e cenários de WIP.
// Reaproveita o carregador do plano reverso (D7). NADA é gravado; nenhuma flag é ativada.
import * as fs from "node:fs";
import * as path from "node:path";
import { montarEstado } from "../auditoria-buffer/carga1102";
import { abrir, estadoEm } from "../auditoria-buffer/comum";
import { CACHE } from "../auditoria-buffer/carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { avaliarPlano, planejarComFluxo } from "@/features/escala/fluxo";
import { prepararFluxo, type CtxFluxo } from "@/features/escala/fluxo/estado";
import { entradaForecastDoPlano } from "@/features/escala/fluxo/forecastBufferPlano";
import { criarEstimadorPosto } from "@/features/escala/fluxo/produtividadePosto";
import { validarCadeia } from "@/features/escala/fluxo/planejamentoCadeia";
import type { ProdutoRev, RecursoRev } from "@/features/escala/fluxo/planoReverso";
import { maquinaDisponivelNoSlot } from "@/features/escala/disponibilidade";
import { chavePool, type AlocacaoEscala, type PoolEscala } from "@/features/escala/types";
import type { ContagemFisicaPar, DadosProducaoReal } from "@/features/escala/fluxo";

export const AGORA = Date.parse("2026-11-02T06:00:00-03:00");
export const AGORA_HOJE = Date.parse("2026-10-30T12:20:52-03:00");
export const EXT = Number(process.env.EXT ?? 1);
export const n0 = (v: number) => Math.round(v).toLocaleString("pt-BR");
export const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("pt-BR");
export const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);

// ---------------- estado da Previsão ----------------
export const { estado } = montarEstado();
export const montada = montarEntradaEscala(estado, AGORA);
export const entrada = montada.entrada;
export const slots = entrada.slots;
export const H = slots.length;
export const nomeP = (id: string) => (estado.nomesProdutos?.[id] ?? id).trim();
export const nomeO = (id: string) => estado.nomesOperacao[id] ?? id;
export const nomeM = (id: string) => (estado.nomesMaquinas?.[id] ?? id).trim();
export const rotuloPeriodo = (i: number) => `${slots[i].data.slice(8)}/${slots[i].data.slice(5, 7)} ${slots[i].periodoId.toUpperCase()}`;
export const periodos = slots.map((s, i) => ({ rotulo: rotuloPeriodo(i), duracaoMin: s.fimMin - s.inicioMin }));
export const pessoas = slots.map((s) => {
  const aus = new Set((entrada.ausencias ?? []).filter((x) => x.data === s.data && (x.inicioMin === null || x.fimMin === null || (x.inicioMin < s.fimMin && x.fimMin > s.inicioMin))).map((x) => x.funcionarioId));
  return entrada.funcionarios.filter((f) => !aus.has(f.id)).length;
});

// ---------------- histórico (produtividade do posto) ----------------
export const A = abrir();
export const todos = [...A.hist, ...A.d.apontamentos];
export const estimador = criarEstimadorPosto(todos, AGORA_HOJE, { janelaDias: 14, nMin: 3 });

// ---------------- WIP: projeção do fim de hoje (engine) ----------------
export const tAloc = fs.readFileSync(path.join(CACHE, "aloc_now.sql.out"), "utf8");
export const planoHoje: AlocacaoEscala[] = JSON.parse(tAloc.slice(tAloc.indexOf("{"))).rows.map((a: any) => ({
  data: a.data, periodoId: a.periodo_id, funcionarioId: a.funcionario_id, maquinaId: a.maquina_id, produtoId: a.produto_id, etapaId: a.etapa_id, operacaoId: a.operacao_id,
  pecas: Number(a.pecas), ...(Number(a.pecas_adicional) > 0 ? { pecasAdicional: Number(a.pecas_adicional) } : {}), motivoSemPosto: a.motivo_sem_posto, origem: a.origem === "manual" ? "manual" : "auto",
}));
export const E0 = estadoEm(A, AGORA_HOJE, planoHoje, { mesmoPeriodo: false });
export const av0 = avaliarPlano(E0.ent, E0.dados, [...E0.ent.congeladas, ...planoHoje.filter((a) => A.ix(a) >= E0.ap)], { ...E0.opcoes, fluxoMesmoPeriodo: false });
export const wipFinal: Record<string, { lo: number; hi: number }> = Object.assign({}, ...av0.produtos.map((p) => p.wipFinal));

// ---------------- produtos / rotas ----------------
export const porProduto = new Map<string, PoolEscala[]>();
entrada.pools.forEach((p) => (porProduto.get(p.produtoId) ?? porProduto.set(p.produtoId, []).get(p.produtoId)!).push(p));
porProduto.forEach((ps) => ps.sort((a, b) => a.ordemEtapa - b.ordemEtapa));
export const ehAutomatica = (id: string) => /Autom/i.test(nomeP(id));
export const taxaPosto = (pool: PoolEscala, maq: string, t: number, mundo: "meta" | "hist") => {
  const meta = pool.metas[slots[t].periodoId] ?? 0;
  if (mundo === "meta") return meta;
  const tx = estimador({ produtoId: pool.produtoId, operacaoId: pool.operacaoId, maquinaId: maq });
  return meta * (tx.fonte === "historico" ? tx.razao : 1);
};
export const maquinasTodas = [...new Set(entrada.pools.flatMap((p) => p.maquinasIds))];
export const recursos: RecursoRev[] = maquinasTodas.map((m) => ({ id: m, rotulo: nomeM(m), unidades: slots.map((s) => (maquinaDisponivelNoSlot(entrada, m, s) ? 1 : 0)) }));
export function produtosRev(mundo: "meta" | "hist", wip: Record<string, number[]>): ProdutoRev[] {
  return [...porProduto.entries()].map(([pid, ps]) => ({
    id: pid, rotulo: nomeP(pid), demandaFinal: ps[0].quantidade, valorUnitario: ps[0].valorUnitario, recorrentePorPeriodo: ps[0].quantidade / H,
    wipInicial: wip[nomeP(pid)] ?? new Array(Math.max(0, ps.length - 1)).fill(0),
    etapas: ps.map((p) => ({ id: p.etapaId, rotulo: `${nomeO(p.operacaoId)}`, alternativas: p.maquinasIds.map((m) => ({ recursoId: m, pecasPorPosto: slots.map((_, t) => taxaPosto(p, m, t, mundo)) })) })),
  }));
}

// ---------------- cenários de WIP inicial (início de 03/11) ----------------
export const conv = [...porProduto.keys()].find((id) => /^Conector 3\/4"$/.test(nomeP(id)) || (nomeP(id).startsWith('Conector 3/4"') && !ehAutomatica(id))) as string;
export const aut = [...porProduto.keys()].find((id) => ehAutomatica(id)) as string;
export const cx = [...porProduto.keys()].find((id) => /Caixa/i.test(nomeP(id))) as string;
export const NC = nomeP(conv), NA = nomeP(aut), NX = nomeP(cx);
export const wipDoEngine = (cen: "lo" | "hi") => {
  const o: Record<string, number[]> = {};
  porProduto.forEach((ps, pid) => { o[nomeP(pid)] = ps.slice(0, -1).map((p) => Math.round(wipFinal[chavePool(pid, p.etapaId)]?.[cen] ?? 0)); });
  return o;
};
export interface CenWip { nome: string; rotulo: string; wip: Record<string, number[]>; confianca: string; principal?: boolean }
export const cenarios: CenWip[] = [
  { nome: "A", rotulo: "A · contagem 30/10 12:00 (6.000/6.000/3.600) tomada como estoque do início de 03/11 (OTIMISTA: ignora o resto de hoje)", wip: { [NC]: [6000, 6000, 3600], [NA]: [0, 0], [NX]: [2300] }, confianca: "baixa (contagem de 12:00, anterior ao consumo de T1–T3; arredondada)" },
  { nome: "B", rotulo: "B · estoque efetivo corrigido (Parafusar→Etiquetar −2.300 = 3.700; Rosquear→Parafusar ≈3.200; Etiquetar→Embalar 3.600)", wip: { [NC]: [3200, 3700, 3600], [NA]: [0, 0], [NX]: [2300] }, confianca: "baixa (estimado a partir da parada das 14:50 e da conservação PE+EE)" },
  { nome: "C", rotulo: "C · zero em todas as ligações", wip: { [NC]: [0, 0, 0], [NA]: [0, 0], [NX]: [0] }, confianca: "limite inferior (sem hipótese)" },
  { nome: "E-lo", rotulo: "E · projetado pelo motor para o FIM DE HOJE (T3 de 30/10 incluso), pessimista (lo)", wip: wipDoEngine("lo"), confianca: "média (reconstrução ±0,3 período; depende do plano de hoje ser cumprido)" },
  { nome: "E-hi", rotulo: "E · projetado pelo motor para o fim de hoje, otimista (hi)", wip: wipDoEngine("hi"), confianca: "média/baixa (limite superior do intervalo)" },
];
if (process.env.WIP_JSON && fs.existsSync(process.env.WIP_JSON)) {
  const j = JSON.parse(fs.readFileSync(process.env.WIP_JSON, "utf8"));
  Object.entries(j).filter(([k]) => k.startsWith("D")).forEach(([k, v]) => cenarios.unshift({ nome: k, rotulo: `D · contagem física final do dia (${k}) — PRINCIPAL`, wip: v as any, confianca: "alta (contagem por local informada pelo usuário)", principal: true }));
}
export const PRINCIPAL = cenarios.find((c) => c.principal) ?? cenarios.find((c) => c.nome === "B")!;

