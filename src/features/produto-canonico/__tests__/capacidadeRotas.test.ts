import { describe, expect, it } from "vitest";
import { calcularCapacidadeMaximaProduto, calcularViabilidadeItem } from "@/features/capacidade/calculations";
import type { PeriodoComDuracao, Produto } from "@/types/domain";
import { capacidadeProdutoUnico, viabilidadeItemComRotas } from "../capacidadeRotas";
import { C, CAN, MAQ, modelo } from "./fixture";

const PER = [["m1", 1.6], ["m2", 1.6], ["m3", 91 / 60], ["t1", 80 / 60], ["t2", 80 / 60], ["t3", 80 / 60]].map(([id, h]) => ({ id, nome: id, duracaoHoras: h })) as unknown as PeriodoComDuracao[];
const m = (a: number, b: number) => ({ m1: a, m2: a, m3: a, t1: b, t2: b, t3: b });
const PRODUTO = {
  id: CAN, nome: "Conector", referencia: "", valorUnitario: 0.1825, ativo: true, prioridade: "media",
  roteiro: [
    { id: C.m8, operacao: "Rosquear + Parafusar", metas: m(1275, 1100), maquinasIds: [] }, { id: C.ros, operacao: "Rosquear", metas: m(2000, 1600), maquinasIds: [] },
    { id: C.par, operacao: "Parafusar", metas: m(1500, 1200), maquinasIds: [] }, { id: C.eti, operacao: "Etiquetar", metas: m(3500, 3000), maquinasIds: [] }, { id: C.emb, operacao: "Embalar", metas: m(5000, 4500), maquinasIds: [] },
  ],
} as Produto;
const H = 34; // horas por máquina na semana (valor de teste)

describe("capacidade do produto único considerando rotas", () => {
  const mod = modelo();
  const sel = (v: { ros?: string[]; par?: string[]; m8?: string[] }) => ({ [C.ros]: v.ros ?? [MAQ.r3], [C.par]: v.par ?? [MAQ.p9], [C.m8]: v.m8 ?? [MAQ.m8], [C.eti]: [MAQ.et15], [C.emb]: [MAQ.em17] });
  it("as duas rotas somam na entrada da Etiquetadora; o trecho comum limita", () => {
    const c = capacidadeProdutoUnico(PRODUTO, sel({}), mod, PER, H);
    expect(c.porRota.map((r) => r.disponivel)).toEqual([true, true]);
    expect(c.entradaComum).toBe(c.porRota[0].maxPecas + c.porRota[1].maxPecas);
    expect(c.maxPecas).toBe(Math.min(c.entradaComum, c.trechoComum.maxPecas));
    expect(c.maxPecas).toBeGreaterThan(Math.max(c.porRota[0].maxPecas, c.porRota[1].maxPecas)); // juntas passam de qualquer rota sozinha (quando o comum comporta)
  });
  it("M8 não selecionada: a rota automática fica indisponível e o produto NÃO zera (a função de hoje zeraria)", () => {
    const s = sel({ m8: [] });
    const c = capacidadeProdutoUnico(PRODUTO, s, mod, PER, H);
    expect(c.porRota[1]).toMatchObject({ disponivel: false, maxPecas: 0 });
    expect(c.maxPecas).toBeGreaterThan(0);
    expect(c.maxPecas).toBe(Math.min(c.porRota[0].maxPecas, c.trechoComum.maxPecas));
    expect(calcularCapacidadeMaximaProduto(CAN, s, [PRODUTO], PER, H).maxPecas).toBe(0); // comportamento serial de hoje: errado para o produto único
  });
  it("rota convencional sem Rosqueadeira: só a automática; sem nenhuma rota: 0", () => {
    const c = capacidadeProdutoUnico(PRODUTO, sel({ ros: [] }), mod, PER, H);
    expect(c.porRota[0].disponivel).toBe(false);
    expect(c.maxPecas).toBe(Math.min(c.porRota[1].maxPecas, c.trechoComum.maxPecas));
    expect(capacidadeProdutoUnico(PRODUTO, sel({ ros: [], m8: [] }), mod, PER, H).maxPecas).toBe(0);
  });
  it("viabilidade do item: canônico usa rotas; outro produto usa EXATAMENTE a função de hoje", () => {
    const it = { produtoId: CAN, quantidade: 93300, maquinasPorEtapa: sel({}) };
    const v = viabilidadeItemComRotas(it, [PRODUTO], PER, H, [mod]);
    expect(v.maxPecas).toBe(capacidadeProdutoUnico(PRODUTO, it.maquinasPorEtapa, mod, PER, H).maxPecas);
    const outro = { produtoId: "x", quantidade: 10, maquinasPorEtapa: { a: ["m"] } };
    const prodX = { ...PRODUTO, id: "x", roteiro: [{ id: "a", operacao: "Op", metas: m(100, 100), maquinasIds: [] }] } as Produto;
    expect(viabilidadeItemComRotas(outro, [prodX], PER, H, [mod])).toEqual(calcularViabilidadeItem(outro, [prodX], PER, H));
    expect(viabilidadeItemComRotas(outro, [prodX], PER, H, [])).toEqual(calcularViabilidadeItem(outro, [prodX], PER, H)); // sem modelos: idêntico
  });
});
