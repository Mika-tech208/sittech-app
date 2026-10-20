import { describe, it, expect } from "vitest";
import type { CoberturaSemana } from "@/features/escala/cobertura";
import { resumirConfirmacaoSugestao } from "../confirmacaoSugestao";

function cobertura(parcial: Partial<CoberturaSemana>): CoberturaSemana {
  return {
    percentual: 100, minutosDisponiveis: 0, minutosSemPosto: 0, horasSemPosto: 0, pessoasPeriodoSemPosto: 0, pessoasPeriodoTotal: 0,
    porCausa: { carga: { pessoasPeriodo: 0, minutos: 0 }, maquina_nao_selecionada: { pessoasPeriodo: 0, minutos: 0 }, recurso_indisponivel: { pessoasPeriodo: 0, minutos: 0 }, sem_recurso_compativel: { pessoasPeriodo: 0, minutos: 0 } },
    dias: [],
    ...parcial,
  };
}

const NOMES: Record<string, string> = { a: "Caixa Amarela 4x2", b: "Pino", c: "Luva 3/4\"", d: "Plug Macho" };

describe("confirmação ao aplicar a sugestão de carga adicional", () => {
  const sugestao = {
    porProduto: [
      { produtoId: "a", adicionalSugerido: 17450 },
      { produtoId: "b", adicionalSugerido: 27000 },
      { produtoId: "c", adicionalSugerido: 22500 },
      { produtoId: "d", adicionalSugerido: 0 }, // sem sugestão: não é "afetado"
    ],
    totalPecas: 66950,
    coberturaApos: cobertura({ percentual: 76.1, pessoasPeriodoSemPosto: 86, horasSemPosto: 123.4 }),
  };
  const atual = cobertura({ percentual: 48.7, pessoasPeriodoSemPosto: 186, horasSemPosto: 269 });

  it("mostra peças, produtos, cobertura antes/depois e o que ainda restará (pessoas-período e horas-pessoa)", () => {
    const r = resumirConfirmacaoSugestao(sugestao, atual, (id) => NOMES[id]);
    expect(r.titulo).toBe("Aplicar carga adicional sugerida?");
    expect(r.totalPecas).toBe(66950);
    expect(r.produtos.map((p) => p.nome)).toEqual(["Caixa Amarela 4x2", "Pino", "Luva 3/4\""]); // só os afetados
    expect(r.produtos.map((p) => p.pecas)).toEqual([17450, 27000, 22500]);
    expect(r.coberturaAtual).toBe(48.7);
    expect(r.coberturaEstimada).toBe(76.1);
    expect(r.pessoasPeriodoRestantes).toBe(86);
    expect(r.horasPessoaRestantes).toBeCloseTo(123.4, 9);
    expect(r.linhas).toEqual([
      "+66.950 peças em 3 produtos",
      "Cobertura: 48,7% → 76,1%",
      "Ainda restarão 86 pessoas-período sem posto (123,4 horas-pessoa).",
    ]);
  });

  it("singular e caso em que ninguém fica sem posto", () => {
    const r = resumirConfirmacaoSugestao(
      { porProduto: [{ produtoId: "b", adicionalSugerido: 1000 }], totalPecas: 1000, coberturaApos: cobertura({ percentual: 100 }) },
      cobertura({ percentual: 90, pessoasPeriodoSemPosto: 10 }),
      (id) => NOMES[id]
    );
    expect(r.linhas).toEqual(["+1.000 peças em 1 produto", "Cobertura: 90,0% → 100,0%", "Nenhuma pessoa ficará sem posto."]);
  });

  it("a confirmação é só um resumo: não grava nada (função pura, sem efeitos)", () => {
    const antes = JSON.stringify([sugestao, atual]);
    resumirConfirmacaoSugestao(sugestao, atual, (id) => NOMES[id]);
    expect(JSON.stringify([sugestao, atual])).toBe(antes);
  });
});
