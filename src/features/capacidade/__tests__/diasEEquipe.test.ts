import { describe, it, expect } from "vitest";
import {
  diasDaSemana, diasProdutivosPadrao, resolverDiasProdutivos, alternarDia,
  resolverEquipeProdutiva, alternarMembro, marcarTodos, resumirEquipe, definirOperacao,
} from "../diasEEquipe";
import { calcularHorasPorMaquinaSemana } from "@/lib/calculations/periodos";

const SEMANA = "2026-10-12"; // segunda-feira

describe("dias produtivos da semana", () => {
  it("lista segunda..domingo", () => {
    expect(diasDaSemana(SEMANA)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  });
  it("padrão = segunda em diante, parte inteira, limitado a 0..7", () => {
    expect(diasProdutivosPadrao(SEMANA, 5)).toHaveLength(5);
    expect(diasProdutivosPadrao(SEMANA, 5.5)).toHaveLength(5);
    expect(diasProdutivosPadrao(SEMANA, 0)).toHaveLength(0);
    expect(diasProdutivosPadrao(SEMANA, 9)).toHaveLength(7);
  });
  it("semana sem snapshot usa o padrão; com snapshot ignora mudança do padrão global", () => {
    expect(resolverDiasProdutivos({ semanaInicio: SEMANA }, 4)).toHaveLength(4);
    const gravada = { semanaInicio: SEMANA, diasProdutivos: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-16"] }; // quinta feriado
    expect(resolverDiasProdutivos(gravada, 6)).toHaveLength(4);
  });
  it("capacidade por máquina acompanha os dias marcados (5, 4, 3, sábado, zero)", () => {
    const horasPorDia = 8.8;
    expect(calcularHorasPorMaquinaSemana(horasPorDia, 5)).toBeCloseTo(44);
    expect(calcularHorasPorMaquinaSemana(horasPorDia, 4)).toBeCloseTo(35.2);
    expect(calcularHorasPorMaquinaSemana(horasPorDia, 3)).toBeCloseTo(26.4);
    const comSabado = alternarDia(diasProdutivosPadrao(SEMANA, 5), "2026-10-17");
    expect(comSabado).toHaveLength(6);
    expect(calcularHorasPorMaquinaSemana(horasPorDia, comSabado.length)).toBeCloseTo(52.8);
    expect(calcularHorasPorMaquinaSemana(horasPorDia, 0)).toBe(0);
  });
});

describe("equipe produtiva da semana", () => {
  const funcionarios = [
    { id: "joao", ativo: true, operacaoId: "emb" }, { id: "clarice", ativo: true, operacaoId: "sup" },
    { id: "ex", ativo: false, operacaoId: "emb" }, { id: "novo", ativo: true, operacaoId: "ros" },
  ];
  it("sem snapshot: todos os ativos elegíveis, produtivos", () => {
    const eq = resolverEquipeProdutiva({}, funcionarios);
    expect(eq.map((m) => m.funcionarioId)).toEqual(["joao", "clarice", "novo"]);
    expect(eq.every((m) => m.produtivo)).toBe(true);
  });
  it("desmarcar Clarice não mexe em mais nada e o resumo conta certo", () => {
    const eq = alternarMembro(resolverEquipeProdutiva({}, funcionarios), "clarice");
    const r = resumirEquipe(eq);
    expect(r.produtivos).toBe(2);
    expect(r.texto).toBe("2 de 3 funcionários considerados produtivos nesta semana");
  });
  it("semana antiga preserva a seleção; contratado depois entra desmarcado; inativo do snapshot permanece", () => {
    const antiga = { equipeSemana: [
      { funcionarioId: "joao", produtivo: true, operacaoId: "emb" }, { funcionarioId: "clarice", produtivo: false, operacaoId: "sup" },
      { funcionarioId: "ex", produtivo: true, operacaoId: "emb" },
    ] };
    const eq = resolverEquipeProdutiva(antiga, funcionarios);
    expect(eq.find((m) => m.funcionarioId === "clarice")!.produtivo).toBe(false);
    expect(eq.find((m) => m.funcionarioId === "ex")!.produtivo).toBe(true);
    expect(eq.find((m) => m.funcionarioId === "novo")!.produtivo).toBe(false);
  });
  it("semana nova copia a operação do cadastro; semana gravada mantém a operação do snapshot mesmo se o cadastro mudou", () => {
    expect(resolverEquipeProdutiva({}, funcionarios).find((m) => m.funcionarioId === "novo")!.operacaoId).toBe("ros");
    const cadastroMudou = funcionarios.map((f) => (f.id === "joao" ? { ...f, operacaoId: "ros" } : f));
    const antiga = { equipeSemana: [{ funcionarioId: "joao", produtivo: true, operacaoId: "emb" }] };
    expect(resolverEquipeProdutiva(antiga, cadastroMudou).find((m) => m.funcionarioId === "joao")!.operacaoId).toBe("emb");
  });
  it("ajuste manual muda só a operação da semana", () => {
    const eq = definirOperacao(resolverEquipeProdutiva({}, funcionarios), "clarice", "ros");
    expect(eq.find((m) => m.funcionarioId === "clarice")!.operacaoId).toBe("ros");
    expect(eq.find((m) => m.funcionarioId === "joao")!.operacaoId).toBe("emb");
  });
  it("semana seguinte (sem snapshot) volta a incluir Clarice", () => {
    expect(resolverEquipeProdutiva({}, funcionarios).find((m) => m.funcionarioId === "clarice")!.produtivo).toBe(true);
  });
  it("todos selecionados / nenhum selecionado (sem divisão por zero)", () => {
    const eq = resolverEquipeProdutiva({}, funcionarios);
    expect(resumirEquipe(marcarTodos(eq, true)).produtivos).toBe(3);
    const nenhum = resumirEquipe(marcarTodos(eq, false));
    expect(nenhum.produtivos).toBe(0);
    expect(nenhum.nenhum).toBe(true);
    expect(nenhum.texto).toBe("Nenhum dos 3 funcionários está marcado como produtivo nesta semana");
  });
});
