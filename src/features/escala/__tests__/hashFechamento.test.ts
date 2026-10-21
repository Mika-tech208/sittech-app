// FASE 4d — hash estável (SHA-256 + JSON canônico) e regra de fechamento de período.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { hashCanonico, jsonCanonico, sha256Hex } from "../hashCanonico";
import { lerParametros, modoEfetivoReplanejamento } from "../parametros";
import { avaliarFechamento, instanteDeFechamento, lancamentosTardios, type LancamentoCarimbado } from "../fechamento";

const MIN = 60_000;
const FIM = Date.UTC(2026, 9, 19, 14, 48); // um fim de período qualquer
const maqs = Array.from({ length: 20 }, (_, i) => `m${i + 1}`);
const lanc = (n: number, aposFimMin: number): LancamentoCarimbado[] => maqs.slice(0, n).map((m, i) => ({ maquinaId: m, ms: FIM + (aposFimMin - (n - i) * 0.1) * MIN }));

describe("hash estável", () => {
  it("SHA-256 confere com os vetores conhecidos e com node:crypto (inclui UTF-8)", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    ["", "a", "Revezamento obrigatório — ação", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(1000), "日本語🚀"].forEach((t) => expect(sha256Hex(t)).toBe(createHash("sha256").update(t, "utf8").digest("hex")));
  });
  it("JSON canônico: ordem das chaves não importa; undefined omitido; ruído de ponto flutuante removido", () => {
    expect(hashCanonico({ b: 1, a: [1, 2, { z: 1, y: 2 }] })).toBe(hashCanonico({ a: [1, 2, { y: 2, z: 1 }], b: 1 }));
    expect(jsonCanonico({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(hashCanonico({ v: 0.1 + 0.2 })).toBe(hashCanonico({ v: 0.3 }));
    expect(hashCanonico({ v: 1 })).not.toBe(hashCanonico({ v: 2 }));
    expect(hashCanonico([1, 2])).not.toBe(hashCanonico([2, 1]));
  });
});

describe("fechamento de período (10 min · 90% · 3 min de quietude · 20 min)", () => {
  it("aos 10 min com 89% dos postos esperados: NÃO fecha", () => {
    const a = avaliarFechamento({ fimMs: FIM, agoraMs: FIM + 10 * MIN, postosEsperados: maqs, lancamentos: lanc(17, 5) }); // 85%
    expect(a.pronto).toBe(false);
    const b = avaliarFechamento({ fimMs: FIM, agoraMs: FIM + 10 * MIN, postosEsperados: maqs.slice(0, 9), lancamentos: lanc(8, 5) }); // 88,9%
    expect(b.pronto).toBe(false);
    expect(b.percentual).toBeCloseTo(88.888, 2);
  });
  it("90% e 3 min de silêncio: fecha (estável, dados completos)", () => {
    const a = avaliarFechamento({ fimMs: FIM, agoraMs: FIM + 10 * MIN, postosEsperados: maqs, lancamentos: lanc(18, 5) });
    expect(a).toMatchObject({ pronto: true, motivo: "estavel", dadosCompletos: true, esperados: 20, recebidos: 18 });
    expect(a.faltantes).toEqual(["m19", "m20"]);
  });
  it("antes dos 10 min nunca fecha, mesmo com 100%", () => {
    expect(avaliarFechamento({ fimMs: FIM, agoraMs: FIM + 9 * MIN, postosEsperados: maqs, lancamentos: lanc(20, 2) }).pronto).toBe(false);
  });
  it("lançamento novo reinicia a quietude de 3 min", () => {
    const base = lanc(18, 5);
    const comNovo = [...base, { maquinaId: "m19", ms: FIM + 9 * MIN }];
    expect(avaliarFechamento({ fimMs: FIM, agoraMs: FIM + 10 * MIN, postosEsperados: maqs, lancamentos: comNovo }).pronto).toBe(false);
    expect(avaliarFechamento({ fimMs: FIM, agoraMs: FIM + 11 * MIN + 59_000, postosEsperados: maqs, lancamentos: comNovo }).pronto).toBe(false);
    expect(avaliarFechamento({ fimMs: FIM, agoraMs: FIM + 12 * MIN, postosEsperados: maqs, lancamentos: comNovo }).pronto).toBe(true);
  });
  it("aos 20 min processa mesmo incompleto, marcado como NÃO completo, com o que falta e o último lançamento", () => {
    const l = lanc(10, 8);
    expect(avaliarFechamento({ fimMs: FIM, agoraMs: FIM + 19 * MIN, postosEsperados: maqs, lancamentos: l }).pronto).toBe(false);
    const a = avaliarFechamento({ fimMs: FIM, agoraMs: FIM + 20 * MIN, postosEsperados: maqs, lancamentos: l });
    expect(a).toMatchObject({ pronto: true, motivo: "prazo", dadosCompletos: false, percentual: 50, esperados: 20, recebidos: 10 });
    expect(a.faltantes).toHaveLength(10);
    expect(a.ultimoLancamentoMs).toBe(Math.max(...l.map((x) => x.ms)));
  });
  it("o CORTE é o 1º instante em que o período fecha — não depende de quando o worker roda", () => {
    const l = [...lanc(18, 5), { maquinaId: "m19", ms: FIM + 9 * MIN }];
    const cedo = instanteDeFechamento({ fimMs: FIM, agoraMs: FIM + 30 * MIN, postosEsperados: maqs, lancamentos: l });
    const tarde = instanteDeFechamento({ fimMs: FIM, agoraMs: FIM + 600 * MIN, postosEsperados: maqs, lancamentos: l });
    expect(cedo.corteMs).toBe(FIM + 12 * MIN);
    expect(tarde.corteMs).toBe(cedo.corteMs);
    expect(instanteDeFechamento({ fimMs: FIM, agoraMs: FIM + 11 * MIN, postosEsperados: maqs, lancamentos: l }).corteMs).toBeNull();
    const incompleto = instanteDeFechamento({ fimMs: FIM, agoraMs: FIM + 90 * MIN, postosEsperados: maqs, lancamentos: lanc(5, 4) });
    expect(incompleto.corteMs).toBe(FIM + 20 * MIN);
    expect(incompleto.avaliacao.dadosCompletos).toBe(false);
  });
  it("lançamento depois do corte é tardio (contado, não usado)", () => {
    expect(lancamentosTardios([{ maquinaId: "m1", ms: FIM + 5 * MIN }, { maquinaId: "m2", ms: FIM + 15 * MIN }], FIM + 12 * MIN)).toBe(1);
  });
  it("sem postos esperados: só o tempo e a quietude contam", () => {
    expect(avaliarFechamento({ fimMs: FIM, agoraMs: FIM + 10 * MIN, postosEsperados: [], lancamentos: [] })).toMatchObject({ pronto: true, dadosCompletos: true, percentual: 100 });
  });
});

describe("replanejamento_modo", () => {
  it("padrão desligado; sombra; ativo cai em sombra (nunca altera a escala); valor desconhecido = desligado", () => {
    expect(lerParametros([]).replanejamentoModo).toBe("desligado");
    expect(lerParametros([{ chave: "replanejamento_modo", valor: "sombra" }]).replanejamentoModo).toBe("sombra");
    expect(lerParametros([{ chave: "replanejamento_modo", valor: "ativo" }]).replanejamentoModo).toBe("ativo");
    expect(lerParametros([{ chave: "replanejamento_modo", valor: "loucura" }]).replanejamentoModo).toBe("desligado");
    expect(modoEfetivoReplanejamento("ativo")).toBe("sombra");
    expect(modoEfetivoReplanejamento("sombra")).toBe("sombra");
    expect(modoEfetivoReplanejamento("desligado")).toBe("desligado");
  });
});
