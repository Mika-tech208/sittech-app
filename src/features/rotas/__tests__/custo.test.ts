import { describe, it, expect } from "vitest";
import { calcularIndicadoresProducao } from "@/features/custo-hora/calculations";
import type { PeriodoComDuracao } from "@/types/domain";
import { custoComum, custoExclusivoRota, custoPecaEtapa, custoPorRota, economiaDaRota, ratearComum, type ContextoCusto } from "../custo";
import { tempoPorPeca } from "../capacidade";
import type { EstruturaProduto, EtapaCadastro, PeriodoId } from "../tipos";

const metas = (m: number, t: number) => ({ m1: m, m2: m, m3: m, t1: t, t2: t, t3: t }) as Record<PeriodoId, number>;
const e = (id: string, operacao: string, ordem: number, m: number, t: number): EtapaCadastro => ({ id, operacaoId: operacao, operacao, ordem, metas: metas(m, t), maquinasIds: ["x"] });
const ETAPAS = [e("rosq", "Rosquear", 0, 2000, 1600), e("para", "Parafusar", 1, 1500, 1200), e("rp", "Rosquear + Parafusar", 2, 1275, 1100), e("etiq", "Etiquetar", 3, 3500, 3000), e("emb", "Embalar", 4, 5000, 4500)];
const MAPA = new Map(ETAPAS.map((x) => [x.id, x]));
const F: EstruturaProduto = {
  produtoId: "F", modelo: "rotas", regraEtapaFinal: "explicita",
  rotas: [{ id: "a", codigo: "AUTO", nome: "Automática", ativa: true, preferencia: 1, etapas: ["rp"] }, { id: "c", codigo: "CONV", nome: "Convencional", ativa: true, preferencia: 2, etapas: ["rosq", "para"] }],
  poolComum: { etapas: ["etiq", "emb"], entradaId: "etiq" }, convergencia: { destinoId: "etiq", origens: [{ rotaCodigo: "AUTO", etapaId: "rp" }, { rotaCodigo: "CONV", etapaId: "para" }] }, etapaFinalId: "emb",
};
const PERIODOS = [{ id: "m1", minutos: 96 }, { id: "m2", minutos: 96 }, { id: "m3", minutos: 91 }, { id: "t1", minutos: 80 }, { id: "t2", minutos: 80 }, { id: "t3", minutos: 80 }] as ContextoCusto["periodos"];
const CUSTO: ContextoCusto = { periodos: PERIODOS, custoHoraPorOperacao: { Rosquear: 30.57, Parafusar: 30.58, "Rosquear + Parafusar": 30.56, Etiquetar: 30.64, Embalar: 30.61 }, custoHoraPadrao: 30 };
const c = (x: EtapaCadastro) => tempoPorPeca(x, CUSTO) * (CUSTO.custoHoraPorOperacao[x.operacao] ?? 30);

