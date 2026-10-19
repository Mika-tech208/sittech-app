import { describe, it, expect } from "vitest";
import { gerarDiasDoIntervalo, resumirResultadoLote, diaSemanaCurto, MAX_DIAS_LOTE } from "../lote";

describe("gerarDiasDoIntervalo", () => {
  it("gera todos os dias do intervalo, sem filtrar fim de semana ou feriado", () => {
    const r = gerarDiasDoIntervalo("2026-10-10", "2026-10-13");
    expect(r.dias).toEqual(["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"]);
    expect(r.erro).toBeNull();
    expect(diaSemanaCurto("2026-10-10")).toBe("sáb");
  });
  it("atravessa a virada de ano", () => {
    expect(gerarDiasDoIntervalo("2026-12-30", "2027-01-02").dias).toHaveLength(4);
  });
  it("rejeita fim antes do início e intervalos acima do limite", () => {
    expect(gerarDiasDoIntervalo("2026-10-13", "2026-10-10").erro).not.toBeNull();
    expect(gerarDiasDoIntervalo("2026-10-01", "2026-12-31").erro).not.toBeNull();
    expect(gerarDiasDoIntervalo("2026-10-01", "2026-10-31").dias).toHaveLength(MAX_DIAS_LOTE);
  });
  it("sem datas ainda não é erro", () => {
    expect(gerarDiasDoIntervalo("", "")).toEqual({ dias: [], erro: null });
  });
});

describe("resumirResultadoLote", () => {
  it("separa criados, conflitos e ignorados (desmarcados)", () => {
    const resumo = resumirResultadoLote(
      [
        { data: "2026-10-10", status: "criado" },
        { data: "2026-10-12", status: "conflito" },
        { data: "2026-10-13", status: "criado" },
      ],
      ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"],
      ["2026-10-10", "2026-10-12", "2026-10-13"]
    );
    expect(resumo).toEqual({ criados: ["2026-10-10", "2026-10-13"], jaRegistrados: [], conflitos: ["2026-10-12"], ignorados: ["2026-10-11"] });
  });
  it("retry com a mesma chave aparece como já registrado, não como criado", () => {
    const resumo = resumirResultadoLote([{ data: "2026-10-10", status: "ja_registrado" }], ["2026-10-10"], ["2026-10-10"]);
    expect(resumo.criados).toEqual([]);
    expect(resumo.jaRegistrados).toEqual(["2026-10-10"]);
  });
});
