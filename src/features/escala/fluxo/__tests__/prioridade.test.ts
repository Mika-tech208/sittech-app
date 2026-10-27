// Prioridade por valor marginal de produto final (regra GERAL — nenhum `if produto == ...`): a etapa seguinte é reforçada quando há WIP para
// consumir; a etapa anterior é mantida quando não há WIP e ela é o gargalo de fluxo. O mesmo desenho com outros ids/nomes dá o mesmo comportamento.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../../gerarEscala";
import { planejarComFluxo } from "../planejar";
import { apontarPlano, checarFluxo, equipe, linhaPlano, montar, pool, rodar } from "./helpersFluxo";

function cenario(ids: { prod: string; e: string; m: string; filler: string }, boasE: number, boasM: number, pessoas: number) {
  const pools = [
    pool({ produto: ids.prod, etapa: ids.e, op: "opE", ordem: 1, q: 70500, maquinas: ["e16"], mu: 2500 }),
    pool({ produto: ids.prod, etapa: ids.m, op: "opM", ordem: 2, q: 70500, maquinas: ["m1", "m2", "m3", "m4"], mu: 700 }),
    pool({ produto: ids.filler, etapa: `${ids.filler}1`, op: "opF", ordem: 1, q: 70500, maquinas: ["f1", "f2", "f3", "f4"], mu: 300 }),
  ];
  const plano = (slots: Parameters<typeof linhaPlano>[0]) => [0, 1, 2, 3].flatMap((i) => [
    linhaPlano(slots, i, "f01", "e16", ids.prod, ids.e, "opE", 2500),
    linhaPlano(slots, i, "f02", "m1", ids.prod, ids.m, "opM", 700),
    linhaPlano(slots, i, "f03", "f1", ids.filler, `${ids.filler}1`, "opF", 300),
  ]);
  const base = rodar({ pools, funcionarios: equipe(pessoas), c: 3, plano });
  const apontamentos = apontarPlano(base.planoCompleto, pools, 3, base.entrada.slots, (a) => (a.etapaId === ids.e ? boasE / 4 : a.etapaId === ids.m ? boasM / 4 : 300));
  const x = rodar({ pools, funcionarios: equipe(pessoas), c: 3, plano, apontamentos });
  const doSlot = (i: number, etapa: string) => x.r.resultado.alocacoes.filter((a) => a.maquinaId && a.etapaId === etapa && a.data === x.entrada.slots[x.entrada.aPartirDe + i].data && a.periodoId === x.entrada.slots[x.entrada.aPartirDe + i].periodoId).length;
  return { x, doSlot, ids };
}

