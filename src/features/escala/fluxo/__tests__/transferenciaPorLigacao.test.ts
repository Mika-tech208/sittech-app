// Modo de transferência POR LIGAÇÃO: simulador (lagPorAresta, default byte-idêntico) e forecast de buffer (contínuo / lote / desconhecido).
import { describe, expect, it } from "vitest";
import { construirGrafo } from "../grafo";
import { novaCap, simularGrupo } from "../simulador";
import { pool } from "./helpersFluxo";
import { forecastBuffer, type EntradaForecast, type LigacaoForecast, type NoForecast } from "../forecastBuffer";

const pools3 = [
  pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 100000, maquinas: ["a1"], mu: 100 }),
  pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 100000, maquinas: ["b1"], mu: 100 }),
  pool({ produto: "P", etapa: "P3", op: "opC", ordem: 3, q: 100000, maquinas: ["c1"], mu: 100 }),
];
function rodar(p: { H: number; mesmo: boolean; lag?: Record<string, number>; w0?: number }) {
  const g = construirGrafo(pools3);
  const cap = { "P|P1": novaCap(p.H), "P|P2": novaCap(p.H), "P|P3": novaCap(p.H) };
  for (let t = 0; t < p.H; t++) { cap["P|P1"].base[t] = 100; cap["P|P2"].base[t] = 100; cap["P|P3"].base[t] = 100; }
  return simularGrupo(g, g.grupos[0], {
    tIni: 0, tFim: p.H, cap, B0: { "P|P1": 0, "P|P2": 0, "P|P3": 0 }, W0: { "P|P1": p.w0 ?? 0, "P|P2": 0 }, L0: {}, Q: { "P|P1": 100000, "P|P2": 100000, "P|P3": 100000 },
    mesmoPeriodo: p.mesmo, trajetoria: true, ...(p.lag ? { lagPorAresta: p.lag } : {}),
  });
}

describe("simulador: defasagem por aresta", () => {
  it("sem lagPorAresta ou com o lag igual ao global ⇒ resultado idêntico", () => {
    for (const mesmo of [true, false]) {
      const base = rodar({ H: 5, mesmo });
      expect(rodar({ H: 5, mesmo, lag: { "P|P1": mesmo ? 0 : 1, "P|P2": mesmo ? 0 : 1 } })).toEqual(base);
    }
  });
  it("arestas com modos diferentes na mesma cadeia: P1→P2 contínuo, P2→P3 em lote", () => {
    const r = rodar({ H: 3, mesmo: false, lag: { "P|P1": 0, "P|P2": 1 } });
    expect(r.x["P|P2"]).toEqual([100, 100, 100]); // P2 usa o que P1 produz no mesmo período
    expect(r.x["P|P3"]).toEqual([0, 100, 100]); // P3 só vê o de P2 no período seguinte
  });
  it("lote com atraso de 2 períodos", () => {
    const r = rodar({ H: 5, mesmo: false, lag: { "P|P1": 2, "P|P2": 2 } });
    expect(r.x["P|P2"]).toEqual([0, 0, 100, 100, 100]);
    expect(r.x["P|P3"]).toEqual([0, 0, 0, 0, 100]);
  });
});

// ---- forecast ----
const H = 3;
const per = Array.from({ length: H }, (_, t) => ({ rotulo: `P${t}`, duracaoMin: 100 }));
const no = (id: string, prod: number, cap = prod): NoForecast => ({ id, rotulo: id, producaoPrevista: new Array(H).fill(prod), capacidadeMaxima: new Array(H).fill(cap), pecasPorPosto: new Array(H).fill(1000) });
const lig = (o: string, d: string, wip: number, x: Partial<LigacaoForecast> = {}): LigacaoForecast => ({ id: `${o}${d}`, origem: o, destino: d, wipInicial: wip, confianca: "alta", ...x });
const ent = (nos: NoForecast[], ligacoes: LigacaoForecast[]): EntradaForecast => ({ periodos: per, nos, ligacoes });

