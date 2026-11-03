// TESTE MÍNIMO DA REGRA DE LOTE (urgente 03/11): estoque no início do período = 0, Parafusar produz 3.000 no período ⇒ a Etiquetadora NÃO produz nesse período; no seguinte, ≤ 3.000.
import { describe, expect, it } from "vitest";
import { despachar, linhasParaOcc, prepararDespacho, type ConfigDespacho } from "../postosDespacho";
import { planejarFuturo } from "../planejadorFuturo";
import type { ProdutoRev, RecursoRev } from "../planoReverso";
import type { SlotEscala } from "../../types";

const ids = ["m3", "t1", "t2", "t3"];
const H = ids.length;
const slots: SlotEscala[] = ids.map((p, i) => ({ data: "2026-11-03", periodoId: p, indice: i, primeiroDoDia: i === 0, inicioMin: 624 + i * 90, fimMin: 714 + i * 90, inicioMs: (624 + i * 90) * 60000, fimMs: (714 + i * 90) * 60000 }));
const rec = (id: string): RecursoRev => ({ id, rotulo: id, unidades: new Array(H).fill(1) });
const alt = (r: string, v: number) => ({ recursoId: r, pecasPorPosto: new Array(H).fill(v) });
const P: ProdutoRev = {
  id: "P", rotulo: "P", valorUnitario: 1, demandaFinal: 100000, wipInicial: [0, 0], // WIP no início de M3 = 0 em TODAS as ligações
  etapas: [{ id: "paf", rotulo: "Parafusar", alternativas: [alt("p1", 3000)] }, { id: "etq", rotulo: "Etiquetar", alternativas: [alt("e1", 3500)] }, { id: "emb", rotulo: "Embalar", alternativas: [alt("b1", 5000)] }],
};
const recursos = ["p1", "e1", "b1"].map(rec);

describe("regra de lote: nada produzido no período T está disponível no próprio T", () => {
  const cfg: ConfigDespacho = { t0: 0, produtos: [P], recursos, pessoas: new Array(H).fill(3), operacaoDe: (_p, e) => `op-${e}`, alvo: { P: 100000 }, margem: { P: 1 }, prioridade: ["P"], blocos: [[0, 1, 2, 3]], limiteOp: 3 };
  it("despacho com Parafusar e Etiquetar ligadas em todos os períodos: Etiquetar M3 = 0, T1 = 3.000 (só o que a Parafusar fez em M3)", () => {
    const D = prepararDespacho(cfg);
    const linhas = [0, 1, 2, 3].flatMap((t) => [{ t, recursoId: "p1", operacaoId: "op-paf" }, { t, recursoId: "e1", operacaoId: "op-etq" }]);
    const r = despachar(cfg, D, linhasParaOcc(cfg, D, linhas), true);
    expect(r.producao.P[0].map(Math.round)).toEqual([3000, 3000, 3000, 3000]); // Parafusar
    expect(r.producao.P[1].map(Math.round)).toEqual([0, 3000, 3000, 3000]); // Etiquetar: M3 = 0 (sem estoque no início), T1 = 3.000
    expect(r.producao.P[1][0]).toBe(0);
    expect(r.producao.P[1][1]).toBeLessThanOrEqual(3000);
    expect(r.linhasOciosas.some((l) => l.t === 0 && l.recursoId === "e1")).toBe(true); // a linha da Etiquetadora em M3 é ociosa (sem material)
  });
  it("planejador: a Etiquetadora não é programada em M3 (nem entra pessoa) quando o estoque inicial é 0", () => {
    const s = planejarFuturo({ slots, aPartirDe: 0, recursos, produtos: [P], equipe: ["a", "b", "c"].map((id) => ({ id })), linhasCongeladas: [], producaoCongelada: {}, operacaoDe: (_p, e) => `op-${e}`, objetivo: "MAX_PECAS_FINAIS", busca: { iter: 40000, reinicios: 1 } });
    const etqM3 = s.producao.P.etq[0], etqT1 = s.producao.P.etq[1];
    expect(etqM3).toBe(0);
    expect(etqT1).toBeLessThanOrEqual(3000);
    expect(s.validacao.cadeiaValida).toBe(true);
    expect(s.validacao.semMaterial).toBe(0);
  });
});
