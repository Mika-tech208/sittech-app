import { describe, it, expect } from "vitest";
import {
  calcularAusencia, minutosProdutivosEntre, minutosJornadaCompleta, jornadaInicioFim, formatarDuracao,
  calcularResumoPorFuncionario, calcularTotalEquipe, calcularDisponibilidadePct,
  type PeriodoSimples,
} from "../calculations";

// Jornada oficial da V1 (definida pelo usuário): 07:12–12:00 + 13:00–17:00 = 8h48.
const PERIODOS: PeriodoSimples[] = [
  { id: "m1", nome: "M1", inicio: "07:12", fim: "08:48" },
  { id: "m2", nome: "M2", inicio: "08:48", fim: "10:24" },
  { id: "m3", nome: "M3", inicio: "10:24", fim: "12:00" },
  { id: "t1", nome: "T1", inicio: "13:00", fim: "14:20" },
  { id: "t2", nome: "T2", inicio: "14:20", fim: "15:40" },
  { id: "t3", nome: "T3", inicio: "15:40", fim: "17:00" },
];

describe("jornadaInicioFim", () => {
  it("acha o início do primeiro período e o fim do último", () => {
    expect(jornadaInicioFim(PERIODOS)).toEqual({ inicio: "07:12", fim: "17:00" });
  });
});

describe("minutosJornadaCompleta", () => {
  it("soma 8h48 (528min), excluindo o intervalo de almoço automaticamente", () => {
    expect(minutosJornadaCompleta(PERIODOS)).toBe(528);
  });
});

describe("falta dia inteiro", () => {
  it("usa a jornada inteira do dia: 8h48 de ausência", () => {
    const r = calcularAusencia({ tipo: "falta_dia_inteiro", periodos: PERIODOS });
    expect(r?.duracaoMinutos).toBe(528);
    expect(formatarDuracao(r!.duracaoMinutos)).toBe("8h48");
  });

  it("atestado/falta justificada/não justificada também usam o dia inteiro", () => {
    for (const tipo of ["atestado", "falta_justificada", "falta_nao_justificada"] as const) {
      const r = calcularAusencia({ tipo, periodos: PERIODOS });
      expect(r?.duracaoMinutos).toBe(528);
    }
  });

  it('"outro" NÃO é dia inteiro — sem horário informado, retorna null', () => {
    expect(calcularAusencia({ tipo: "outro", periodos: PERIODOS })).toBeNull();
  });
});

describe("atraso", () => {
  it("exemplo do pedido: previsto 07:12, chegada 09:00 -> 1h48", () => {
    const r = calcularAusencia({ tipo: "atraso", periodos: PERIODOS, horarioReal: "09:00" });
    expect(r?.duracaoMinutos).toBe(108);
    expect(formatarDuracao(r!.duracaoMinutos)).toBe("1h48");
  });

  it("atraso que atravessa o almoço não conta o almoço", () => {
    // chega às 13:30 (devia ter chegado 07:12) — não conta 12:00-13:00
    const r = calcularAusencia({ tipo: "atraso", periodos: PERIODOS, horarioReal: "13:30" });
    // 07:12-12:00 (288min produtivos) + 13:00-13:30 (30min) = 318min, SEM os 60min de almoço
    expect(r?.duracaoMinutos).toBe(318);
  });
});

describe("saída antecipada", () => {
  it("exemplo do pedido: saída real 15:20, previsto 17:00 -> 1h40", () => {
    const r = calcularAusencia({ tipo: "saida_antecipada", periodos: PERIODOS, horarioReal: "15:20" });
    expect(r?.duracaoMinutos).toBe(100);
    expect(formatarDuracao(r!.duracaoMinutos)).toBe("1h40");
  });

  it("saída antecipada que atravessa o almoço não conta o almoço", () => {
    // saiu às 11:30 (devia sair 17:00) — não conta 12:00-13:00
    const r = calcularAusencia({ tipo: "saida_antecipada", periodos: PERIODOS, horarioReal: "11:30" });
    // 11:30-12:00 (30min) + 13:00-17:00 (240min) = 270min
    expect(r?.duracaoMinutos).toBe(270);
  });
});

