import { describe, expect, it } from "vitest";
import {
  agendarMontante, compararFontes, coberturaSemReposicao, forecastBuffer, formatarDiagnosticoLigacao,
  type EntradaForecast, type LigacaoForecast, type NoForecast, type OpcoesForecast,
} from "../forecastBuffer";

// Cadeia genérica (ids opacos: nada de produto/etapa do Conector). H períodos de 100 min.
const periodos = (H: number) => Array.from({ length: H }, (_, t) => ({ rotulo: `P${t}`, duracaoMin: 100 }));
const serie = (H: number, v: number) => new Array<number>(H).fill(v);
const no = (id: string, H: number, prod: number, cap?: number, extra: Partial<NoForecast> = {}): NoForecast => ({
  id, rotulo: id, producaoPrevista: serie(H, prod), capacidadeMaxima: serie(H, cap ?? prod), pecasPorPosto: serie(H, 1000), ...extra,
});
const lig = (o: string, d: string, wip: number, extra: Partial<LigacaoForecast> = {}): LigacaoForecast => ({ id: `${o}${d}`, origem: o, destino: d, wipInicial: wip, confianca: "alta", ...extra });
const cadeia = (H: number, nos: NoForecast[], ligacoes: LigacaoForecast[]): EntradaForecast => ({ periodos: periodos(H), nos, ligacoes });
const L = (r: ReturnType<typeof forecastBuffer>, id: string) => r.ligacoes.find((l) => l.ligacaoId === id)!;
const soma = (a: number[]) => a.reduce((s, v) => s + v, 0);

describe("TIME_TO_STARVATION", () => {
  it("exemplo do usuário: 6.000 de WIP e 3.000 por período => 2 períodos de cobertura", () => {
    const c = coberturaSemReposicao(6000, [3000, 3000, 3000, 3000]);
    expect(c.periodos).toBe(2);
    expect(c.periodoDaRuptura).toBe(2);
    expect(c.cobreHorizonte).toBe(false);
  });
  it("fracionário e minuto da ruptura", () => {
    const c = coberturaSemReposicao(4500, [3000, 3000, 3000], [100, 100, 100]);
    expect(c.periodos).toBe(1.5);
    expect(c.minutoDaRuptura).toBe(50);
  });
  it("cobre o horizonte", () => {
    const c = coberturaSemReposicao(20000, [3000, 3000, 3000]);
    expect(c.cobreHorizonte).toBe(true);
    expect(c.periodos).toBeNull();
  });
  it("período de consumo zero conta como tempo decorrido mas não consome", () => {
    expect(coberturaSemReposicao(3000, [0, 3000, 3000]).periodos).toBe(2);
  });
});

