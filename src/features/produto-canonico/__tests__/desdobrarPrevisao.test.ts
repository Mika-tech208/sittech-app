import { describe, expect, it } from "vitest";
import { calcularHorasPorMaquina, tempoPorPecaEtapa } from "@/features/capacidade/calculations";
import type { PeriodoComDuracao, PrevisaoItem, Produto } from "@/types/domain";
import { dividirDemandaPorCapacidade, itensParaAnalise } from "../desdobrarPrevisao";
import { C, CAN, MAQ, modelo } from "./fixture";

const PER = [["m1", 1.6], ["m2", 1.6], ["m3", 91 / 60], ["t1", 80 / 60], ["t2", 80 / 60], ["t3", 80 / 60]].map(([id, h]) => ({ id, nome: id, duracaoHoras: h })) as unknown as PeriodoComDuracao[];
const m = (a: number, b: number) => ({ m1: a, m2: a, m3: a, t1: b, t2: b, t3: b });
const PRODUTO = { id: CAN, nome: "Conector", referencia: "", valorUnitario: 0.1825, ativo: true, prioridade: "media", roteiro: [
  { id: C.m8, operacao: "Rosquear + Parafusar", metas: m(1275, 1100), maquinasIds: [] }, { id: C.ros, operacao: "Rosquear", metas: m(2000, 1600), maquinasIds: [] },
  { id: C.par, operacao: "Parafusar", metas: m(1500, 1200), maquinasIds: [] }, { id: C.eti, operacao: "Etiquetar", metas: m(3500, 3000), maquinasIds: [] }, { id: C.emb, operacao: "Embalar", metas: m(5000, 4500), maquinasIds: [] },
] } as Produto;
const ITEM: PrevisaoItem = { id: "it1", produtoId: CAN, produtoNome: "Conector", valorUnitario: 0.1825, quantidade: 93300, maquinasPorEtapa: { [C.ros]: [MAQ.r3], [C.par]: [MAQ.p9], [C.m8]: [MAQ.m8], [C.eti]: [MAQ.et15], [C.emb]: [MAQ.em17] } } as PrevisaoItem;
const H = 34;

describe("divisão estimada da demanda por rota (só para a análise de capacidade)", () => {
  it("proporcional à capacidade, soma exata, sem capacidade => tudo na 1ª rota (nunca some demanda)", () => {
    expect(dividirDemandaPorCapacidade(10000, [3, 1])).toEqual([7500, 2500]);
    expect(dividirDemandaPorCapacidade(10001, [1, 1]).reduce((a, b) => a + b, 0)).toBe(10001);
    expect(dividirDemandaPorCapacidade(100, [0, 0])).toEqual([100, 0]);
    expect(dividirDemandaPorCapacidade(100, [0, 5])).toEqual([0, 100]);
  });
  it("sem produto canônico: a MESMA lista de itens e produtos (identidade)", () => {
    const outro = { ...ITEM, produtoId: "x" } as PrevisaoItem;
    const r = itensParaAnalise([outro], [PRODUTO], [], PER, H);
    expect(r.itens).toEqual([outro]);
    expect(r.produtos).toEqual([PRODUTO]);
    expect(itensParaAnalise([outro], [PRODUTO], [modelo()], PER, H).itens[0]).toBe(outro);
  });
  it("horas das máquinas do trecho comum = demanda total UMA vez (sem desdobrar seria carga dobrada na M8/Rosquear/Parafusar em série)", () => {
    const { itens, produtos, divisao } = itensParaAnalise([ITEM], [PRODUTO], [modelo()], PER, H);
    expect(divisao.it1.reduce((s, d) => s + d.quantidade, 0)).toBe(93300);
    const horas = calcularHorasPorMaquina(itens, produtos, PER, H);
    const tEti = tempoPorPecaEtapa(PRODUTO.roteiro[3], PER), tEmb = tempoPorPecaEtapa(PRODUTO.roteiro[4], PER);
    expect(horas[MAQ.et15].horasNecessarias).toBeCloseTo(93300 * tEti, 6); // as duas rotas somam a demanda, uma vez
    expect(horas[MAQ.em17].horasNecessarias).toBeCloseTo(93300 * tEmb, 6);
    const q = (rota: string) => divisao.it1.find((d) => d.rotulo.includes(rota))!.quantidade;
    expect(horas[MAQ.m8].horasNecessarias).toBeCloseTo(q("Automática") * tempoPorPecaEtapa(PRODUTO.roteiro[0], PER), 6);
    expect(horas[MAQ.p9].horasNecessarias).toBeCloseTo(q("Convencional") * tempoPorPecaEtapa(PRODUTO.roteiro[2], PER), 6);
    // serial (como seria sem o desdobramento): M8 carregaria as 93.300 peças
    const serial = calcularHorasPorMaquina([ITEM], [PRODUTO], PER, H);
    expect(serial[MAQ.m8].horasNecessarias).toBeCloseTo(93300 * tempoPorPecaEtapa(PRODUTO.roteiro[0], PER), 6);
    expect(serial[MAQ.m8].horasNecessarias).toBeGreaterThan(horas[MAQ.m8].horasNecessarias);
  });
  it("M8 não selecionada: toda a demanda cai na rota convencional (a análise mostra a sobrecarga real)", () => {
    const it = { ...ITEM, maquinasPorEtapa: { ...ITEM.maquinasPorEtapa, [C.m8]: [] } } as PrevisaoItem;
    const { divisao } = itensParaAnalise([it], [PRODUTO], [modelo()], PER, H);
    expect(divisao.it1.find((d) => d.rotulo.includes("Automática"))!.quantidade).toBe(0);
    expect(divisao.it1.find((d) => d.rotulo.includes("Convencional"))!.quantidade).toBe(93300);
  });
});
