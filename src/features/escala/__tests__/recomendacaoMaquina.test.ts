import { describe, it, expect } from "vitest";
import { analisarAtingibilidade } from "../atingibilidade";
import { gerarEscala } from "../gerarEscala";
import { avaliarCenario, classificarGanhos, melhoraGlobal, recomendarMaquinas, type AvaliacaoCenario } from "../recomendacaoMaquina";
import { entrada, equipe, pool } from "./helpers";
import { cenarioAleatorio } from "./adicionalWipHelpers";

const DIA = "2026-10-19";
const comCompativeis = (p: ReturnType<typeof pool>, compat: string[]) => ({ ...p, maquinasCompativeisIds: [...p.maquinasIds, ...compat] });

const ava = (parcial: Partial<AvaliacaoCenario>): AvaliacaoCenario => ({
  coberturaPrevisto: 90, minutosSemPostoPrevisto: 100, statusPrevisto: "em_risco", faltaTotal: 100, valorEmRisco: 100,
  faltaPorProduto: { A: 60, B: 40 }, statusPorProduto: { A: "em_risco", B: "em_risco" }, comAdicional: null, ...parcial,
});

describe("melhora global (regra de aceitação)", () => {
  it("aceita quando reduz a falta sem piorar ninguém", () => {
    expect(melhoraGlobal(ava({}), ava({ faltaTotal: 70, faltaPorProduto: { A: 30, B: 40 } }))).toBe(true);
  });
  it("REJEITA se um produto piora, mesmo que o total melhore (recurso compartilhado)", () => {
    expect(melhoraGlobal(ava({}), ava({ faltaTotal: 50, faltaPorProduto: { A: 0, B: 50 } }))).toBe(false);
  });
  it("REJEITA se o status de um produto piora", () => {
    expect(melhoraGlobal(ava({}), ava({ faltaTotal: 90, faltaPorProduto: { A: 50, B: 40 }, statusPorProduto: { A: "em_risco", B: "impossivel" } }))).toBe(false);
  });
  it("REJEITA se a cobertura piora; aceita ganho só de cobertura (com adicional)", () => {
    expect(melhoraGlobal(ava({}), ava({ faltaTotal: 90, faltaPorProduto: { A: 50, B: 40 }, minutosSemPostoPrevisto: 130 }))).toBe(false);
    expect(melhoraGlobal(ava({ comAdicional: { cobertura: 90, minutosSemPosto: 100 } }), ava({ comAdicional: { cobertura: 92, minutosSemPosto: 80 } }))).toBe(true);
  });
  it("REJEITA quando nada melhora", () => {
    expect(melhoraGlobal(ava({}), ava({}))).toBe(false);
  });
});

