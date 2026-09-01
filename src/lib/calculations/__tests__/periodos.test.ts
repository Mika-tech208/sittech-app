import { describe, it, expect } from "vitest";
import { duracaoPeriodoHorasCalc } from "@/lib/calculations/periodos";

describe("duracaoPeriodoHorasCalc", () => {
  it("calcula a duração de um período em horas", () => {
    expect(duracaoPeriodoHorasCalc("07:12", "08:48")).toBeCloseTo(1.6, 5);
  });

  it("calcula um período de exatamente 1 hora", () => {
    expect(duracaoPeriodoHorasCalc("13:00", "14:00")).toBe(1);
  });

  it("retorna 0 quando início ou fim estão vazios", () => {
    expect(duracaoPeriodoHorasCalc("", "08:48")).toBe(0);
    expect(duracaoPeriodoHorasCalc("07:12", "")).toBe(0);
  });

  it("retorna 0 quando o fim é antes ou igual ao início (período inválido)", () => {
    expect(duracaoPeriodoHorasCalc("10:24", "08:48")).toBe(0);
    expect(duracaoPeriodoHorasCalc("10:24", "10:24")).toBe(0);
  });

  it("retorna 0 para horários malformados", () => {
    expect(duracaoPeriodoHorasCalc("abc", "08:48")).toBe(0);
  });

  it("reproduz a soma total dos períodos padrão do sistema (8h43min/dia)", () => {
    const periodos = [
      ["07:12", "08:48"],
      ["08:48", "10:24"],
      ["10:24", "11:55"],
      ["13:00", "14:20"],
      ["14:20", "15:40"],
      ["15:40", "17:00"],
    ] as const;
    const total = periodos.reduce((s, [i, f]) => s + duracaoPeriodoHorasCalc(i, f), 0);
    expect(total).toBeCloseTo(8 + 43 / 60, 5);
  });
});
