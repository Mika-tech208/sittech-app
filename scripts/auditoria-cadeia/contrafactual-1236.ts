/* eslint-disable @typescript-eslint/no-explicit-any */
// CONTRAFACTUAL A–F + SENSIBILIDADE AO WIP, no estado REAL de 30/10 12:36:08 (OFFLINE; dados do cache de SELECTs em PROD). Mesmo motor, mesmo estado; só muda a(s) flag(s) da cadeia.
//  A = plano vigente das 08:59 (avaliado no estado das 12:36) · B = plano que o motor de PROD fez às 12:36 (flags desligadas) · C = B + só diagnóstico · D = B + novo Allowed
//  E = D + valor de estoque de saída (penalidade de cadeia na tupla J) · F = E + reparo (candidatos reparados + realocação). Extras: S = só saída · R = só reparo.
import * as fs from "node:fs";
import { abrir, estadoEm, versaoEm, receita, NOVAS } from "../auditoria-buffer/comum";
import { avaliarPlano, planejarComFluxo, verificarRestricoesDuras } from "@/features/escala/fluxo";
import { simularCadeia } from "@/features/escala/fluxo/cadeia";
import { ociosasEvitaveis } from "@/features/escala/fluxo/cadeiaReparo";
import { prepararFluxo } from "@/features/escala/fluxo/estado";
import type { AlocacaoEscala } from "@/features/escala/types";
import type { ContagemFisicaPar, OpcoesFluxo } from "@/features/escala/fluxo";

const A_ = abrir();
const { slots, ix, nome } = A_;
const AGORA = Date.parse("2026-10-30T12:36:08-03:00");
const vigente = versaoEm("2026-10-30T12:36:08-03:00");
const ORIG_PE = "78aaa207-b8cc-412a-8a8b-d17bd95a1930"; // Parafusar→Etiquetar
const ORIG_RP = "ca90456c-9077-40f4-a058-bd0f467e87ec"; // Rosquear→Parafusar
const grupo = (m: string) => (/Rosqueadeira/.test(m) ? "Ros" : /Parafusadeira (9|10|12)$/.test(m) ? "Paf" : /Automatica 8/.test(m) ? "M8" : /Etiquetadora 15/.test(m) ? "Etq" : /Embalagem 17$/.test(m) ? "Emb" : "");

