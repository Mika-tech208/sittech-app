import { describe, it, expect } from "vitest";
import { atribuicaoMinima } from "../matching";

function forcaBruta(c: number[][]): number {
  const n = c.length;
  let melhor = Infinity;
  const usado = new Array(n).fill(false);
  const rec = (i: number, soma: number) => {
    if (soma >= melhor) return;
    if (i === n) { melhor = soma; return; }
    for (let j = 0; j < n; j++) if (!usado[j]) { usado[j] = true; rec(i + 1, soma + c[i][j]); usado[j] = false; }
  };
  rec(0, 0);
  return melhor;
}

function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

describe("atribuicaoMinima (húngaro)", () => {
  it("matriz vazia e 1x1", () => {
    expect(atribuicaoMinima([])).toEqual([]);
    expect(atribuicaoMinima([[7]])).toEqual([0]);
  });
  it("caso clássico 3x3", () => {
    const r = atribuicaoMinima([[4, 1, 3], [2, 0, 5], [3, 2, 2]]);
    const total = r.reduce((s, j, i) => s + [[4, 1, 3], [2, 0, 5], [3, 2, 2]][i][j], 0);
    expect(total).toBe(5);
    expect(new Set(r).size).toBe(3);
  });
  it("custo ótimo igual à força bruta em 200 matrizes aleatórias (n=1..7)", () => {
    const rand = rng(42);
    for (let k = 0; k < 200; k++) {
      const n = 1 + (k % 7);
      const c = Array.from({ length: n }, () => Array.from({ length: n }, () => Math.floor(rand() * 100)));
      const r = atribuicaoMinima(c);
      expect(new Set(r).size).toBe(n);
      expect(r.reduce((s, j, i) => s + c[i][j], 0)).toBe(forcaBruta(c));
    }
  });
  it("é determinístico", () => {
    const c = [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
    expect(atribuicaoMinima(c)).toEqual(atribuicaoMinima(c));
  });
  it("custos com penalidade enorme são evitados quando há alternativa", () => {
    const BIG = 1_000_000;
    const r = atribuicaoMinima([[BIG, 0], [0, BIG]]);
    expect(r).toEqual([1, 0]);
  });
});
