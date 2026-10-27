import { describe, it, expect } from "vitest";
import { calcularApontadoReal, type LinhaApontadoEtapa } from "../apontadoReal";
import { calcularProdutosProgramados, calcularResumoProgramacaoPecas, calcularProdutosNaoPrevistos, calcularHistoricoApontado } from "../progressoSemana";
import { formatPct } from "../formatPct";
import type { PrevisaoItem } from "@/types/domain";

const item = (id: string, produtoId: string, qtd: number, preco = 1): PrevisaoItem => ({ id, produtoId, produtoNome: produtoId, valorUnitario: preco, quantidade: qtd });
const ap = (m: Record<string, number>) => new Map(Object.entries(m).map(([k, v]) => [k, { apontadoReal: v, ambiguoPecas: 0 }]));
// linha do banco (agrupada por produto/etapa/operação). Roteiro: etapa 0 = op0, etapa 1 = op1 (última)
const linhaBanco = (produtoId: string, etapaOrdem: number, ultima: number, boas: number): LinhaApontadoEtapa => ({
  produtoId, etapaId: `${produtoId}-e${etapaOrdem}`, operacaoId: `op${etapaOrdem}`, quantidadeBoa: boas, nApontamentos: 1,
  etapaOrdem, etapaOperacaoId: `op${etapaOrdem}`, ultimaOrdem: ultima, nNaUltimaOrdem: 1, ultimaOperacaoId: `op${ultima}`,
});

describe("Falta, % e total — Apontado real é a fonte", () => {
  it("A) previsto 70.500, apontado 14.230 => falta 56.270 e 20,18%", () => {
    const [p] = calcularProdutosProgramados([item("i", "A", 70500)], [], ap({ A: 14230 }));
    expect(p.apontadoReal).toBe(14230);
    expect(p.falta).toBe(56270);
    expect(p.concluidoPct).toBeCloseTo(20.184, 3);
    expect(formatPct(p.concluidoPct)).toBe("20,2%");
  });
  it("B) acima do previsto: 10.000 previsto, 10.500 apontado => 105%, falta 0 (nunca negativa), sem teto", () => {
    const [p] = calcularProdutosProgramados([item("i", "A", 10000)], [], ap({ A: 10500 }));
    expect(p.concluidoPct).toBe(105);
    expect(p.falta).toBe(0);
    const r = calcularResumoProgramacaoPecas([p]);
    expect(r.totalFalta).toBe(0);
    expect(r.concluidoPct).toBe(105);
  });
  it("C) apontado 0 => falta = previsto, 0%", () => {
    const [p] = calcularProdutosProgramados([item("i", "A", 500)], [], ap({ A: 0 }));
    expect(p.falta).toBe(500);
    expect(p.concluidoPct).toBe(0);
  });
  it("C2) produto sem nenhuma linha no mapa => 0 (mapa existe), e mapa indisponível => null (nunca 0 inventado)", () => {
    expect(calcularProdutosProgramados([item("i", "Z", 5)], [], ap({}))[0].apontadoReal).toBe(0);
    const [p] = calcularProdutosProgramados([item("i", "Z", 5)], [], null);
    expect([p.apontadoReal, p.falta, p.concluidoPct, p.valorRealizado]).toEqual([null, null, null, null]);
    const r = calcularResumoProgramacaoPecas([p]);
    expect([r.totalApontadoReal, r.totalFalta, r.concluidoPct, r.valorRealizado, r.valorFalta]).toEqual([null, null, null, null, null]);
  });
  it("totais da semana: previsto 335.775, apontado 62.359 => falta 273.416 e 18,6%", () => {
    const itens = [item("1", "A", 200000), item("2", "B", 135775)];
    const r = calcularResumoProgramacaoPecas(calcularProdutosProgramados(itens, [], ap({ A: 40000, B: 22359 })));
    expect(r.totalPrevisto).toBe(335775);
    expect(r.totalApontadoReal).toBe(62359);
    expect(r.totalFalta).toBe(273416);
    expect(formatPct(r.concluidoPct)).toBe("18,6%");
  });
  it("Possível é capacidade e não se mistura com andamento", () => {
    const [p] = calcularProdutosProgramados([item("i", "A", 335775)], [{ itemId: "i", maximoPossivel: 316649 } as never], ap({ A: 62359 }));
    expect([p.previsto, p.possivel, p.apontadoReal]).toEqual([335775, 316649, 62359]);
    expect(p.falta).toBe(335775 - 62359); // não 316649 - 62359
  });
  it("total: falta total = previsto total − apontado total (excesso de um produto abate o total, linhas continuam >= 0)", () => {
    const prog = calcularProdutosProgramados([item("1", "A", 1000), item("2", "B", 1000)], [], ap({ A: 1500, B: 400 }));
    expect(prog.map((p) => p.falta)).toEqual([0, 600]);
    const r = calcularResumoProgramacaoPecas(prog);
    expect(r.totalFalta).toBe(100);
    expect(r.somaFaltasPorProduto).toBe(600);
  });
  it("L/16) nunca soma Realizado manual: o cálculo nem recebe o manual, e dois itens do mesmo produto contam o apontado UMA vez", () => {
    expect(calcularProdutosProgramados.length).toBe(3);
    const prog = calcularProdutosProgramados([item("1", "A", 10), item("2", "A", 20)], [], ap({ A: 25 }));
    expect(prog.map((p) => p.apontadoReal)).toEqual([10, 15]); // 10 no primeiro (até o previsto), restante no último
    expect(calcularResumoProgramacaoPecas(prog).totalApontadoReal).toBe(25);
    const exc = calcularProdutosProgramados([item("1", "A", 10), item("2", "A", 20)], [], ap({ A: 50 }));
    expect(exc.map((p) => p.apontadoReal)).toEqual([10, 40]); // excesso fica no último
  });
});

