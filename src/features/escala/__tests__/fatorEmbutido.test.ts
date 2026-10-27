// f DUPLICADO: o plano gravado por um replanejamento aplicado já traz as metas × f daquela decisão; projetá-lo com o f NOVO não pode multiplicar duas vezes.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import { fatorEmbutidoDoPlano, projetarProducao, projetarProducaoReescalada } from "../execucao";
import { executarCorteSombra, type ParametrosCorte } from "../sombraCorte";
import type { ApontamentoReal } from "../producaoReal";
import type { AlocacaoEscala, EntradaEscala } from "../types";
import { entrada, equipe, pool } from "./helpers";

const DIAS = ["2026-10-19", "2026-10-20"];
const e0 = entrada({ funcionarios: equipe(4), pools: [pool({ produto: "A", etapa: "A1", op: "o1", q: 1000, maquinas: ["m1"], mu: 100 }), pool({ produto: "B", etapa: "B1", op: "o2", q: 500, maquinas: ["m2"], mu: 100 })] }, DIAS);
const K_A = "A|A1";
const linha = (i: number, pecas: number, extra: Partial<AlocacaoEscala> = {}): AlocacaoEscala => ({
  data: e0.slots[i].data, periodoId: e0.slots[i].periodoId, funcionarioId: "f01", maquinaId: "m1", produtoId: "A", etapaId: "A1", operacaoId: "o1", pecas, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, ...extra,
});
const semanaA = (f: number, ultimaCortada?: number): AlocacaoEscala[] => [0, 1, 2, 3].map((i) => linha(i, i === 3 && ultimaCortada !== undefined ? ultimaCortada : 100 * f));

describe("fatorEmbutidoDoPlano / projetarProducaoReescalada", () => {
  it("(i) plano NOMINAL (razão 1): resultado idêntico à projeção atual — inclusive com a última linha cortada pelo restante", () => {
    for (const plano of [semanaA(1), semanaA(1, 30), [linha(0, 100), linha(1, 100), linha(2, 100, { funcionarioId: "f02" }), linha(2, 40)]]) {
      const fator = { [K_A]: 1.2 };
      expect(projetarProducaoReescalada(plano, fator, fatorEmbutidoDoPlano(plano, e0.pools, e0.slots))).toEqual(projetarProducao(plano, fator));
    }
  });

  it("(ii) plano JÁ ×f: a projeção com o mesmo f não dobra; com f novo reescala por f novo / f embutido", () => {
    const plano = semanaA(1.1);
    const emb = fatorEmbutidoDoPlano(plano, e0.pools, e0.slots);
    expect(emb.de(plano[0])).toBeCloseTo(1.1, 10);
    expect(projetarProducaoReescalada(plano, { [K_A]: 1.1 }, emb)[K_A]).toBeCloseTo(440, 8); // antes: 484 (1.1 duas vezes)
    expect(projetarProducao(plano, { [K_A]: 1.1 })[K_A]).toBeCloseTo(484, 8);
    expect(projetarProducaoReescalada(plano, { [K_A]: 0.9 }, emb)[K_A]).toBeCloseTo(360, 8); // 4 × 100 × 0,9
    expect(projetarProducaoReescalada(plano, { [K_A]: 1 }, emb)[K_A]).toBeCloseTo(400, 8);
    const abaixo = semanaA(0.8796);
    expect(projetarProducaoReescalada(abaixo, { [K_A]: 0.8796 }, fatorEmbutidoDoPlano(abaixo, e0.pools, e0.slots))[K_A]).toBeCloseTo(400 * 0.8796, 8);
  });

  it("última linha do pool CORTADA pelo restante não vira 'f': plano ×f com a cauda cortada reescala a cauda pelo f dos períodos cheios", () => {
    const plano = semanaA(1.1, 33); // 3 períodos cheios (110) e o último cortado em 33
    const emb = fatorEmbutidoDoPlano(plano, e0.pools, e0.slots);
    expect(emb.de(plano[3])).toBeCloseTo(1.1, 10);
    expect(projetarProducaoReescalada(plano, { [K_A]: 1.1 }, emb)[K_A]).toBeCloseTo(3 * 100 * 1.1 + 33, 8);
  });

  it("(iii) bordas: ambíguo (única linha, último período) nunca assume f < 1; sem período anterior ⇒ max(1, razão)", () => {
    const sozinha = [linha(5, 40)]; // pode ser o resto cortado de um plano nominal
    expect(fatorEmbutidoDoPlano(sozinha, e0.pools, e0.slots).de(sozinha[0])).toBe(1);
    const sozinhaAcima = [linha(5, 110)];
    expect(fatorEmbutidoDoPlano(sozinhaAcima, e0.pools, e0.slots).de(sozinhaAcima[0])).toBeCloseTo(1.1, 10);
    const comAnterior = [linha(4, 90), linha(5, 40)]; // plano ×0,9 com a cauda cortada: usa o período anterior
    expect(fatorEmbutidoDoPlano(comAnterior, e0.pools, e0.slots).de(comAnterior[1])).toBeCloseTo(0.9, 10);
  });

  it("(iii) bordas: meta ausente/zero, peças ≤ 0, adicional puro, sem posto, razão fora de faixa e período desconhecido caem em 1", () => {
    const semMeta = { ...e0.pools[0], metas: { ...e0.pools[0].metas, m1: 0 } };
    const l0 = linha(0, 120);
    expect(fatorEmbutidoDoPlano([l0], [semMeta, e0.pools[1]], e0.slots).de(l0)).toBe(1);
    const adic = linha(1, 0, { pecasAdicional: 80 });
    const ocioso = linha(2, 0, { maquinaId: null, produtoId: null, etapaId: null, operacaoId: null });
    const absurda = linha(3, 100 * 9);
    const plano = [adic, ocioso, absurda, linha(4, 100), linha(5, 100)];
    const emb = fatorEmbutidoDoPlano(plano, e0.pools, e0.slots);
    expect(emb.de(adic)).toBe(1);
    expect(emb.de(ocioso)).toBe(1);
    expect(emb.de(absurda)).toBe(1); // 9× está fora de faixa => legado
    expect(emb.de({ data: "2031-01-01", periodoId: "m1", produtoId: "A", etapaId: "A1" })).toBe(1);
    expect(emb.de({ data: e0.slots[0].data, periodoId: "m1", produtoId: "Z", etapaId: "Z1" })).toBe(1);
    // adicional puro soma 0 de previsto e linhas sem posto não entram na projeção (como antes)
    expect(projetarProducaoReescalada([adic, ocioso], { [K_A]: 1.2 }, emb)).toEqual(projetarProducao([adic, ocioso], { [K_A]: 1.2 }));
  });

  it("(iii) bordas: linha MANUAL não estima o f e herda o do período/pool vizinho", () => {
    const manual = linha(1, 100, { origem: "manual" });
    const plano = [linha(0, 110), manual, linha(2, 110), linha(3, 110)];
    const emb = fatorEmbutidoDoPlano(plano, e0.pools, e0.slots);
    expect(emb.de(manual)).toBeCloseTo(1.1, 10); // vizinho anterior
    const soManual = [linha(1, 100, { origem: "manual" })];
    expect(fatorEmbutidoDoPlano(soManual, e0.pools, e0.slots).de(soManual[0])).toBe(1);
  });

  it("razão ≈ 1 dentro de 1e-4 é tratada como exatamente 1 (sem ruído numérico)", () => {
    const plano = [linha(0, 100.003), linha(1, 100.003), linha(2, 100.003)];
    expect(fatorEmbutidoDoPlano(plano, e0.pools, e0.slots).de(plano[0])).toBe(1);
  });
});

