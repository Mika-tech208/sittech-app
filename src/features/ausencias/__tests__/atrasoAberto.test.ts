import { describe, it, expect } from "vitest";
import { hojeEmSaoPaulo, horaEmSaoPaulo, minutosEmAndamento, opcoesInicioAtraso, validarChegadaInformada, visaoAtrasoAberto } from "../atrasoAberto";
import type { PeriodoSimples } from "../calculations";

const J: PeriodoSimples[] = [
  { id: "m1", nome: "M1", inicio: "07:12", fim: "08:48" }, { id: "m2", nome: "M2", inicio: "08:48", fim: "10:24" }, { id: "m3", nome: "M3", inicio: "10:24", fim: "12:00" },
  { id: "t1", nome: "T1", inicio: "13:00", fim: "14:20" }, { id: "t2", nome: "T2", inicio: "14:20", fim: "15:40" }, { id: "t3", nome: "T3", inicio: "15:40", fim: "17:00" },
];

describe("relógio de São Paulo ('Funcionário chegou' usa a hora do servidor em America/Sao_Paulo)", () => {
  it("UTC 11:03 do dia 4 = 08:03 em São Paulo (o fuso do navegador/servidor não importa)", () => {
    const d = new Date("2031-03-04T11:03:40Z");
    expect(horaEmSaoPaulo(d)).toBe("08:03");
    expect(hojeEmSaoPaulo(d)).toBe("2031-03-04");
  });
  it("UTC 01:30 do dia 5 ainda é o dia 4 às 22:30 em São Paulo", () => {
    const d = new Date("2031-03-05T01:30:00Z");
    expect(hojeEmSaoPaulo(d)).toBe("2031-03-04");
    expect(horaEmSaoPaulo(d)).toBe("22:30");
  });
});

describe("opções de início do atraso em aberto", () => {
  it("manhã (07:12) e após o almoço (13:00), derivados da jornada", () => {
    expect(opcoesInicioAtraso(J).map((o) => o.valor)).toEqual(["07:12", "13:00"]);
  });
});

describe("minutos perdidos até agora (só exibição; almoço não conta; limitado ao fim da jornada)", () => {
  it("07:12 até 08:03 = 51 min", () => expect(minutosEmAndamento(J, "07:12:00", "08:03")).toBe(51));
  it("07:12 até 13:30 = 288 + 30 = 318 min (sem o almoço)", () => expect(minutosEmAndamento(J, "07:12:00", "13:30")).toBe(318));
  it("13:00 até 18:00 fica limitado a 17:00 = 240 min", () => expect(minutosEmAndamento(J, "13:00:00", "18:00")).toBe(240));
});

describe("validação da chegada informada", () => {
  const a = { data: "2031-03-04", horarioInicio: "07:12:00" };
  it("aceita chegada válida no mesmo dia", () => expect(validarChegadaInformada(a, "08:03", J, "2031-03-04", "09:00")).toBeNull());
  it("recusa chegada igual/antes do início", () => {
    expect(validarChegadaInformada(a, "07:12", J, "2031-03-04", "09:00")).toMatch(/depois do início/);
    expect(validarChegadaInformada(a, "07:00", J, "2031-03-04", "09:00")).toMatch(/depois do início/);
  });
  it("recusa chegada no futuro (hoje) e depois do fim da jornada", () => {
    expect(validarChegadaInformada(a, "09:30", J, "2031-03-04", "09:00")).toMatch(/futuro/);
    expect(validarChegadaInformada(a, "17:30", J, "2031-03-04", "18:00")).toMatch(/fim da jornada/);
  });
  it("sem horário preenchido", () => expect(validarChegadaInformada(a, "", J, "2031-03-04", "09:00")).toMatch(/Informe/));
});

describe("visão do atraso em aberto", () => {
  it("texto 'Desde 07:12 · EM ABERTO'; do dia anterior = inconsistência operacional", () => {
    expect(visaoAtrasoAberto({ data: "2031-03-04", horarioInicio: "07:12:00" }, "2031-03-04")).toEqual({ texto: "Desde 07:12 · EM ABERTO", inconsistente: false });
    expect(visaoAtrasoAberto({ data: "2031-03-03", horarioInicio: "07:12:00" }, "2031-03-04").inconsistente).toBe(true);
  });
});