describe("regra de etapa final (cadeia banco -> apontado -> Previsão)", () => {
  it("D/E) refugo já descontado pelo banco (boas = produzido − refugo) e sem_producao nunca chega (status filtrado) => só a quantidade boa conta", () => {
    const m = calcularApontadoReal([linhaBanco("A", 1, 1, 95)]); // 100 produzidas − 5 refugo = 95 já agregado; sem_producao fora do agrupamento
    const [p] = calcularProdutosProgramados([item("i", "A", 100)], [], m);
    expect(p.apontadoReal).toBe(95);
    expect(p.falta).toBe(5);
  });
  it("F) produto de uma operação: a própria operação é a final", () => {
    const m = calcularApontadoReal([linhaBanco("U", 0, 0, 300)]);
    expect(calcularProdutosProgramados([item("i", "U", 1000)], [], m)[0].apontadoReal).toBe(300);
  });
  it("G/H) várias operações: intermediário NÃO conta, só a última", () => {
    const m = calcularApontadoReal([linhaBanco("M", 0, 1, 5000), linhaBanco("M", 1, 1, 1200)]);
    expect(calcularProdutosProgramados([item("i", "M", 2000)], [], m)[0].apontadoReal).toBe(1200);
    const soIntermediario = calcularApontadoReal([linhaBanco("M", 0, 1, 5000)]);
    expect(calcularProdutosProgramados([item("i", "M", 2000)], [], soIntermediario)[0].apontadoReal).toBe(0);
  });
  it("J) correção de apontamento (o banco devolve o novo agregado) atualiza apontado, falta, % e R$", () => {
    const antes = calcularResumoProgramacaoPecas(calcularProdutosProgramados([item("i", "M", 2000, 0.5)], [], calcularApontadoReal([linhaBanco("M", 1, 1, 1000)])));
    const depois = calcularResumoProgramacaoPecas(calcularProdutosProgramados([item("i", "M", 2000, 0.5)], [], calcularApontadoReal([linhaBanco("M", 1, 1, 1500)])));
    expect([antes.totalApontadoReal, antes.totalFalta, antes.valorRealizado]).toEqual([1000, 1000, 500]);
    expect([depois.totalApontadoReal, depois.totalFalta, depois.valorRealizado, depois.concluidoPct]).toEqual([1500, 500, 750, 75]);
  });
  it("roteiro alterado: ambíguo NÃO vira quantidade; fica no diagnóstico", () => {
    const m = calcularApontadoReal([{ ...linhaBanco("X", 1, 1, 70), operacaoId: "opAntiga" }]);
    const prog = calcularProdutosProgramados([item("i", "X", 100)], [], m);
    expect(prog[0].apontadoReal).toBe(0);
    expect(prog[0].apontadoAmbiguoPecas).toBe(70);
  });
});

