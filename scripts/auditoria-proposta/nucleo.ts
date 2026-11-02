/* eslint-disable @typescript-eslint/no-explicit-any */
// NÚCLEO compartilhado (economia, tipos de posto, inteirização com fechamento de cadeia, validação, atribuição de pessoas) — extraído de proposta-0211.ts.
import * as fs from "node:fs";
import * as path from "node:path";
import * as D from "./dados";
import { validarPlanoCadeia, type ProdutoRev } from "@/features/escala/fluxo/planoReverso";
import type { LimiteOperacaoBloco } from "@/features/escala/fluxo/propostaCorte";
import { reatribuirPessoasBloco } from "@/features/escala/estabilidade";
import { verificarRestricoesDuras } from "@/features/escala/fluxo/restricoes";
import { MOTIVO_DEMANDA_ESGOTADA, type AlocacaoEscala } from "@/features/escala/types";
export const { n0, n1, soma, H, periodos, pessoas, recursos, entrada, slots, nomeP, nomeO, nomeM, porProduto, conv, aut, cx } = D;
export const SCRATCH = "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/auditoria-1030/D9";
export const NP = Math.max(...pessoas);
export const money = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
export const custoOp: Record<string, number> = {};
{
  const t = fs.readFileSync(path.join(SCRATCH, "sql/custo_op.sql.out"), "utf8");
  JSON.parse(t.slice(t.indexOf("{"))).rows.forEach((r: any) => (custoOp[r.op] = Number(r.custo_h_medio)));
}
export const CUSTO_HORA_EMPRESA = 31.922; // econ/calc.py (CH) — fallback quando a operação não tem custo próprio
export const durH: Record<string, number> = {};
slots.filter((s) => s.data === slots[0].data).forEach((s) => (durH[s.periodoId] = (s.fimMin - s.inicioMin) / 60));
export interface Econ { valor: number; custo: number; margem: number; margemPct: number; horasPorPeca: number; custoPorEtapa: { etapa: string; custo: number }[] }
export const econ: Record<string, Econ> = {};
porProduto.forEach((ps, pid) => {
  let custo = 0, horas = 0;
  const por: Econ["custoPorEtapa"] = [];
  ps.forEach((pool) => {
    let pc = 0, hh = 0;
    Object.entries(pool.metas).forEach(([per, m]) => { if (m > 0) { pc += m; hh += durH[per]; } });
    if (pc <= 0) return;
    const tp = hh / pc;
    const c = tp * (custoOp[nomeO(pool.operacaoId)] ?? CUSTO_HORA_EMPRESA);
    custo += c; horas += tp; por.push({ etapa: nomeO(pool.operacaoId), custo: c });
  });
  const valor = ps[0].valorUnitario;
  econ[pid] = { valor, custo, margem: valor - custo, margemPct: valor > 0 ? ((valor - custo) / valor) * 100 : 0, horasPorPeca: horas, custoPorEtapa: por };
});
export const pesosMargem = Object.fromEntries(Object.keys(econ).map((k) => [k, econ[k].margem]));
export const pesosPecas = Object.fromEntries(Object.keys(econ).map((k) => [k, 1]));

export const idsProd = [...porProduto.keys()];
export const pino = idsProd.find((i) => /^Pino/.test(nomeP(i)))!, plug = idsProd.find((i) => /^Plug/.test(nomeP(i)))!;
export const poolPor = (pid: string, eid: string) => porProduto.get(pid)!.find((p) => p.etapaId === eid)!;
export const opDe = (pid: string, eid: string) => poolPor(pid, eid).operacaoId;
export const blocos: number[][] = [];
slots.forEach((s, i) => { const k = `${s.data}|${s.periodoId.startsWith("m") ? "m" : "t"}`; const ult = blocos[blocos.length - 1]; if (ult && `${slots[ult[0]].data}|${slots[ult[0]].periodoId.startsWith("m") ? "m" : "t"}` === k) ult.push(i); else blocos.push([i]); });
export const limOp: LimiteOperacaoBloco = { blocos, operacaoDe: opDe, limite: NP };

