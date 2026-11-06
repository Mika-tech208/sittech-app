import { describe, expect, it } from "vitest";
import { calcularIndicadoresProducao } from "@/features/custo-hora/calculations";
import type { PeriodoComDuracao, Produto } from "@/types/domain";
import { margemPorRota, roteiroDaRota } from "../margemRotas";
import { C, CAN, modelo } from "./fixture";

const PER: PeriodoComDuracao[] = [
  { id: "m1", nome: "M1", duracaoHoras: 1.6 }, { id: "m2", nome: "M2", duracaoHoras: 1.6 }, { id: "m3", nome: "M3", duracaoHoras: 91 / 60 },
  { id: "t1", nome: "T1", duracaoHoras: 80 / 60 }, { id: "t2", nome: "T2", duracaoHoras: 80 / 60 }, { id: "t3", nome: "T3", duracaoHoras: 80 / 60 },
] as unknown as PeriodoComDuracao[];
const m = (a: number, b: number) => ({ m1: a, m2: a, m3: a, t1: b, t2: b, t3: b });
// metas reais de PROD; ordem da lista = ordem do banco (M8 = 0 ... Embalar = 4), NÃO o caminho
const PRODUTO: Produto = {
  id: CAN, nome: 'Conector 3/4" (Final)', referencia: "", valorUnitario: 0.1825, ativo: true, prioridade: "media",
  roteiro: [
    { id: C.m8, operacao: "Rosquear + Parafusar", metas: m(1275, 1100), maquinasIds: [] }, { id: C.ros, operacao: "Rosquear", metas: m(2000, 1600), maquinasIds: [] },
    { id: C.par, operacao: "Parafusar", metas: m(1500, 1200), maquinasIds: [] }, { id: C.eti, operacao: "Etiquetar", metas: m(3500, 3000), maquinasIds: [] }, { id: C.emb, operacao: "Embalar", metas: m(5000, 4500), maquinasIds: [] },
  ],
} as Produto;
const CUSTO_HORA = { "Rosquear": 20, "Parafusar": 20, "Rosquear + Parafusar": 25, "Etiquetar": 18, "Embalar": 16 };

describe("custo/margem por rota (um valor de venda, custo por rota)", () => {
  const mod = modelo();
  const [r1, r2] = mod.rotas;
  it("o roteiro de cada rota é linear e segue o caminho (não a ordem do banco)", () => {
    expect(roteiroDaRota(PRODUTO, mod, r1.id).map((e) => e.id)).toEqual([C.ros, C.par, C.eti, C.emb]);
    expect(roteiroDaRota(PRODUTO, mod, r2.id).map((e) => e.id)).toEqual([C.m8, C.eti, C.emb]);
  });
  it("custo da rota = soma do custo de suas etapas (mesma fórmula de hoje); trecho comum idêntico nas duas", () => {
    const res = margemPorRota(PRODUTO, mod, CUSTO_HORA, 17, PER);
    const custoEtapa = (id: string) => calcularIndicadoresProducao({ roteiro: PRODUTO.roteiro.filter((e) => e.id === id) }, CUSTO_HORA, 17, PER).custo;
    const esperado1 = [C.ros, C.par, C.eti, C.emb].reduce((s, id) => s + custoEtapa(id), 0);
    const esperado2 = [C.m8, C.eti, C.emb].reduce((s, id) => s + custoEtapa(id), 0);
    expect(res).toHaveLength(2);
    expect(res[0].margem.custo).toBeCloseTo(esperado1, 12);
    expect(res[1].margem.custo).toBeCloseTo(esperado2, 12);
    expect(res[0].margem.margemRS + res[0].margem.custo).toBeCloseTo(0.1825, 12); // um único valor de venda
    expect(res[1].margem.margemRS + res[1].margem.custo).toBeCloseTo(0.1825, 12);
    expect(res[0].margem.custo).not.toBeCloseTo(res[1].margem.custo, 6); // rotas com custo/margem próprios
  });
  it("somar o roteiro inteiro (como a tela de Produtos faria sem rotas) seria ERRADO: M8 entraria em série", () => {
    const serial = calcularIndicadoresProducao(PRODUTO, CUSTO_HORA, 17, PER).custo;
    const res = margemPorRota(PRODUTO, mod, CUSTO_HORA, 17, PER);
    expect(serial).toBeGreaterThan(Math.max(res[0].margem.custo, res[1].margem.custo));
  });
  it("rota inativa não aparece", () => {
    const m2 = modelo(); m2.rotas[1].ativa = false;
    expect(margemPorRota(PRODUTO, m2, CUSTO_HORA, 17, PER)).toHaveLength(1);
  });
});
