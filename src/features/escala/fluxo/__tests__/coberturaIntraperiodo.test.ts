// COBERTURA DE MATERIAL INTRAPERÍODO — protótipo desligado por padrão. Casos A–H do pedido de auditoria (30/10/2026).
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../../gerarEscala";
import { coberturaPosto, maxPostosSustentaveis, margemDaConfianca } from "../coberturaIntraperiodo";
import { coberturaDoPlano, repararCobertura } from "../coberturaPlano";
import { prepararFluxo } from "../estado";
import type { ContagemFisicaPar } from "../tipos";
import { ap, equipe, linhaPlano, montar, pool } from "./helpersFluxo";

describe("coberturaPosto (pura)", () => {
  it("exemplo do usuário: upstream 700/h, downstream 1000/h, 80 min ⇒ o WIP inicial precisa cobrir 400 peças", () => {
    const base = { duracaoMin: 80, producaoUpstream: (700 * 80) / 60, consumoPlanejado: (1000 * 80) / 60 };
    const ok = coberturaPosto({ ...base, wipInicial: 400 });
    expect(ok.bufferNecessario).toBeCloseTo(400, 6);
    expect(ok.sustentavel).toBe(true);
    const falta = coberturaPosto({ ...base, wipInicial: 399 });
    expect(falta.sustentavel).toBe(false);
  });

  it("CASO A: WIP inicial cobre o período inteiro sozinho (upstream parado) ⇒ permitido", () => {
    const r = coberturaPosto({ duracaoMin: 80, wipInicial: 1000, producaoUpstream: 0, consumoPlanejado: 900 });
    expect(r.sustentavel).toBe(true);
    expect(r.minutoEsgotamento).toBeNull();
    expect(r.fracaoViavel).toBe(1);
  });

  it("CASO B: WIP não cobre sozinho, mas o upstream durante o período cobre ⇒ permitido", () => {
    const r = coberturaPosto({ duracaoMin: 80, wipInicial: 200, producaoUpstream: 800, consumoPlanejado: 1000 });
    expect(r.sustentavel).toBe(true);
    expect(coberturaPosto({ duracaoMin: 80, wipInicial: 0, producaoUpstream: 1000, consumoPlanejado: 1000 }).sustentavel).toBe(true);
  });

  it("CASO C: WIP + upstream não cobrem ⇒ o posto inteiro NÃO é permitido (sem fracionar a pessoa)", () => {
    const e = { duracaoMin: 80, wipInicial: 100, producaoUpstream: 700 };
    expect(coberturaPosto({ ...e, consumoPlanejado: 1000 }).sustentavel).toBe(false);
    // 2 postos de 500: 1 posto cabe (800 ≥ 500), 2 não (800 < 1000) ⇒ máximo 1; com 1 posto de 1000 ⇒ máximo 0
    expect(maxPostosSustentaveis(e, 500, 2)).toBe(1);
    expect(maxPostosSustentaveis(e, 1000, 1)).toBe(0);
  });

  it("CASO D: upstream mais lento que o downstream, mas buffer inicial suficiente ⇒ permitido", () => {
    const r = coberturaPosto({ duracaoMin: 80, wipInicial: 500, producaoUpstream: 400, consumoPlanejado: 800 });
    expect(r.bufferNecessario).toBeCloseTo(400, 6);
    expect(r.sustentavel).toBe(true);
  });

  it("CASO E: o buffer acaba antes do fim ⇒ não permitido, com o minuto estimado de esgotamento", () => {
    // taxa de consumo 1000/h, upstream 700/h ⇒ déficit 300/h = 5/min; WIP 200 zera em 40 min
    const r = coberturaPosto({ duracaoMin: 80, wipInicial: 200, producaoUpstream: (700 * 80) / 60, consumoPlanejado: (1000 * 80) / 60 });
    expect(r.sustentavel).toBe(false);
    expect(r.minutoEsgotamento).toBeCloseTo(40, 6);
    expect(r.fracaoViavel).toBeLessThan(1);
  });

  it("upstream que só começa a entregar depois (atraso) é pior que o uniforme", () => {
    const e = { duracaoMin: 80, wipInicial: 300, producaoUpstream: 1000, consumoPlanejado: 1000 };
    expect(coberturaPosto(e).sustentavel).toBe(true);
    const atrasado = coberturaPosto({ ...e, atrasoUpstreamMin: 40 });
    expect(atrasado.sustentavel).toBe(false); // consome 500 nos primeiros 40 min com só 300 de estoque
    expect(atrasado.minutoEsgotamento).toBeCloseTo(24, 6);
  });

  it("margem só existe quando passada (nunca embutida) e aumenta o buffer exigido", () => {
    const e = { duracaoMin: 80, wipInicial: 400, producaoUpstream: (700 * 80) / 60, consumoPlanejado: (1000 * 80) / 60 };
    expect(coberturaPosto(e).sustentavel).toBe(true);
    expect(coberturaPosto({ ...e, margem: 0.1 }).sustentavel).toBe(false);
    expect(margemDaConfianca("baixa", undefined)).toBe(0);
    expect(margemDaConfianca("baixa", { baixa: 0.2 })).toBe(0.2);
    expect(margemDaConfianca("alta", { baixa: 0.2 })).toBe(0);
  });
});