[
  { nome: "Caixa-like", ids: { prod: "C", e: "E", m: "M", filler: "F" } },
  { nome: "outro produto (ids diferentes)", ids: { prod: "zzz", e: "alfa", m: "beta", filler: "w" } },
].forEach(({ nome, ids }) => {
  describe(`prioridade por valor marginal — ${nome}`, () => {
    it("COM WIP suficiente: reforça a etapa seguinte (consome o WIP) e não gasta pessoa na anterior", () => {
      const { x, doSlot } = cenario(ids, 20000, 8000, 4);
      expect(x.r.diagnostico.estado.pares[0].wip.lo).toBe(12000);
      expect(x.r.diagnostico.planoEscolhido).toBe("fluxo");
      expect(doSlot(0, ids.m)).toBeGreaterThanOrEqual(3);
      expect(doSlot(0, ids.e)).toBe(0);
      expect(x.r.diagnostico.depois.faltaPrevista.lo).toBeLessThan(x.r.diagnostico.depoisBase.faltaPrevista.lo);
      expect(checarFluxo(x)).toEqual([]);
    });
    it("SEM WIP e a etapa anterior é o gargalo de fluxo: mantém a anterior", () => {
      const { x, doSlot } = cenario(ids, 10000, 10000, 4);
      expect(x.r.diagnostico.estado.pares[0].wip.hi).toBe(0);
      const gar = x.r.diagnostico.antes.gargalosFluxo.find((g) => g.produtoId === ids.prod);
      expect(gar?.etapaId).toBe(ids.e);
      expect(doSlot(0, ids.e) + doSlot(1, ids.e)).toBeGreaterThanOrEqual(1);
      expect(x.r.diagnostico.depois.faltaPrevista.lo).toBeLessThan(x.r.diagnostico.depoisBase.faltaPrevista.lo);
      expect(checarFluxo(x)).toEqual([]);
    });
    it("o diagnóstico explica ANTES / DECISÃO / MOTIVO / DEPOIS", () => {
      const { x } = cenario(ids, 20000, 8000, 4);
      const d = x.r.diagnostico;
      expect(Object.keys(d.antes.demandaRestante)).toContain(ids.prod);
      expect(d.antes.wip[0].wip.lo).toBe(12000);
      expect(d.decisoes.length).toBeGreaterThan(0);
      const dec = d.decisoes.find((z) => z.motivo.ganhoProdutoFinal > 0)!;
      expect(dec.de.maquinaId !== dec.para.maquinaId || dec.de.etapaId !== dec.para.etapaId).toBe(true);
      expect(dec.motivo.texto.length).toBeGreaterThan(10);
      expect(d.depois.produtoFinalPrevisto.lo).toBeGreaterThan(d.depoisBase.produtoFinalPrevisto.lo);
      expect(d.depois.wipPrevisto.hi).toBeLessThanOrEqual(d.depoisBase.wipPrevisto.hi);
      expect(d.churn.linhasAlteradas).toBeGreaterThanOrEqual(0); // o plano vigente deste cenário só tem passado
      expect(d.iteracoes.length).toBeGreaterThanOrEqual(2);
      expect(d.iteracoes.filter((i) => i.escolhida)).toHaveLength(1);
    });
  });
});

describe("nunca pior que o plano base", () => {
  it("quando o motor atual já é ótimo pelo simulador, nada muda: plano vigente (= o que o motor gera) mantido, sem decisões nem churn (PLANO_VIGENTE_MANTIDO)", () => {
    const pools = [pool({ produto: "U", etapa: "U1", op: "opA", ordem: 1, q: 9000, maquinas: ["m1", "m2", "m3"], mu: 300 })];
    const x = rodar({ pools, funcionarios: equipe(3), c: 1 });
    expect(x.r.diagnostico.planoEscolhido).toBe("vigente");
    expect(x.r.diagnostico.diagnosticos.some((d) => d.codigo === "PLANO_VIGENTE_MANTIDO")).toBe(true);
    expect(x.r.diagnostico.decisoesTotal).toBe(0);
    expect(x.r.diagnostico.churn.linhasAlteradas).toBe(0);
    expect(JSON.stringify(x.r.resultado.alocacoes)).toBe(JSON.stringify(gerarEscala(x.entrada).alocacoes)); // aqui o vigente É o que o motor gera
    expect(JSON.stringify(x.r.entradaFluxo)).toBe(JSON.stringify(x.entrada));
  });
  it("sem plano vigente futuro (primeira geração) o candidato vigente não existe: o plano base é mantido (PLANO_BASE_MANTIDO)", () => {
    const pools = [pool({ produto: "U", etapa: "U1", op: "opA", ordem: 1, q: 9000, maquinas: ["m1", "m2", "m3"], mu: 300 })];
    const m = montar({ pools, funcionarios: equipe(3), c: 1 });
    const r = planejarComFluxo(m.entrada, { ...m.dados, planoVigente: m.entrada.congeladas });
    expect(r.diagnostico.vigente.disponivel).toBe(false);
    expect(r.diagnostico.planoEscolhido).toBe("base");
    expect(r.diagnostico.referencia).toBe("base");
    expect(JSON.stringify(r.resultado)).toBe(JSON.stringify(gerarEscala(m.entrada)));
  });
});
