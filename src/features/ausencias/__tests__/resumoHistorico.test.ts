import { describe, it, expect } from "vitest";
import { calcularResumoPorFuncionario, calcularTotalEquipe } from "../calculations";
import { funcionariosParaResumo } from "../resumoHistorico";

const ativa = { id: "a", nome: "Ana", ativo: true };
const joao = { id: "j", nome: "João", ativo: false, desligadoEm: "2026-10-26T20:00:00Z" }; // saiu 26/10 17:00 (SP)
const maria = { id: "m", nome: "Maria", ativo: false, desligadoEm: "2026-08-10T20:00:00Z" }; // saiu em agosto

describe("resumo de ausências inclui inativos com histórico", () => {
  it("setembro: João (inativo hoje) com atraso em setembro continua na tabela e nos totais", () => {
    const lista = funcionariosParaResumo([ativa, joao, maria], ["j"], "2026-09-01");
    expect(lista.map((f) => f.id)).toEqual(["a", "j"]);
    const resumo = calcularResumoPorFuncionario([{ funcionarioId: "j", tipo: "atraso", duracaoMinutos: 51 }], lista);
    expect(resumo.find((r) => r.funcionarioId === "j")?.atrasos).toBe(1);
    expect(calcularTotalEquipe(resumo).minutosPerdidos).toBe(51);
  });
  it("quem ainda estava ativo em algum momento do período entra mesmo sem registro; quem já tinha saído antes do período não entra", () => {
    const lista = funcionariosParaResumo([ativa, joao, maria], [], "2026-10-01");
    expect(lista.map((f) => f.id)).toEqual(["a", "j"]);
  });
  it("sem data inicial no filtro: só inativos com registro", () => {
    expect(funcionariosParaResumo([ativa, joao, maria], ["m"]).map((f) => f.id)).toEqual(["a", "m"]);
  });
});