describe("forecast: contínuo × lote × desconhecido por ligação", () => {
  it("Etiquetadora→Embalagem contínuo (30/10 T1): estoque 3.600, entra 2.650, sai 5.400 ⇒ saldo final 850, sem ruptura", () => {
    const r = forecastBuffer(ent([no("E", 2650), no("M", 5400)], [lig("E", "M", 3600, { transferencia: "continuo" })]));
    const l = r.ligacoes[0];
    expect(l.saldoInicial[0]).toBe(3600);
    expect(l.entradaNoPeriodo[0]).toBe(2650);
    expect(l.saidaNoPeriodo[0]).toBe(5400);
    expect(l.taxaLiquida[0]).toBe(-2750);
    expect(l.saldoFinal[0]).toBe(850);
    expect(l.rupturaPrevista?.periodo).toBe(1); // T2: 850 + 2.650 < 5.400
    expect(l.incerta).toBe(false);
    expect(r.alternativo).toBeNull();
  });
  it("a mesma ligação em lote rompe já em T1 (3.600 < 5.400) — a regra global conservadora subestima o par contínuo", () => {
    const lote = forecastBuffer(ent([no("E", 2650), no("M", 5400)], [lig("E", "M", 3600, { transferencia: "lote" })])).ligacoes[0];
    expect(lote.rupturaPrevista?.periodo).toBe(0);
    expect(lote.saldoFinal[0]).toBe(2650); // 3.600 − 3.600 consumidos + 2.650 que chegam para o período seguinte
  });
  it("minuto da ruptura considera a entrada contínua durante o período", () => {
    const r = forecastBuffer(ent([no("A", 1000), no("B", 4000)], [lig("A", "B", 1000, { transferencia: "continuo" })]));
    expect(r.ligacoes[0].rupturaPrevista?.periodo).toBe(0);
    expect(r.ligacoes[0].rupturaPrevista?.minuto).toBeCloseTo(33.333, 2); // 1.000 ÷ (4.000 − 1.000)
  });
  it("desconhecido: calcula os DOIS cenários (principal = lote, alternativo = contínuo) e sinaliza a divergência", () => {
    const r = forecastBuffer(ent([no("E", 2650), no("M", 5400)], [lig("E", "M", 3600, { transferencia: "desconhecido" })]));
    expect(r.ligacoes[0].incerta).toBe(true);
    expect(r.ligacoes[0].divergeEntreCenarios).toBe(true);
    expect(r.ligacoes[0].rupturaPrevista?.periodo).toBe(0);
    expect(r.alternativo).not.toBeNull();
    expect(r.alternativo!.ligacoes[0].rupturaPrevista?.periodo).toBe(1);
    expect(r.avisos.join(" ")).toMatch(/DESCONHECIDA/);
  });
  it("desconhecido sem diferença entre os cenários não gera alerta de divergência", () => {
    const r = forecastBuffer(ent([no("A", 0, 1000), no("B", 1000)], [lig("A", "B", 50000, { transferencia: "desconhecido" })]));
    expect(r.ligacoes[0].incerta).toBe(true);
    expect(r.ligacoes[0].divergeEntreCenarios).toBe(false);
  });
  it("lote com atraso de 2 períodos: a produção de P0 só serve P2", () => {
    const r = forecastBuffer(ent([no("A", 1000), no("B", 1000)], [lig("A", "B", 0, { transferencia: "lote", atrasoPeriodos: 2 })]));
    const l = r.ligacoes[0];
    expect(l.entradaNoPeriodo).toEqual([0, 0, 1000]);
    expect(l.rupturaPrevista?.periodo).toBe(0);
    expect(r.nos.find((n) => n.noId === "B")!.producaoPlano).toEqual([0, 0, 1000]);
  });
  it("cadeia com modos diferentes por ligação: A→B desconhecido, B→C contínuo; a ação sobe pela cadeia respeitando cada modo", () => {
    const e = ent([no("A", 0, 3000), no("B", 0, 3000), no("C", 3000)], [lig("A", "B", 10000, { transferencia: "desconhecido" }), lig("B", "C", 3000, { transferencia: "continuo" })]);
    const r = forecastBuffer(e);
    const bc = r.ligacoes.find((l) => l.ligacaoId === "BC")!;
    expect(bc.transferencia).toBe("continuo");
    expect(bc.acao.ligarEm).toBe(1); // contínuo: B produz no PRÓPRIO período em que C consome (o estoque de 3.000 cobre T0)
    expect(bc.rupturaComAcao).toBeNull();
    const emLote = forecastBuffer(ent([no("A", 0, 3000), no("B", 0, 3000), no("C", 3000)], [lig("A", "B", 10000, { transferencia: "lote" }), lig("B", "C", 3000, { transferencia: "lote" })]));
    expect(emLote.ligacoes.find((l) => l.ligacaoId === "BC")!.acao.ligarEm).toBe(0); // em lote tem que ligar um período antes
    expect(r.ligacoes.find((l) => l.ligacaoId === "AB")!.incerta).toBe(true);
  });
  it("padrão por opção: ligação sem modo declarado segue mesmoPeriodo (compatível com o uso anterior)", () => {
    const a = forecastBuffer(ent([no("E", 2650), no("M", 5400)], [lig("E", "M", 3600)]), { mesmoPeriodo: true }).ligacoes[0];
    expect(a.transferencia).toBe("continuo");
    expect(a.saldoFinal[0]).toBe(850);
    expect(forecastBuffer(ent([no("E", 2650), no("M", 5400)], [lig("E", "M", 3600)])).ligacoes[0].transferencia).toBe("lote");
  });
});

