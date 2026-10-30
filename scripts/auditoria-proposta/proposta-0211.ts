/* eslint-disable @typescript-eslint/no-explicit-any */
// PROPOSTA 02/11/2026 — plano concreto com 12 pessoas (HARD), corte de demanda explícito, três objetivos. SOMBRA / OFFLINE: nada é gravado em PROD, nenhuma flag/semana ativada.
// Rodar: scratchpad/auditoria-1030/D9/ts.sh scripts/auditoria-proposta/proposta-0211.ts   (OUT=json MD=markdown CAND_DIR=dir dos candidatos; ETAPA=conector para o marco 1)
import * as fs from "node:fs";
import * as path from "node:path";
import * as D from "./dados";
import { ctxDe, validarNosNoMotor } from "./validador";
import { avaliarAlvos, otimizarAlvos, coberturaUniformeMaxima, objetivoDe, type AvaliacaoAlvos, type LimiteOperacaoBloco } from "@/features/escala/fluxo/propostaCorte";
import { validarPlanoCadeia, type ProdutoRev, type EntradaReverso } from "@/features/escala/fluxo/planoReverso";
import { reatribuirPessoasBloco } from "@/features/escala/estabilidade";
import { verificarRestricoesDuras } from "@/features/escala/fluxo/restricoes";
import { MOTIVO_DEMANDA_ESGOTADA, type AlocacaoEscala } from "@/features/escala/types";

const { n0, n1, soma, H, periodos, pessoas, recursos, entrada, slots, nomeP, nomeO, nomeM, porProduto, conv, aut, cx } = D;
const SCRATCH = "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/auditoria-1030/D9";
const NP = Math.max(...pessoas);
const money = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const money2 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const md: string[] = [];
const P = (s = "") => md.push(s);

// ===================================================================================================================
// ECONOMIA — fonte: preço = previsao_itens.valor_unitario (= produtos.valor_unitario, preço do SERVIÇO); custo/hora por operação = snapshot
// apontamentos_producao.custo_hora_operacao_vigente (mesmo valor que src/features/custo-hora/calculations.ts calcularCustoHoraEOperacoes); margem/peça =
// calcularMargemProduto/calcularIndicadoresProducao (custo = Σ etapas tempoPorPeça × custoHoraOperação; tempoPorPeça = Σ horas dos períodos com meta ÷ Σ metas).
// ===================================================================================================================
const custoOp: Record<string, number> = {};
{
  const t = fs.readFileSync(path.join(SCRATCH, "sql/custo_op.sql.out"), "utf8");
  JSON.parse(t.slice(t.indexOf("{"))).rows.forEach((r: any) => (custoOp[r.op] = Number(r.custo_h_medio)));
}
const CUSTO_HORA_EMPRESA = 31.922; // econ/calc.py (CH) — fallback quando a operação não tem custo próprio
const durH: Record<string, number> = {};
slots.filter((s) => s.data === slots[0].data).forEach((s) => (durH[s.periodoId] = (s.fimMin - s.inicioMin) / 60));
interface Econ { valor: number; custo: number; margem: number; margemPct: number; horasPorPeca: number; custoPorEtapa: { etapa: string; custo: number }[] }
const econ: Record<string, Econ> = {};
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
const pesosMargem = Object.fromEntries(Object.keys(econ).map((k) => [k, econ[k].margem]));
const pesosPecas = Object.fromEntries(Object.keys(econ).map((k) => [k, 1]));

// ===================================================================================================================
// base do reverso, blocos de revezamento, operações
// ===================================================================================================================
const idsProd = [...porProduto.keys()];
const pino = idsProd.find((i) => /^Pino/.test(nomeP(i)))!, plug = idsProd.find((i) => /^Plug/.test(nomeP(i)))!;
const poolPor = (pid: string, eid: string) => porProduto.get(pid)!.find((p) => p.etapaId === eid)!;
const opDe = (pid: string, eid: string) => poolPor(pid, eid).operacaoId;
const blocos: number[][] = [];
slots.forEach((s, i) => { const k = `${s.data}|${s.periodoId.startsWith("m") ? "m" : "t"}`; const ult = blocos[blocos.length - 1]; if (ult && `${slots[ult[0]].data}|${slots[ult[0]].periodoId.startsWith("m") ? "m" : "t"}` === k) ult.push(i); else blocos.push([i]); });
const limOp: LimiteOperacaoBloco = { blocos, operacaoDe: opDe, limite: NP };

const nomeCurto = (id: string) => nomeP(id).replace('Conector 3/4" - Maquina Automatica', "Conector 3/4 Automática").replace('Conector 3/4"', "Conector 3/4 Conv.");
const baseDe = (mundo: "meta" | "hist", wip: Record<string, number[]>, comPessoas = true): EntradaReverso => ({ periodos, recursos, produtos: D.produtosRev(mundo, wip), pessoas: comPessoas ? pessoas : pessoas.map(() => 99), extensaoPeriodos: D.EXT });
const demandaDe = (b: EntradaReverso) => Object.fromEntries(b.produtos.map((p) => [p.id, p.demandaFinal]));

// máximo de um produto SOZINHO (físico, sem limite de pessoas; e com 12 pessoas)
function maxSozinho(b0: EntradaReverso, pid: string, comPessoas: boolean) {
  const b = comPessoas ? b0 : { ...b0, pessoas: pessoas.map(() => 99) };
  const dem = demandaDe(b0)[pid];
  const alvo0 = Object.fromEntries(Object.keys(demandaDe(b0)).map((k) => [k, 0]));
  const op = { semAntecipacao: true, limiteOpBloco: comPessoas ? limOp : undefined };
  const topo = avaliarAlvos(b, { ...alvo0, [pid]: dem }, [pid, ...Object.keys(alvo0).filter((k) => k !== pid)], op);
  if (topo.viavel) return { q: dem, av: topo };
  let lo = 0, hi = dem, mel = avaliarAlvos(b, alvo0, [pid], op);
  for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; const t = avaliarAlvos(b, { ...alvo0, [pid]: mid }, [pid, ...Object.keys(alvo0).filter((x) => x !== pid)], op); if (t.viavel) { lo = mid; mel = t; } else hi = mid; }
  return { q: lo, av: mel };
}

