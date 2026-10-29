import { describe, it, expect } from "vitest";
import { aderenciaPorPeriodo } from "../aderencia";
import { construirSlots } from "../../tempo";
import { PERIODOS_REAIS } from "../../__tests__/helpers";
import type { AlocacaoEscala } from "../../types";
import { ap } from "./helpersFluxo";

const slots = construirSlots(["2026-10-26"], PERIODOS_REAIS);
const linha = (i: number, maq: string, produto: string, op: string, origem?: "manual"): AlocacaoEscala => ({ data: slots[i].data, periodoId: slots[i].periodoId, funcionarioId: "f1", maquinaId: maq, produtoId: produto, etapaId: `${produto}-e`, operacaoId: op, pecas: 100, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, ...(origem ? { origem } : {}) });
const apt = (i: number, maq: string, produto: string, op: string, extra: object = {}) => ap({ data: slots[i].data, periodoId: slots[i].periodoId, maquinaId: maq, produtoId: produto, etapaId: `${produto}-e`, operacaoId: op, boas: 100, lancadoEmMs: slots[i].fimMs + 60_000, ...extra });
const agora = slots[2].fimMs + 20 * 60_000; // m1 e m2 fechados (m3 também)

describe("aderência à Escala por período (por posto/máquina; nunca por pessoa)", () => {
  it("igual / divergente / não executado / sem apontamento / fora do plano / intervenção manual, com motivo", () => {
    const plan = [linha(0, "m1", "A", "opA"), linha(0, "m2", "A", "opA"), linha(0, "m3", "B", "opB"), linha(0, "m4", "B", "opB", "manual"), linha(0, "m5", "A", "opA")];
    const aps = [
      apt(0, "m1", "A", "opA"), // igual
      apt(0, "m2", "B", "opB"), // divergente (outro produto/operação)
      apt(0, "m3", "B", "opB", { status: "sem_producao", boas: 0, motivo: "falta_material" }), // não executado
      // m4 sem apontamento; m5 sem apontamento
      apt(0, "m9", "A", "opA"), // fora do plano
    ];
    const r = aderenciaPorPeriodo(slots, plan, aps, { agoraMs: agora, incluirPostos: true })[0];
    expect(r).toMatchObject({ planejados: 5, igual: 1, divergente: 1, naoExecutado: 1, semApontamento: 2, foraDoPlano: 1, intervencoesManuais: 1 });
    expect(r.motivos).toEqual({ falta_material: 1 });
    expect(r.aderencia).toBeCloseTo(1 / 3, 3); // exclui sem_apontamento
    expect(r.aderenciaBruta).toBeCloseTo(1 / 5, 3);
    expect(r.postos.find((p) => p.maquinaId === "m4")).toMatchObject({ status: "sem_apontamento", intervencaoManual: true });
    expect(r.postos.find((p) => p.maquinaId === "m2")?.apontado).toEqual({ produtoId: "B", operacaoId: "opB" });
  });
  it("período não fechado não é classificado; lançamento no futuro é ignorado; rótulo de janela", () => {
    const plan = [linha(5, "m1", "A", "opA")];
    const r = aderenciaPorPeriodo(slots, plan, [apt(5, "m1", "A", "opA")], { agoraMs: slots[5].inicioMs ?? 0, janelaConfiavelAteMs: slots[1].fimMs });
    expect(r[5].fechado).toBe(false);
    expect(r[5].igual).toBe(0);
    expect(r[0].janela).toBe("janela_confiavel");
    expect(r[3].janela).toBe("aderencia_nao_confiavel");
  });
  it("máquina com duas linhas (carga adicional) conta uma vez", () => {
    const plan = [linha(0, "m1", "A", "opA"), { ...linha(0, "m1", "A", "opA"), funcionarioId: "f2" }];
    expect(aderenciaPorPeriodo(slots, plan, [apt(0, "m1", "A", "opA")], { agoraMs: agora })[0].planejados).toBe(1);
  });
});