describe("executarCorteSombra: faltaOficial não depende de o plano gravado já trazer f", () => {
  const mk = (): EntradaEscala => entrada({ funcionarios: equipe(8), pools: [
    pool({ produto: "A", etapa: "A-e1", op: "opX", q: 900, maquinas: ["m1", "m2"], mu: 100 }),
    pool({ produto: "B", etapa: "B-e1", op: "opY", q: 700, maquinas: ["m3", "m4"], mu: 100 }),
    pool({ produto: "C", etapa: "C-e1", op: "opZ", q: 500, maquinas: ["m5"], mu: 100 }),
  ] }, DIAS);
  const e = mk();
  const idx = (a: { data: string; periodoId: string }) => e.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)!.indice;
  const c = 3;
  const plano = gerarEscala(e).alocacoes;
  const apont: ApontamentoReal[] = plano.filter((a) => a.maquinaId && idx(a) <= c).map((a) => ({
    data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId, boas: Math.round(a.pecas * 0.9), refugo: 0, meta: a.pecas, status: "produzindo",
    lancadoEmMs: e.slots[idx(a)].fimMs + 60_000,
  } as ApontamentoReal));
  const par = (p: AlocacaoEscala[]): ParametrosCorte => ({ base: e, ausencias: [], indisponibilidades: [], apontamentos: apont, planoOficial: p, c, corteMs: e.slots[c].fimMs + 10 * 60_000 });

  it("plano nominal: a decisão é a mesma de antes da correção (f embutido 1)", () => {
    const d = executarCorteSombra(par(plano));
    expect(d.desempenho["A|A-e1"].f).toBeLessThan(1);
    // projeção antiga reproduzida à mão: Σ pecas × f
    const futuro = plano.filter((a) => idx(a) >= c + 1);
    const velho = projetarProducao(futuro, Object.fromEntries(Object.entries(d.desempenho).map(([k, v]) => [k, v.f])));
    const capacidadeVelha = Object.keys(velho).reduce((s, k) => s + Math.min(velho[k], d.restantePorPool[k]), 0);
    expect(d.faltaOficial.capacidade).toBeCloseTo(capacidadeVelha, 6);
  });

  it("plano já ×1,1 (como gravado por um replanejamento): faltaOficial igual à do plano nominal; a fórmula antiga dobraria o f", () => {
    const nominal = executarCorteSombra(par(plano));
    const gravado = plano.map((a) => (idx(a) >= c + 1 && a.maquinaId ? { ...a, pecas: a.pecas * 1.1 } : a));
    const d = executarCorteSombra(par(gravado));
    expect(d.faltaOficial.total).toBeCloseTo(nominal.faltaOficial.total, 4);
    const fator = Object.fromEntries(Object.entries(d.desempenho).map(([k, v]) => [k, v.f]));
    const dobrado = projetarProducao(gravado.filter((a) => idx(a) >= c + 1), fator);
    const certo = projetarProducao(plano.filter((a) => idx(a) >= c + 1), fator);
    expect(dobrado["A|A-e1"]).toBeGreaterThan(certo["A|A-e1"] * 1.09); // o erro que a correção elimina
  });
});