// ===================================================================================================================
// PLANO CONCRETO: postos por período a partir do resultado do reverso
// ===================================================================================================================
interface Detalhe { produtoId: string; etapaId: string; pecas: number; uso: number }
interface Posto { t: number; maquinaId: string; produtoId: string; etapaId: string; operacaoId: string; pecas: number; uso: number; detalhes: Detalhe[] }
function montarPostos(av: AvaliacaoAlvos, prods: ProdutoRev[]): Posto[][] {
  const out: Posto[][] = Array.from({ length: H }, () => []);
  const mp = new Map<string, Posto>();
  av.res.produtos.forEach((rp) => {
    const prod = prods.find((p) => p.id === rp.produtoId) as ProdutoRev;
    rp.etapas.forEach((e) => {
      const et = prod.etapas.find((x) => x.id === e.etapaId) as ProdutoRev["etapas"][number];
      Object.entries(e.usoPorRecurso).forEach(([rid, v]) => v.forEach((u, t) => {
        if (u < 1e-6) return;
        const taxa = et.alternativas.find((a) => a.recursoId === rid)!.pecasPorPosto[t];
        const d: Detalhe = { produtoId: rp.produtoId, etapaId: e.etapaId, pecas: u * taxa, uso: u };
        const k = `${t}|${rid}`;
        const ex = mp.get(k);
        if (!ex) { const po = { t, maquinaId: rid, produtoId: d.produtoId, etapaId: d.etapaId, operacaoId: opDe(d.produtoId, d.etapaId), pecas: d.pecas, uso: d.uso, detalhes: [d] }; mp.set(k, po); out[t].push(po); }
        else { ex.detalhes.push(d); ex.pecas += d.pecas; ex.uso += d.uso; const dom = ex.detalhes.reduce((a, b) => (b.pecas > a.pecas ? b : a)); ex.produtoId = dom.produtoId; ex.etapaId = dom.etapaId; ex.operacaoId = opDe(dom.produtoId, dom.etapaId); }
      }));
    });
  });
  out.forEach((l) => l.sort((a, b) => (nomeM(a.maquinaId) < nomeM(b.maquinaId) ? -1 : 1)));
  return out;
}
const compartilhadasComOpDiferente = (pp: Posto[][]) => soma(pp.map((l) => l.filter((x) => new Set(x.detalhes.map((d) => opDe(d.produtoId, d.etapaId))).size > 1).length));

