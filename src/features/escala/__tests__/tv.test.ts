import { describe, it, expect } from "vitest";
import { calcularOffset, linhasDoPeriodo, periodosDoDia, situacaoTv, type LinhaTv } from "../tv";
import { epochMsNoFuso } from "../tempo";
import { PERIODOS_REAIS } from "./helpers";

const D = "2026-10-19";

describe("modo TV — AGORA e PRÓXIMO", () => {
  it("durante o M2: agora=M2, próximo=M3, sem destaque ainda", () => {
    const s = situacaoTv(D, PERIODOS_REAIS, epochMsNoFuso(D, "09:30"));
    expect(s.atual?.id).toBe("m2");
    expect(s.proximo?.id).toBe("m3");
    expect(s.destacarProximo).toBe(false);
    expect(s.minutosParaTroca).toBe(54);
  });
  it("poucos minutos antes da troca o próximo ganha destaque", () => {
    const s = situacaoTv(D, PERIODOS_REAIS, epochMsNoFuso(D, "10:20"));
    expect(s.destacarProximo).toBe(true);
    expect(s.minutosParaTroca).toBe(4);
  });
  it("na troca de período muda sozinho (10:24 em ponto já é o M3)", () => {
    expect(situacaoTv(D, PERIODOS_REAIS, epochMsNoFuso(D, "10:23")).atual?.id).toBe("m2");
    expect(situacaoTv(D, PERIODOS_REAIS, epochMsNoFuso(D, "10:24")).atual?.id).toBe("m3");
  });
  it("no almoço não há período atual: o próximo é o T1 com a contagem até 13:00", () => {
    const s = situacaoTv(D, PERIODOS_REAIS, epochMsNoFuso(D, "12:30"));
    expect(s.atual).toBeNull();
    expect(s.proximo?.id).toBe("t1");
    expect(s.minutosParaTroca).toBe(30);
    expect(s.destacarProximo).toBe(false);
  });
  it("antes do expediente e depois do último período", () => {
    const antes = situacaoTv(D, PERIODOS_REAIS, epochMsNoFuso(D, "06:00"));
    expect(antes.proximo?.id).toBe("m1");
    expect(antes.antesDoInicio).toBe(true); // não é "intervalo"
    expect(situacaoTv(D, PERIODOS_REAIS, epochMsNoFuso(D, "12:30")).antesDoInicio).toBe(false);
    const fim = situacaoTv(D, PERIODOS_REAIS, epochMsNoFuso(D, "17:30"));
    expect(fim.encerrado).toBe(true);
    expect(fim.atual).toBeNull();
    expect(fim.proximo).toBeNull();
  });
  it("último período: sem próximo, sem destaque", () => {
    const s = situacaoTv(D, PERIODOS_REAIS, epochMsNoFuso(D, "16:30"));
    expect(s.atual?.id).toBe("t3");
    expect(s.proximo).toBeNull();
    expect(s.destacarProximo).toBe(false);
  });
  it("períodos inválidos são ignorados", () => {
    expect(periodosDoDia(D, [...PERIODOS_REAIS, { id: "x", nome: "X", inicio: "18:00", fim: "18:00" }])).toHaveLength(6);
  });
  it("linhas do período ordenadas por funcionário e offset do relógio do servidor", () => {
    const linhas: LinhaTv[] = [
      { periodo_id: "m2", funcionario_id: "2", funcionario: "Pedro", maquina: "M1", produto: "P", operacao: "O", motivo_sem_posto: null, excecao: false },
      { periodo_id: "m2", funcionario_id: "1", funcionario: "Ana", maquina: null, produto: null, operacao: null, motivo_sem_posto: "x", excecao: false },
      { periodo_id: "m3", funcionario_id: "3", funcionario: "Zé", maquina: "M2", produto: "P", operacao: "O", motivo_sem_posto: null, excecao: false },
    ];
    expect(linhasDoPeriodo(linhas, "m2").map((l) => l.funcionario)).toEqual(["Ana", "Pedro"]);
    expect(linhasDoPeriodo(linhas, null)).toEqual([]);
    expect(calcularOffset("2026-10-19T12:00:05.000Z", Date.parse("2026-10-19T12:00:00.000Z"))).toBe(5000);
    expect(calcularOffset("lixo", 123)).toBe(0);
  });
});
