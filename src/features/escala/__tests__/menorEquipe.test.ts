import { describe, it, expect } from "vitest";
import { buscarMenorEquipe, igualReferencia, TOLERANCIA_PECAS, type RodadaEquipe } from "../menorEquipe";

// Produtor injetado: produção (créditos) em função de N. Quantidade fixa por etapa = 1000 => falta = 1000 - crédito.
const rodada = (n: number, credito: Record<string, number>): RodadaEquipe => ({
  n, creditoPorEtapa: credito, faltaPorEtapa: Object.fromEntries(Object.entries(credito).map(([k, v]) => [k, 1000 - v])),
});

function produtor(f: (n: number) => Record<string, number>) {
  const chamadas: number[] = [];
  return { chamadas, produzir: (n: number) => { chamadas.push(n); return rodada(n, f(n)); } };
}

describe("buscarMenorEquipe (busca pura, produtor injetado)", () => {
  it("8) 13 perde produção, 14 iguala a equipe ilimitada => 14", () => {
    const p = produtor((n) => ({ "a|e": Math.min(900, 60 * n + 60), "b|e": 500 })); // satura em n>=14 (900)
    const r = buscarMenorEquipe({ nMax: 45, produzir: p.produzir });
    expect(r.n).toBe(14);
    expect(r.iguala[13]).toBe(false); // N-1 é sempre avaliado (verificação de vizinhança)
    expect(r.rodadas.find((x) => x.n === 13)).toBeDefined();
    expect(r.rodadas.find((x) => x.n === 13)!.creditoPorEtapa["a|e"]).toBeLessThan(r.referencia.creditoPorEtapa["a|e"]);
    expect(r.iguala[14]).toBe(true);
    expect(r.metodo).toBe("binaria");
    expect(r.monotonico).toBe(true);
    expect(p.chamadas.length).toBeLessThan(12); // binária: bem menos que 45 rodadas
  });

  it("6) quando a 15ª pessoa aumenta a produção frente a 14 => 15", () => {
    const p = produtor((n) => ({ "a|e": Math.min(900, 60 * n) })); // 15*60 = 900 só com 15
    const r = buscarMenorEquipe({ nMax: 45, produzir: p.produzir });
    expect(r.n).toBe(15);
    expect(r.rodadas.find((x) => x.n === 14)!.creditoPorEtapa["a|e"]).toBe(840);
  });

  it("a comparação é por etapa: ganho numa etapa não esconde perda em outra", () => {
    const ref = rodada(30, { "a|e": 800, "b|e": 800 });
    expect(igualReferencia(rodada(9, { "a|e": 1000, "b|e": 700 }), ref)).toBe(false);
    expect(igualReferencia(rodada(9, { "a|e": 800, "b|e": 800 }), ref)).toBe(true);
    // ter produzido MAIS que a referência não reprova
    expect(igualReferencia(rodada(9, { "a|e": 900, "b|e": 800 }), ref)).toBe(true);
  });

  it("tolerância numérica explícita: diferença de 1e-9 igual, de 0,5 peça diferente", () => {
    const ref = rodada(30, { "a|e": 800 });
    expect(igualReferencia({ n: 5, creditoPorEtapa: { "a|e": 800 }, faltaPorEtapa: { "a|e": 200 + 1e-9 } }, ref)).toBe(true);
    expect(igualReferencia({ n: 5, creditoPorEtapa: { "a|e": 799.5 }, faltaPorEtapa: { "a|e": 200.5 } }, ref)).toBe(false);
    expect(TOLERANCIA_PECAS).toBeLessThan(0.01);
  });

  it("falta que existe até com equipe de sobra (limite de máquina) não exige mais gente", () => {
    const p = produtor((n) => ({ "a|e": Math.min(600, 100 * n) })); // teto físico 600 (< 1000)
    const r = buscarMenorEquipe({ nMax: 45, produzir: p.produzir });
    expect(r.n).toBe(6);
    expect(r.referencia.faltaPorEtapa["a|e"]).toBe(400);
  });

  it("não-monotonia na vizinhança do resultado => cai para varredura linear e marca monotonico=false", () => {
    // 10 iguala, 11 NÃO (piora), 12+ iguala: a binária pararia em 10, mas N+1 contradiz o limiar => varredura
    const p = produtor((n) => ({ "a|e": n >= 10 && n !== 11 ? 900 : 700 }));
    const r = buscarMenorEquipe({ nMax: 20, produzir: p.produzir });
    expect(r.monotonico).toBe(false);
    expect(r.metodo).toBe("varredura");
    expect(r.n).toBe(10); // o primeiro N que iguala na varredura
  });

  it("limite conhecido: não-monotonia LONGE do limiar não é vista pela binária (por isso há varredura empírica nas semanas reais)", () => {
    const p = produtor((n) => ({ "a|e": n === 3 || n >= 10 ? 900 : 700 }));
    const r = buscarMenorEquipe({ nMax: 20, produzir: p.produzir });
    expect(r.n).toBe(10);
    expect(r.monotonico).toBe(true);
  });

  it("nada produzido nem com equipe grande => 0 (nada a executar)", () => {
    const p = produtor(() => ({ "a|e": 0 }));
    expect(buscarMenorEquipe({ nMax: 10, produzir: p.produzir }).n).toBe(0);
    expect(buscarMenorEquipe({ nMax: 0, produzir: p.produzir }).n).toBe(0);
  });

  it("mínimo 1 quando 1 pessoa já produz tudo", () => {
    const p = produtor(() => ({ "a|e": 900 }));
    expect(buscarMenorEquipe({ nMax: 10, produzir: p.produzir }).n).toBe(1);
  });
});
