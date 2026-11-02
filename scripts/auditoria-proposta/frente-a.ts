/* eslint-disable @typescript-eslint/no-explicit-any */
// FRENTE A (02/11) — plano EQUILIBRIO refeito com busca local de postos + despacho forward; antecipação das pessoas sem posto; sensibilidade; ausência; Conector.
// SOMBRA/OFFLINE: nada em PROD. Rodar: D9/ts.sh scripts/auditoria-proposta/frente-a.ts  (STAGE=plano|tudo)
import * as fs from "node:fs";
import * as path from "node:path";
import * as D from "./dados";
import * as N from "./nucleo";
import { coberturaUniformeMaxima } from "@/features/escala/fluxo/propostaCorte";
import { planejarFuturo, type EntradaPlanejador, type SaidaPlanejador } from "@/features/escala/fluxo/planejadorFuturo";
import { prepararDespacho, despachar, linhasParaOcc, type ConfigDespacho, type LinhaPostoD } from "@/features/escala/fluxo/postosDespacho";
import type { ProdutoRev } from "@/features/escala/fluxo/planoReverso";
import type { AlocacaoEscala } from "@/features/escala/types";

const OUT = "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/auditoria-1030/D10";
export const wipB = D.cenarios.find((c) => c.nome === "B")!;
const wipA = D.cenarios.find((c) => c.nome === "A")!, wipC = D.cenarios.find((c) => c.nome === "C")!;
const wipDpath = "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/auditoria-1030/D7/wip-D.json";
const { n0, n1, soma, H, periodos, nomeCurto, nomeM, nomeO } = { ...N, nomeM: D.nomeM, nomeO: D.nomeO };
const slotIdx = new Map(N.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));

// ---------------- helpers ----------------
function escalarM8(prods: ProdutoRev[], f: number): ProdutoRev[] {
  return prods.map((p) => (p.id !== D.aut ? p : { ...p, etapas: p.etapas.map((e, k) => (k !== 0 ? e : { ...e, alternativas: e.alternativas.map((a) => ({ ...a, pecasPorPosto: a.pecasPorPosto.map((v) => v * f) })) })) }));
}
const base0 = (prods: ProdutoRev[]) => ({ periodos, recursos: N.recursos, produtos: prods, pessoas: N.pessoas, extensaoPeriodos: 0 });
const demanda = Object.fromEntries(D.produtosRev("meta", wipB.wip).map((p) => [p.id, p.demandaFinal]));
let pisoCache: Record<string, number> | null = null;
function pisoEquilibrio(): Record<string, number> {
  if (pisoCache) return pisoCache;
  const cu = coberturaUniformeMaxima(base0(D.produtosRev("meta", wipB.wip)), N.idsProd, { semAntecipacao: true, limiteOpBloco: N.limOp });
  pisoCache = Object.fromEntries(N.idsProd.map((i) => [i, 0.9 * cu.c * demanda[i]]));
  return pisoCache;
}
const prioridade = [D.aut, D.conv, N.pino, N.plug, D.cx];
const verificar = (l: AlocacaoEscala[]) => N.violacoes(l).total;
function entradaPlanejador(prods: ProdutoRev[], extra: Partial<EntradaPlanejador> = {}): EntradaPlanejador {
  return {
    slots: N.slots, aPartirDe: 0, recursos: N.recursos, produtos: prods, equipe: N.entrada.funcionarios.map((f) => ({ id: f.id })), linhasCongeladas: [], producaoCongelada: {},
    objetivo: "EQUILIBRIO", margemPorPeca: N.pesosMargem, pisoPorProduto: pisoEquilibrio(), operacaoDe: N.opDe, prioridade, verificarDuras: verificar,
    revezamento: { ponteM3T1: N.entrada.revezamentoPonteM3T1 === true, equivalencias: N.entrada.equivalenciaOperacoes }, busca: { iter: 3000000, reinicios: 3, semente: 1 }, ...extra,
  };
}
export function resumo(s: SaidaPlanejador) {
  const fin = Object.fromEntries(s.porProduto.map((p) => [p.produtoId, p.programado]));
  return { pecas: soma(Object.values(fin)), margem: soma(Object.entries(fin).map(([k, v]) => v * N.econ[k].margem)), receita: soma(Object.entries(fin).map(([k, v]) => v * N.econ[k].valor)), fin };
}
export const semPosto = (s: SaidaPlanejador) => s.linhas.filter((l) => !l.maquinaId).length;
export function postosPorPeriodo(s: SaidaPlanejador): number[] { return N.slots.map((x) => s.linhas.filter((l) => l.data === x.data && l.periodoId === x.periodoId && l.maquinaId).length); }
const linhasDeCand = (): LinhaPostoD[] => (JSON.parse(fs.readFileSync(path.join(N.SCRATCH, "candidato-EQUILIBRIO.json"), "utf8")).alocacoes as any[]).filter((a) => a.maquina_id).map((a) => ({ t: slotIdx.get(`${a.data}|${a.periodo_id}`) as number, recursoId: a.maquina_id, operacaoId: a.operacao_id }));
export { entradaPlanejador, escalarM8, linhasDeCand, pisoEquilibrio, OUT, wipA, wipC, wipDpath, demanda, prioridade, slotIdx };

if (require.main === module || process.env.STAGE) {
  const stage = process.env.STAGE ?? "plano";
  if (stage === "plano") {
    const t0 = Date.now();
    const prods = D.produtosRev("meta", wipB.wip);
    const s = planejarFuturo(entradaPlanejador(prods, { linhasIniciais: linhasDeCand() }));
    console.error("plano ms", Date.now() - t0);
    const r = resumo(s);
    console.log(JSON.stringify({ ...r, semPosto: semPosto(s), postos: postosPorPeriodo(s), validacao: s.validacao, avisos: s.avisos, fin: Object.fromEntries(Object.entries(r.fin).map(([k, v]) => [nomeCurto(k), Math.round(v)])) }));
    fs.writeFileSync(path.join(OUT, "plano-B-meta.json"), JSON.stringify({ linhas: s.linhas, linhasPostos: s.linhasPostos, porProduto: s.porProduto, validacao: s.validacao, producao: s.producao, wip: s.wip }, null, 1));
  }
}
