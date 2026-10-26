import { describe, it, expect } from "vitest";
import { agoraParaInputLocal, efetivoNoFuturo, filtrarPorSituacao, formatarDataHoraSP, inputLocalParaIso } from "../situacao";
import { mensagemDeErro } from "../exclusao";

describe("filtro Ativos / Inativos / Todos", () => {
  const lista = [{ ativo: true, n: 1 }, { ativo: false, n: 2 }, { ativo: true, n: 3 }];
  it("ativos (padrão), inativos e todos", () => {
    expect(filtrarPorSituacao(lista, "ativos").map((f) => f.n)).toEqual([1, 3]);
    expect(filtrarPorSituacao(lista, "inativos").map((f) => f.n)).toEqual([2]);
    expect(filtrarPorSituacao(lista, "todos")).toHaveLength(3);
  });
});

describe("data/hora efetiva (America/Sao_Paulo)", () => {
  it("agora em São Paulo, independente do fuso do navegador", () => {
    expect(agoraParaInputLocal(new Date("2031-03-05T13:00:00Z"))).toBe("2031-03-05T10:00");
    expect(agoraParaInputLocal(new Date("2031-03-05T02:30:00Z"))).toBe("2031-03-04T23:30");
  });
  it("converte para ISO com offset e recusa valor vazio/inválido", () => {
    expect(inputLocalParaIso("2031-03-04T17:00")).toBe("2031-03-04T17:00:00-03:00");
    expect(inputLocalParaIso("")).toBeNull();
    expect(inputLocalParaIso("04/03/2031")).toBeNull();
  });
  it("retroativo é permitido; futuro é recusado (tolerância de 5 min)", () => {
    const agora = new Date("2031-03-05T13:00:00Z"); // 10:00 SP
    expect(efetivoNoFuturo("2031-03-04T17:00", agora)).toBe(false);
    expect(efetivoNoFuturo("2031-03-05T10:03", agora)).toBe(false);
    expect(efetivoNoFuturo("2031-03-05T10:30", agora)).toBe(true);
  });
  it("formata em dd/mm/aaaa hh:mm de São Paulo", () => {
    expect(formatarDataHoraSP("2031-03-04T20:00:00Z")).toBe("04/03/2031 17:00");
    expect(formatarDataHoraSP(null)).toBe("—");
  });
});

describe("mensagens do desligamento", () => {
  it("atraso em aberto e exclusão descontinuada têm texto claro", () => {
    expect(mensagemDeErro("ATRASO_EM_ABERTO: x")).toMatch(/atraso em aberto/i);
    expect(mensagemDeErro("FUNC_EXCLUSAO_DESCONTINUADA: x")).toMatch(/desativar/i);
    expect(mensagemDeErro("FUNC_TEM_VINCULOS: {}")).toMatch(/vínculos/);
  });
});