describe("Conector 3/4\": Rosquear→Parafusar DESCONHECIDO · Parafusar→Etiquetar LOTE · Etiquetar→Embalar CONTÍNUO · Máquina 8 como fonte alternativa (DESCONHECIDO)", () => {
  // A = Rosquear, B = Parafusar, C = Etiquetar (fundido), D = Embalar, M8 = Rosquear+Parafusar automática (2ª origem de C)
  const nosC = [no("A", 0, 3000), no("B", 0, 2280), no("C", 3000, 6000), no("D", 5400), no("M8", 0, 996)];
  const ligC = (cd: LigacaoForecast["transferencia"] = "continuo") => [
    lig("A", "B", 6000, { transferencia: "desconhecido" }),
    lig("B", "C", 6000, { transferencia: "lote", peso: 0.75 }),
    lig("M8", "C", 0, { transferencia: "desconhecido", peso: 0.25 }),
    lig("C", "D", 3600, { transferencia: cd }),
  ];
  const L = (r: ReturnType<typeof forecastBuffer>, id: string) => r.ligacoes.find((l) => l.ligacaoId === id)!;

  it("cada aresta mantém o seu modo; só as desconhecidas são marcadas incertas e geram o cenário alternativo", () => {
    const r = forecastBuffer(ent(nosC, ligC()));
    expect(r.ligacoes.map((l) => [l.ligacaoId, l.transferencia, l.incerta])).toEqual([["AB", "desconhecido", true], ["BC", "lote", false], ["M8C", "desconhecido", true], ["CD", "continuo", false]]);
    expect(r.alternativo).not.toBeNull();
    expect(r.alternativo!.ligacoes.map((l) => l.atrasoPeriodos)).toEqual([0, 1, 0, 0]); // desconhecidas viram contínuo no alternativo; o lote continua lote
    expect(r.ligacoes.map((l) => l.atrasoPeriodos)).toEqual([1, 1, 1, 0]); // principal: desconhecido = lote de 1 período
  });
  it("Etiquetar→Embalar contínuo: consome durante o período o que a Etiquetadora libera (sem fixar regra global)", () => {
    const l = L(forecastBuffer(ent(nosC, ligC())), "CD");
    expect(l.saldoInicial[0]).toBe(3600);
    expect(l.entradaNoPeriodo[0]).toBe(3000);
    expect(l.saidaNoPeriodo[0]).toBe(5400);
    expect(l.saldoFinal[0]).toBe(1200);
    expect(l.rupturaPrevista?.periodo).toBe(1); // 1.200 + 3.000 < 5.400
  });
  it("Parafusar→Etiquetar em lote: a produção de Tn só entra em Tn+1", () => {
    const r = forecastBuffer(ent([...nosC.filter((n) => n.id !== "B"), no("B", 1000, 2280)], ligC()));
    const bc = L(r, "BC");
    expect(bc.entradaNoPeriodo).toEqual([0, 1000, 1000]);
  });
  it("REORDER_POINT / ligar: lote = um período ANTES; contínuo = no mesmo período", () => {
    const r = forecastBuffer(ent(nosC, ligC()));
    // Embalar (contínuo) falta 1.200 em T1 ⇒ a Etiquetadora (origem) liga NO PRÓPRIO T1
    expect(L(r, "CD").acao.ligarEm).toBe(1);
    // essa produção extra de Etiquetar em T1 consome Parafusar em lote ⇒ Parafusar precisa ter produzido em T0
    expect(L(r, "BC").acao.ligarEm).toBe(0);
    // a mesma Embalagem, se fosse lote, exigiria a Etiquetadora um período antes
    const emLote = forecastBuffer(ent(nosC, ligC("lote")));
    expect(L(emLote, "CD").acao.ligarEm).toBe(0);
    expect(L(emLote, "CD").pontoDePedido[0]).toBeGreaterThan(L(r, "CD").pontoDePedido[0]);
  });
  it("destino com origens de modos diferentes: avisa e usa o mais conservador; Máquina 8 desconhecida aparece como incerta, sem inventar a regra", () => {
    const r = forecastBuffer(ent(nosC, ligC()));
    expect(r.alternativo!.avisos.join(" ")).toMatch(/modos de transferência diferentes/); // no cenário contínuo a M8 (0) e a Parafusar (lote, 1) divergem
    expect(L(r, "M8C").incerta).toBe(true);
    expect(L(r, "M8C").transferencia).toBe("desconhecido");
  });
  it("Rosquear→Parafusar desconhecido: os dois cenários são calculados e a divergência é sinalizada só quando existe", () => {
    // WIP baixo em A→B e B precisa produzir já em T0 para atender a cadeia ⇒ lote e contínuo mudam o que A precisa fazer
    const nos2 = [no("A", 0, 3000), no("B", 0, 2280), no("C", 3000, 6000), no("D", 5400), no("M8", 0, 996)];
    const lig2 = [lig("A", "B", 0, { transferencia: "desconhecido" }), lig("B", "C", 6000, { transferencia: "lote", peso: 0.75 }), lig("M8", "C", 0, { transferencia: "desconhecido", peso: 0.25 }), lig("C", "D", 3600, { transferencia: "continuo" })];
    const r = forecastBuffer(ent(nos2, lig2));
    const ab = L(r, "AB");
    const abAlt = L(r.alternativo!, "AB");
    expect(ab.incerta).toBe(true);
    expect(ab.acao.tipo).toBe("sem_fonte"); // lote: A precisaria ter produzido ANTES do horizonte para B produzir em T0
    expect(abAlt.acao.tipo).toBe("ligar_upstream"); // contínuo: A liga no próprio T0, junto com B
    expect(abAlt.acao.ligarEm).toBe(0);
    expect(ab.divergeEntreCenarios).toBe(true);
  });
});
