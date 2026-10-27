import { describe, it, expect } from "vitest";
import { aplicarIndisponibilidadeEfetiva } from "../indisponibilidadeEfetiva";
import { calcularCapacidadeInicialPorMaquina } from "../calculations";
import { maquinaDisponivelNoSlot } from "@/features/escala/disponibilidade";
import { entrada, equipe, pool } from "@/features/escala/__tests__/helpers";
import type { Maquina, Previsao } from "@/types/domain";

const prev = (semanaInicio: string, maquinasIndisponiveis: string[] = []): Previsao => ({ semanaInicio, itens: [], itensRealizados: [], maquinasIndisponiveis });
const maquinas: Maquina[] = ["m1", "m8", "m9"].map((id) => ({ id, nome: id, operacao: "op", ativo: true }));

describe("Capacidade usa a MESMA indisponibilidade da Escala", () => {
  it("sem nenhuma causa: devolve exatamente as mesmas previsões (referência idêntica — comportamento de antes)", () => {
    const ps = [prev("2026-10-26"), prev("2026-11-02")];
    expect(aplicarIndisponibilidadeEfetiva(ps, new Set(), "2026-10-27")).toBe(ps);
  });
  it("semana corrente e futuras recebem a máquina em Parada; manuais ficam preservadas à parte", () => {
    const [a, b] = aplicarIndisponibilidadeEfetiva([prev("2026-10-26", ["m1"]), prev("2026-11-02")], new Set(["m8"]), "2026-10-27");
    expect(a.maquinasIndisponiveis?.sort()).toEqual(["m1", "m8"]);
    expect(a.maquinasIndisponiveisManuais).toEqual(["m1"]);
    expect(b.maquinasIndisponiveis).toEqual(["m8"]);
  });
  it("semanas já encerradas NÃO mudam (histórico intacto)", () => {
    const antiga = prev("2026-10-12");
    const [r] = aplicarIndisponibilidadeEfetiva([antiga], new Set(["m8"]), "2026-10-27");
    expect(r).toBe(antiga);
  });
  it("a semana corrente vale até o domingo (fim 01/11): em 01/11 ainda conta, em 02/11 não", () => {
    expect(aplicarIndisponibilidadeEfetiva([prev("2026-10-26")], new Set(["m8"]), "2026-11-01")[0].maquinasIndisponiveis).toEqual(["m8"]);
    const p = prev("2026-10-26");
    expect(aplicarIndisponibilidadeEfetiva([p], new Set(["m8"]), "2026-11-02")[0]).toBe(p);
  });
  it("a capacidade inicial por máquina exclui a máquina em Parada", () => {
    const [r] = aplicarIndisponibilidadeEfetiva([prev("2026-10-26")], new Set(["m8"]), "2026-10-27");
    const cap = calcularCapacidadeInicialPorMaquina(maquinas, r.maquinasIndisponiveis ?? [], 40);
    expect(Object.keys(cap).sort()).toEqual(["m1", "m9"]);
  });
  it("consistência com a Escala: toda máquina indisponível para a Capacidade é indisponível para o motor, e vice-versa", () => {
    const [r] = aplicarIndisponibilidadeEfetiva([prev("2026-10-26", ["m1"])], new Set(["m8"]), "2026-10-27");
    const e = entrada({ funcionarios: equipe(1), pools: [pool({ produto: "A", op: "o", q: 10, maquinas: ["m1", "m8", "m9"] })], maquinasIndisponiveisPrevisao: ["m1"],
      indisponibilidades: [{ maquinaId: "m8", desdeMs: 0, liberadaEmMs: null }] }, ["2026-10-28"]);
    const doMotor = ["m1", "m8", "m9"].filter((m) => !maquinaDisponivelNoSlot(e, m, e.slots[0])).sort();
    expect(doMotor).toEqual([...(r.maquinasIndisponiveis ?? [])].sort());
  });
});