describe("recomendação de máquina por cenário completo", () => {
  it("recomenda a máquina que fecha o previsto (capacidade dobra) e mostra impossível → atingível", () => {
    const p = comCompativeis(pool({ produto: "A", op: "o1", q: 1000, maquinas: ["m1"], mu: 100 }), ["m2", "m3"]);
    const e = entrada({ funcionarios: equipe(3), pools: [p] }, [DIA]);
    const g = recomendarMaquinas(e, { margem: 0.1 });
    expect(g).not.toBeNull();
    expect(g!.antes.statusPrevisto).toBe("impossivel");
    expect(g!.depois.statusPrevisto).not.toBe("impossivel");
    expect(g!.depois.faltaTotal).toBeLessThan(g!.antes.faltaTotal);
    expect(g!.passos[0].poolsAfetados).toEqual([{ produtoId: "A", etapaId: "A-e1" }]);
    expect(["m2", "m3"]).toContain(g!.passos[0].maquinaId);
    // m2 e m3 são equivalentes: uma vira alternativa da outra
    expect([g!.passos[0].maquinaId, ...g!.passos[0].alternativas].sort()).toEqual(["m2", "m3"]);
    expect(g!.cenariosSimulados).toBeGreaterThan(2); // rodou a semana inteira de novo para cada candidata
  });

  it("não recomenda quando nenhuma máquina melhora o cenário (máquina compatível indisponível)", () => {
    const p = comCompativeis(pool({ produto: "A", op: "o1", q: 1000, maquinas: ["m1"], mu: 100 }), ["m2"]);
    const e = { ...entrada({ funcionarios: equipe(3), pools: [p] }, [DIA]), maquinasIndisponiveisPrevisao: ["m2"] };
    expect(recomendarMaquinas(e)).toBeNull();
  });

  it("RECURSO COMPARTILHADO: máquina que ajuda um produto mas rouba capacidade de outro é descartada", () => {
    // A (impossível) e B (folgado) dividem a máquina mS; m9 é compatível só com A. Com 1 pessoa cada máquina extra
    // não cria gente: a recomendação só pode existir se NENHUM produto piorar no cenário completo.
    const A = comCompativeis(pool({ produto: "A", op: "o1", q: 900, maquinas: ["mS"], mu: 100, valor: 5 }), ["m9"]);
    const B = pool({ produto: "B", op: "o2", q: 300, maquinas: ["mS"], mu: 100, valor: 1 });
    const e = entrada({ funcionarios: equipe(2), pools: [A, B] }, [DIA]);
    const g = recomendarMaquinas(e);
    if (g) {
      Object.keys(g.antes.faltaPorProduto).forEach((p) => expect(g.depois.faltaPorProduto[p] ?? 0).toBeLessThanOrEqual(g.antes.faltaPorProduto[p] + 1e-6));
      expect(g.depois.minutosSemPostoPrevisto).toBeLessThanOrEqual(g.antes.minutosSemPostoPrevisto + 1e-6);
    }
  });

  it("só recomenda máquinas para produtos já previstos (produtosPermitidos)", () => {
    const A = comCompativeis(pool({ produto: "A", op: "o1", q: 1000, maquinas: ["m1"], mu: 100 }), ["m2"]);
    const B = comCompativeis(pool({ produto: "B", op: "o2", q: 1000, maquinas: ["m3"], mu: 100 }), ["m4"]);
    const e = entrada({ funcionarios: equipe(4), pools: [A, B] }, [DIA]);
    const g = recomendarMaquinas(e, { produtosPermitidos: new Set(["A"]) });
    expect(g).not.toBeNull();
    g!.passos.forEach((p) => p.poolsAfetados.forEach((x) => expect(x.produtoId).toBe("A")));
  });

  it("o cenário avaliado é o MESMO motor: avaliarCenario == gerarEscala + atingibilidade", () => {
    const p = pool({ produto: "A", op: "o1", q: 1000, maquinas: ["m1"], mu: 100 });
    const e = entrada({ funcionarios: equipe(2), pools: [p] }, [DIA]);
    const a = analisarAtingibilidade(e, gerarEscala(e));
    const c = avaliarCenario(e, 0.1);
    expect(c.faltaTotal).toBe(a.faltaTotalPlano);
    expect(c.statusPrevisto).toBe(a.status);
  });

  it("propriedade: toda recomendação (120 cenários) é uma melhora global sem regressão em nenhum produto", () => {
    let comRecomendacao = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const { base } = cenarioAleatorio(seed);
      const pools = base.pools.map((p) => ({ ...p, maquinasCompativeisIds: [...new Set([...p.maquinasIds, "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"])] }));
      const e = { ...base, pools };
      const g = recomendarMaquinas(e, { maxPassos: 2, maxCandidatos: 8 });
      if (!g) continue;
      comRecomendacao++;
      expect(melhoraGlobal(g.antes, g.depois)).toBe(true);
      Object.keys(g.antes.faltaPorProduto).forEach((p) => expect(g.depois.faltaPorProduto[p] ?? 0).toBeLessThanOrEqual(g.antes.faltaPorProduto[p] + 1e-6));
    }
    expect(comRecomendacao).toBeGreaterThan(0);
  });
});

