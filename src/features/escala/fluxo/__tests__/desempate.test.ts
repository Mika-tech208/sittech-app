import { describe, it, expect } from "vitest";
import { compararMovimentos, melhorMovimento, type CandidatoMovimento } from "../desempate";

const base: CandidatoMovimento = { ganho: 55.85, folgaRevezamento: 3, desvioExposicao: 0, churn: 1, continuidade: 0, id: "m" };
const c = (o: Partial<CandidatoMovimento>): CandidatoMovimento => ({ ...base, ...o });

describe("desempate da pessoa (posto já decidido)", () => {
  it("ganho maior vence só acima da tolerância; abaixo dela decide a folga de revezamento", () => {
    expect(melhorMovimento([c({ id: "a", ganho: 55.85 }), c({ id: "b", ganho: 55.86, folgaRevezamento: 1 })])?.id).toBe("a"); // dif. 0,01 = dentro da tolerância
    expect(melhorMovimento([c({ id: "a", ganho: 55.85 }), c({ id: "b", ganho: 56.5, folgaRevezamento: 1 })])?.id).toBe("b");
  });
  it("ordem: folga de revezamento → desvio de exposição → churn → continuidade → id", () => {
    expect(melhorMovimento([c({ id: "a", folgaRevezamento: 2 }), c({ id: "b", folgaRevezamento: 4 })])?.id).toBe("b");
    expect(melhorMovimento([c({ id: "a", desvioExposicao: 30 }), c({ id: "b", desvioExposicao: -20 })])?.id).toBe("b"); // menor desvio = abaixo da parcela justa
    expect(melhorMovimento([c({ id: "a", churn: 2 }), c({ id: "b", churn: 1 })])?.id).toBe("b");
    expect(melhorMovimento([c({ id: "a", continuidade: 0 }), c({ id: "b", continuidade: 1 })])?.id).toBe("b");
    expect(melhorMovimento([c({ id: "z" }), c({ id: "a" })])?.id).toBe("a");
  });
  it("a ordem do array NUNCA decide (todas as permutações dão o mesmo vencedor)", () => {
    const l = [c({ id: "c", desvioExposicao: 5 }), c({ id: "a", desvioExposicao: 5 }), c({ id: "b", desvioExposicao: -9 }), c({ id: "d", desvioExposicao: -9, churn: 3 })];
    const perms = [l, [...l].reverse(), [l[2], l[0], l[3], l[1]], [l[1], l[3], l[0], l[2]]];
    perms.forEach((p) => expect(melhorMovimento(p)?.id).toBe("b"));
  });
  it("comparador consistente (antissimétrico) e lista vazia", () => {
    expect(compararMovimentos(c({ id: "a" }), c({ id: "b" }))).toBe(-compararMovimentos(c({ id: "b" }), c({ id: "a" })));
    expect(melhorMovimento([])).toBeNull();
  });
});