describe("saída durante expediente", () => {
  it("exemplo do pedido: saiu 09:30, retornou 10:45 -> 1h15", () => {
    const r = calcularAusencia({
      tipo: "saida_durante_expediente", periodos: PERIODOS, horarioJanelaInicio: "09:30", horarioJanelaFim: "10:45",
    });
    expect(r?.duracaoMinutos).toBe(75);
    expect(formatarDuracao(r!.duracaoMinutos)).toBe("1h15");
  });

  it("atravessando o almoço: só conta os minutos produtivos dos dois lados", () => {
    // saiu 11:30, retornou 13:30
    const r = calcularAusencia({
      tipo: "saida_durante_expediente", periodos: PERIODOS, horarioJanelaInicio: "11:30", horarioJanelaFim: "13:30",
    });
    // 11:30-12:00 (30min) + 13:00-13:30 (30min) = 60min, excluindo os 60min de almoço
    expect(r?.duracaoMinutos).toBe(60);
  });

  it("saída e retorno inteiramente dentro do almoço: 0min", () => {
    const r = calcularAusencia({
      tipo: "saida_durante_expediente", periodos: PERIODOS, horarioJanelaInicio: "12:10", horarioJanelaFim: "12:50",
    });
    expect(r?.duracaoMinutos).toBe(0);
  });
});

describe('"outro" — exige início/fim, mesma lógica de janela explícita', () => {
  it("não é mais 8h48 automático — usa só o intervalo informado", () => {
    const r = calcularAusencia({ tipo: "outro", periodos: PERIODOS, horarioJanelaInicio: "09:00", horarioJanelaFim: "10:00" });
    expect(r?.duracaoMinutos).toBe(60);
  });

  it("atravessando o almoço, mesma regra de não contar 12:00-13:00", () => {
    const r = calcularAusencia({ tipo: "outro", periodos: PERIODOS, horarioJanelaInicio: "11:30", horarioJanelaFim: "13:30" });
    expect(r?.duracaoMinutos).toBe(60);
  });
});

describe("minutosProdutivosEntre", () => {
  it("janela totalmente fora dos períodos (ex.: antes do início da jornada) é zero", () => {
    expect(minutosProdutivosEntre(PERIODOS, "06:00", "07:12")).toBe(0);
  });

  it("janela invertida (fim antes do início) é zero, nunca negativa", () => {
    expect(minutosProdutivosEntre(PERIODOS, "10:00", "09:00")).toBe(0);
  });
});

describe("tipos com horário incompleto não calculam (evita a supervisora mandar dado parcial)", () => {
  it("atraso sem horarioReal retorna null", () => {
    expect(calcularAusencia({ tipo: "atraso", periodos: PERIODOS })).toBeNull();
  });
  it("saída durante expediente só com saída (sem retorno) retorna null", () => {
    expect(calcularAusencia({ tipo: "saida_durante_expediente", periodos: PERIODOS, horarioJanelaInicio: "09:00" })).toBeNull();
  });
  it('"outro" só com início (sem fim) retorna null', () => {
    expect(calcularAusencia({ tipo: "outro", periodos: PERIODOS, horarioJanelaInicio: "09:00" })).toBeNull();
  });
});

describe("formatarDuracao", () => {
  it("minutos puros, sem hora cheia", () => {
    expect(formatarDuracao(45)).toBe("45min");
  });
  it("hora cheia, sem minutos", () => {
    expect(formatarDuracao(120)).toBe("2h");
  });
  it("hora e minutos", () => {
    expect(formatarDuracao(108)).toBe("1h48");
  });
  it("zero ou negativo", () => {
    expect(formatarDuracao(0)).toBe("0min");
    expect(formatarDuracao(-5)).toBe("0min");
  });
});
