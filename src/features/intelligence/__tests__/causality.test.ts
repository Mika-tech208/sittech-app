import { describe, expect, it } from "vitest";
import { avaliarCausalidade } from "@/features/intelligence/causality";

describe("Filtro leve de causalidade (§10/§15)", () => {
  it("caso 1: frase seguindo o padrão recomendado (coincidiu com) não viola", () => {
    const r = avaliarCausalidade("A performance caiu nesta janela. Houve aumento de paradas que coincidiu com esse período — vale investigar.");
    expect(r.violacao).toBe(false);
  });

  it("caso 2: 'foi causado por' viola", () => {
    const r = avaliarCausalidade("A queda de performance foi causado por um problema na máquina.");
    expect(r.violacao).toBe(true);
  });

  it("caso 3: 'caiu porque' viola", () => {
    const r = avaliarCausalidade("A produção caiu porque houve uma parada longa.");
    expect(r.violacao).toBe(true);
  });

  it("caso 4: causalidade envolvendo funcionário é detectada e marcada como tal (§16 — pior classe de erro)", () => {
    const r = avaliarCausalidade("A queda de qualidade foi causado por o funcionário João.");
    expect(r.violacao).toBe(true);
    expect(r.envolveFuncionario).toBe(true);
  });

  it("caso 5: 'culpa de' viola", () => {
    const r = avaliarCausalidade("Isso é culpa de manutenção mal feita.");
    expect(r.violacao).toBe(true);
  });

  it("caso 6: texto neutro sem nenhum padrão causal não viola", () => {
    const r = avaliarCausalidade("A Performance está calculada em 92,3% para a semana atual até agora.");
    expect(r.violacao).toBe(false);
    expect(r.envolveFuncionario).toBe(false);
  });

  it("caso 7: menção a funcionário sem linguagem causal não viola (contexto normal é permitido)", () => {
    const r = avaliarCausalidade("O funcionário Maria está em atenção no contexto Luva 3/4 + Rosquear + Rosqueadeira 3.");
    expect(r.violacao).toBe(false);
  });

  it("caso 8: devolve os padrões encontrados, pra permitir montar a instrução de reformulação", () => {
    const r = avaliarCausalidade("A parada causou a queda de produção.");
    expect(r.padroesEncontrados.length).toBeGreaterThan(0);
  });
});
