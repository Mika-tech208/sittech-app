import { describe, it, expect, afterEach } from "vitest";
import { formatBRL, toNumber, setModoPrivadoAtivo, monthLabelShort } from "@/lib/format";

describe("toNumber", () => {
  it("converte string com vírgula decimal", () => {
    expect(toNumber("1234,56")).toBe(1234.56);
  });
  it("converte string com ponto decimal", () => {
    expect(toNumber("1234.56")).toBe(1234.56);
  });
  it("trata undefined/null/vazio como 0", () => {
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber("")).toBe(0);
  });
});

describe("formatBRL", () => {
  afterEach(() => setModoPrivadoAtivo(false));

  it("formata número como moeda BRL", () => {
    expect(formatBRL(1234.5)).toBe(
      new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(1234.5)
    );
  });

  it("trata valor ausente como 0", () => {
    expect(formatBRL(undefined)).toBe(
      new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(0)
    );
  });

  it("oculta o valor quando o modo privado está ativo", () => {
    setModoPrivadoAtivo(true);
    expect(formatBRL(9999)).toBe("R$ ••••");
  });
});

describe("monthLabelShort", () => {
  it("formata mês/ano abreviado", () => {
    expect(monthLabelShort("2026-01")).toBe("Jan/26");
    expect(monthLabelShort("2026-12")).toBe("Dez/26");
  });
});
