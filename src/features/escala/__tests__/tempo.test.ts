import { describe, it, expect } from "vitest";
import { construirSlots, dataHoraNoFuso, epochMsNoFuso, minutosDoHorario, primeiroSlotFuturo, sobrepoe } from "../tempo";
import { PERIODOS_REAIS } from "./helpers";

describe("tempo", () => {
  it("minutos do horário", () => {
    expect(minutosDoHorario("07:12")).toBe(432);
    expect(minutosDoHorario("17:00:00")).toBe(1020);
  });
  it("sobreposição meio-aberta: encostar não sobrepõe", () => {
    expect(sobrepoe(900, 1020, 860, 940)).toBe(true); // 15:00-17:00 x 14:20-15:40
    expect(sobrepoe(940, 1020, 860, 940)).toBe(false); // 15:40-17:00 x 14:20-15:40 só encosta
    expect(sobrepoe(840, 860, 860, 940)).toBe(false);
  });
  it("epoch no fuso de São Paulo (UTC-3) e ida-e-volta", () => {
    const ms = epochMsNoFuso("2026-10-19", "07:12");
    expect(new Date(ms).toISOString()).toBe("2026-10-19T10:12:00.000Z");
    expect(dataHoraNoFuso(ms)).toEqual({ data: "2026-10-19", minutos: 432 });
    expect(dataHoraNoFuso(Date.UTC(2026, 9, 20, 2, 30))).toEqual({ data: "2026-10-19", minutos: 23 * 60 + 30 });
  });
  it("slots: dias ordenados x 6 períodos, primeiro do dia e índices", () => {
    const s = construirSlots(["2026-10-20", "2026-10-19"], PERIODOS_REAIS);
    expect(s).toHaveLength(12);
    expect(s[0].data).toBe("2026-10-19");
    expect(s[0].primeiroDoDia).toBe(true);
    expect(s[6].primeiroDoDia).toBe(true);
    expect(s[5].periodoId).toBe("t3");
    expect(s.map((x) => x.indice)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(s[3].inicioMin).toBe(13 * 60);
  });
  it("período com duração zero não vira slot", () => {
    const s = construirSlots(["2026-10-19"], [...PERIODOS_REAIS, { id: "x9", nome: "X", inicio: "18:00", fim: "18:00" }]);
    expect(s).toHaveLength(6);
  });
  it("primeiro slot futuro: o período em andamento fica congelado", () => {
    const s = construirSlots(["2026-10-19"], PERIODOS_REAIS);
    const durante = epochMsNoFuso("2026-10-19", "09:30"); // M2 em andamento
    expect(s[primeiroSlotFuturo(s, durante)].periodoId).toBe("m3");
    const noInicio = s[2].inicioMs; // exatamente no início do M3: já iniciou
    expect(s[primeiroSlotFuturo(s, noInicio)].periodoId).toBe("t1");
    expect(primeiroSlotFuturo(s, epochMsNoFuso("2026-10-19", "16:00"))).toBe(6);
    expect(primeiroSlotFuturo(s, epochMsNoFuso("2026-10-19", "05:00"))).toBe(0);
  });
});