describe("cadeia de 2 etapas (A→B)", () => {
  const H = 4;
  const ent = (wip: number, aPlan = 1000, aCap = 3000): EntradaForecast => cadeia(H, [no("A", H, aPlan, aCap), no("B", H, 3000)], [lig("A", "B", wip)]);

  it("diagnostico por ligação: cobertura, saldo, ruptura e ação (conservador)", () => {
    const r = forecastBuffer(ent(6000));
    const d = L(r, "AB");
    expect(d.coberturaSemReposicao.periodos).toBe(2);
    expect(d.saldoSemReposicao).toEqual([3000, 0, 0, 0]);
    // com a reposição do plano (1.000/período): sobra 4.000, 2.000, 1.000, ...
    expect(d.saldoProjetado.slice(0, 3)).toEqual([4000, 2000, 1000]);
    expect(d.rupturaPrevista?.periodo).toBe(2);
    expect(d.rupturaPrevista?.faltaPecas).toBe(1000);
    expect(d.rupturaPrevista?.minuto).toBeCloseTo(66.667, 2);
    expect(d.acao.tipo).toBe("ligar_upstream");
    expect(d.acao.ligarEm).toBe(1);
    expect(d.acao.adicionar).toEqual([0, 1000, 2000, 0]);
    expect(d.rupturaComAcao).toBeNull(); // auto-verificação
    expect(formatarDiagnosticoLigacao(d, r.periodos)).toContain("AÇÃO: ligar P1");
  });

  it("mesmoPeriodo=false × true: o conservador rompe antes e exige mais reposição", () => {
    const cons = L(forecastBuffer(ent(6000), { mesmoPeriodo: false }), "AB");
    const mesmo = L(forecastBuffer(ent(6000), { mesmoPeriodo: true }), "AB");
    expect(cons.rupturaPrevista?.periodo).toBe(2);
    expect(mesmo.rupturaPrevista?.periodo).toBe(3);
    expect(soma(cons.acao.adicionar)).toBeGreaterThan(soma(mesmo.acao.adicionar));
    expect(cons.rupturaComAcao).toBeNull();
    expect(mesmo.rupturaComAcao).toBeNull();
  });

  it("WIP que cobre todo o horizonte: nenhuma ação, nenhuma ruptura", () => {
    const d = L(forecastBuffer(ent(15000, 0)), "AB");
    expect(d.coberturaSemReposicao.cobreHorizonte).toBe(true);
    expect(d.rupturaPrevista).toBeNull();
    expect(d.acao.tipo).toBe("nenhuma");
    expect(d.acao.ligarEm).toBeNull();
  });

  it("ruptura no meio do período: minuto proporcional ao estoque", () => {
    const d = L(forecastBuffer(ent(7500, 0)), "AB");
    expect(d.rupturaPrevista?.periodo).toBe(2);
    expect(d.rupturaPrevista?.minuto).toBeCloseTo(50, 5); // 1.500 de 3.000 => metade do período
  });

  it("capacidade da origem insuficiente: ruptura inevitável (sem_fonte)", () => {
    const d = L(forecastBuffer(ent(0, 0, 1000)), "AB");
    expect(d.acao.tipo).toBe("sem_fonte");
    expect(d.acao.inevitavel).toBeGreaterThan(0);
    expect(d.rupturaComAcao).not.toBeNull();
  });

  it("ponto de pedido dinâmico cobre o tempo até a reposição chegar + o tempo de produzir (capacidade da origem)", () => {
    const e = cadeia(H, [no("A", H, 0, 1500), no("B", H, 3000)], [lig("A", "B", 0)]);
    const pp = L(forecastBuffer(e, { mesmoPeriodo: false }), "AB").pontoDePedido;
    expect(pp).toEqual([7500, 6000, 4500, 3000]); // max_j(ΣC − Σcap anteriores)
    const ppMesmo = L(forecastBuffer(e, { mesmoPeriodo: true }), "AB").pontoDePedido;
    expect(ppMesmo[0]).toBe(6000);
    expect(ppMesmo[0]).toBeLessThan(pp[0]);
  });

  it("gatilho do ponto de pedido dispara antes da ruptura", () => {
    const e = cadeia(H, [no("A", H, 0, 1500), no("B", H, 3000)], [lig("A", "B", 7000)]);
    const d = L(forecastBuffer(e), "AB");
    expect(d.gatilhoPontoDePedido).toBe(0); // 7.000 < 7.500 no período 0
    expect(d.rupturaPrevista?.periodo).toBe(2);
  });
});