// arredonda e "fecha" a cadeia por construção: produção do destino nunca excede o estoque (peças inteiras, produção de Tn só em Tn+1)
function inteirizar(pp: Posto[][], prods: ProdutoRev[]): { perdidas: number } {
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
type PlanoPE = Record<string, Record<string, number[]>>; // produto -> etapa -> [t]
function planoDePostos(pp: Posto[][]): PlanoPE {
  const o: PlanoPE = {};
  pp.forEach((l, t) => l.forEach((x) => x.detalhes.forEach((d) => { ((o[d.produtoId] ??= {})[d.etapaId] ??= new Array(H).fill(0))[t] += d.pecas; })));
  return o;
}
function planoDeLinhas(ls: { data: string; periodoId: string; produtoId: string | null; etapaId: string | null; pecas: number; maquinaId: string | null }[]): PlanoPE {
  const o: PlanoPE = {};
  ls.forEach((a) => { if (!a.maquinaId || !a.produtoId || !a.etapaId) return; const t = slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)!.indice; ((o[a.produtoId] ??= {})[a.etapaId] ??= new Array(H).fill(0))[t] += Number(a.pecas); });
  return o;
}
interface ValCadeia { valida: boolean; violacoes: number; primeira: string | null; pecasFinais: Record<string, number>; faltaMaterialPecas: number; postosSemMaterial: number; periodosComSemMaterial: number }
function validarPlano(plano: PlanoPE, prods: ProdutoRev[]): ValCadeia {
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

// ===================================================================================================================
// PESSOAS: atribuição com revezamento de bloco + ponte M3→T1 (estabilidade.ts) e verificador independente (restricoes.ts)
// ===================================================================================================================
const equipe = entrada.funcionarios.map((f) => f.id);
const nomeFunc = (id: string) => (entrada.funcionarios.find((f) => f.id === id)?.nome ?? id.slice(0, 6));
function atribuirPessoas(pp: Posto[][]): { linhas: AlocacaoEscala[]; ok: boolean; motivo?: string; semPostoLinhas: number } {
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
function violacoes(linhas: AlocacaoEscala[]) {
  const v = verificarRestricoesDuras(entrada, linhas);
  const c: Record<string, number> = {};
  v.forEach((x) => (c[x.tipo] = (c[x.tipo] ?? 0) + 1));
  return { total: v.length, porTipo: c, amostra: v.slice(0, 5).map((x) => x.detalhe) };
}

// ===================================================================================================================
// ORQUESTRA UM CENÁRIO (objetivo × WIP × mundo)
// ===================================================================================================================
type Obj = "MAX_PECAS_FINAIS" | "MAX_RESULTADO_ECONOMICO" | "EQUILIBRIO";
interface Cenario {
  nome: string; obj: Obj; wipNome: string; mundo: "meta" | "hist"; av: AvaliacaoAlvos; prods: ProdutoRev[]; postos: Posto[][]; perdidas: number; compSharedOpDif: number;
  entregue: Record<string, number>; cadeia: ValCadeia; pessoasPlano: ReturnType<typeof atribuirPessoas>; viol: ReturnType<typeof violacoes>; totalPecas: number; receita: number; margem: number;
  pessoasPorPeriodo: number[]; piso?: Record<string, number>; cUniforme?: number; avaliacoes: number; semAntecipacao: boolean; ajustes: string[];
}
function rodar(obj: Obj, wipCen: D.CenWip, mundo: "meta" | "hist", opts: { teto?: Record<string, number>; piso?: Record<string, number>; pisoRel?: number; limiteOp?: number } = {}): Cenario {
  const prods0 = D.produtosRev(mundo, wipCen.wip);
  const base: EntradaReverso = { periodos, recursos, produtos: prods0, pessoas, extensaoPeriodos: D.EXT };
  const dem = demandaDe(base);
  const limite = opts.limiteOp ?? NP;
  const L: LimiteOperacaoBloco = { ...limOp, limite };
  const pesos = obj === "MAX_PECAS_FINAIS" ? pesosPecas : pesosMargem;
  let piso = opts.piso, cU: number | undefined;
  if (obj === "EQUILIBRIO") {
    const cu = coberturaUniformeMaxima(base, idsProd, { semAntecipacao: true, limiteOpBloco: L });
    cU = cu.c;
    const rel = opts.pisoRel ?? 0.9;
    piso = Object.fromEntries(idsProd.map((i) => [i, Math.min(dem[i], rel * cu.c * dem[i])]));
  }
  const ajustes: string[] = [];
  let r = otimizarAlvos({ base, pesos, piso, teto: opts.teto, grupos: [[aut, conv], [pino, plug]], opAval: { semAntecipacao: true, limiteOpBloco: L }, maxAval: 30000 });
  // final: com antecipação útil (pessoas que sobram) — se a atribuição de pessoas falhar, cai para o plano obrigatório puro; se ainda falhar, aperta o limite de operação por bloco
  let tentativa = 0, limiteAtual = limite;
  for (;;) {
    for (const semAnt of [false, true]) {
      const av = avaliarAlvos(base, r.melhor.alvo, r.melhor.ordem, { semAntecipacao: semAnt, limiteOpBloco: { ...limOp, limite: limiteAtual }, perfilFinal: undefined });
      if (!av.viavel) { ajustes.push(`${semAnt ? "sem" : "com"} antecipação: reavaliação inviável (déficit ${n1(av.deficitPessoas)})`); continue; }
      const pp = montarPostos(av, prods0);
      const maxPostos = Math.max(...pp.map((l) => l.length));
      if (maxPostos > NP) { ajustes.push(`${semAnt ? "plano obrigatório" : "com antecipação"}: ${maxPostos} postos simultâneos > ${NP} (descartado; a antecipação do reverso conta unidades, não pessoas)`); continue; }
      const comp = compartilhadasComOpDiferente(pp);
      const { perdidas } = inteirizar(pp, prods0);
      const pl = atribuirPessoas(pp);
      if (!pl.ok) { ajustes.push(`${semAnt ? "plano obrigatório" : "com antecipação"}: ${pl.motivo}`); continue; }
      const cad = validarPlano(planoDePostos(pp), prods0);
      const viol = violacoes(pl.linhas);
      const ent = cad.pecasFinais;
      const totalPecas = soma(Object.values(ent));
      const nome = `${obj}|${wipCen.nome}|${mundo}`;
      return {
        nome, obj, wipNome: wipCen.nome, mundo, av, prods: prods0, postos: pp, perdidas, compSharedOpDif: comp, entregue: ent, cadeia: cad, pessoasPlano: pl, viol, totalPecas,
        receita: soma(Object.entries(ent).map(([k, v]) => v * econ[k].valor)), margem: soma(Object.entries(ent).map(([k, v]) => v * econ[k].margem)), pessoasPorPeriodo: pp.map((l) => l.length),
        piso, cUniforme: cU, avaliacoes: r.avaliacoes, semAntecipacao: semAnt, ajustes,
      };
    }
    // aperta o limite de postos da mesma operação por bloco e reotimiza
    limiteAtual -= 1; tentativa++;
    ajustes.push(`limite de postos por operação/bloco reduzido para ${limiteAtual} (a atribuição de pessoas falhou)`);
    if (tentativa > 4) throw new Error(`sem plano executável para ${obj}|${wipCen.nome}|${mundo}: ${ajustes.join(" ; ")}`);
    r = otimizarAlvos({ base, pesos, piso, teto: opts.teto, grupos: [[aut, conv], [pino, plug]], opAval: { semAntecipacao: true, limiteOpBloco: { ...limOp, limite: limiteAtual } }, maxAval: 30000 });
  }
}

// ===================================================================================================================
// CONECTOR 3/4 — curva Convencional × Automática (Etiquetadora 15 UMA capacidade)
// ===================================================================================================================
interface PontoConector { A: number; C: number; part: number; pecas: number; receita: number; margem: number; ppEtiq: number; ppEmb: number; ppRos: number; ppPaf: number; ppM8: number; pico: number; deficit: number }
function curvaConector(wipCen: D.CenWip, mundo: "meta" | "hist", comPessoas: boolean): PontoConector[] {
  const prods = D.produtosRev(mundo, wipCen.wip).filter((p) => p.id === aut || p.id === conv);
  const b: EntradaReverso = { periodos, recursos, produtos: prods, pessoas: comPessoas ? pessoas : pessoas.map(() => 99), extensaoPeriodos: 0 };
  const op = { semAntecipacao: true, limiteOpBloco: comPessoas ? limOp : undefined };
  const dC = prods.find((p) => p.id === conv)!.demandaFinal, dA = prods.find((p) => p.id === aut)!.demandaFinal;
  const maxA = (() => { let lo = 0, hi = dA; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (avaliarAlvos(b, { [aut]: m, [conv]: 0 }, [aut, conv], op).viavel) lo = m; else hi = m; } return lo; })();
  const grade = [...new Set([0, ...Array.from({ length: 10 }, (_, i) => Math.round((maxA * (i + 1)) / 10 / 500) * 500), Math.floor(maxA)])].sort((x, y) => x - y);
  return grade.map((A) => {
    let lo = 0, hi = dC;
    if (avaliarAlvos(b, { [aut]: A, [conv]: dC }, [aut, conv], op).viavel) lo = dC; else for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (avaliarAlvos(b, { [aut]: A, [conv]: m }, [aut, conv], op).viavel) lo = m; else hi = m; }
    const av = avaliarAlvos(b, { [aut]: A, [conv]: lo }, [aut, conv], { ...op });
    const uso = (nome: string) => soma(recursos.filter((r) => r.rotulo.startsWith(nome)).map((r) => soma(av.res.usoPorRecurso[r.id]?.obrigatorio ?? [])));
    const pc = av.res.produtos.find((p) => p.produtoId === conv)!, pa = av.res.produtos.find((p) => p.produtoId === aut)!;
    const sp = (p: typeof pc, k: number) => soma(p.etapas[k].postosObrigatorios);
    return {
      A: pa.entregavel, C: pc.entregavel, part: pa.entregavel / Math.max(1, pa.entregavel + pc.entregavel), pecas: pa.entregavel + pc.entregavel, receita: pa.entregavel * econ[aut].valor + pc.entregavel * econ[conv].valor,
      margem: pa.entregavel * econ[aut].margem + pc.entregavel * econ[conv].margem, ppEtiq: uso("Etiquetadora 15"), ppEmb: uso("Embalagem 17"), ppRos: sp(pc, 0), ppPaf: sp(pc, 1), ppM8: sp(pa, 0), pico: av.picoPostos, deficit: av.deficitPessoas,
    };
  });
}
const tabelaCurva = (c: PontoConector[]) => {
  P(`| Autom. (pç) | Conv. (pç) | % Autom. | Σ peças finais | Receita R$ | Margem R$ | pp Etiq.15 | pp Emb.17 | pp Ros (conv) | pp Paf (conv) | pp M8 | Pessoas (pico) |`);
  P(`|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
  c.forEach((x) => P(`| ${n0(x.A)} | ${n0(x.C)} | ${n0(x.part * 100)}% | ${n0(x.pecas)} | ${money(x.receita)} | ${money(x.margem)} | ${n1(x.ppEtiq)} | ${n1(x.ppEmb)} | ${n1(x.ppRos)} | ${n1(x.ppPaf)} | ${n1(x.ppM8)} | ${x.pico} |`));
};
const melhorDe = (c: PontoConector[], f: (x: PontoConector) => number) => c.reduce((a, b) => (f(b) > f(a) + 1e-9 ? b : a));

// ===================================================================================================================
// PROGRAMAÇÃO DO CONECTOR 3/4 (por período) a partir de um cenário
// ===================================================================================================================
const RS = (nome: string) => recursos.filter((r) => r.rotulo.startsWith(nome)).map((r) => r.id);
function programacaoConector(c: Cenario) {
  const linhas: string[] = [];
  const rp = (pid: string) => c.av.res.produtos.find((p) => p.produtoId === pid)!;
  const pcv = rp(conv), pau = rp(aut);
  const maqsStr = (t: number, filtro: (m: string) => boolean) => {
    const xs = c.postos[t].filter((x) => filtro(x.maquinaId)).map((x) => `${nomeM(x.maquinaId).replace("Rosqueadeira ", "Ros ").replace("Parafusadeira ", "Paf ").replace("Maquina Automatica", "M8").replace("Etiquetadora ", "Etiq ").replace("Embalagem ", "Emb ")}:${n0(x.detalhes.filter((d) => d.produtoId === conv || d.produtoId === aut).reduce((a, d) => a + d.pecas, 0))}`);
    return xs.length ? xs.join(" · ") : "—";
  };
  const isM = (nome: string) => (m: string) => nomeM(m).startsWith(nome);
  linhas.push(`| Período | Rosquear (Ros 3/6) | Parafusar (Paf 9/10…) | Máquina 8 | Etiquetadora 15 | Embalagem 17 | WIP Ros→Paf | WIP Paf→Etiq | WIP M8→Etiq | WIP Etiq→Emb (conv / autom) |`);
  linhas.push(`|---|---|---|---|---|---|---:|---:|---:|---|`);
  for (let t = 0; t < H; t++) {
    linhas.push(`| ${periodos[t].rotulo} | ${maqsStr(t, (m) => /^Rosqueadeira/.test(nomeM(m)) && c.postos[t].some((x) => x.maquinaId === m && x.detalhes.some((d) => d.produtoId === conv)))} | ${maqsStr(t, (m) => /^Parafusadeira (9|1[0-2])\b/.test(nomeM(m)))} | ${maqsStr(t, isM("Maquina Automatica"))} | ${maqsStr(t, isM("Etiquetadora 15"))} | ${maqsStr(t, isM("Embalagem 17"))} | ${n0(pcv.ligacoes[0].wipProjetado[t])} | ${n0(pcv.ligacoes[1].wipProjetado[t])} | ${n0(pau.ligacoes[0].wipProjetado[t])} | ${n0(pcv.ligacoes[2].wipProjetado[t])} / ${n0(pau.ligacoes[1].wipProjetado[t])} |`);
  }
  linhas.push(`| WIP de saída p/ 09/11 | | | | | | ${n0(pcv.ligacoes[0].wipProjetado[H])} | ${n0(pcv.ligacoes[1].wipProjetado[H])} | ${n0(pau.ligacoes[0].wipProjetado[H])} | ${n0(pcv.ligacoes[2].wipProjetado[H])} / ${n0(pau.ligacoes[1].wipProjetado[H])} |`);
  return linhas;
}

// ===================================================================================================================
// EXECUÇÃO
// ===================================================================================================================
const wipB = D.cenarios.find((c) => c.nome === "B")!, wipA = D.cenarios.find((c) => c.nome === "A")!, wipC = D.cenarios.find((c) => c.nome === "C")!;
const WIPP = D.PRINCIPAL;
const out: any = { gerado: "offline/sombra", semana: "2026-11-02", principal: WIPP.nome };
const etapaSo = process.env.ETAPA ?? "tudo";

P(`# PROPOSTA 02/11/2026 — plano concreto com 12 pessoas (SOMBRA / OFFLINE)`);
P();
P(`Gerado em ${new Date().toISOString()} · PROD só SELECT · nada publicado · semana 02/11 NÃO ativada (producao_real_semanas_ativas = ["2026-10-26"]) · cenário de WIP principal: **${WIPP.nome}** (${WIPP.rotulo}).`);
P();

// -------- economia --------
P(`## 0. Fonte do valor, custo e margem (nada inventado)`);
P(`- **Valor unitário**: \`previsao_itens.valor_unitario\` da Previsão 02/11 (= \`produtos.valor_unitario\`, preço do SERVIÇO; igual nas duas tabelas hoje).`);
P(`- **Custo/hora por operação**: snapshot \`apontamentos_producao.custo_hora_operacao_vigente\` (média 19–30/10; mesmo número de \`calcularCustoHoraEOperacoes\` em src/features/custo-hora/calculations.ts: salário+encargos do grupo + rateio de fixos ÷ horas). Todas as operações ficam entre R$ ${n1(Math.min(...Object.values(custoOp)))} e R$ ${n1(Math.max(...Object.values(custoOp)))}/h (diferença < 1%).`);
P(`- **Margem/peça** = valor − Σ_etapas (tempo por peça × custo/hora da operação), com tempo por peça = Σ horas dos períodos com meta ÷ Σ metas (exatamente \`calcularIndicadoresProducao\`/\`calcularMargemProduto\`). A Máquina 8 usa UMA etapa "Rosquear + Parafusar" (uma pessoa, um custo/hora) — o benefício de fazer duas operações com uma pessoa aparece UMA vez, no menor custo/peça e nos menos postos-período; nenhum bônus é somado por fora.`);
P(`- **Resultado econômico do plano** = Σ_produto peças finais entregues × margem/peça (custo pleno do app). Com 12 pessoas fixas o custo de MO é fixo na semana: a ordenação que importa é R$/posto-período (valor × peças por posto), que é o que o otimizador maximiza sob o limite de pessoas.`);
P(`- **Incertezas**: custo/hora é snapshot de out/2026 (não inclui matéria-prima, que é do cliente); a meta (não a produtividade histórica) define o tempo/peça da margem; não há custo variável por peça no cadastro (energia/consumíveis estão em variable_entries, sem rateio por produto) — não foi inventado.`);
P();
P(`| Produto | Valor unit. R$ | Custo/peça R$ | Margem/peça R$ | Margem % | Horas-posto/peça | R$ margem por posto-hora |`);
P(`|---|---:|---:|---:|---:|---:|---:|`);
idsProd.forEach((i) => P(`| ${nomeCurto(i)} | ${econ[i].valor.toFixed(4)} | ${econ[i].custo.toFixed(4)} | ${econ[i].margem.toFixed(4)} | ${n1(econ[i].margemPct)}% | ${(econ[i].horasPorPeca * 1000).toFixed(2)}/mil | ${n1(econ[i].margem / econ[i].horasPorPeca)} |`));
P();

// -------- conector (marco 1) --------
P(`## 1. Conector 3/4 — Convencional × Máquina 8 (Etiquetadora 15 e Embalagem 17: UMA capacidade, entradas somadas)`);
P(`Para cada quantidade de Automática (A), a maior Convencional (C) fisicamente possível (cadeia fecha, lote de 1 período, WIP ${WIPP.nome}). Duas curvas: **física** (sem limite de pessoas) e **com 12 pessoas só para o Conector** (teto ${NP} postos/período e ${NP} postos da mesma operação por bloco).`);
const curvas: any = {};
for (const mundo of ["meta", "hist"] as const) {
  const cf = curvaConector(WIPP, mundo, false), c12 = curvaConector(WIPP, mundo, true);
  curvas[`${mundo}|fisico`] = cf; curvas[`${mundo}|12p`] = c12;
  const igual = JSON.stringify(cf.map((x) => [x.A, x.C])) === JSON.stringify(c12.map((x) => [x.A, x.C]));
  P(`\n**${mundo === "meta" ? "META" : "HISTÓRICA"} · capacidade física${igual ? ` (idêntica com limite de ${NP} pessoas: o Conector sozinho precisa de no máximo ${Math.max(...cf.map((x) => x.pico))} pessoas por período — a disputa por pessoas é com os outros 4 produtos, ver seção 2/3)` : ""}**`);
  tabelaCurva(cf);
  if (!igual) { P(`\n**${mundo === "meta" ? "META" : "HISTÓRICA"} · limitado a ${NP} pessoas**`); tabelaCurva(c12); }
  const bP = melhorDe(cf, (x) => x.pecas), bR = melhorDe(cf, (x) => x.margem);
  const cheio = cf.filter((x) => x.ppEtiq >= 0.99 * Math.max(...cf.map((y) => y.ppEtiq)));
  const faixaP = cf.filter((x) => x.pecas >= 0.999 * bP.pecas);
  const mpp = (pid: string) => {
    const pr = D.produtosRev(mundo, WIPP.wip).find((p) => p.id === pid)!;
    const et = pr.etapas.find((e) => e.alternativas.some((al) => /^Etiquetadora 15/.test(nomeM(al.recursoId))))!;
    const al = et.alternativas.find((x) => /^Etiquetadora 15/.test(nomeM(x.recursoId)))!;
    return econ[pid].margem * (soma(al.pecasPorPosto) / al.pecasPorPosto.length);
  };
  P(`Ótimo por critério (${mundo}): **peças** → qualquer A entre ${n0(faixaP[0].A)} e ${n0(faixaP[faixaP.length - 1].A)} (platô de ${n0(bP.pecas)} pç: a Etiquetadora 15 satura em ${n1(bP.ppEtiq)} de 24 postos-período; depois dela cada peça de Automática desloca uma de Convencional) · **R$ margem** → A=${n0(bR.A)} / C=${n0(bR.C)} (${n0(bR.part * 100)}% Autom., M8 no limite: ${n1(bR.ppM8)} de 24 postos-período) · **R$ de margem por posto-período da Etiquetadora 15 (peça final × produtividade média da Etiquetadora 15)**: Convencional ${n0(mpp(conv))} R$ vs Automática ${n0(mpp(aut))} R$ ⇒ a Automática vale mais por slot da Etiquetadora e usa menos pessoas (uma pessoa na M8 faz Rosquear+Parafusar).`);
  void cheio;
}
out.curvasConector = curvas;
fs.writeFileSync(path.join(SCRATCH, "conector-curva.json"), JSON.stringify(curvas, null, 1));
if (etapaSo === "conector") { fs.writeFileSync(process.env.MD ?? "/dev/stdout", md.join("\n") + "\n"); process.exit(0); }

// -------- cenários --------
const OBJS: Obj[] = ["MAX_PECAS_FINAIS", "MAX_RESULTADO_ECONOMICO", "EQUILIBRIO"];
const principais: Record<Obj, Cenario> = {} as any;
const t0 = Date.now();
for (const o of OBJS) { principais[o] = rodar(o, WIPP, "meta"); console.error(`[${o}] ${Math.round((Date.now() - t0) / 1000)}s pecas=${n0(principais[o].totalPecas)} margem=${n0(principais[o].margem)} viol=${principais[o].viol.total} cadeia=${principais[o].cadeia.violacoes}`); }
const sens: Cenario[] = [];
for (const [w, m] of [[wipA, "meta"], [wipC, "meta"], [WIPP, "hist"]] as [D.CenWip, "meta" | "hist"][]) {
  if (w.nome === WIPP.nome && m === "meta") continue;
  for (const o of ["MAX_PECAS_FINAIS", "MAX_RESULTADO_ECONOMICO"] as Obj[]) { try { sens.push(rodar(o, w, m)); console.error(`[sens ${o}|${w.nome}|${m}] ok`); } catch (e: any) { console.error("sens falhou", e.message.slice(0, 120)); } }
}
if (WIPP.nome !== "B") for (const o of ["MAX_RESULTADO_ECONOMICO"] as Obj[]) sens.push(rodar(o, wipB, "meta"));
// Conector com divisão forçada (impacto no plano inteiro)
const forcado: { A: number; c: Cenario }[] = [];
for (const A of [0, 8000, 16000, 25000]) { try { forcado.push({ A, c: rodar("MAX_RESULTADO_ECONOMICO", WIPP, "meta", { teto: { [aut]: A }, piso: { [aut]: A } }) }); } catch (e: any) { console.error("forçado falhou", A, e.message.slice(0, 100)); } }

// -------- recomendado --------
const recomendado = principais.MAX_RESULTADO_ECONOMICO;
const recObj: Obj = "MAX_RESULTADO_ECONOMICO";

// ===== comparação com o legado real (288 linhas de PROD) =====
const legRows: any[] = (() => { const t = fs.readFileSync(path.join(SCRATCH, "sql/aloc_0211.sql.out"), "utf8"); return JSON.parse(t.slice(t.indexOf("{"))).rows; })();
const legLin: AlocacaoEscala[] = legRows.map((a) => ({ data: a.data, periodoId: a.periodo_id, funcionarioId: a.funcionario_id, maquinaId: a.maquina_id, produtoId: a.produto_id, etapaId: a.etapa_id, operacaoId: a.operacao_id, pecas: Number(a.pecas), pecasAdicional: Number(a.pecas_adicional), motivoSemPosto: a.motivo_sem_posto, excecaoRevezamento: !!a.excecao_revezamento, motivoExcecao: a.motivo_excecao, origem: a.origem === "manual" ? "manual" : "auto" }));
const prodsPrincipal = D.produtosRev("meta", WIPP.wip);
const legVal = validarPlano(planoDeLinhas(legLin), prodsPrincipal);
const legViol = violacoes(legLin);
const legPostos: Posto[][] = Array.from({ length: H }, () => []);
legLin.forEach((a) => { if (!a.maquinaId) return; const t = slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)!.indice; legPostos[t].push({ t, maquinaId: a.maquinaId, produtoId: a.produtoId!, etapaId: a.etapaId!, operacaoId: a.operacaoId!, pecas: a.pecas, uso: 1, detalhes: [{ produtoId: a.produtoId!, etapaId: a.etapaId!, pecas: a.pecas, uso: 1 }] }); });
let legEngine: any = null;
try { const ctx = ctxDe(WIPP); legEngine = validarNosNoMotor(ctx, "legado real 15:40 (288 linhas)", "meta", WIPP, legLin).m; } catch (e: any) { legEngine = { erro: e.message }; }
const candLin = recomendado.pessoasPlano.linhas;

// ===== candidatos (JSON no formato do backup) =====
const CAND_DIR = process.env.CAND_DIR ?? SCRATCH;
function paraJson(linhas: AlocacaoEscala[]) {
  return linhas.map((a) => ({ data: a.data, periodo_id: a.periodoId, funcionario_id: a.funcionarioId, maquina_id: a.maquinaId, produto_id: a.produtoId, etapa_id: a.etapaId, operacao_id: a.operacaoId, pecas: String(Math.round(a.pecas)), pecas_adicional: "0", tipo_adicional: null, origem: "auto", excecao_revezamento: false, motivo_excecao: null, motivo_sem_posto: a.motivoSemPosto }));
}
Object.values(principais).forEach((c) => fs.writeFileSync(path.join(CAND_DIR, `candidato-${c.obj}.json`), JSON.stringify({ alocacoes: paraJson(c.pessoasPlano.linhas), resumo: { origem: "proposta_0211", objetivo: c.obj, wip: c.wipNome, mundo: c.mundo } }, null, 1)));

// ===================================================================================================================
// RELATÓRIO
// ===================================================================================================================
const cenAnalise = (c: Cenario) => {
  const dem = demandaDe(baseDe("meta", WIPP.wip));
  return idsProd.map((i) => ({ id: i, dem: dem[i], prog: c.entregue[i] ?? 0, corte: Math.max(0, dem[i] - (c.entregue[i] ?? 0)) }));
};
const solo: Record<string, { fis: number; p12: number; garg: string | null }> = {};
{
  const b = baseDe("meta", WIPP.wip);
  for (const i of idsProd) {
    const f = maxSozinho(b, i, false), p = maxSozinho(b, i, true);
    const rp = f.av.res.produtos.find((x) => x.produtoId === i)!;
    solo[i] = { fis: f.q, p12: p.q, garg: rp.etapas.find((e) => e.etapaId === rp.gargaloEtapaId)?.rotulo ?? null };
  }
}
const motivo = (c: Cenario, i: string) => {
  const a = cenAnalise(c).find((x) => x.id === i)!;
  if (a.corte < 0.005 * a.dem) return "atendido";
  const s = solo[i];
  const sh = i === conv || i === aut ? "Etiquetadora 15/Embalagem 17 (capacidade única compartilhada)" : i === pino || i === plug ? "Parafusadeira Pino 2 (compartilhada)" : "";
  if (s.fis < a.dem * 0.995) return `capacidade física: sozinho só entrega ${n0(s.fis)} (gargalo ${s.garg ?? "—"}${sh ? `; ${sh}` : ""})`;
  if (s.p12 < a.dem * 0.995) return `headcount: sozinho já exigiria mais que 12 pessoas/bloco (máx. ${n0(s.p12)})${sh ? `; ${sh}` : ""}`;
  return `competição por pessoas/recursos: sozinho caberia (${n0(s.p12)}), mas rende menos por posto-período que os produtos priorizados (objetivo ${c.obj})`;
};

P(`\n## 2. Resumo dos três objetivos (WIP ${WIPP.nome}, produtividade META, 12 pessoas HARD)`);
P(`Critérios: (1) MAX_PECAS_FINAIS = maximiza Σ peças finais; (2) MAX_RESULTADO_ECONOMICO = maximiza Σ peças × margem/peça (seção 0); (3) EQUILIBRIO = maximiza o resultado econômico com PISO de cobertura por produto = **90% da maior cobertura UNIFORME viável** (c_u; max-min), parâmetro explícito \`pisoRel=0.90\`.`);
P(`| Objetivo | Σ peças finais | Receita R$ | Margem R$ | Cobertura da demanda (peças) | Cadeia | Violações duras | Pico de pessoas | Antecipação útil | Avaliações |`);
P(`|---|---:|---:|---:|---:|---|---:|---:|---|---:|`);
const demTot = soma(idsProd.map((i) => demandaDe(baseDe("meta", WIPP.wip))[i]));
OBJS.forEach((o) => { const c = principais[o]; P(`| ${o} | ${n0(c.totalPecas)} | ${money(c.receita)} | ${money(c.margem)} | ${n1((100 * c.totalPecas) / demTot)}% | ${c.cadeia.valida ? "VÁLIDA (0 viol.)" : `INVÁLIDA (${c.cadeia.violacoes})`} | ${c.viol.total} | ${Math.max(...c.pessoasPorPeriodo)} | ${c.semAntecipacao ? "não" : "sim"} | ${c.avaliacoes} |`); });
P(`\nc_u (cobertura uniforme máxima) = ${n1((principais.EQUILIBRIO.cUniforme ?? 0) * 100)}% · piso por produto no EQUILIBRIO: ${idsProd.map((i) => `${nomeCurto(i)} ${n0(principais.EQUILIBRIO.piso?.[i] ?? 0)}`).join(" · ")}`);

for (const o of OBJS) {
  const c = principais[o];
  P(`\n### 2.${OBJS.indexOf(o) + 1} ${o}${o === recObj ? " — RECOMENDADO" : ""}`);
  P(`**Corte de demanda explícito**`);
  P(`| Produto | Demanda solicitada | Quantidade programada | Quantidade cortada | % cortado | Motivo |`);
  P(`|---|---:|---:|---:|---:|---|`);
  cenAnalise(c).forEach((a) => P(`| ${nomeCurto(a.id)} | ${n0(a.dem)} | ${n0(a.prog)} | ${n0(a.corte)} | ${n1((100 * a.corte) / a.dem)}% | ${motivo(c, a.id)} |`));
  P(`| **Total** | ${n0(demTot)} | ${n0(c.totalPecas)} | ${n0(demTot - c.totalPecas)} | ${n1((100 * (demTot - c.totalPecas)) / demTot)}% | |`);
  P(`\nR$ por produto (receita / margem): ${idsProd.map((i) => `${nomeCurto(i)} ${money((c.entregue[i] ?? 0) * econ[i].valor)} / ${money((c.entregue[i] ?? 0) * econ[i].margem)}`).join(" · ")}`);
  P(`Peças perdidas por inteirização/fechamento de cadeia: ${n0(c.perdidas)} · linhas de máquina compartilhada com operações diferentes no mesmo período: ${c.compSharedOpDif} · ajustes: ${c.ajustes.join(" | ") || "nenhum"}.`);
  P(`WIP de saída p/ 09/11 (por ligação): ${c.av.res.produtos.map((p) => `${nomeCurto(p.produtoId)} ${p.ligacoes.map((l) => n0(l.wipProjetado[H])).join("/") || "—"}`).join(" · ")}.`);
  P(`\n**Plano por período** (máquina ligada → produto · operação · peças previstas; pessoas = nº de postos):`);
  P(`| Período | Pessoas | Postos ativos (máquina: produto · operação · peças) |`);
  P(`|---|---:|---|`);
  c.postos.forEach((l, t) => P(`| ${periodos[t].rotulo} | ${l.length} | ${l.map((x) => `${nomeM(x.maquinaId)}: ${nomeCurto(x.produtoId)} · ${nomeO(x.operacaoId)} · ${n0(x.pecas)}`).join(" ; ")} |`));
}

// ---- Conector programação ----
P(`\n## 3. Conector 3/4 — programação por período (cenário recomendado ${recObj}, WIP ${WIPP.nome})`);
programacaoConector(recomendado).forEach((l) => P(l));
P(`\nPeças finais: Conv. ${n0(recomendado.entregue[conv])} de ${n0(demandaDe(baseDe("meta", WIPP.wip))[conv])} · Autom. ${n0(recomendado.entregue[aut])} de ${n0(demandaDe(baseDe("meta", WIPP.wip))[aut])}.`);
P(`\n**Máquina 8 — convencional × híbrido × máximo-Máquina 8 dentro do plano de 12 pessoas** (MAX_RESULTADO, divisão da Automática forçada):`);
P(`| Automática forçada | Conv. | Autom. | Σ peças | Margem R$ plano inteiro | Postos Etiq.15 | Pico pessoas |`);
P(`|---:|---:|---:|---:|---:|---:|---:|`);
forcado.forEach(({ A, c }) => P(`| ${n0(A)} (${A === 0 ? "só convencional" : A >= 25000 ? "máximo M8" : "híbrido"}) | ${n0(c.entregue[conv])} | ${n0(c.entregue[aut])} | ${n0(c.totalPecas)} | ${money(c.margem)} | ${n1(soma(RS("Etiquetadora 15").map((r) => soma(c.av.res.usoPorRecurso[r]?.obrigatorio ?? []))))} | ${Math.max(...c.pessoasPorPeriodo)} |`));

// ---- pessoas ----
const pp = recomendado.pessoasPlano.linhas;
P(`\n## 4. Plano pessoa → posto do cenário recomendado (${recObj}) — revezamento de bloco + ponte M3→T1 (reatribuirPessoasBloco)`);
const ordem = equipe.slice();
P(`| Período | ${ordem.map(nomeFunc).join(" | ")} |`);
P(`|---|${ordem.map(() => "---").join("|")}|`);
slots.forEach((s, t) => P(`| ${periodos[t].rotulo} | ${ordem.map((fid) => { const a = pp.find((x) => x.data === s.data && x.periodoId === s.periodoId && x.funcionarioId === fid); return a?.maquinaId ? `${nomeM(a.maquinaId).replace("Maquina Automatica", "M8")} (${nomeO(a.operacaoId!)})` : "sem posto"; }).join(" | ")} |`));
P(`\nVerificação independente (fluxo/restricoes.ts, revezamento duro + bloco${entrada.revezamentoPonteM3T1 ? " + ponte M3→T1" : ""}): **${recomendado.viol.total} violações** ${JSON.stringify(recomendado.viol.porTipo)}. Linhas sem posto: ${recomendado.pessoasPlano.semPostoLinhas} de ${pp.length}.`);

// ---- teste final ----
const foraPrevisao = pp.filter((a) => a.maquinaId && !entrada.pools.some((p) => p.produtoId === a.produtoId && p.etapaId === a.etapaId && p.maquinasIds.includes(a.maquinaId!))).length;
const dup = (() => { const k = new Map<string, number>(); pp.forEach((a) => k.set(`${a.data}|${a.periodoId}|${a.funcionarioId}`, (k.get(`${a.data}|${a.periodoId}|${a.funcionarioId}`) ?? 0) + 1)); return [...k.values()].filter((v) => v > 1).length; })();
const blocoV = recomendado.viol.porTipo["revezamento"] ?? 0;
P(`\n## 5. TESTE FINAL do recomendado`);
P(`| Teste | Resultado |`); P(`|---|---|`);
P(`| Máquinas fora da Previsão/roteiro | ${foraPrevisao} |`);
P(`| Pessoa duplicada no período | ${dup} (+ \`pessoa_em_dois_postos\`/\`duas_pessoas_no_posto\` do verificador: ${(recomendado.viol.porTipo["pessoa_em_dois_postos"] ?? 0) + (recomendado.viol.porTipo["duas_pessoas_no_posto"] ?? 0)}) |`);
P(`| Violações de revezamento (bloco + ponte M3→T1) | ${blocoV} |`);
P(`| CADEIA_INVALIDA (validarCadeia, por produto, lote 1 período) | ${recomendado.cadeia.violacoes} |`);
P(`| Pessoas simultâneas ≤ 12 | máx. ${Math.max(...recomendado.pessoasPorPeriodo)} postos por período |`);
P(`| Posto com material faltando (peças / postos-período) | ${n0(recomendado.cadeia.faltaMaterialPecas)} / ${n1(recomendado.cadeia.postosSemMaterial)} |`);
P(`| Demanda final limitada à capacidade real | programado ≤ máximo físico por produto: ${idsProd.every((i) => (recomendado.entregue[i] ?? 0) <= solo[i].fis + 1) ? "sim" : "NÃO"} |`);
P(`| Todas as violações duras (restricoes.ts) | ${recomendado.viol.total} ${recomendado.viol.amostra.join(" | ")} |`);

// ---- legado × novo ----
P(`\n## 6. Comparação direta com o LEGADO real (288 linhas, hash oficial 828baf25fc29ae34c00ff35b5ff4e588)`);
P(`Mesma régua para os dois (validação de cadeia por produto, lote de 1 período, WIP ${WIPP.nome}, sobre as linhas/peças de cada plano).`);
P(`| Métrica | LEGADO | NOVO (${recObj}) |`); P(`|---|---:|---:|`);
const legFin = soma(Object.values(legVal.pecasFinais));
P(`| Postos ativos (Σ períodos) | ${soma(legPostos.map((l) => l.length))} | ${soma(recomendado.postos.map((l) => l.length))} |`);
P(`| Peças finais efetivas | ${n0(legFin)} | ${n0(recomendado.totalPecas)} |`);
P(`| Receita R$ | ${money(soma(Object.entries(legVal.pecasFinais).map(([k, v]) => v * econ[k].valor)))} | ${money(recomendado.receita)} |`);
P(`| Margem R$ | ${money(soma(Object.entries(legVal.pecasFinais).map(([k, v]) => v * econ[k].margem)))} | ${money(recomendado.margem)} |`);
P(`| Cadeia | ${legVal.valida ? "VÁLIDA" : `CADEIA_INVALIDA (${legVal.violacoes} viol.)`} | ${recomendado.cadeia.valida ? "VÁLIDA (0)" : `INVÁLIDA (${recomendado.cadeia.violacoes})`} |`);
P(`| 1ª falta de material | ${legVal.primeira ?? "—"} | ${recomendado.cadeia.primeira ?? "—"} |`);
P(`| Peças planejadas sem material | ${n0(legVal.faltaMaterialPecas)} | ${n0(recomendado.cadeia.faltaMaterialPecas)} |`);
P(`| Postos-período sem material | ${n1(legVal.postosSemMaterial)} | ${n1(recomendado.cadeia.postosSemMaterial)} |`);
P(`| Períodos com posto sem material | ${legVal.periodosComSemMaterial} | ${recomendado.cadeia.periodosComSemMaterial} |`);
P(`| Violações duras (restricoes.ts) | ${legViol.total} ${JSON.stringify(legViol.porTipo)} | ${recomendado.viol.total} |`);
P(`| Validador do motor (grafo fundido), legado | ${legEngine?.erro ? "erro: " + legEngine.erro : `${legEngine.violacoes} viol.; peças finais ${n0(legEngine.pecasFinais)}; falta ${n0(legEngine.faltaMaterialPecas)}; 1ª: ${legEngine.primeiraFalta}`} | — |`);
P(`\nPeças finais por produto: ${idsProd.map((i) => `${nomeCurto(i)} legado ${n0(legVal.pecasFinais[i] ?? 0)} → novo ${n0(recomendado.entregue[i] ?? 0)}`).join(" · ")}.`);
P(`\n**Diferença por período** (postos do legado × novo; o que saiu, o que entrou). Chave do posto = máquina→produto·operação.`);
P(`| Período | Legado | Novo | Saiu | Entrou |`); P(`|---|---:|---:|---|---|`);
const chaveP = (x: Posto) => `${nomeM(x.maquinaId)}→${nomeCurto(x.produtoId)}·${nomeO(x.operacaoId)}`;
for (let t = 0; t < H; t++) {
  const L = new Set(legPostos[t].map(chaveP)), N = new Set(recomendado.postos[t].map(chaveP));
  P(`| ${periodos[t].rotulo} | ${L.size} | ${N.size} | ${[...L].filter((k) => !N.has(k)).join("; ") || "—"} | ${[...N].filter((k) => !L.has(k)).join("; ") || "—"} |`);
}
P(`\nPor quê: o legado liga postos de etapas downstream (Etiquetar/Embalar, Montar Presilha…) sem o upstream que os abastece (lote de 1 período) e distribui as 12 pessoas sem reservar Rosquear/Parafusar/M8 nos períodos certos; o plano novo reserva o upstream mínimo antes e só então preenche o resto, cortando os produtos de menor valor por posto-período.`);

// ---- sensibilidade ----
P(`\n## 7. Sensibilidade (WIP A/B/C e produtividade META × HISTÓRICA)`);
P(`| Objetivo | WIP | Produtividade | Σ peças | Margem R$ | Cadeia | Violações duras | Conv. | Autom. | Caixa | Pino | Plug |`); P(`|---|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|`);
[...Object.values(principais), ...sens].forEach((c) => P(`| ${c.obj} | ${c.wipNome} | ${c.mundo} | ${n0(c.totalPecas)} | ${money(c.margem)} | ${c.cadeia.valida ? "0 viol." : c.cadeia.violacoes} | ${c.viol.total} | ${n0(c.entregue[conv])} | ${n0(c.entregue[aut])} | ${n0(c.entregue[cx])} | ${n0(c.entregue[pino])} | ${n0(c.entregue[plug])} |`));
P(`\nObservação: o simulador de cadeia é OTIMISTA (sem refugo/parada, produtividade = meta ou histórico por posto, WIP inicial estimado); o WIP B é estimado (D, a contagem física final do dia, ainda não existe: \`D7/wip-D.json\`); meta × histórica podem divergir de sinal por produto (ver seção 1: curvas meta e histórica).`);

// ---- hash ----
const crypto = require("node:crypto") as typeof import("node:crypto");
const hashOficial = (js: any[]) => crypto.createHash("md5").update([...js].sort((a, b) => (a.data + a.periodo_id + a.funcionario_id < b.data + b.periodo_id + b.funcionario_id ? -1 : 1)).map((a) => a.data + a.periodo_id + a.funcionario_id + (a.maquina_id ?? "") + (a.produto_id ?? "") + (a.etapa_id ?? "") + (a.operacao_id ?? "") + (a.pecas ?? "") + (a.pecas_adicional ?? "") + (a.origem ?? "")).join(",")).digest("hex");
P(`\n## 8. Hashes (fórmula D8/sql/01-hash-plano.sql: md5 sobre data‖periodo‖funcionario‖maquina‖produto‖etapa‖operacao‖pecas‖pecas_adicional‖origem, ordenado por data, periodo, funcionario)`);
P(`- legado real (conferência): \`${hashOficial(legRows.map((a) => ({ data: a.data, periodo_id: a.periodo_id, funcionario_id: a.funcionario_id, maquina_id: a.maquina_id, produto_id: a.produto_id, etapa_id: a.etapa_id, operacao_id: a.operacao_id, pecas: String(a.pecas), pecas_adicional: String(a.pecas_adicional), origem: a.origem })))}\``);
Object.values(principais).forEach((c) => P(`- candidato ${c.obj}: \`${hashOficial(paraJson(c.pessoasPlano.linhas))}\` (${c.pessoasPlano.linhas.length} linhas) → \`${CAND_DIR}/candidato-${c.obj}.json\``));
P(`\nPublicação e rollback (NÃO executados): ver \`${SCRATCH}/procedimento-publicacao.md\` (RPC \`escala_aplicar_recalculo\`, template \`publicar-candidato-0211.template.sql\` via \`gerar-publicar-candidato-0211.py\`, \`restaurar-legado-0211.guardado.sql\`, \`rollback-compensacao-versoes.template.sql\`).`);

out.principais = Object.fromEntries(Object.entries(principais).map(([k, c]) => [k, { totalPecas: c.totalPecas, margem: c.margem, receita: c.receita, entregue: c.entregue, viol: c.viol, cadeia: c.cadeia, pessoasPorPeriodo: c.pessoasPorPeriodo, ajustes: c.ajustes }]));
out.legado = { val: legVal, viol: legViol, engine: legEngine };
out.econ = econ;
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
fs.writeFileSync(process.env.MD ?? "/dev/stdout", md.join("\n") + "\n");