// ---- sobre um plano (usa o simulador de fluxo): P1 (upstream, 500/período) → P2 (downstream, 1500/período) ----------------------------------------
const cenarioPlano = (apontamentosExtra: (slots: ReturnType<typeof montar>["entrada"]["slots"]) => ReturnType<typeof ap>[] = () => [], contagemSaldo?: number) => {
  const pools = [
    pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 20000, maquinas: ["a1", "a2"], mu: 500 }),
    pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 20000, maquinas: ["b1", "b2"], mu: 1500 }),
  ];
  const funcionarios = equipe(4);
  const m0 = montar({ pools, funcionarios, c: 0, plano: (slots) => slots.flatMap((_, i) => (i < 1 ? [] : [])) });
  const slots = m0.entrada.slots;
  const apontamentos = apontamentosExtra(slots);
  const m = montar({ pools, funcionarios, c: 0, apontamentos, plano: (sl) => [linhaPlano(sl, 0, "f01", "a1", "P", "P1", "opA", 500), linhaPlano(sl, 0, "f03", "a2", "P", "P1", "opA", 500)] });
  const contagens: ContagemFisicaPar[] = contagemSaldo === undefined ? [] : [{ produtoId: "P", etapaOrigemId: "P1", etapaSeguinteId: "P2", saldo: contagemSaldo, contadoEmMs: m.entrada.slots[0].fimMs, informadoPor: "teste" }];
  const dados = { ...m.dados, ...(contagens.length ? { contagensFisicas: contagens } : {}) };
  const ctx = prepararFluxo(m.entrada, dados, {});
  const t = ctx.aPartirDe; // primeiro slot mutável
  // plano futuro: P1 em a1 (500) e P2 em b1 (1500) no slot t
  const futuro = [linhaPlano(m.entrada.slots, t, "f01", "a1", "P", "P1", "opA", 500), linhaPlano(m.entrada.slots, t, "f02", "b1", "P", "P2", "opB", 1500)];
  return { ctx, futuro, m, t };
};

