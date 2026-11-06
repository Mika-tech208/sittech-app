// BUSCA EXATA da atribuição de pessoas do bloco (fallback de reatribuirPessoasBloco) × força bruta. Nenhuma regra é relaxada: o resultado é conferido pelo auditor independente (repeticoesPorBloco).
import { describe, expect, it } from "vitest";
import { reatribuirPessoasBloco, resolverBlocoExato } from "../estabilidade";
import { repeticoesPorBloco } from "../exposicaoBloco";
import type { AlocacaoEscala, SlotEscala } from "../types";

const IDS = ["m1", "m2", "m3", "t1", "t2", "t3"];
const slots: SlotEscala[] = IDS.map((p, i) => ({ data: "2026-11-06", periodoId: p, indice: i, primeiroDoDia: i === 0, inicioMin: 420 + i * 90, fimMin: 510 + i * 90, inicioMs: 0, fimMs: 1 }));
const linha = (periodoId: string, funcionarioId: string, op: string | null, maq = op ? `mq-${op}-${periodoId}` : null, origem: "auto" | "manual" = "auto"): AlocacaoEscala =>
  ({ data: "2026-11-06", periodoId, funcionarioId, maquinaId: maq, produtoId: op ? "P" : null, etapaId: op ? "E" : null, operacaoId: op, pecas: op ? 10 : 0, pecasAdicional: 0, motivoSemPosto: op ? null : "x", excecaoRevezamento: false, motivoExcecao: null, origem });
const prng = (seed: number) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** instância: pessoas p1..pN na tarde (t1 congelado = `antes`; t2,t3 livres), postos por período com operações dadas */
function instancia(pessoas: string[], t1: (string | null)[], t2: string[], t3: string[]) {
  const antes = pessoas.map((p, i) => linha("t1", p, t1[i]));
  const mk = (per: string, ops: string[]) => { const ls = pessoas.map((p, i) => linha(per, p, ops[i] ?? null)); return ls; };
  const linhas = [...mk("t2", t2), ...mk("t3", t3)];
  const porSlot = new Map<number, AlocacaoEscala[]>();
  linhas.forEach((l) => { const i = slots.find((s) => s.periodoId === l.periodoId)!.indice; porSlot.set(i, [...(porSlot.get(i) ?? []), l]); });
  return { antes, linhas, porSlot, bloco: [4, 5] };
}
const regras = { escopo: "bloco" as const, ponteM3T1: true };

/** força bruta: existe atribuição (permutação por período) sem repetir operação no bloco (t1 congelado + t2 + t3)? */
function viavelBruta(pessoas: string[], t1: (string | null)[], t2: string[], t3: string[]): boolean {
  const permuta = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permuta([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));
  const ini = new Map<string, Set<string>>(pessoas.map((p, i) => [p, new Set(t1[i] ? [t1[i] as string] : [])]));
  const posts2 = t2, posts3 = t3;
  const pad = (ps: string[]) => [...ps, ...new Array(pessoas.length - ps.length).fill(null)] as (string | null)[];
  for (const a2 of permuta(pad(posts2))) {
    const e2 = new Map([...ini].map(([p, s]) => [p, new Set(s)]));
    let ok = true;
    a2.forEach((op, i) => { if (op) { if (e2.get(pessoas[i])!.has(op)) ok = false; e2.get(pessoas[i])!.add(op); } });
    if (!ok) continue;
    for (const a3 of permuta(pad(posts3))) {
      if (a3.every((op, i) => !op || !e2.get(pessoas[i])!.has(op))) return true;
    }
  }
  return false;
}
const auditar = (antes: AlocacaoEscala[], novas: AlocacaoEscala[]) => repeticoesPorBloco([...antes, ...novas], slots, undefined, true);

