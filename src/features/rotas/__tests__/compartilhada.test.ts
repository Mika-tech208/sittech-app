import { describe, it, expect } from "vitest";
import { distribuirPedido, previaComCompartilhamento, repartirMaquina, type EntradaPrevia } from "../compartilhada";
import { horasMaquinaSemana } from "../capacidade";
import type { ContextoCapacidade, EtapaCadastro, PeriodoId } from "../tipos";
import { ESTRUTURA_F, SEL_F } from "./fixtureRotas";

const PERIODOS = [{ id: "m1", minutos: 96 }, { id: "m2", minutos: 96 }, { id: "m3", minutos: 91 }, { id: "t1", minutos: 80 }, { id: "t2", minutos: 80 }, { id: "t3", minutos: 80 }] as ContextoCapacidade["periodos"];
const mt = (a: number, b: number): Record<PeriodoId, number> => ({ m1: a, m2: a, m3: a, t1: b, t2: b, t3: b });
const e = (id: string, op: string, ordem: number, a: number, b: number, ms: string[]): EtapaCadastro => ({ id, operacaoId: `op${op}`, operacao: op, ordem, metas: mt(a, b), maquinasIds: ms });
const ETAPAS = new Map([e("f-rosq", "Rosquear", 0, 2000, 1600, ["R3", "R5", "R6"]), e("f-para", "Parafusar", 1, 1500, 1200, ["P9", "P10", "P11", "P12"]), e("f-rp", "Rosquear + Parafusar", 2, 1275, 1100, ["A8"]), e("f-etiq", "Etiquetar", 3, 3500, 3000, ["E15", "E16"]), e("f-emb", "Embalar", 4, 5000, 4500, ["EMB17"])].map((x) => [x.id, x]));
const ctx: ContextoCapacidade = { periodos: PERIODOS, diasProdutivos: 5 };
const caixa = (q: number, ms = ["E16"]) => ({ itemId: "caixa", produtoNome: "Caixa Amarela", quantidade: q, selecao: { "c-etiq": ms } });
const metasCaixa = new Map([["c-etiq", { operacaoId: "opEtiquetar", metas: mt(2500, 2200) }]]);
const previa = (selecao: Record<string, string[]>, outros = [caixa(14100)], demanda = 116625) => previaComCompartilhamento({ itemId: "pF", estrutura: ESTRUTURA_F, etapas: ETAPAS, demanda, ctx, selecao, outros, etapasDosOutros: metasCaixa } as EntradaPrevia);

describe("M3 — máquina compartilhada: orçamento único por máquina", () => {
  it("repartirMaquina: Σ concedido ≤ horas da máquina e ninguém recebe mais do que pediu (fuzz)", () => {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 500; n++) {
      const H = rnd() * 50;
      const pedidos = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => ({ itemId: `i${i}`, horas: rnd() * 40 }));
      const c = repartirMaquina(H, pedidos);
      const soma = [...c.values()].reduce((s, v) => s + v, 0);
      expect(soma).toBeLessThanOrEqual(H + 1e-6);
      pedidos.forEach((p) => { expect(c.get(p.itemId)!).toBeLessThanOrEqual(p.horas + 1e-9); expect(c.get(p.itemId)!).toBeGreaterThanOrEqual(0); });
      if (pedidos.reduce((s, p) => s + p.horas, 0) >= H) expect(soma).toBeGreaterThan(H - 1e-6);    // se há demanda sobrando a máquina é toda usada
    }
  });
  it("distribuirPedido: máquinas sem concorrência primeiro; a disputada só recebe o que sobra", () => {
    const d = distribuirPedido(116625, ["E15", "E16"], 0.000447, 43.58, new Set(["E16"]));
    expect(d.E15).toBeCloseTo(43.58, 6); expect(d.E16).toBeGreaterThan(0); expect(d.E16).toBeLessThan(10);
    expect(distribuirPedido(20000, ["E15", "E16"], 0.000447, 43.58, new Set(["E16"])).E16).toBeUndefined();   // cabe na livre: não pede a disputada
  });
  it("E16 marcada para F e para a Caixa: aparece como compartilhada, com total, comprometido por outros e estimativa restante — e a soma nunca passa da máquina", () => {
    const p = previa({ ...SEL_F, "f-etiq": ["E15", "E16"] }, [caixa(60000)]);
    expect(p.estimativa).toBe(true);
    const c = p.compartilhadas.find((x) => x.maquinaId === "E16")!;
    const H = horasMaquinaSemana(ctx);
    expect(c.horasTotais).toBeCloseTo(H, 6);
    expect(c.porItem.reduce((s, x) => s + x.concedido, 0)).toBeLessThanOrEqual(H + 1e-6);
    expect(c.reivindicadoPorOutros).toBeGreaterThan(0); expect(c.concedidoAoItem).toBeLessThan(H);
    expect(c.porItem.find((x) => x.itemId === "caixa")?.produtoNome).toBe("Caixa Amarela");
    expect(p.plano.finalAtingivel).toBeGreaterThan(97500);                        // sobra algo da E16 para o Conector…
    expect(p.plano.finalAtingivel).toBeLessThan(116625);                          // …mas não tudo
  });
  it("E16 compatível mas NÃO marcada no F: capacidade 0 dela para o Conector e nenhuma 'compartilhada'", () => {
    const p = previa(SEL_F, [caixa(14100)]);
    expect(p.compartilhadas).toHaveLength(0);
    expect(p.plano.finalAtingivel).toBeCloseTo(97500, 4);
    expect(p.horasComprometidasParaOItem.E16).toBeUndefined();                    // F nem pede a máquina
  });
  it("sem concorrência (Caixa pequena) o Conector recebe o que pediu; com a Caixa tomando a máquina toda, a prévia reduz o final do Conector", () => {
    const livre = previa({ ...SEL_F, "f-etiq": ["E15", "E16"] }, [caixa(5000)]);
    expect(livre.plano.finalAtingivel).toBeCloseTo(116625, 2);
    const cheia = previa({ ...SEL_F, "f-etiq": ["E15", "E16"] }, [caixa(70500)]);
    expect(cheia.plano.finalAtingivel).toBeLessThan(livre.plano.finalAtingivel);
  });
});