describe("custo por rota — exclusivo até a convergência + comum UMA vez", () => {
  it("custo final CONV = exclusivo CONV + comum; AUTO = exclusivo AUTO + comum — sem somar as duas rotas", () => {
    const custos = custoPorRota(F, MAPA, CUSTO, 0.1825);
    const conv = custos.find((x) => x.rotaCodigo === "CONV")!, auto = custos.find((x) => x.rotaCodigo === "AUTO")!;
    const comumEsperado = c(MAPA.get("etiq")!) + c(MAPA.get("emb")!);
    expect(conv.exclusivo).toBeCloseTo(c(MAPA.get("rosq")!) + c(MAPA.get("para")!), 12);
    expect(auto.exclusivo).toBeCloseTo(c(MAPA.get("rp")!), 12);
    expect(conv.comum).toBeCloseTo(comumEsperado, 12); expect(auto.comum).toBeCloseTo(comumEsperado, 12);
    expect(conv.final).toBeCloseTo(conv.exclusivo + comumEsperado, 12); expect(auto.final).toBeCloseTo(auto.exclusivo + comumEsperado, 12);
    // ordem de grandeza dos dados reais (out/26): CONV ≈ 0,081 e AUTO ≈ 0,061 por peça
    expect(conv.final).toBeGreaterThan(0.075); expect(conv.final).toBeLessThan(0.09); expect(auto.final).toBeGreaterThan(0.055); expect(auto.final).toBeLessThan(0.068);
    expect(conv.margem).toBeCloseTo(0.1825 - conv.final, 12);
  });
  it("NUNCA CONV + AUTO + comum: a função do legado aplicada à lista plana de 5 etapas daria o valor FALSO (por isso não pode ser usada em produto de rotas)", () => {
    const periodos = PERIODOS.map((p) => ({ id: p.id, nome: p.id, inicio: "00:00", fim: "00:00", duracaoHoras: p.minutos / 60 })) as unknown as PeriodoComDuracao[];
    const plano = calcularIndicadoresProducao({ roteiro: ETAPAS.map((x) => ({ id: x.id, operacao: x.operacao, metas: x.metas, maquinasIds: x.maquinasIds })) } as never, CUSTO.custoHoraPorOperacao, 30, periodos).custo;
    const custos = custoPorRota(F, MAPA, CUSTO);
    const conv = custos.find((x) => x.rotaCodigo === "CONV")!, auto = custos.find((x) => x.rotaCodigo === "AUTO")!;
    expect(plano).toBeCloseTo(conv.exclusivo + auto.exclusivo + conv.comum, 12);   // = CONV + AUTO + comum (errado)
    expect(plano).toBeGreaterThan(conv.final + 0.03);                              // bem acima do custo real de qualquer rota
  });
  it("economia da AUTO = (exclusivo CONV − exclusivo AUTO) × volume entregue ao pool; o comum não entra", () => {
    const custos = custoPorRota(F, MAPA, CUSTO);
    const econ = economiaDaRota(custos, "AUTO", "CONV", 35625);
    expect(econ.porPeca).toBeCloseTo(custoExclusivoRota(F, "CONV", MAPA, CUSTO) - custoExclusivoRota(F, "AUTO", MAPA, CUSTO), 12);
    expect(econ.total).toBeCloseTo(econ.porPeca * 35625, 6);
    expect(econ.porPeca).toBeGreaterThan(0.018); expect(econ.porPeca).toBeLessThan(0.024);      // ≈ R$ 0,020/peça nos dados de out/26
    const comDoisComuns = economiaDaRota(custos.map((x) => ({ ...x, comum: x.comum * 3, final: x.exclusivo + x.comum * 3 })), "AUTO", "CONV", 35625);
    expect(comDoisComuns.total).toBeCloseTo(econ.total, 9);                                     // mudar o custo comum não muda a economia
    expect(economiaDaRota(custos, "AUTO", "CONV", 0).total).toBe(0);
  });
  it("custo comum rateado PROPORCIONALMENTE ao volume entregue ao pool (sem FIFO); soma preservada", () => {
    const r = ratearComum(1000, { CONV: 70000, AUTO: 35000 });
    expect(r.CONV).toBeCloseTo(666.6667, 3); expect(r.AUTO).toBeCloseTo(333.3333, 3); expect(r.CONV + r.AUTO).toBeCloseTo(1000, 9);
    expect(ratearComum(500, { CONV: 0, AUTO: 0 })).toEqual({ CONV: 0, AUTO: 0 });
  });
  it("nenhum valor fixo: mudar o custo/hora ou a meta muda o custo; operação sem custo usa o padrão da empresa", () => {
    const mais = { ...CUSTO, custoHoraPorOperacao: { ...CUSTO.custoHoraPorOperacao, Embalar: 61.22 } };
    expect(custoComum(F, MAPA, mais)).toBeGreaterThan(custoComum(F, MAPA, CUSTO));
    expect(custoPecaEtapa(MAPA.get("rp")!, { ...CUSTO, custoHoraPorOperacao: {} })).toBeCloseTo(tempoPorPeca(MAPA.get("rp")!, CUSTO) * 30, 12);
  });
});