describe("propagação pela cadeia A→B→C→D", () => {
  it("3 etapas: B não tem WIP para produzir a reposição => A é acionada", () => {
    const H = 4;
    const e = cadeia(H, [no("A", H, 0, 3000), no("B", H, 0, 3000), no("C", H, 3000)], [lig("A", "B", 4000), lig("B", "C", 0)]);
    const r = forecastBuffer(e);
    expect(L(r, "BC").acao.tipo).toBe("sem_fonte"); // o consumo do período 0 não tem como ser reposto (estoque 0 no início)
    expect(L(r, "BC").acao.ligarEm).toBe(0);
    expect(soma(L(r, "BC").acao.adicionar)).toBe(9000);
    expect(L(r, "AB").acao.ligarEm).toBe(0);
    expect(soma(L(r, "AB").acao.adicionar)).toBe(5000);
    expect(L(r, "AB").rupturaComAcao).toBeNull();
  });

  it("3 etapas: B tem WIP de sobra => A não precisa ser ligada", () => {
    const H = 4;
    const e = cadeia(H, [no("A", H, 0, 3000), no("B", H, 0, 3000), no("C", H, 3000)], [lig("A", "B", 10000), lig("B", "C", 0)]);
    const r = forecastBuffer(e);
    expect(L(r, "AB").acao.tipo).toBe("nenhuma");
    expect(L(r, "AB").acao.adicionar).toEqual([0, 0, 0, 0]);
  });

  it("4 etapas com estoque em todas as ligações: aciona C e B, A não; sem ruptura depois da ação", () => {
    const H = 3;
    const e = cadeia(H, [no("A", H, 0, 1000), no("B", H, 0, 1000), no("C", H, 0, 1000), no("D", H, 1000)], [lig("A", "B", 1000), lig("B", "C", 1000), lig("C", "D", 1000)]);
    const r = forecastBuffer(e);
    expect(L(r, "CD").rupturaPrevista?.periodo).toBe(1);
    expect(L(r, "CD").acao.ligarEm).toBe(0);
    expect(soma(L(r, "CD").acao.adicionar)).toBe(2000);
    expect(L(r, "BC").acao.ligarEm).toBe(0);
    expect(soma(L(r, "BC").acao.adicionar)).toBe(1000);
    expect(L(r, "AB").acao.tipo).toBe("nenhuma");
    r.ligacoes.forEach((d) => expect(d.rupturaComAcao).toBeNull());
  });

  it("4 etapas sem nenhum estoque intermediário: a ruptura inicial é inevitável e fica registrada na ligação certa", () => {
    const H = 5;
    const e = cadeia(H, [no("A", H, 0, 1000), no("B", H, 0, 1000), no("C", H, 0, 1000), no("D", H, 1000)], [lig("A", "B", 0), lig("B", "C", 0), lig("C", "D", 1000)]);
    const r = forecastBuffer(e);
    expect(L(r, "BC").acao.tipo).toBe("sem_fonte");
    expect(L(r, "BC").acao.inevitavel).toBe(1000);
    expect(L(r, "CD").rupturaComAcao).not.toBeNull();
  });

  it("não depende de produto: ids arbitrários e ordem de declaração embaralhada", () => {
    const H = 3;
    const e = cadeia(H, [no("z9", H, 1000), no("a1", H, 0, 3000), no("m5", H, 0, 3000)], [lig("a1", "m5", 100), lig("m5", "z9", 100)]);
    expect(forecastBuffer(e).ligacoes.map((l) => l.ligacaoId).sort()).toEqual(["a1m5", "m5z9"]);
  });

  it("ciclo é recusado", () => {
    const H = 2;
    expect(() => forecastBuffer(cadeia(H, [no("A", H, 1), no("B", H, 1)], [lig("A", "B", 0), lig("B", "A", 0)]))).toThrow(/ciclo/);
  });
});

describe("produtividade real × meta, confiança e margem", () => {
  const H = 4;
  const base = (consumo: number, fonte: "real" | "meta") => cadeia(H, [no("A", H, 0, 3000), no("B", H, consumo, consumo, { fonteTaxa: serie(H, 0).map(() => fonte) })], [lig("A", "B", 6000)]);

  it("ritmo real menor que a meta aumenta a cobertura (e vice-versa)", () => {
    const meta = L(forecastBuffer(base(3000, "meta")), "AB").coberturaSemReposicao.periodos as number;
    const real = L(forecastBuffer(base(2500, "real")), "AB").coberturaSemReposicao.periodos as number;
    const realMaior = L(forecastBuffer(base(3600, "real")), "AB").coberturaSemReposicao.periodos as number;
    expect(meta).toBe(2);
    expect(real).toBe(2.4);
    expect(realMaior).toBeLessThan(meta);
  });

  it("confiança agregada reflete a fonte da taxa e a do WIP", () => {
    expect(forecastBuffer(base(3000, "real")).confianca).toBe("alta");
    expect(forecastBuffer(base(3000, "meta")).confianca).toBe("baixa");
    const e = base(3000, "real");
    e.ligacoes[0].confianca = "media";
    expect(forecastBuffer(e).confianca).toBe("media");
  });

  it("confiança baixa + margem => mais conservador (mais reposição e ponto de pedido maior)", () => {
    const e = base(3000, "real");
    e.ligacoes[0].confianca = "baixa";
    const sem = L(forecastBuffer(e), "AB");
    const op: OpcoesForecast = { margemPorConfianca: { baixa: 0.2 } };
    const com = L(forecastBuffer(e, op), "AB");
    expect(soma(com.acao.adicionar)).toBeGreaterThan(soma(sem.acao.adicionar));
    expect(com.pontoDePedido[0]).toBeGreaterThan(sem.pontoDePedido[0]);
    // confiança alta com a mesma margem configurada para "baixa": nada muda (margem é por confiança)
    e.ligacoes[0].confianca = "alta";
    expect(soma(L(forecastBuffer(e, op), "AB").acao.adicionar)).toBe(soma(sem.acao.adicionar));
  });

  it("fatorReposicao < 1 (quantil baixo da produtividade da origem) pede mais reposição", () => {
    const e = cadeia(H, [no("A", H, 1000, 3000), no("B", H, 3000)], [lig("A", "B", 6000)]);
    const a = L(forecastBuffer(e), "AB");
    const b = L(forecastBuffer(e, { fatorReposicao: 0.8 }), "AB");
    expect(b.saldoProjetado[3]).toBeLessThan(a.saldoProjetado[3]);
    expect(soma(b.acao.adicionar)).toBeGreaterThan(soma(a.acao.adicionar));
    expect(() => forecastBuffer(e, { fatorReposicao: 0 })).toThrow();
  });
});

