import { describe, it, expect } from "vitest";
import { PERIODOS_REAIS } from "@/features/escala/__tests__/helpers";
import { agregarHistoricoEquidade } from "@/features/escala/equidade";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { linhasConsolidadas, type LinhaHistoricoBruta } from "../historicoConsolidado";

const linha = (data: string, periodo_id: string, funcionario_id: string, maquina_id: string | null = "m1", operacao_id: string | null = "opA"): LinhaHistoricoBruta => ({
  data, periodo_id, funcionario_id, maquina_id, operacao_id,
});
const snaps = ["2026-10-26", "2026-10-27"].map((data) => ({ data, periodos_snapshot: PERIODOS_REAIS }));

describe("histórico de equidade só com o que JÁ ACONTECEU", () => {
  it("períodos que ainda não começaram não entram; o período em andamento (já iniciado) entra", () => {
    const agora = epochMsNoFuso("2026-10-27", "09:00"); // terça, M2 em andamento (08:48)
    const brutas = [
      linha("2026-10-26", "t3", "f1"), // segunda à tarde: passado
      linha("2026-10-27", "m1", "f1"), // terça M1: passado
      linha("2026-10-27", "m2", "f1"), // terça M2: em andamento => congelado => conta
      linha("2026-10-27", "m3", "f1"), // terça M3: futuro => fora
      linha("2026-10-27", "t1", "f1"), // futuro => fora
    ];
    const r = linhasConsolidadas(brutas, snaps, PERIODOS_REAIS, agora);
    expect(r.map((x) => x.minutos)).toEqual([80, 96, 96]);
  });

  it("minutos vêm do snapshot do próprio dia, não dos horários atuais", () => {
    const antigo = PERIODOS_REAIS.map((p) => (p.id === "m3" ? { ...p, fim: "12:25" } : p)); // M3 durava 121 min naquele dia
    const r = linhasConsolidadas([linha("2026-10-26", "m3", "f1")], [{ data: "2026-10-26", periodos_snapshot: antigo }], PERIODOS_REAIS, epochMsNoFuso("2026-11-02", "05:00"));
    expect(r[0].minutos).toBe(121);
  });

  it("a equidade da semana seguinte NÃO depende do plano futuro descartável da semana em curso", () => {
    const agora = epochMsNoFuso("2026-10-27", "09:00");
    const consolidado = [linha("2026-10-26", "m1", "f1", "m1", "opA"), linha("2026-10-26", "m1", "f2", "m2", "opB"), linha("2026-10-27", "m1", "f1", "m1", "opA")];
    // dois planos futuros DIFERENTES (resultado de recálculos com caminhos de eventos diferentes)
    const planoX = [linha("2026-10-27", "t1", "f1", "m1", "opA"), linha("2026-10-27", "t2", "f1", "m1", "opA"), linha("2026-10-28", "m1", "f1", "m1", "opA")];
    const planoY = [linha("2026-10-27", "t1", "f2", "m9", "opZ"), linha("2026-10-28", "m1", "f2", "m9", "opZ"), linha("2026-10-28", "m2", "f1", null, null)];
    const todosSnaps = ["2026-10-26", "2026-10-27", "2026-10-28"].map((data) => ({ data, periodos_snapshot: PERIODOS_REAIS }));
    const hx = agregarHistoricoEquidade(linhasConsolidadas([...consolidado, ...planoX], todosSnaps, PERIODOS_REAIS, agora));
    const hy = agregarHistoricoEquidade(linhasConsolidadas([...consolidado, ...planoY], todosSnaps, PERIODOS_REAIS, agora));
    expect(JSON.stringify(hx)).toBe(JSON.stringify(hy));
    const sem = agregarHistoricoEquidade(linhasConsolidadas(consolidado, todosSnaps, PERIODOS_REAIS, agora));
    expect(JSON.stringify(hx)).toBe(JSON.stringify(sem));
  });

  it("semana inteira já passada: tudo entra (geração de segunda-feira vê a semana anterior completa)", () => {
    const brutas = ["m1", "m2", "m3", "t1", "t2", "t3"].map((p) => linha("2026-10-26", p, "f1"));
    const r = linhasConsolidadas(brutas, snaps, PERIODOS_REAIS, epochMsNoFuso("2026-11-02", "06:30"));
    expect(r).toHaveLength(6);
    expect(r.reduce((s, x) => s + x.minutos, 0)).toBe(96 + 96 + 91 + 80 + 80 + 80);
  });
});
