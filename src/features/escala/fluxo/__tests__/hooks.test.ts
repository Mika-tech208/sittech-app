// Semântica dos hooks ADITIVOS do motor: remPorPool, ordemPostos (valor marginal por pool×slot×n) e bonusContinuidade.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../../gerarEscala";
import { checarInvariantes, entrada, equipe, pool } from "../../__tests__/helpers";

const pools = [
  pool({ produto: "A", etapa: "A1", op: "opA", q: 100000, maquinas: ["a1", "a2"], mu: 100 }),
  pool({ produto: "B", etapa: "B1", op: "opB", q: 100000, maquinas: ["b1", "b2"], mu: 100 }),
  pool({ produto: "C", etapa: "C1", op: "opC", q: 100000, maquinas: ["c1", "c2"], mu: 100 }),
];
const e = (extra: object = {}, n = 2) => entrada({ pools, funcionarios: equipe(n), revezamentoDuro: false, ...extra }, ["2026-10-19"]);
const postosDe = (r: ReturnType<typeof gerarEscala>, slot: number, p: ReturnType<typeof e>) =>
  r.alocacoes.filter((a) => a.maquinaId && a.data === p.slots[slot].data && a.periodoId === p.slots[slot].periodoId).map((a) => a.etapaId).sort();

describe("remPorPool", () => {
  it("substitui Q − créditos congelados; pool ausente do mapa mantém a regra anterior", () => {
    const x = e({ remPorPool: { "A|A1": 150 } }, 6);
    const r = gerarEscala(x);
    const credA = r.alocacoes.filter((a) => a.etapaId === "A1").reduce((s, a) => s + a.pecas, 0);
    expect(credA).toBe(150); // exatamente o rem explícito
    expect(r.alocacoes.filter((a) => a.etapaId === "B1").reduce((s, a) => s + a.pecas, 0)).toBeGreaterThan(150);
  });
  it("não abate o crédito planejado dos slots congelados", () => {
    const x0 = e({}, 3);
    const completo = gerarEscala({ ...x0, aPartirDe: 0 });
    const cong = completo.alocacoes.filter((a) => a.periodoId === "m1");
    const x = { ...x0, aPartirDe: 1, congeladas: cong, remPorPool: { "A|A1": 1000, "B|B1": 0, "C|C1": 0 } };
    const r = gerarEscala(x);
    const prod = r.alocacoes.reduce((s, a) => s + (a.etapaId === "A1" ? a.pecas : 0), 0);
    expect(prod).toBe(1000);
    expect(r.alocacoes.filter((a) => a.etapaId === "B1" && a.maquinaId)).toHaveLength(0);
  });
  it("rem 0 tira o pool do motor; chave desconhecida é ignorada", () => {
    const r = gerarEscala(e({ remPorPool: { "A|A1": 0, "Z|Z1": 5 } }, 3));
    expect(r.alocacoes.filter((a) => a.etapaId === "A1" && a.maquinaId)).toHaveLength(0);
  });
});

describe("ordemPostos (valor marginal do n-ésimo posto)", () => {
  it("o pool de maior valor marginal é escolhido primeiro, mesmo contra o desempate legado", () => {
    const x0 = e({}, 1);
    const legado = gerarEscala(x0);
    const primeiroLegado = postosDe(legado, 0, x0)[0];
    const alvo = primeiroLegado === "C1" ? "B1" : "C1";
    const marg = { "0": { [`${alvo === "C1" ? "C" : "B"}|${alvo}`]: [50, 0], "A|A1": [1, 0] } };
    const r = gerarEscala({ ...x0, ordemPostos: { valorMarginal: marg } });
    expect(postosDe(r, 0, x0)).toEqual([alvo]);
  });
  it("n-ésimo posto: [10, 0] para A e [5] para B ⇒ A, B, (A de novo só depois)", () => {
    const x0 = e({}, 2);
    const marg = { "0": { "A|A1": [10, 0], "B|B1": [5, 0] } };
    const r = gerarEscala({ ...x0, ordemPostos: { valorMarginal: marg } });
    expect(postosDe(r, 0, x0)).toEqual(["A1", "B1"]);
  });
  it("2º posto do mesmo pool vale mais que o 1º de outro: dois postos do pool A", () => {
    const x0 = e({}, 2);
    const marg = { "0": { "A|A1": [10, 8], "B|B1": [5, 0] } };
    const r = gerarEscala({ ...x0, ordemPostos: { valorMarginal: marg } });
    expect(postosDe(r, 0, x0)).toEqual(["A1", "A1"]);
  });
  it("slot sem entrada na tabela segue a ordem legada (e nunca viola invariantes)", () => {
    const x0 = e({}, 3);
    const r = gerarEscala({ ...x0, ordemPostos: { valorMarginal: { "2": { "C|C1": [9, 9] } } } });
    expect(JSON.stringify(r.alocacoes.filter((a) => a.periodoId === "m1"))).toBe(JSON.stringify(gerarEscala(x0).alocacoes.filter((a) => a.periodoId === "m1")));
    expect(checarInvariantes(x0, r)).toEqual([]);
  });
});

describe("bonusContinuidade", () => {
  it("o bônus mantém o posto vigente quando o ganho do concorrente é menor que θ", () => {
    const x0 = e({}, 1);
    const marg = { "0": { "A|A1": [4, 0], "B|B1": [10, 0] } };
    const semBonus = gerarEscala({ ...x0, ordemPostos: { valorMarginal: marg } });
    expect(postosDe(semBonus, 0, x0)).toEqual(["B1"]);
    const comBonus = gerarEscala({ ...x0, ordemPostos: { valorMarginal: marg }, bonusContinuidade: { "0": { "a1|A|A1": 7 } } });
    expect(postosDe(comBonus, 0, x0)).toEqual(["A1"]); // 4 + 7 > 10
    const bonusPequeno = gerarEscala({ ...x0, ordemPostos: { valorMarginal: marg }, bonusContinuidade: { "0": { "a1|A|A1": 5 } } });
    expect(postosDe(bonusPequeno, 0, x0)).toEqual(["B1"]); // 4 + 5 < 10: o ganho supera θ
  });
  it("sempre dentro das restrições: máquina indisponível nunca é escolhida, mesmo com bônus", () => {
    const x0 = e({ maquinasIndisponiveisPrevisao: ["a1", "a2"] }, 1);
    const r = gerarEscala({ ...x0, ordemPostos: { valorMarginal: { "0": { "A|A1": [99] } } }, bonusContinuidade: { "0": { "a1|A|A1": 99 } } });
    expect(r.alocacoes.some((a) => a.etapaId === "A1" && a.maquinaId)).toBe(false);
    expect(checarInvariantes(x0, r)).toEqual([]);
  });
});
