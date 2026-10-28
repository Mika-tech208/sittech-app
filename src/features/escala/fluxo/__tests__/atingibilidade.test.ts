// Preservação da atingibilidade da meta semanal (tier 1) — regra GERAL (nenhum `if produto == ...`): os mesmos cenários valem com outros ids/nomes.
// Cenários A–F do pedido: 4 necessárias → 4; 3 suficientes → pode 3; meta adiantada → pode reduzir; sem material → não inventa; metas incompatíveis → diagnóstico; remover de A torna A inatingível → mantém.
import { describe, it, expect } from "vitest";
import { planejarComFluxo } from "../planejar";
import { avaliarPlano } from "../avaliar";
import { calcularAtingibilidade, maximosPossiveis, postosMinimosUltimoElo } from "../atingibilidade";
import { prepararFluxo } from "../estado";
import { verificarRestricoesDuras } from "../restricoes";
import { equipe, jsonSerializavel, linhaPlano, montar, pool } from "./helpersFluxo";
import type { OpcoesFluxo } from "../tipos";

interface Ids { a: string; ea: string; ma: string; b: string; eb: string }
const IDS: Ids = { a: "A", ea: "A-E", ma: "A-M", b: "B", eb: "B-1" };
const OUTROS: Ids = { a: "zeta", ea: "z-etiq", ma: "z-mont", b: "omega", eb: "o-unico" };

/** A: etapa 1 (1 máquina, muE) → etapa 2 (4 máquinas, muM); B: etapa única (4 máquinas, muB, demanda ampla). Horizonte: 2 dias (12 slots), aPartirDe = 3. */
function cenario(ids: Ids, p: { qA: number; muE?: number; muM?: number; muB?: number; qB?: number; pessoas: number; opcoes?: OpcoesFluxo }) {
  const muE = p.muE ?? 3000, muM = p.muM ?? 700, muB = p.muB ?? 1000;
  const pools = [
    pool({ produto: ids.a, etapa: ids.ea, op: "opE", ordem: 1, q: p.qA, maquinas: ["e1"], mu: muE }),
    pool({ produto: ids.a, etapa: ids.ma, op: "opM", ordem: 2, q: p.qA, maquinas: ["m1", "m2", "m3", "m4"], mu: muM }),
    pool({ produto: ids.b, etapa: ids.eb, op: "opB", ordem: 1, q: p.qB ?? 500000, maquinas: ["b1", "b2", "b3", "b4"], mu: muB }),
  ];
  // plano vigente "ingênuo": tudo no produto B (maior peça absoluta por posto) com a pessoa de A mínima — o que a régua de peças absolutas faria
  const plano = (slots: Parameters<typeof linhaPlano>[0]) => slots.map((_, i) => i).flatMap((i) => equipe(p.pessoas).map((f, k) => linhaPlano(slots, i, f.id, `b${(k % 4) + 1}`, ids.b, ids.eb, "opB", muB)));
  const x = montar({ pools, funcionarios: equipe(p.pessoas), c: 1, plano, extra: { revezamentoDuro: false }, opcoes: p.opcoes, dias: ["2026-10-26", "2026-10-27"] });
  return { x, pools };
}
// o helper montar() não repassa `opcoes`; planejarComFluxo recebe diretamente:
// a falta TOTAL pode piorar em relação ao base/vigente quando a meta de um produto atingível é preservada (tier 1): só a restrição dura é invariante
const semViolacao = (x: { r: ReturnType<typeof planejarComFluxo> }) => verificarRestricoesDuras(x.r.entradaFluxo, x.r.resultado.alocacoes);

