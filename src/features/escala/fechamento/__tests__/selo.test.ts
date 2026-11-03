import { describe, expect, it } from "vitest";
import { calcularSelo, type FechamentoSelo, type SlotSelo } from "../selo";

const slot = (data: string, periodoId: string, fimMs: number): SlotSelo => ({ data, periodoId, rotulo: periodoId.toUpperCase(), fimMs });
const SLOTS = [slot("2026-11-03", "m1", 100), slot("2026-11-03", "m2", 200), slot("2026-11-03", "m3", 300)];
const mapa = (o: Record<string, FechamentoSelo>) => new Map(Object.entries(o));

describe("selo da programação", () => {
  it("antes de qualquer período terminar: sem selo", () => expect(calcularSelo(SLOTS, 50, mapa({}))).toBeNull());
  it("último período terminado sem fechamento ⇒ AGUARDANDO FECHAMENTO", () => {
    expect(calcularSelo(SLOTS, 250, mapa({ "2026-11-03|m1": { estado: "CONFIRMADO", excecao: false, fechadoEmMs: 110 } }))?.codigo).toBe("AGUARDANDO_FECHAMENTO");
  });
  it("último período terminado fechado e confirmado ⇒ ESCALA CONFIRMADA", () => {
    const s = calcularSelo(SLOTS, 250, mapa({ "2026-11-03|m2": { estado: "CONFIRMADO", excecao: false, fechadoEmMs: 210 } }));
    expect(s).toMatchObject({ codigo: "ESCALA_CONFIRMADA", texto: "ESCALA CONFIRMADA", periodo: { periodoId: "m2" } });
  });
  it("fechamento de exceção ⇒ confirmada com ESTIMATIVA PARCIAL", () => {
    expect(calcularSelo(SLOTS, 250, mapa({ "2026-11-03|m2": { estado: "CONFIRMADO", excecao: true, fechadoEmMs: 210 } }))?.codigo).toBe("ESCALA_CONFIRMADA_PARCIAL");
  });
  it("recalculando e erro", () => {
    expect(calcularSelo(SLOTS, 250, mapa({ "2026-11-03|m2": { estado: "RECALCULANDO", excecao: false, fechadoEmMs: 210 } }))?.codigo).toBe("RECALCULANDO");
    expect(calcularSelo(SLOTS, 250, mapa({ "2026-11-03|m2": { estado: "ERRO_RECALCULO", excecao: false, fechadoEmMs: 210 } }))?.codigo).toBe("ERRO_RECALCULO");
  });
  it("só olha o ÚLTIMO período terminado (um fechamento antigo não confirma o atual)", () => {
    expect(calcularSelo(SLOTS, 350, mapa({ "2026-11-03|m1": { estado: "CONFIRMADO", excecao: false, fechadoEmMs: 110 }, "2026-11-03|m2": { estado: "CONFIRMADO", excecao: false, fechadoEmMs: 210 } }))?.codigo).toBe("AGUARDANDO_FECHAMENTO");
  });
});
