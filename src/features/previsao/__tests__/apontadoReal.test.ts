import { describe, it, expect } from "vitest";
import { calcularApontadoReal, totalApontadoReal, type LinhaApontadoEtapa } from "../apontadoReal";

// roteiro A (3 etapas): e1 Cortar(0) > e2 Montar(1) > e3 Embalar(2). Linhas AGRUPADAS como o banco devolve (produto, etapa, operação gravada).
const OP = { cortar: "op-cortar", montar: "op-montar", embalar: "op-embalar", etiq: "op-etiq" };
function linha(p: Partial<LinhaApontadoEtapa> & { etapaId: string; etapaOrdem: number; boas: number }, ultima = { ordem: 2, op: OP.embalar }, opEtapa = ""): LinhaApontadoEtapa {
  const opAtual = opEtapa || ({ e1: OP.cortar, e2: OP.montar, e3: OP.embalar } as Record<string, string>)[p.etapaId] || OP.embalar;
  return {
    produtoId: p.produtoId ?? "A", etapaId: p.etapaId, operacaoId: p.operacaoId ?? opAtual, quantidadeBoa: p.boas, nApontamentos: p.nApontamentos ?? 1,
    etapaOrdem: p.etapaOrdem, etapaOperacaoId: opAtual, ultimaOrdem: ultima.ordem, nNaUltimaOrdem: 1, ultimaOperacaoId: ultima.op,
  };
}

describe("Apontado real: só a ÚLTIMA etapa do roteiro", () => {
  it("3 etapas: 100 boas na 1ª, 90 na 2ª, 80 na última => Apontado real 80 (não 270)", () => {
    const m = calcularApontadoReal([linha({ etapaId: "e1", etapaOrdem: 0, boas: 100 }), linha({ etapaId: "e2", etapaOrdem: 1, boas: 90 }), linha({ etapaId: "e3", etapaOrdem: 2, boas: 80 })]);
    expect(m.get("A")?.apontadoReal).toBe(80);
    expect(m.get("A")?.ambiguoPecas).toBe(0);
  });
  it("produto de etapa única: a única etapa é a final (100 produzidas − 5 refugo = 95 boas, já agregadas pelo banco)", () => {
    const m = calcularApontadoReal([{ ...linha({ produtoId: "P", etapaId: "u1", etapaOrdem: 0, boas: 95 }, { ordem: 0, op: OP.montar }, OP.montar) }]);
    expect(m.get("P")?.apontadoReal).toBe(95);
  });
  it("dois apontamentos da última etapa (40 + 60 boas) somam 100", () => {
    const m = calcularApontadoReal([linha({ etapaId: "e3", etapaOrdem: 2, boas: 40 }), linha({ etapaId: "e3", etapaOrdem: 2, boas: 60 })]);
    expect(m.get("A")?.apontadoReal).toBe(100);
  });
  it("produto sem apontamento da última etapa (só etapas intermediárias) fica em 0 — diagnóstico útil", () => {
    const m = calcularApontadoReal([linha({ etapaId: "e1", etapaOrdem: 0, boas: 500 })]);
    expect(m.get("A")?.apontadoReal).toBe(0);
  });
  it("produto sem roteiro: nada é contado", () => {
    const m = calcularApontadoReal([{ produtoId: "S", etapaId: "x", operacaoId: OP.cortar, quantidadeBoa: 10, nApontamentos: 1, etapaOrdem: null, etapaOperacaoId: null, ultimaOrdem: null, nNaUltimaOrdem: 0, ultimaOperacaoId: null }]);
    expect(m.get("S")?.apontadoReal).toBe(0);
  });
});