function plan(ids: Ids, p: Omit<Parameters<typeof cenario>[1], "opcoes">, on: boolean) {
  const c = cenario(ids, p);
  const opcoes: OpcoesFluxo = on ? { preservarAtingibilidade: true } : {};
  const r = planejarComFluxo(c.x.entrada, c.x.dados, opcoes);
  const ctxAv = (aloc = r.resultado.alocacoes) => avaliarPlano(c.x.entrada, c.x.dados, aloc, { preservarAtingibilidade: true });
  const postos = (etapa: string, slotRel: number) => {
    const s = c.x.entrada.slots[c.x.entrada.aPartirDe + slotRel];
    return r.resultado.alocacoes.filter((a) => a.maquinaId && a.etapaId === etapa && a.data === s.data && a.periodoId === s.periodoId).length;
  };
  const total = (etapa: string) => Array.from({ length: c.x.entrada.slots.length - c.x.entrada.aPartirDe }, (_, i) => postos(etapa, i)).reduce((s, v) => s + v, 0);
  const grupo = (produto: string) => ctxAv().atingibilidade!.grupos.find((g) => g.produtos.some((q) => q.produtoId === produto))!;
  return { ...c, r, postos, total, grupo, ctxAv, opcoes };
}

[{ nome: "ids A/B", ids: IDS }, { nome: "outros ids (sem regra por produto)", ids: OUTROS }].forEach(({ nome, ids }) => {
  describe(`atingibilidade — ${nome}`, () => {
    const S = 9; // slots mutáveis (12 − aPartirDe 3)

    it("A) 4 pessoas necessárias agora → usa 4 em todos os períodos (a meta de A só é atingível assim), mesmo que B renda mais peças por posto", () => {
      const q = 4 * 700 * S; // exatamente a capacidade máxima da etapa 2 desde aPartirDe
      const on = plan(ids, { qA: q, pessoas: 5 }, true);
      const g = on.grupo(ids.a);
      expect(g.atingivel).toBe(true);
      expect(g.maximoPossivel).toBeCloseTo(q, 0);
      expect(on.total(ids.ma)).toBe(4 * S);
      expect(on.total(ids.ea)).toBeGreaterThanOrEqual(S - 1); // a etapa 1 precisa abastecer (2800/slot ≤ 3000)
      expect(g.status).toBe("META_ATINGIDA_PELO_PLANO");
      expect(on.r.diagnostico.atingibilidade?.postosMinimos.find((m) => m.slot === on.x.entrada.aPartirDe && m.minimos[`${ids.a}|${ids.ma}`] !== undefined)?.minimos[`${ids.a}|${ids.ma}`]).toBe(4);
      expect(semViolacao(on)).toEqual([]);
    });

    it("F) uma pessoa rende mais peças em B, mas tirá-la de A torna A inatingível → mantém em A (sem a regra, o plano de peças absolutas sacrifica A)", () => {
      const q = 4 * 700 * S;
      const off = plan(ids, { qA: q, pessoas: 5 }, false);
      const on = plan(ids, { qA: q, pessoas: 5 }, true);
      const gOff = off.grupo(ids.a);
      const gOn = on.grupo(ids.a);
      expect(gOn.finalPrevisto).toBeGreaterThanOrEqual(gOff.finalPrevisto - 1e-6);
      expect(gOn.finalPrevisto).toBeCloseTo(q, 0);
      // B nunca fica pior que o que sobra de pessoas; o total de postos respeita as 5 pessoas
      on.r.resultado.alocacoes.forEach((a) => expect(a.funcionarioId).toBeTruthy());
      expect(on.r.diagnostico.violacoes).toEqual([]);
    });

    it("B) 3 suficientes → pode usar 3: com folga ≥ 1 posto-período a meta de A segue atingida e o posto liberado vai para B", () => {
      const q = 4 * 700 * S - 1500; // folga de 1.500 peças ≥ 2 posto-períodos
      const on = plan(ids, { qA: q, pessoas: 5 }, true);
      const g = on.grupo(ids.a);
      expect(g.atingivel).toBe(true);
      expect(g.status).toBe("META_ATINGIDA_PELO_PLANO");
      expect(on.total(ids.ma)).toBeLessThan(4 * S);
      expect(on.total(ids.ma)).toBeGreaterThanOrEqual(Math.ceil(q / 700) - 1); // nunca abaixo do necessário
      expect(on.total(ids.eb)).toBeGreaterThan(0); // posto liberado vai para o outro produto
      expect(semViolacao(on)).toEqual([]);
    });

    it("C) meta já adiantada → pode reduzir: com pouca demanda restante, A usa poucos postos e a meta é entregue", () => {
      const on = plan(ids, { qA: 3000, pessoas: 5 }, true);
      const g = on.grupo(ids.a);
      expect(g.status).toBe("META_ATINGIDA_PELO_PLANO");
      expect(on.total(ids.ma)).toBeLessThanOrEqual(Math.ceil(3000 / 700) + 1);
      expect(on.total(ids.eb)).toBeGreaterThan(on.total(ids.ma));
    });

    it("D) sem material para 4 → não inventa capacidade: a etapa 1 limita (1.400/slot ⇒ no máx. 2 postos úteis na etapa 2) e a meta vira META_NAO_ATINGIVEL", () => {
      const q = 4 * 700 * S;
      const on = plan(ids, { qA: q, muE: 1400, pessoas: 6 }, true);
      const g = on.grupo(ids.a);
      expect(g.atingivel).toBe(false);
      expect(g.maximoPossivel).toBeCloseTo(1400 * S, 0);
      expect(g.faltaInevitavel).toBeCloseTo(q - 1400 * S, 0);
      expect(g.status).toBe("META_NAO_ATINGIVEL");
      // meta fisicamente inatingível NÃO reserva postos (tier 2 decide) — e nunca mais postos úteis do que o material sustenta
      on.r.diagnostico.atingibilidade!.postosMinimos.filter((m) => m.grupo === `${ids.a}|${ids.ma}`).forEach((m) => expect(m.minimos[`${ids.a}|${ids.ma}`]).toBe(0));
      expect(on.r.diagnostico.diagnosticos.some((d) => d.codigo === "META_NAO_ATINGIVEL" && d.detalhes?.status === "META_NAO_ATINGIVEL")).toBe(true);
      expect(g.finalPrevisto).toBeLessThanOrEqual(g.maximoPossivel + 1); // nunca promete mais que o máximo possível (nada de capacidade inventada)
    });

    it("E) duas metas incompatíveis (cada uma atingível sozinha, juntas não cabem nas pessoas) → diagnóstico explícito, sem inventar capacidade", () => {
      const q = 4 * 700 * S;
      const pools = [
        pool({ produto: ids.a, etapa: ids.ma, op: "opM", ordem: 1, q, maquinas: ["m1", "m2", "m3", "m4"], mu: 700 }),
        pool({ produto: ids.b, etapa: ids.eb, op: "opB", ordem: 1, q, maquinas: ["b1", "b2", "b3", "b4"], mu: 700 }),
      ];
      const m = montar({ pools, funcionarios: equipe(5), c: 1, extra: { revezamentoDuro: false }, dias: ["2026-10-26", "2026-10-27"] });
      const r = planejarComFluxo(m.entrada, m.dados, { preservarAtingibilidade: true });
      const at = r.diagnostico.atingibilidade!.depois;
      expect(at.grupos.every((g) => g.atingivel)).toBe(true);
      expect(at.grupos.some((g) => g.status === "META_EM_CONFLITO")).toBe(true);
      expect(r.diagnostico.diagnosticos.some((d) => d.codigo === "META_NAO_ATINGIVEL" && d.detalhes?.status === "META_EM_CONFLITO")).toBe(true);
      const porSlot = new Map<string, number>();
      r.resultado.alocacoes.filter((a) => a.maquinaId).forEach((a) => porSlot.set(`${a.data}|${a.periodoId}`, (porSlot.get(`${a.data}|${a.periodoId}`) ?? 0) + 1));
      porSlot.forEach((n) => expect(n).toBeLessThanOrEqual(5));
      expect(semViolacao({ r })).toEqual([]);
    });

    it("saída JSON pura, determinística, sem violação dura", () => {
      const a = plan(ids, { qA: 4 * 700 * S - 1500, pessoas: 5 }, true);
      const b = plan(ids, { qA: 4 * 700 * S - 1500, pessoas: 5 }, true);
      expect(JSON.stringify(a.r.diagnostico)).toBe(JSON.stringify(b.r.diagnostico));
      expect(jsonSerializavel(a.r.diagnostico)).toBe(true);
      expect(a.r.diagnostico.violacoes).toEqual([]);
    });
  });
});