export const nomeCurto = (id: string) => nomeP(id).replace('Conector 3/4" - Maquina Automatica', "Conector 3/4 Automática").replace('Conector 3/4"', "Conector 3/4 Conv.");
export interface Detalhe { produtoId: string; etapaId: string; pecas: number; uso: number }
export interface Posto { t: number; maquinaId: string; produtoId: string; etapaId: string; operacaoId: string; pecas: number; uso: number; detalhes: Detalhe[] }
// arredonda e "fecha" a cadeia por construção: produção do destino nunca excede o estoque (peças inteiras, produção de Tn só em Tn+1)
export function inteirizar(pp: Posto[][], prods: ProdutoRev[]): { perdidas: number } {
  let perdidas = 0;
  prods.forEach((prod) => {
    const n = prod.etapas.length;
    const estoque = prod.wipInicial.map((w) => w);
    for (let t = 0; t < H; t++) {
      const chega = new Array(n).fill(0);
      for (let k = 0; k < n; k++) {
        const ds = pp[t].flatMap((x) => x.detalhes.filter((d) => d.produtoId === prod.id && d.etapaId === prod.etapas[k].id));
        const bruto = soma(ds.map((d) => d.pecas));
        if (bruto <= 0) continue;
        const disp = k === 0 ? Number.POSITIVE_INFINITY : estoque[k - 1];
        let alvo = Math.min(Math.floor(bruto + 1e-6), Math.floor(disp + 1e-6));
        if (alvo < Math.floor(bruto + 1e-6)) perdidas += Math.floor(bruto + 1e-6) - alvo;
        // distribui o inteiro entre os detalhes (proporcional)
        let resto = alvo;
        ds.forEach((d, i) => { const q = i === ds.length - 1 ? resto : Math.min(resto, Math.floor((d.pecas / bruto) * alvo)); d.pecas = q; resto -= q; });
        if (k > 0) estoque[k - 1] -= alvo;
        if (k < n - 1) chega[k] += alvo;
      }
      for (let k = 0; k < n - 1; k++) estoque[k] += chega[k];
    }
  });
  pp.forEach((l) => l.forEach((x) => (x.pecas = soma(x.detalhes.map((d) => d.pecas)))));
  return { perdidas };
}