describe("roteiro alterado depois do lançamento: ambíguo é REPORTADO, nunca corrigido em silêncio", () => {
  // Caixa: roteiro ATUAL = Etiquetar(0, id c1) > Montar(1, id c2, FINAL). Antes da troca c1=Montar e c2=Etiquetar (mesmos ids).
  const atual = { ordem: 1, op: OP.montar };
  it("apontamento coerente com o roteiro atual (etapa final + operação final) conta", () => {
    const m = calcularApontadoReal([{ produtoId: "C", etapaId: "c2", operacaoId: OP.montar, quantidadeBoa: 33980, nApontamentos: 54, etapaOrdem: 1, etapaOperacaoId: OP.montar, ultimaOrdem: 1, nNaUltimaOrdem: 1, ultimaOperacaoId: OP.montar }]);
    expect(m.get("C")).toMatchObject({ apontadoReal: 33980, ambiguoPecas: 0 });
  });
  it("mesma etapa final (id) mas operação gravada diferente da atual: NÃO conta, vira ambíguo", () => {
    const m = calcularApontadoReal([{ produtoId: "C", etapaId: "c2", operacaoId: OP.etiq, quantidadeBoa: 28961, nApontamentos: 13, etapaOrdem: 1, etapaOperacaoId: OP.montar, ultimaOrdem: atual.ordem, nNaUltimaOrdem: 1, ultimaOperacaoId: atual.op }]);
    expect(m.get("C")).toMatchObject({ apontadoReal: 0, ambiguoPecas: 28961, ambiguoApontamentos: 13 });
  });
  it("operação gravada = operação final atual, mas em etapa que hoje NÃO é a final: NÃO conta, vira ambíguo", () => {
    const m = calcularApontadoReal([{ produtoId: "C", etapaId: "c1", operacaoId: OP.montar, quantidadeBoa: 36530, nApontamentos: 58, etapaOrdem: 0, etapaOperacaoId: OP.etiq, ultimaOrdem: atual.ordem, nNaUltimaOrdem: 1, ultimaOperacaoId: atual.op }]);
    expect(m.get("C")).toMatchObject({ apontadoReal: 0, ambiguoPecas: 36530, ambiguoApontamentos: 58 });
  });
  it("incoerente mas que nenhuma leitura coloca na etapa final: não conta e não é ambíguo", () => {
    const m = calcularApontadoReal([{ produtoId: "C", etapaId: "c1", operacaoId: OP.cortar, quantidadeBoa: 70, nApontamentos: 1, etapaOrdem: 0, etapaOperacaoId: OP.etiq, ultimaOrdem: atual.ordem, nNaUltimaOrdem: 1, ultimaOperacaoId: atual.op }]);
    expect(m.get("C")).toMatchObject({ apontadoReal: 0, ambiguoPecas: 0 });
  });
  it("etapa removida do roteiro: só é ambíguo se a operação gravada for a da etapa final atual", () => {
    const base = { produtoId: "C", etapaId: "morta", quantidadeBoa: 10, nApontamentos: 1, etapaOrdem: null, etapaOperacaoId: null, ultimaOrdem: 1, nNaUltimaOrdem: 1, ultimaOperacaoId: OP.montar };
    expect(calcularApontadoReal([{ ...base, operacaoId: OP.montar }]).get("C")?.ambiguoPecas).toBe(10);
    expect(calcularApontadoReal([{ ...base, operacaoId: OP.cortar }]).get("C")?.ambiguoPecas).toBe(0);
  });
  it("empate na última ordem: não há 'a' etapa final — ambíguo, não conta", () => {
    const m = calcularApontadoReal([{ produtoId: "T", etapaId: "t1", operacaoId: OP.montar, quantidadeBoa: 5, nApontamentos: 1, etapaOrdem: 1, etapaOperacaoId: OP.montar, ultimaOrdem: 1, nNaUltimaOrdem: 2, ultimaOperacaoId: null }]);
    expect(m.get("T")).toMatchObject({ apontadoReal: 0, ambiguoPecas: 5 });
  });
});

describe("totalApontadoReal", () => {
  it("totalApontadoReal soma por produto distinto", () => {
    const m = calcularApontadoReal([linha({ etapaId: "e3", etapaOrdem: 2, boas: 80 })]);
    expect(totalApontadoReal(["A", "A", "X"], m)).toEqual({ apontadoReal: 80, ambiguoPecas: 0 });
  });
});