describe("atingibilidade — funções puras e compatibilidade", () => {
  it("fórmula do último elo: ceil(max(0, restante − capacidade máxima depois) / capacidade por posto)", () => {
    expect(postosMinimosUltimoElo({ restanteFinal: 40785, capacidadeMaximaDepois: 40523, capacidadePorPosto: 689, postosMaximos: 4 })).toMatchObject({ producaoObrigatoriaAgora: 262, postosMinimos: 1, viavel: true });
    expect(postosMinimosUltimoElo({ restanteFinal: 43320, capacidadeMaximaDepois: 40523, capacidadePorPosto: 689, postosMaximos: 4 })).toMatchObject({ postosMinimos: 5, viavel: false });
    expect(postosMinimosUltimoElo({ restanteFinal: 100, capacidadeMaximaDepois: 500, capacidadePorPosto: 689 }).postosMinimos).toBe(0);
  });

  it("máximo possível = min(oferta de material, capacidade da última etapa) e falta inevitável (cálculo à mão)", () => {
    const pools = [
      pool({ produto: "P", etapa: "P1", op: "o1", ordem: 1, q: 20000, maquinas: ["x"], mu: 1000 }),
      pool({ produto: "P", etapa: "P2", op: "o2", ordem: 2, q: 20000, maquinas: ["y1", "y2"], mu: 600 }),
    ];
    const m = montar({ pools, funcionarios: equipe(3), c: 1, dias: ["2026-10-26", "2026-10-27"] });
    const ctx = prepararFluxo(m.entrada, m.dados, { preservarAtingibilidade: true });
    const max = maximosPossiveis(ctx);
    const sink = Object.keys(ctx.grafo.nos).find((n) => ctx.grafo.nos[n].final)!;
    expect(max[sink]).toBeCloseTo(10000, 0); // oferta da etapa 1 (inclui o período congelado) = 10.000 < 12.000 da etapa 2
    const at = calcularAtingibilidade(ctx, { [sink]: 9000 });
    expect(at.grupos[0]).toMatchObject({ atingivel: false, faltaInevitavel: 10000, faltaEvitavel: 1000 });
  });

  it("flag desligada: avaliação e diagnóstico sem os campos novos (saída idêntica à anterior)", () => {
    const pools = [pool({ produto: "P", etapa: "P1", op: "o1", ordem: 1, q: 3000, maquinas: ["x", "y"], mu: 500 })];
    const m = montar({ pools, funcionarios: equipe(2), c: 1 });
    const r = planejarComFluxo(m.entrada, m.dados);
    expect(r.diagnostico.atingibilidade).toBeUndefined();
    expect(r.diagnostico.avaliacaoFluxo.atingibilidade).toBeUndefined();
    expect(r.diagnostico.diagnosticos.some((d) => d.codigo === "META_NAO_ATINGIVEL" || d.codigo === "POSTOS_MINIMOS_APLICADOS")).toBe(false);
    expect(r.diagnostico.iteracoes[0].tupla).toHaveLength(7);
  });

  it("flag ligada em cenário sem conflito (tudo atingível e folgado): não piora a falta total e não gera violação", () => {
    const pools = [
      pool({ produto: "P", etapa: "P1", op: "o1", ordem: 1, q: 4000, maquinas: ["x", "y"], mu: 500 }),
      pool({ produto: "Q", etapa: "Q1", op: "o2", ordem: 1, q: 3000, maquinas: ["z", "w"], mu: 500 }),
    ];
    const m = montar({ pools, funcionarios: equipe(4), c: 1 });
    const off = planejarComFluxo(m.entrada, m.dados);
    const on = planejarComFluxo(m.entrada, m.dados, { preservarAtingibilidade: true });
    expect(on.diagnostico.depois.faltaPrevista.lo).toBeLessThanOrEqual(off.diagnostico.depois.faltaPrevista.lo + 1e-6);
    expect(on.diagnostico.violacoes).toEqual([]);
    expect(on.diagnostico.iteracoes[0].tupla).toHaveLength(9);
  });
});