// plano de produção por produto×etapa×período a partir dos postos (ou de linhas de alocação)
export type PlanoPE = Record<string, Record<string, number[]>>; // produto -> etapa -> [t]
export function planoDePostos(pp: Posto[][]): PlanoPE {
  const o: PlanoPE = {};
  pp.forEach((l, t) => l.forEach((x) => x.detalhes.forEach((d) => { ((o[d.produtoId] ??= {})[d.etapaId] ??= new Array(H).fill(0))[t] += d.pecas; })));
  return o;
}
export function planoDeLinhas(ls: { data: string; periodoId: string; produtoId: string | null; etapaId: string | null; pecas: number; maquinaId: string | null }[]): PlanoPE {
  const o: PlanoPE = {};
  ls.forEach((a) => { if (!a.maquinaId || !a.produtoId || !a.etapaId) return; const t = slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)!.indice; ((o[a.produtoId] ??= {})[a.etapaId] ??= new Array(H).fill(0))[t] += Number(a.pecas); });
  return o;
}
export interface ValCadeia { valida: boolean; violacoes: number; primeira: string | null; pecasFinais: Record<string, number>; faltaMaterialPecas: number; postosSemMaterial: number; periodosComSemMaterial: number }
export function validarPlano(plano: PlanoPE, prods: ProdutoRev[]): ValCadeia {
  let viol = 0, prim: { t: number; txt: string } | null = null, falta = 0, psm = 0;
  const per = new Set<number>(), fin: Record<string, number> = {};
  prods.forEach((prod) => {
    const pl = Object.fromEntries(prod.etapas.map((e) => [e.id, plano[prod.id]?.[e.id] ?? new Array(H).fill(0)]));
    const sim = validarPlanoCadeia({ etapas: prod.etapas.map((e) => ({ id: e.id, rotulo: e.rotulo })), wipInicial: prod.wipInicial, periodos }, pl);
    viol += sim.violacoes.length;
    sim.violacoes.forEach((v) => { if (!prim || v.periodo < prim.t) prim = { t: v.periodo, txt: `${v.periodoRotulo} (${nomeCurto(prod.id)} · ${sim.nos.find((n) => n.noId === v.noId)?.rotulo}: falta ${n0(v.falta)})` }; });
    const ult = sim.nos[sim.nos.length - 1];
    fin[prod.id] = soma(ult.efetiva);
    prod.etapas.forEach((e, k) => {
      const no = sim.nos.find((n) => n.noId === e.id)!;
      no.semMaterial.forEach((v, t) => {
        if (v <= 0.5) return;
        falta += v;
        const rate = Math.max(...e.alternativas.map((a) => a.pecasPorPosto[t]));
        psm += rate > 0 ? v / rate : 0; per.add(t);
      });
      void k;
    });
  });
  return { valida: viol === 0, violacoes: viol, primeira: (prim as any)?.txt ?? null, pecasFinais: fin, faltaMaterialPecas: falta, postosSemMaterial: psm, periodosComSemMaterial: per.size };
}

export const equipe = entrada.funcionarios.map((f) => f.id);
export const nomeFunc = (id: string) => (entrada.funcionarios.find((f) => f.id === id)?.nome ?? id.slice(0, 6));
export function atribuirPessoas(pp: Posto[][]): { linhas: AlocacaoEscala[]; ok: boolean; motivo?: string; semPostoLinhas: number } {
  const lin: AlocacaoEscala[] = [];
  let sem = 0;
  pp.forEach((l, t) => {
    const s = slots[t];
    const disp = equipe.filter((fid) => !(entrada.ausencias ?? []).some((x) => x.funcionarioId === fid && x.data === s.data && (x.inicioMin === null || x.fimMin === null || (x.inicioMin < s.fimMin && x.fimMin > s.inicioMin))));
    disp.forEach((fid, i) => {
      const x = l[i];
      if (x) lin.push({ data: s.data, periodoId: s.periodoId, funcionarioId: fid, maquinaId: x.maquinaId, produtoId: x.produtoId, etapaId: x.etapaId, operacaoId: x.operacaoId, pecas: Math.round(x.pecas), pecasAdicional: 0, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, origem: "auto" });
      else { sem++; lin.push({ data: s.data, periodoId: s.periodoId, funcionarioId: fid, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, pecasAdicional: 0, motivoSemPosto: MOTIVO_DEMANDA_ESGOTADA, excecaoRevezamento: false, motivoExcecao: null, origem: "auto" }); }
    });
  });
  const r = reatribuirPessoasBloco(lin, [], slots, { escopo: "bloco", ponteM3T1: entrada.revezamentoPonteM3T1 === true, equivalencias: entrada.equivalenciaOperacoes }, 600);
  if (!r) return { linhas: lin, ok: false, motivo: "reatribuirPessoasBloco sem solução (revezamento de bloco/ponte)", semPostoLinhas: sem };
  return { linhas: r.linhas, ok: true, semPostoLinhas: sem };
}
export function violacoes(linhas: AlocacaoEscala[]) {
  const v = verificarRestricoesDuras(entrada, linhas);
  const c: Record<string, number> = {};
  v.forEach((x) => (c[x.tipo] = (c[x.tipo] ?? 0) + 1));
  return { total: v.length, porTipo: c, amostra: v.slice(0, 5).map((x) => x.detalhe) };
}