describe("valores em R$ — preço congelado do item da Previsão", () => {
  it("I/K) R$ previsto = Σ qtd × preço congelado; realizado = Σ apontado × preço congelado; falta = max(prev − real, 0); preço do cadastro é irrelevante", () => {
    const itens = [item("1", "A", 1000, 0.18), item("2", "B", 500, 2)]; // preços congelados na Previsão
    const mapa = ap({ A: 400, B: 100 });
    const r = calcularResumoProgramacaoPecas(calcularProdutosProgramados(itens, [], mapa));
    expect(r.valorPrevisto).toBeCloseTo(180 + 1000, 6);
    expect(r.valorRealizado).toBeCloseTo(72 + 200, 6);
    expect(r.valorFalta).toBeCloseTo(1180 - 272, 6);
    expect(r.concluidoValorPct).toBeCloseTo((272 / 1180) * 100, 6);
    // o cadastro do produto mudou depois (preço novo): a função nem recebe o cadastro => o histórico da semana não muda
    const depoisDeMudarCadastro = calcularResumoProgramacaoPecas(calcularProdutosProgramados(itens, [], mapa));
    expect(depoisDeMudarCadastro.valorRealizado).toBe(r.valorRealizado);
  });
  it("R$ acima do previsto: realizado > previsto => falta R$ 0 (nunca negativa)", () => {
    const r = calcularResumoProgramacaoPecas(calcularProdutosProgramados([item("1", "A", 100, 2)], [], ap({ A: 150 })));
    expect([r.valorRealizado, r.valorFalta]).toEqual([300, 0]);
  });
  it("histórico semanal: usa o preço congelado de cada semana e o apontado dela; semana sem dados => null", () => {
    const semanas = [{ semanaInicio: "2026-10-19", itens: [item("1", "A", 100, 2)] }, { semanaInicio: "2026-10-26", itens: [item("2", "A", 100, 3)] }];
    const h = calcularHistoricoApontado(semanas, new Map([["2026-10-19", ap({ A: 50 })]]));
    expect(h[0]).toMatchObject({ semanaInicio: "2026-10-19", previsto: 200, realizado: 100, pct: 50 });
    expect(h[1]).toMatchObject({ semanaInicio: "2026-10-26", previsto: 300, realizado: null, pct: null });
  });
});

describe("produzido fora da previsão", () => {
  it("lista só produtos com apontado > 0 que não estão na previsão; não entra em nenhum total", () => {
    const itens = [item("1", "A", 10)];
    const mapa = ap({ A: 5, B: 40, C: 0 });
    const fora = calcularProdutosNaoPrevistos(itens, mapa, new Map([["B", "Produto B"], ["C", "Produto C"]]));
    expect(fora).toEqual([{ produtoId: "B", produtoNome: "Produto B", apontadoReal: 40 }]);
    expect(calcularResumoProgramacaoPecas(calcularProdutosProgramados(itens, [], mapa)).totalApontadoReal).toBe(5);
    expect(calcularProdutosNaoPrevistos(itens, null, new Map())).toEqual([]);
  });
});