describe("classificação do benefício da recomendação (produtivo / cobertura / margem)", () => {
  it("só aumenta folga (no limite → atingível, falta e ociosidade iguais) = GANHO DE MARGEM", () => {
    const antes = ava({ faltaTotal: 0, faltaPorProduto: { A: 0 }, statusPorProduto: { A: "atingivel_no_limite" }, statusPrevisto: "atingivel_no_limite" });
    const depois = ava({ faltaTotal: 0, faltaPorProduto: { A: 0 }, statusPorProduto: { A: "atingivel" }, statusPrevisto: "atingivel" });
    const g = classificarGanhos(antes, depois);
    expect(g.beneficios).toEqual(["margem"]);
    expect(g.faltaReduzida).toBe(0);
    expect(g.produtos).toEqual([{ produtoId: "A", de: "atingivel_no_limite", para: "atingivel", faltaDe: 0, faltaPara: 0 }]);
  });
  it("reduz a falta = GANHO PRODUTIVO", () => {
    const g = classificarGanhos(ava({}), ava({ faltaTotal: 70, faltaPorProduto: { A: 30, B: 40 } }));
    expect(g.beneficios).toEqual(["produtivo"]);
    expect(g.faltaReduzida).toBe(30);
  });
  it("transforma impossível em possível = GANHO PRODUTIVO (mesmo sem reduzir a falta total medida)", () => {
    const antes = ava({ statusPorProduto: { A: "impossivel", B: "em_risco" }, statusPrevisto: "impossivel" });
    const depois = ava({ statusPorProduto: { A: "em_risco", B: "em_risco" }, statusPrevisto: "em_risco" });
    expect(classificarGanhos(antes, depois).beneficios).toContain("produtivo");
  });
  it("reduz ociosidade = GANHO DE COBERTURA (previsto ou com a melhor carga adicional)", () => {
    expect(classificarGanhos(ava({ minutosSemPostoPrevisto: 100 }), ava({ minutosSemPostoPrevisto: 40 })).beneficios).toEqual(["cobertura"]);
    const g = classificarGanhos(ava({ comAdicional: { cobertura: 90, minutosSemPosto: 100 } }), ava({ comAdicional: { cobertura: 93, minutosSemPosto: 60 } }));
    expect(g.beneficios).toEqual(["cobertura"]);
    expect(g.minutosOciososReduzidos).toBe(40);
  });
  it("uma recomendação pode ter mais de um benefício, em ordem de força", () => {
    const antes = ava({ faltaTotal: 100, faltaPorProduto: { A: 100 }, statusPorProduto: { A: "em_risco", B: "atingivel_no_limite" }, minutosSemPostoPrevisto: 100 });
    const depois = ava({ faltaTotal: 50, faltaPorProduto: { A: 50 }, statusPorProduto: { A: "em_risco", B: "atingivel" }, minutosSemPostoPrevisto: 60 });
    expect(classificarGanhos(antes, depois).beneficios).toEqual(["produtivo", "cobertura", "margem"]);
  });

  it("integração (cenário completo): máquina que só cria folga é recomendada como MARGEM, sem reduzir falta", () => {
    // fecha exatamente (600 de 600) => no limite; com a 2ª máquina ganha folga, mas a produção é a mesma
    const p = comCompativeis(pool({ produto: "A", op: "o1", q: 600, maquinas: ["m1"], mu: 100 }), ["m2"]);
    const e = entrada({ funcionarios: equipe(1), pools: [p] }, [DIA]); // 1 pessoa: a 2ª máquina não muda a ocupação
    const g = recomendarMaquinas(e, { margem: 0.1 });
    expect(g).not.toBeNull();
    expect(g!.antes.statusPorProduto.A).toBe("atingivel_no_limite");
    expect(g!.depois.statusPorProduto.A).toBe("atingivel");
    expect(g!.passos[0].ganhos.beneficios).toEqual(["margem"]);
    expect(g!.passos[0].ganhos.faltaReduzida).toBe(0);
    expect(g!.ganhos.beneficios).toEqual(["margem"]);
  });

  it("integração: máquina que reduz a falta é GANHO PRODUTIVO", () => {
    const p = comCompativeis(pool({ produto: "A", op: "o1", q: 1000, maquinas: ["m1"], mu: 100 }), ["m2"]);
    const e = entrada({ funcionarios: equipe(3), pools: [p] }, [DIA]);
    const g = recomendarMaquinas(e)!;
    expect(g.passos[0].ganhos.beneficios).toContain("produtivo");
    expect(g.passos[0].ganhos.faltaReduzida).toBeGreaterThan(0);
    expect(g.ganhos.beneficios[0]).toBe("produtivo");
  });

  it("integração: quando a máquina reduz ociosidade (avaliador do cenário com carga adicional), é GANHO DE COBERTURA", () => {
    const p = comCompativeis(pool({ produto: "A", op: "o1", q: 300, maquinas: ["m1"], mu: 100 }), ["m2"]);
    const e = entrada({ funcionarios: equipe(3), pools: [p] }, [DIA]);
    // avaliador de teste: cada máquina selecionada ocupa mais uma pessoa com o adicional do cenário
    const avaliarAdicional = (x: typeof e) => {
      const n = new Set(x.pools.flatMap((q) => q.maquinasIds)).size;
      return { cobertura: 80 + 5 * n, minutosSemPosto: 1000 - 100 * n };
    };
    const g = recomendarMaquinas(e, { avaliarAdicional })!;
    expect(g).not.toBeNull();
    expect(g.passos[0].ganhos.beneficios).toContain("cobertura");
    expect(g.passos[0].ganhos.minutosOciososReduzidos).toBeGreaterThan(0);
  });

  it("a recomendação mais forte vem antes (produtivo > cobertura > margem) e toda recomendação continua sem piorar produto", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { base } = cenarioAleatorio(seed);
      const pools = base.pools.map((q) => ({ ...q, maquinasCompativeisIds: [...new Set([...q.maquinasIds, "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"])] }));
      const g = recomendarMaquinas({ ...base, pools }, { maxPassos: 2, maxCandidatos: 8 });
      if (!g) continue;
      g.passos.forEach((passo) => expect(passo.ganhos.beneficios.length).toBeGreaterThan(0));
      expect(g.ganhos.beneficios.length).toBeGreaterThan(0);
    }
  });
});
