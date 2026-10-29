import { describe, expect, it } from "vitest";
import { fatorPorPoolDosPostos, produtividadeEsperada, produtividadePorPosto, type ObsProdutividade } from "../produtividade";

const T0 = Date.parse("2026-10-05T07:12:00-03:00");
const PER = 90 * 60_000;
let seq = 0;
function obs(i: number, razao: number, extra: Partial<ObsProdutividade> = {}): ObsProdutividade {
  const fim = T0 + i * PER + PER;
  return {
    data: "2026-10-05", periodoId: "m1", funcionarioId: null, maquinaId: "M1", produtoId: "P", etapaId: "E", operacaoId: null,
    boas: razao * 1000, refugo: 0, meta: 1000, status: "produzindo", motivo: null, lancadoEmMs: fim + 60_000 + (seq++ % 3), fimPeriodoMs: fim, inicioPeriodoMs: fim - PER, ...extra,
  };
}
const serie = (n: number, r: number, ini = 0) => Array.from({ length: n }, (_, i) => obs(ini + i, r));
const agoraApos = (n: number) => T0 + n * PER + PER + 10 * 60_000;
const est = (h: ObsProdutividade[], n: number, o = {}, maq = "M1") => produtividadeEsperada(h, "P", "E", maq, agoraApos(n), o);