describe("busca exata do bloco (fallback da reatribuição de pessoas)", () => {
  it("INVIÁVEL provado: mais postos de uma operação do que pessoas elegíveis (Hall) — o caso de 06/11 em miniatura", () => {
    // 5 pessoas; no T1 congelado p1,p2 fizeram Montar; sobram 3 elegíveis; T2 pede 2 Montar e T3 pede 2 Montar (4 > 3)
    const I = instancia(["p1", "p2", "p3", "p4", "p5"], ["Montar", "Montar", "A", "B", "C"], ["Montar", "Montar", "A", "B"], ["Montar", "Montar", "A"]);
    expect(resolverBlocoExato(I.bloco, I.porSlot, slots, I.antes, regras, true)).toBeNull();
    expect(reatribuirPessoasBloco(I.linhas, I.antes, slots, regras, 600)).toBeNull();
    expect(viavelBruta(["p1", "p2", "p3", "p4", "p5"], ["Montar", "Montar", "A", "B", "C"], ["Montar", "Montar", "A", "B"], ["Montar", "Montar", "A"])).toBe(false);
    // com 3 postos de Montar no total (≤ 3 elegíveis) passa e o auditor independente não acha repetição
    const J = instancia(["p1", "p2", "p3", "p4", "p5"], ["Montar", "Montar", "A", "B", "C"], ["Montar", "Montar", "A", "B"], ["Montar", "A"]);
    const r = resolverBlocoExato(J.bloco, J.porSlot, slots, J.antes, regras, true);
    expect(r === null || r === "limite").toBe(false);
    expect(auditar(J.antes, r as AlocacaoEscala[])).toEqual([]);
  });

  it("concorda com a força bruta em instâncias aleatórias e SEMPRE devolve atribuição válida (auditor independente)", () => {
    let viaveis = 0, inviaveis = 0, heurFalhaExatoAcha = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const r = prng(seed);
      const n = 4 + Math.floor(r() * 2); // 4..5 pessoas
      const pessoas = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      const OPS = ["A", "B", "C", "D"];
      const ops = (k: number) => Array.from({ length: k }, () => OPS[Math.floor(r() * OPS.length)]);
      const t1 = pessoas.map(() => (r() < 0.8 ? OPS[Math.floor(r() * OPS.length)] : null));
      const t2 = ops(2 + Math.floor(r() * (n - 1))), t3 = ops(2 + Math.floor(r() * (n - 1)));
      const I = instancia(pessoas, t1, t2, t3);
      const bruta = viavelBruta(pessoas, t1, t2, t3);
      const ex = resolverBlocoExato(I.bloco, I.porSlot, slots, I.antes, regras, true);
      expect(ex === "limite", `seed ${seed}`).toBe(false);
      expect(ex !== null, `seed ${seed}`).toBe(bruta);
      if (bruta) {
        viaveis++;
        expect(auditar(I.antes, ex as AlocacaoEscala[]), `seed ${seed}`).toEqual([]);
        // 1 pessoa por posto e 1 posto por pessoa
        for (const per of ["t2", "t3"]) {
          const ls = (ex as AlocacaoEscala[]).filter((l) => l.periodoId === per);
          expect(new Set(ls.map((l) => l.funcionarioId)).size).toBe(pessoas.length);
          expect(ls.filter((l) => l.maquinaId).length).toBe(per === "t2" ? t2.length : t3.length);
        }
        if (reatribuirPessoasBloco(I.linhas, I.antes, slots, regras, 600, false) === null) heurFalhaExatoAcha++; // sem o fallback: a heurística sozinha
        expect(reatribuirPessoasBloco(I.linhas, I.antes, slots, regras, 600), `seed ${seed}`).not.toBeNull(); // com o fallback: sempre acha quando existe
      } else inviaveis++;
    }
    expect(viaveis).toBeGreaterThan(20);
    expect(inviaveis).toBeGreaterThan(20);
    // (informativo) quantas vezes a heurística falhava com solução existente — o fallback exato resolve essas
    expect(heurFalhaExatoAcha).toBeGreaterThanOrEqual(0);
    console.info(`heurística sozinha falhou com solução existente em ${heurFalhaExatoAcha} de ${viaveis} instâncias viáveis`);
  });

  it("reatribuirPessoasBloco usa o fallback exato: o resultado nunca é pior que antes (se a heurística achava, ainda acha igual)", () => {
    const I = instancia(["p1", "p2", "p3", "p4"], ["A", "B", null, null], ["A", "B", "C"], ["A", "B", "C"]);
    const r = reatribuirPessoasBloco(I.linhas, I.antes, slots, regras, 600);
    expect(r).not.toBeNull();
    expect(auditar(I.antes, r!.linhas)).toEqual([]);
  });

  it("tokens manuais ficam fixos na pessoa decidida (como na heurística: decisão humana não é desfeita)", () => {
    const pessoas = ["p1", "p2", "p3"];
    const antes = pessoas.map((p, i) => linha("t1", p, ["A", null, null][i]));
    const t2 = [linha("t2", "p1", "A", "m", "manual"), linha("t2", "p2", "A", "m2"), linha("t2", "p3", null)];
    const porSlot = new Map<number, AlocacaoEscala[]>([[4, t2]]);
    const r = resolverBlocoExato([4], porSlot, slots, antes, regras, true) as AlocacaoEscala[];
    expect(r.find((l) => l.maquinaId === "m")!.funcionarioId).toBe("p1"); // fixo
    expect(r.find((l) => l.maquinaId === "m2")!.funcionarioId).not.toBe("p1"); // o outro posto A não pode ir para quem já está em A
  });
});