type Flags = NonNullable<OpcoesFluxo["cadeia"]>;
function estadoCom(over?: { pe?: number; rp?: number }) {
  const E = estadoEm(A_, AGORA, vigente, { mesmoPeriodo: false, ponte: true });
  if (over) {
    const lista: ContagemFisicaPar[] = (E.dados.contagensFisicas ?? []).map((c) => (c.etapaOrigemId === ORIG_PE && over.pe !== undefined ? { ...c, saldo: over.pe } : c.etapaOrigemId === ORIG_RP && over.rp !== undefined ? { ...c, saldo: over.rp } : c));
    E.dados = { ...E.dados, contagensFisicas: lista };
  }
  return E;
}
function churnVsVigente(ap: number, plano: AlocacaoEscala[]) {
  const vig = new Map(vigente.filter((a) => ix(a) >= ap).map((a) => [`${ix(a)}|${a.funcionarioId}`, a]));
  let linhas = 0, pessoas = new Set<string>();
  plano.filter((a) => ix(a) >= ap).forEach((a) => { const v = vig.get(`${ix(a)}|${a.funcionarioId}`); if (!v || v.maquinaId !== a.maquinaId || v.etapaId !== a.etapaId) { linhas++; pessoas.add(a.funcionarioId); } });
  return { linhas, pessoas: pessoas.size };
}
function metricas(rotulo: string, E: ReturnType<typeof estadoCom>, planoFut: AlocacaoEscala[], diag: any[] | null, planoEsc: string, cad: Flags | undefined) {
  const opcoes: OpcoesFluxo = { ...E.opcoes };
  const ap = E.ap;
  const todo = [...E.ent.congeladas, ...planoFut];
  const av = avaliarPlano(E.ent, E.dados, todo, opcoes);
  const ctx = prepararFluxo(E.ent, E.dados, { ...opcoes, cadeia: { diagnostico: true } });
  const semana = simularCadeia(ctx, planoFut, { semProximoDia: true });
  const completa = simularCadeia(ctx, planoFut);
  const viol = verificarRestricoesDuras(E.ent, todo, { somenteLinhasNovas: true });
  const porTipo: Record<string, number> = {};
  viol.forEach((v) => (porTipo[v.tipo] = (porTipo[v.tipo] ?? 0) + 1));
  const semPosto = planoFut.filter((a) => !a.maquinaId).length;
  const upstream: string[] = [];
  for (let s = ap; s < slots.length; s++) {
    const c: Record<string, number> = {};
    planoFut.filter((a) => ix(a) === s && a.maquinaId).forEach((a) => { const g = grupo(nome(a.maquinaId)); if (g) c[g] = (c[g] ?? 0) + 1; });
    upstream.push(`${slots[s].periodoId}:${["Ros", "Paf", "M8", "Etq", "Emb"].map((g) => `${g}${c[g] ?? 0}`).join("/")}`);
  }
  const nReparos = (diag ?? []).filter((d) => d.codigo === "CADEIA_REPARADA" && d.severidade === "info").length;
  const nRealoc = (diag ?? []).filter((d) => d.codigo === "POSTO_SEM_MATERIAL_REALOCADO").length;
  const par = E.ctx.pares.filter((p: any) => /3\/4/.test(nome(p.produtoId)) && !/Automatica/.test(nome(p.produtoId)));
  return {
    plano: rotulo, escolhido: planoEsc, flags: cad ? JSON.stringify(cad) : "—", pecasFinaisLo: Math.round(av.totais.finalEntregueLo), receitaLo: receita(E.ent, av), wipFinalLo: Math.round(av.totais.wipFinalLo),
    rupturasSemana: semana.violacoes.length, deficitSemana: Math.round(semana.deficit), deficitComProxDia: Math.round(completa.deficit),
    semMaterialEtq: semana.violacoes.filter((v) => /Etiquetar/.test(nome(v.etapaId)) && /3\/4/.test(nome(v.produtoId))).map((v) => `${slots[v.slot].periodoId}:${Math.round(v.deficit)}`).join(" ") || "—",
    pessoasSemPosto: semPosto, ociosasEvitaveis: ociosasEvitaveis(ctx, planoFut), violacoesDuras: viol.length, porTipo: JSON.stringify(porTipo),
    churnLinhas: churnVsVigente(ap, planoFut).linhas, pessoasAlteradas: churnVsVigente(ap, planoFut).pessoas, reparos: nReparos, realocacoes: nRealoc,
    wipEstimadoNaCadeia: par.filter((p: any) => p.origem !== "confirmado").length + "/" + par.length, postosPorPeriodo: upstream.join(" "),
  };
}
function rodar(rotulo: string, cad: Flags | undefined, over?: { pe?: number; rp?: number }) {
  const E = estadoCom(over);
  const opcoes = { ...E.opcoes, ...(cad ? { cadeia: cad } : {}) };
  const t0 = Date.now();
  const r = planejarComFluxo(E.ent, E.dados, opcoes);
  const m = metricas(rotulo, E, r.resultado.alocacoes, r.diagnostico.diagnosticos, r.diagnostico.planoEscolhido, cad);
  return { ...m, ms: Date.now() - t0, _plano: r.resultado.alocacoes, _E: E };
}
const sai: any = { principais: [], sensibilidade: [] };
const ap0 = estadoCom().ap;
{
  const E = estadoCom();
  sai.principais.push({ ...metricas("A (vigente 08:59)", E, vigente.filter((a) => ix(a) >= ap0), null, "vigente", undefined), ms: 0 });
}
const defs: [string, Flags | undefined][] = [["B (PROD 12:36)", undefined], ["C (B + diagnóstico)", { diagnostico: true }], ["D (B + Allowed)", { allowed: true }], ["E (D + saída)", { allowed: true, saida: true }], ["F (E + reparo)", { allowed: true, saida: true, reparo: true }], ["S (só saída)", { saida: true }], ["R (só reparo)", { reparo: true }]];
const planos: Record<string, AlocacaoEscala[]> = {};
for (const [r, c] of defs) { const x = rodar(r, c); planos[r] = x._plano; const { _plano, _E, ...m } = x; sai.principais.push(m); }
const mesmo = JSON.stringify(planos["B (PROD 12:36)"]) === JSON.stringify(planos["C (B + diagnóstico)"]);
sai.C_igual_B = mesmo;
if (!process.env.SEM_SENS) {
  for (const over of [{ pe: 6000, rp: 6000 }, { pe: 3350, rp: 6000 }, { pe: 1000, rp: 6000 }, { pe: 3350, rp: 3200 }, { pe: 1000, rp: 3200 }]) {
    for (const [r, c] of [defs[0], defs[3], defs[4]]) { const x = rodar(r, c, over); const { _plano, _E, ...m } = x; sai.sensibilidade.push({ PE: over.pe, RP: over.rp, ...m }); }
  }
}
fs.writeFileSync(process.env.OUT ?? "/dev/stdout", JSON.stringify(sai, null, 1));