describe("produtividadeEsperada", () => {
  it("sem histórico: nominal, fator 1, amostra 0", () => {
    const r = est([], 0);
    expect(r.fonte).toBe("nominal"); expect(r.fator).toBe(1); expect(r.amostra).toBe(0); expect(r.pecasPorPeriodo).toBeNull();
    expect(r.diagnostico.codigos).toContain("SEM_HISTORICO_NOMINAL");
  });

  it("amostra abaixo do mínimo ⇒ nominal (mesmo com razão ruim)", () => {
    const r = est(serie(2, 0.5), 2);
    expect(r.fonte).toBe("nominal"); expect(r.fator).toBe(1); expect(r.diagnostico.codigos).toContain("AMOSTRA_INSUFICIENTE_NOMINAL");
  });

  it("amostra pequena ⇒ 'parcial' e encolhida ao nominal; amostra cheia ⇒ 'observada' e mais perto da razão real", () => {
    const pequeno = est(serie(4, 0.8), 4, { prior: "nominal" });
    const grande = est(serie(40, 0.8), 40, { prior: "nominal" });
    expect(pequeno.fonte).toBe("parcial"); expect(grande.fonte).toBe("observada");
    expect(pequeno.fator).toBeGreaterThan(grande.fator); expect(pequeno.fator).toBeLessThan(1); expect(grande.fator).toBeLessThan(0.9);
    expect(grande.fator).toBeGreaterThan(0.8);
    expect(grande.pecasPorPeriodo).toBeCloseTo(grande.fator * 1000, 6);
  });

  it("posto que entrega 1,0 consistentemente ⇒ fator ≈ 1", () => {
    expect(est(serie(30, 1), 30).fator).toBeCloseTo(1, 6);
  });

  it("UM período ruim não derruba a expectativa (queda < 0,05 com 20 períodos de histórico)", () => {
    const antes = est(serie(20, 1), 20).fator;
    const depois = est([...serie(20, 1), obs(20, 0.4)], 21).fator;
    expect(antes - depois).toBeLessThan(0.05); expect(antes - depois).toBeGreaterThanOrEqual(0);
    expect(depois).toBeGreaterThan(0.95);
  });

  it("outlier alto também é contido (1 período a 2,0 não infla o fator)", () => {
    const base = est(serie(20, 0.9), 20).fator;
    const comOut = est([...serie(20, 0.9), obs(20, 2)], 21);
    expect(comOut.fator - base).toBeLessThan(0.05); expect(comOut.diagnostico.outliersWinsorizados).toBeGreaterThan(0);
    expect(comOut.diagnostico.codigos).toContain("OUTLIERS_WINSORIZADOS");
  });

  it("queda CONSISTENTE é refletida gradualmente e monotonicamente", () => {
    const h = serie(24, 1);
    const trilha: number[] = [];
    for (let t = 0; t < 40; t++) { h.push(obs(24 + t, 0.8)); trilha.push(est(h, 24 + t + 1).fator); }
    for (let t = 1; t < trilha.length; t++) expect(trilha[t]).toBeLessThanOrEqual(trilha[t - 1] + 1e-9);
    expect(trilha[0]).toBeGreaterThan(0.97); // 1º período ruim: quase nada
    expect(trilha[39]).toBeLessThan(0.87); // 40 períodos depois: já reflete
    expect(trilha[39]).toBeGreaterThan(0.79);
  });

  it("sem_producao (falta_operador / falta_material) NÃO conta como produtividade baixa, mas fica no diagnóstico", () => {
    const sem = (i: number, motivo: string): ObsProdutividade => obs(i, 0, { status: "sem_producao", motivo, produtoId: null, etapaId: null, boas: 0, meta: 0 });
    const h = [...serie(12, 1), sem(12, "falta_operador"), sem(13, "falta_material"), sem(14, "outro")];
    const r = est(h, 15);
    expect(r.fator).toBeCloseTo(1, 6); expect(r.amostra).toBe(12);
    expect(r.diagnostico.semProducao).toEqual({ falta_operador: 1, falta_material: 1, outro: 1 });
    expect(r.diagnostico.codigos).toContain("FALTA_MATERIAL_NA_JANELA");
  });

  it("linha lançada ANTES do fim do período (parcial) é ignorada por padrão e não puxa o fator", () => {
    const parc = obs(12, 0.5, { lancadoEmMs: T0 + 12 * PER + PER - 10 * 60_000 });
    const r = est([...serie(12, 1), parc], 13);
    expect(r.fator).toBeCloseTo(1, 6); expect(r.diagnostico.parciaisIgnoradas).toBe(1); expect(r.amostra).toBe(12);
    const inc = est([...serie(12, 1), parc], 13, { parcial: "incluir" });
    expect(inc.amostra).toBe(13);
  });

  it("modo 'projetar' extrapola pela fração decorrida do período", () => {
    const parc = obs(12, 0.8, { lancadoEmMs: T0 + 12 * PER + PER - 9 * 60_000 }); // 90% do período decorrido
    const r = est([...serie(12, 1), parc], 13, { parcial: "projetar", c: Infinity, prior: "nominal", k: 0, meiaVida: Infinity });
    expect(r.diagnostico.parciaisProjetadas).toBe(1); expect(r.diagnostico.nivelBruto).toBeGreaterThan(est([...serie(12, 1), parc], 13, { parcial: "incluir", c: Infinity, prior: "nominal", k: 0, meiaVida: Infinity }).diagnostico.nivelBruto as number);
  });

  it("nada do futuro: linhas lançadas depois de `agora` são ignoradas", () => {
    const h = [...serie(12, 1), ...serie(10, 0.3, 12)];
    const antes = produtividadeEsperada(h, "P", "E", "M1", agoraApos(11), {});
    expect(antes.amostra).toBe(12); expect(antes.fator).toBeCloseTo(1, 6);
  });

  it("observações velhas demais saem (posto parado volta ao nominal)", () => {
    const h = serie(15, 0.7);
    const r = produtividadeEsperada(h, "P", "E", "M1", agoraApos(15) + 60 * 86_400_000, {});
    expect(r.fonte).toBe("nominal"); expect(r.fator).toBe(1);
  });

  it("cap [0,30; 1,30] — igual ao f atual", () => {
    expect(est(serie(60, 3), 60, { c: Infinity, prior: "nominal" }).fator).toBeLessThanOrEqual(1.3);
    expect(est(serie(60, 0.01), 60, { c: Infinity, prior: "nominal" }).fator).toBeGreaterThanOrEqual(0.3);
  });

  it("postos são independentes (mesma etapa, outra máquina não contamina com prior nominal)", () => {
    const h = [...serie(20, 1), ...serie(20, 0.7).map((o) => ({ ...o, maquinaId: "M2" }))];
    const a = est(h, 20, { prior: "nominal" }), b = est(h, 20, { prior: "nominal" }, "M2");
    expect(a.fator).toBeGreaterThan(0.99); expect(b.fator).toBeLessThan(0.85);
  });

  it("prior 'pool': máquina com pouca amostra herda a tendência do pool em vez do nominal", () => {
    const h = [...serie(30, 0.8).map((o) => ({ ...o, maquinaId: "M2" })), ...serie(4, 0.8)];
    const nom = est(h, 30, { prior: "nominal" }), pool = est(h, 30, { prior: "pool" });
    expect(pool.fator).toBeLessThan(nom.fator); expect(pool.diagnostico.priorOrigem).toBe("pool");
  });

  it("intervalo contém o fator e encolhe com a amostra", () => {
    const p = est(serie(5, 0.9), 5), g = est(serie(60, 0.9), 60);
    [p, g].forEach((r) => { expect(r.intervalo.lo).toBeLessThanOrEqual(r.fator); expect(r.intervalo.hi).toBeGreaterThanOrEqual(r.fator); });
    expect(g.intervalo.hi - g.intervalo.lo).toBeLessThanOrEqual(p.intervalo.hi - p.intervalo.lo + 1e-12);
  });

  it("meta nominal por período (`metaNominal` por periodoId) define pecasPorPeriodo", () => {
    const r = est(serie(30, 1), 30, { metaNominal: { m1: 2500, t1: 2200 }, periodoId: "t1" });
    expect(r.pecasPorPeriodo).toBeCloseTo(2200, 6);
  });

  it("determinístico e sem mutar a entrada", () => {
    const h = serie(15, 0.85); const copia = JSON.stringify(h);
    const a = est(h, 15), b = est(h, 15);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); expect(JSON.stringify(h)).toBe(copia);
    expect(JSON.stringify(a)).not.toMatch(/NaN|Infinity|null.*fator/);
  });
});

describe("produtividadePorPosto / fatorPorPoolDosPostos", () => {
  it("lote por posto e agregação por pool ponderada pela amostra", () => {
    const h = [...serie(30, 1), ...serie(10, 0.7).map((o) => ({ ...o, maquinaId: "M2" }))];
    const r = produtividadePorPosto(h, [{ produtoId: "P", etapaId: "E", maquinaId: "M1" }, { produtoId: "P", etapaId: "E", maquinaId: "M2" }, { produtoId: "P", etapaId: "E", maquinaId: "M9" }], agoraApos(30), { prior: "nominal" });
    expect(Object.keys(r)).toEqual(["P|E|M1", "P|E|M2", "P|E|M9"]);
    expect(r["P|E|M9"].fonte).toBe("nominal");
    const pool = fatorPorPoolDosPostos(r);
    expect(pool["P|E"]).toBeLessThan(1); expect(pool["P|E"]).toBeGreaterThan(r["P|E|M2"].fator);
  });
});
