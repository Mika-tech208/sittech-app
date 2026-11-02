/* eslint-disable @typescript-eslint/no-explicit-any */
// Ausência simulada em 03/11 (12 → 11 pessoas) com a API pura planejarFuturo: passado congelado, só o futuro é recalculado.
import * as fs from "node:fs";
import * as path from "node:path";
import * as D from "./dados";
import * as N from "./nucleo";
import { OUT, wipB, entradaPlanejador, resumo } from "./frente-a";
import { planejarFuturo, type SaidaPlanejador, type EntradaPlanejador } from "@/features/escala/fluxo/planejadorFuturo";
import { verificarRestricoesDuras } from "@/features/escala/fluxo/restricoes";
import type { AlocacaoEscala } from "@/features/escala/types";
import type { LinhaPostoD } from "@/features/escala/fluxo/postosDespacho";

const base = JSON.parse(fs.readFileSync(path.join(OUT, "plano-B-meta.json"), "utf8"));
const prods = D.produtosRev("meta", wipB.wip);
const baseRes = { pecas: N.soma(base.porProduto.map((p: any) => p.programado)), margem: N.soma(base.porProduto.map((p: any) => p.programado * N.econ[p.produtoId].margem)) };
const dia = N.slots.filter((s) => s.data === "2026-11-03");
const idx03 = dia.map((s) => s.indice); // 0..5

function caso(nome: string, k0: number, pessoaId: string, iter = 800000) {
  const ausentes: Record<number, string[]> = {};
  idx03.filter((t) => t >= k0).forEach((t) => (ausentes[t] = [pessoaId]));
  const congel: AlocacaoEscala[] = base.linhas.filter((l: any) => (N.slots.find((s) => s.data === l.data && s.periodoId === l.periodoId) as any).indice < k0).map((l: any) => { const { distribuicao, ...r } = l; void distribuicao; return r; });
  const prodC: Record<string, Record<string, number[]>> = {};
  for (const p of prods) { prodC[p.id] = {}; p.etapas.forEach((e) => (prodC[p.id][e.id] = (base.producao[p.id][e.id] as number[]).map((v, t) => (t < k0 ? v : 0)))); }
  const entradaComAusencia = { ...N.entrada, ausencias: [...(N.entrada.ausencias ?? []), { funcionarioId: pessoaId, data: "2026-11-03", inicioMin: N.slots[k0].inicioMin, fimMin: 24 * 60 }] };
  const ver = (ls: AlocacaoEscala[]) => verificarRestricoesDuras(entradaComAusencia as any, ls.map((l: any) => { const { distribuicao, ...r } = l; void distribuicao; return r; })).length;
  const t0 = Date.now();
  const s = planejarFuturo(entradaPlanejador(prods, { aPartirDe: k0, linhasCongeladas: congel, producaoCongelada: prodC, ausentes, linhasIniciais: base.linhasPostos as LinhaPostoD[], verificarDuras: ver, busca: { iter, reinicios: 1, semente: 2 } }));
  const r = resumo(s);
  const corteExtra = Object.fromEntries(s.porProduto.map((p) => [N.nomeCurto(p.produtoId), Math.round((base.porProduto.find((b: any) => b.produtoId === p.produtoId).programado as number) - p.programado)]));
  const pessoasPeriodo = N.slots.map((x) => s.linhas.filter((l) => l.data === x.data && l.periodoId === x.periodoId && l.maquinaId).length);
  const semPostoFut = s.linhas.filter((l) => !l.maquinaId).length;
  const ausenteEmLinha = s.linhas.filter((l) => l.funcionarioId === pessoaId && ausentes[N.slots.find((x) => x.data === l.data && x.periodoId === l.periodoId)!.indice]).length;
  return { nome, k0, pessoa: N.nomeFunc(pessoaId), pecas: r.pecas, margem: Math.round(r.margem), deltaPecas: Math.round(r.pecas - baseRes.pecas), deltaMargem: Math.round(r.margem - baseRes.margem), corteExtra, val: s.validacao, pessoasPeriodo03: pessoasPeriodo.slice(0, 6), semPostoFuturo: semPostoFut, ausenteEmLinha, ms: Date.now() - t0, avisos: s.avisos };
}
const out: any[] = [];
const eq = N.equipe;
// 1) ausência começando em M1 (nada congelado) e em T1 (M1–M3 congelados): pessoa = a que ocupava a Etiquetadora 15 / Embalagem 17 no início do dia (mais crítica = postos únicos)
const doPostoUnico = (t: number, pred: (nm: string) => boolean) => base.linhas.find((l: any) => l.data === "2026-11-03" && l.periodoId === ["m1", "m2", "m3", "t1", "t2", "t3"][t] && l.maquinaId && pred(D.nomeM(l.maquinaId))).funcionarioId;
out.push(caso("ausência desde M1 (pessoa na Etiquetadora 15 em M1)", 0, doPostoUnico(0, (n) => n.startsWith("Etiquetadora 15")) ?? eq[0]));
out.push(caso("ausência desde T1 (pessoa na Etiquetadora 15 em T1)", 3, doPostoUnico(3, (n) => n.startsWith("Etiquetadora 15") || n.startsWith("Embalagem 17") || n.startsWith("Maquina Automatica")) ?? eq[0]));
// 2) varredura: cada uma das 12 pessoas ausente desde T1 → a mais crítica (maior perda ou atribuição impossível)
const varredura: any[] = [];
for (const pid of eq) { try { const c = caso(`varredura T1 ${N.nomeFunc(pid)}`, 3, pid, 300000); varredura.push({ pessoa: c.pessoa, deltaPecas: c.deltaPecas, deltaMargem: c.deltaMargem, cadeia: c.val.cadeiaValida, duras: c.val.violacoesDuras, ok: c.val.atribuicaoOk, avisos: c.avisos.length }); } catch (e: any) { varredura.push({ pessoa: N.nomeFunc(pid), erro: e.message.slice(0, 80) }); } }
const pior = varredura.filter((v) => v.deltaMargem !== undefined).sort((a, b) => a.deltaMargem - b.deltaMargem)[0];
const piorId = eq.find((id) => N.nomeFunc(id) === pior.pessoa) as string;
out.push(caso(`pessoa mais crítica (varredura T1): ${pior.pessoa}`, 3, piorId));
// 3) ausência desde M1 de uma pessoa, depois recálculo SEM a pessoa de novo (idempotência) é coberto pelos testes unitários
console.error(JSON.stringify(out.map((o) => ({ ...o, val: undefined, cadeia: o.val.cadeiaValida, duras: o.val.violacoesDuras, atrib: o.val.atribuicaoOk, max: o.val.maxPostosSimultaneos, semMat: o.val.semMaterial }))));
fs.writeFileSync(path.join(OUT, "ausencia.json"), JSON.stringify({ baseRes, out, varredura }, null, 1));