describe("coberturaDoPlano (sobre o simulador de fluxo)", () => {
  it("CASO F: WIP confirmado por contagem física ⇒ confiança ALTA e posto sustentado quando o saldo cobre o déficit", () => {
    const { ctx, futuro } = cenarioPlano(() => [], 1200);
    const cov = coberturaDoPlano(ctx, futuro);
    const c = cov.celulas.find((x) => x.no.includes("P2"))!;
    expect(c.confianca).toBe("alta");
    expect(c.wipInicial).toBeGreaterThanOrEqual(1200); // contagem (+ produção dos períodos fechados depois dela)
    expect(c.sustentavel).toBe(true); // 1200 + 500 (upstream) ≥ 1500
  });

  it("CASO G: o MESMO WIP só estimado, com baixa confiança ⇒ planejamento mais conservador (margem por confiança)", () => {
    // WIP lo = 1200 vindo do apontamento de P1 (a1) no slot 0; a2 planejada e SEM apontamento ⇒ célula não confirmada ⇒ confiança baixa
    const apt = (slots: ReturnType<typeof montar>["entrada"]["slots"]) => {
      void slots;
      return [ap({ data: "2026-10-26", periodoId: "m1", maquinaId: "a1", produtoId: "P", etapaId: "P1", boas: 1200 })];
    };
    const f = cenarioPlano(apt, 1200);
    const g = cenarioPlano(apt);
    const cf = coberturaDoPlano(f.ctx, f.futuro, { margemPorConfianca: { baixa: 0.3, media: 0.15 } }).celulas.find((x) => x.no.includes("P2"))!;
    const cg = coberturaDoPlano(g.ctx, g.futuro, { margemPorConfianca: { baixa: 0.3, media: 0.15 } }).celulas.find((x) => x.no.includes("P2"))!;
    expect(cf.confianca).toBe("alta");
    expect(cg.confianca).not.toBe("alta");
    expect(cg.margem).toBeGreaterThan(cf.margem);
    // mesmo WIP piso, margem maior ⇒ buffer exigido maior (ou igual) e nunca mais postos sustentáveis
    expect(cg.bufferNecessario).toBeGreaterThanOrEqual(cf.bufferNecessario);
    expect(cg.postosSustentaveis).toBeLessThanOrEqual(cf.postosSustentaveis);
  });

  it("CASO H: período anterior SEM apontamento não é assumido como produção planejada (WIP piso = 0)", () => {
    // slot 0 tinha P1 planejado (500) e fechou sem apontamento: o intervalo é [0, 500], o piso (lo) é 0 ⇒ P2 (1500) não é sustentado por esse "estoque"
    const sem = cenarioPlano(() => []);
    const com = cenarioPlano((slots) => (void slots, [ap({ data: "2026-10-26", periodoId: "m1", maquinaId: "a1", produtoId: "P", etapaId: "P1", boas: 500 })]));
    const cs = coberturaDoPlano(sem.ctx, sem.futuro).celulas.find((x) => x.no.includes("P2"))!;
    const cc = coberturaDoPlano(com.ctx, com.futuro).celulas.find((x) => x.no.includes("P2"))!;
    expect(cs.wipInicial).toBe(0); // lo = 0, não 500+500 planejados
    expect(cs.sustentavel).toBe(false); // 0 + 500 < 1500
    expect(cc.wipInicial).toBe(500);
    expect(cs.confianca).toBe("baixa"); // há período fechado sem apontamento
  });

  it("nó de entrada (1ª etapa) não tem material modelado: fica em semMaterialModelado, nunca aprovado/reprovado", () => {
    const { ctx, futuro } = cenarioPlano();
    const cov = coberturaDoPlano(ctx, futuro);
    expect(cov.celulas.every((c) => !c.no.includes("P1"))).toBe(true);
    expect(cov.semMaterialModelado).toBe(1);
  });

  it("reparo: o teto de cobertura retira o posto insustentável e termina; sem a opção o motor é byte-idêntico", () => {
    const { ctx, m } = cenarioPlano(() => [], 0);
    const entradaPlano = { ...m.entrada };
    const sem = gerarEscala(entradaPlano);
    const semHook = gerarEscala({ ...entradaPlano, coberturaMax: undefined });
    const vazio = gerarEscala({ ...entradaPlano, coberturaMax: {} });
    expect(JSON.stringify(semHook)).toBe(JSON.stringify(sem));
    expect(JSON.stringify(vazio)).toBe(JSON.stringify(sem));
    const rep = repararCobertura(ctx, entradaPlano);
    expect(rep.violacoesFinais).toBe(0);
    expect(rep.iteracoes).toBeLessThanOrEqual(8);
  });
});
