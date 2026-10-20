import { describe, it, expect } from "vitest";
import golden from "../__fixtures__/golden_sem_adicional.json";
import { gerarEscala } from "../gerarEscala";
import { cenariosGolden, hashDaSaida } from "./cenariosGolden";

// INVARIANTE (decisão de negócio): com quantidade_adicional = 0 a Escala é IDÊNTICA ao
// comportamento anterior à camada de adicional. Os hashes foram congelados com o motor
// anterior (arquivos completos de alocações, alertas, resumo por período e peças restantes).
describe("sem adicional: Escala idêntica ao comportamento anterior (golden)", () => {
  const esperado = golden as Record<string, string>;
  const cenarios = cenariosGolden();

  it("o golden cobre todos os cenários", () => {
    expect(Object.keys(esperado).sort()).toEqual(cenarios.map((c) => c.nome).sort());
    expect(cenarios.length).toBeGreaterThanOrEqual(20);
  });

  cenarios.forEach((c) => {
    it(`${c.nome}: saída idêntica à do motor anterior`, () => {
      expect(hashDaSaida(c.entrada)).toBe(esperado[c.nome]);
    });
  });

  it("adicionalMax = 0 (explícito) em todos os pools não muda nada", () => {
    cenarios.forEach((c) => {
      const zerado = { ...c.entrada, pools: c.entrada.pools.map((p) => ({ ...p, adicionalMax: 0 })) };
      expect(hashDaSaida(zerado)).toBe(esperado[c.nome]);
    });
  });

  it("nenhuma linha traz crédito adicional quando não há adicional", () => {
    cenarios.forEach((c) => {
      const r = gerarEscala(c.entrada);
      expect(r.alocacoes.some((a) => (a.pecasAdicional ?? 0) !== 0)).toBe(false);
      expect(r.adicionalProduzido).toEqual({});
    });
  });
});
