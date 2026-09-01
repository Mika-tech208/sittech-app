import { describe, it, expect } from "vitest";
import { monthKey, monthLabel, shiftMonth, toISODate, mondayOf, weekLabel, shiftWeek } from "@/lib/date";

describe("monthKey / monthLabel", () => {
  it("gera a chave AAAA-MM", () => {
    expect(monthKey(new Date(2026, 0, 15))).toBe("2026-01");
  });
  it("formata o rótulo por extenso", () => {
    expect(monthLabel("2026-01")).toBe("Janeiro de 2026");
  });
});

describe("shiftMonth", () => {
  it("avança um mês", () => {
    expect(shiftMonth("2026-01", 1)).toBe("2026-02");
  });
  it("retrocede um mês cruzando o ano", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});

describe("toISODate", () => {
  it("formata AAAA-MM-DD", () => {
    expect(toISODate(new Date(2026, 8, 1))).toBe("2026-09-01");
  });
});

describe("mondayOf", () => {
  it("retorna a própria data se já for segunda-feira", () => {
    const segunda = new Date(2026, 8, 7); // 2026-09-07 é uma segunda
    expect(toISODate(mondayOf(segunda))).toBe("2026-09-07");
  });
  it("retorna a segunda-feira anterior para qualquer dia da semana", () => {
    const quinta = new Date(2026, 8, 10); // 2026-09-10 é uma quinta
    expect(toISODate(mondayOf(quinta))).toBe("2026-09-07");
  });
  it("trata domingo corretamente (volta 6 dias)", () => {
    const domingo = new Date(2026, 8, 13); // 2026-09-13 é um domingo
    expect(toISODate(mondayOf(domingo))).toBe("2026-09-07");
  });
});

describe("weekLabel", () => {
  it("formata o intervalo segunda-domingo", () => {
    expect(weekLabel("2026-09-07")).toBe("Semana de 07/09 a 13/09/2026");
  });
});

describe("shiftWeek", () => {
  it("avança uma semana", () => {
    expect(shiftWeek("2026-09-07", 1)).toBe("2026-09-14");
  });
  it("retrocede uma semana", () => {
    expect(shiftWeek("2026-09-07", -1)).toBe("2026-08-31");
  });
});