describe("reposição ≠ produção excessiva", () => {
  const H = 4;
  it("origem planejada além da necessidade: sinaliza capacidade livre (removível) sem criar ruptura", () => {
    const e = cadeia(H, [no("A", H, 3000, 3000, { pecasPorPosto: serie(H, 1000) }), no("B", H, 3000)], [lig("A", "B", 6000)]);
    const r = forecastBuffer(e);
    const A = r.nos.find((n) => n.noId === "A")!;
    expect(r.ligacoes[0].acao.tipo).toBe("nenhuma");
    expect(A.removivel.some((v) => v > 0)).toBe(true);
    expect(Math.max(...A.postosLivres)).toBeGreaterThan(0);
    // o removível de um período, aplicado sozinho, não gera ruptura
    const k = A.removivel.findIndex((v) => v > 0);
    const prod = serie(H, 3000);
    prod[k] -= A.removivel[k];
    const e2 = cadeia(H, [{ ...no("A", H, 0, 3000), producaoPrevista: prod }, no("B", H, 3000)], [lig("A", "B", 6000)]);
    expect(forecastBuffer(e2).ligacoes[0].rupturaPrevista).toBeNull();
  });
  it("demanda restante do destino limita o que a origem precisa repor", () => {
    const e = cadeia(H, [no("A", H, 0, 3000), no("B", H, 3000, 3000, { demandaRestante: 4000 })], [lig("A", "B", 0)]);
    const r = forecastBuffer(e);
    expect(soma(L(r, "AB").acao.adicionar) + L(r, "AB").acao.inevitavel).toBeLessThanOrEqual(4000 + 1e-6);
  });
});

describe("posto sem material (capacidade de pessoas sem peça)", () => {
  it("mede peças e postos-equivalentes que o plano deixa de produzir por falta de material", () => {
    const H = 3;
    const r = forecastBuffer(cadeia(H, [no("A", H, 0, 0), no("B", H, 3000)], [lig("A", "B", 4500)]));
    const B = r.nos.find((n) => n.noId === "B")!;
    expect(B.pecasSemMaterial).toEqual([0, 1500, 3000]);
    expect(B.postosSemMaterial).toEqual([0, 1.5, 3]); // 1 posto = 1.000 pç/período no helper
  });
});

describe("fonte alternativa de reposição (relatório)", () => {
  const H = 4;
  const nec = [0, 3000, 3000, 0];
  const conv = { id: "conv", rotulo: "Rosquear+Parafusar", estagios: [
    { rotulo: "Parafusar", pecasPorPosto: serie(H, 1500), capacidadeMaxima: serie(H, 3000), wipEntrada: 6000 },
    { rotulo: "Rosquear", pecasPorPosto: serie(H, 2000), capacidadeMaxima: serie(H, 4000), wipEntrada: 0, materialExterno: true },
  ] };
  const m8 = { id: "m8", rotulo: "Máquina 8", estagios: [{ rotulo: "Rosquear+Parafusar", pecasPorPosto: serie(H, 1275), capacidadeMaxima: serie(H, 1275), wipEntrada: 0, materialExterno: true }], restricoes: ["op distinta"] };
  it("compara cobertura, pessoas-período e WIP consumido sem decidir nada", () => {
    const c = compararFontes(nec, [m8, conv], { mesmoPeriodo: true });
    expect(c.necessidadeTotal).toBe(6000);
    const rc = c.fontes.find((f) => f.id === "conv")!;
    const r8 = c.fontes.find((f) => f.id === "m8")!;
    expect(rc.cobre).toBe(true);
    expect(rc.wipConsumido).toBe(6000);
    expect(rc.porEstagio.find((e) => e.rotulo === "Rosquear")!.producao.reduce((s, v) => s + v, 0)).toBe(0); // o WIP a montante cobre: Rosquear não precisa ligar
    expect(r8.cobre).toBe(false);
    expect(r8.deficit).toBeGreaterThan(0);
    expect(r8.restricoes).toEqual(["op distinta"]);
    expect(c.ordemSugerida[0]).toBe("conv");
    expect(c.aviso).toMatch(/nenhuma alocação/);
  });
  it("Máquina 8 vence quando a cadeia convencional não tem WIP nem capacidade", () => {
    const m8forte = { ...m8, estagios: [{ ...m8.estagios[0], capacidadeMaxima: serie(H, 3000) }] };
    const convSemWip = { ...conv, estagios: [{ ...conv.estagios[0], wipEntrada: 0, capacidadeMaxima: serie(H, 1000) }, conv.estagios[1]] };
    const c = compararFontes(nec, [convSemWip, m8forte], { mesmoPeriodo: true });
    expect(c.ordemSugerida[0]).toBe("m8");
  });
});

describe("destino com 2 origens (ex.: cadeia convencional + Máquina 8)", () => {
  const H = 4;
  const e = () => cadeia(H, [no("P", H, 0, 3000), no("M8", H, 0, 1200), no("E", H, 3000)], [lig("P", "E", 5000, { peso: 0.75 }), lig("M8", "E", 1000, { peso: 0.25 })]);
  it("cobertura e ruptura são do estoque TOTAL; as duas ligações são marcadas como compartilhadas", () => {
    const r = forecastBuffer(e());
    expect(r.ligacoes.every((l) => l.compartilhada)).toBe(true);
    expect(r.ligacoes[0].coberturaSemReposicao.periodos).toBe(2); // (5.000 + 1.000) ÷ 3.000
    expect(r.ligacoes[0].rupturaPrevista?.periodo).toBe(r.ligacoes[1].rupturaPrevista?.periodo);
    expect(r.ligacoes[0].rupturaPrevista?.periodo).toBe(2);
  });
  it("a reposição extra é repartida pelo peso, limitada pela capacidade de cada origem, e a ação elimina a ruptura", () => {
    const r = forecastBuffer(e());
    const p = L(r, "PE").acao, m = L(r, "M8E").acao;
    expect(soma(p.adicionar) + soma(m.adicionar)).toBeCloseTo(6000, 3); // 12.000 de consumo − 6.000 de estoque
    expect(p.adicionar.every((v) => v <= 3000 + 1e-6)).toBe(true);
    expect(m.adicionar.every((v) => v <= 1200 + 1e-6)).toBe(true);
    expect(soma(p.adicionar)).toBeGreaterThan(soma(m.adicionar));
    expect(r.ligacoes[0].rupturaComAcao).toBeNull();
  });
});

describe("agendarMontante", () => {
  it("empurra para períodos anteriores o que excede a capacidade", () => {
    const a = agendarMontante([0, 3000, 6000, 9000], 0, [3000, 3000, 3000, 3000], [0, 0, 0, 0], false);
    // consumo do período 3 (9.000 acumulado) exige produção até o período 2
    expect(soma(a.producao)).toBeGreaterThanOrEqual(6000);
    expect(a.producao[3]).toBe(0);
  });
});
