import { describe, it, expect } from "vitest";
import { PERIODOS_REAIS } from "@/features/escala/__tests__/helpers";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { EstadoBruto, PayloadAplicacao } from "../estado";
import { processarSemana, type EscalaIO } from "../processar";
import { aplicarRascunhoItens, RascunhoInvalidoError, simularCobertura, simularSemana } from "../simularCobertura";

const D1 = "2026-10-26";
const D2 = "2026-10-27";
const METAS = { m1: 100, m2: 100, m3: 100, t1: 100, t2: 100, t3: 100 };
const AGORA = epochMsNoFuso(D1, "05:00");

function estado(extra: Partial<EstadoBruto> = {}, adicionalP1 = 0): EstadoBruto {
  return {
    previsaoId: "prev1",
    semanaInicio: D1,
    diasProdutivos: [D1, D2],
    periodosAtuais: PERIODOS_REAIS,
    diasExistentes: [],
    equipeProdutiva: [1, 2, 3, 4, 5].map((n) => ({ funcionarioId: `f${n}`, ativo: true })),
    itens: [
      { produtoId: "p1", quantidade: 600, quantidadeAdicional: adicionalP1, valorUnitario: 2, maquinasPorEtapa: { e1: ["m1"], e2: ["m3"] } },
      { produtoId: "p2", quantidade: 400, quantidadeAdicional: 0, valorUnitario: 5, maquinasPorEtapa: {} }, // etapa e3 SEM máquina selecionada
    ],
    etapas: [
      { id: "e1", produtoId: "p1", operacaoId: "opA", ordem: 1, metas: METAS, maquinasCompativeis: ["m1", "m2", "m9"] },
      { id: "e2", produtoId: "p1", operacaoId: "opB", ordem: 2, metas: METAS, maquinasCompativeis: ["m3"] },
      { id: "e3", produtoId: "p2", operacaoId: "opC", ordem: 1, metas: METAS, maquinasCompativeis: ["m5", "m6"] },
    ],
    maquinasIndisponiveisPrevisao: [],
    maquinasInativas: [],
    ausencias: [],
    indisponibilidades: [],
    alocacoes: [],
    nomesOperacao: { opA: "Rosquear", opB: "Embalar", opC: "Montar" },
    nomesMaquinas: { m1: "Rosqueadeira 1", m2: "Rosqueadeira 2", m9: "Rosqueadeira 9", m3: "Embaladora 3", m5: "Montagem 5", m6: "Montagem 6" },
    nomesProdutos: { p1: "Pino", p2: "Plug" },
    ...extra,
  };
}

function fakeIO(e: EstadoBruto) {
  const payloads: PayloadAplicacao[] = [];
  const io: EscalaIO = {
    async carregarEstado() { return e; },
    async aplicar(p) { payloads.push(p); return { versoes: {} }; },
  };
  return { io, payloads };
}

describe("simularCobertura — PARIDADE com o gerador da Escala (mesmo motor)", () => {
  [0, 800].forEach((adicional) => {
    it(`a simulação produz exatamente as alocações que a geração grava (adicional do p1 = ${adicional})`, async () => {
      const e = estado({}, adicional);
      const { io, payloads } = fakeIO(e);
      await processarSemana(io, { agoraMs: AGORA, criarSeNaoExiste: true });
      const sim = simularSemana(e, AGORA);
      expect(JSON.stringify(sim.resultado.alocacoes)).toBe(JSON.stringify(payloads[0].alocacoes));
      if (adicional > 0) expect(payloads[0].alocacoes.some((a) => (a.pecasAdicional ?? 0) > 0)).toBe(true);
    });
  });

  it("simular é somente leitura: não chama a gravação e não altera o estado recebido", () => {
    const e = estado({}, 500);
    const antes = JSON.stringify(e);
    simularCobertura(e, AGORA, { sugerir: true });
    expect(JSON.stringify(e)).toBe(antes);
  });
});

describe("simularCobertura — resultado para a tela", () => {
  it("sem adicional programado, 'somentePrevisto' é igual a 'atual'", () => {
    const r = simularCobertura(estado(), AGORA);
    expect(r.somentePrevisto.percentual).toBe(r.atual.percentual);
    expect(r.adicional.find((a) => a.produtoId === "p1")).toMatchObject({ previsto: 600, adicionalProgramado: 0, adicionalAbsorvido: 0 });
    expect(r.sugestao).toBeNull();
    expect(r.periodosAnalisados).toBe(12); // 2 dias × 6 períodos, semana ainda não iniciada
  });

  it("adicional manual: mostra o que está programado e o que a capacidade ociosa realmente absorve (produto acabado)", () => {
    const pouco = simularCobertura(estado({}, 100), AGORA);
    const demais = simularCobertura(estado({}, 1_000_000), AGORA);
    const a1 = pouco.adicional.find((a) => a.produtoId === "p1")!;
    const a2 = demais.adicional.find((a) => a.produtoId === "p1")!;
    expect(a1.adicionalProgramado).toBe(100);
    expect(a1.adicionalAbsorvido).toBe(100);
    expect(a2.adicionalProgramado).toBe(1_000_000);
    expect(a2.adicionalAbsorvido).toBeLessThan(1_000_000); // programou mais do que cabe
    expect(a2.adicionalAbsorvido).toBeGreaterThan(a1.adicionalAbsorvido);
    expect(demais.atual.minutosSemPosto).toBeLessThan(pouco.atual.minutosSemPosto);
    expect(pouco.somentePrevisto.minutosSemPosto).toBeGreaterThan(pouco.atual.minutosSemPosto); // "antes" × "depois"
  });

  it("etapa sem máquina selecionada é apontada com os recursos compatíveis do roteiro (nunca selecionados automaticamente)", () => {
    const r = simularCobertura(estado(), AGORA);
    expect(r.etapasSemMaquina).toEqual([{ produtoId: "p2", etapaId: "e3", compativeis: ["m5", "m6"] }]);
    expect(r.nomes.maquinas.m5).toBe("Montagem 5");
  });

  it("sugestão: só produto acabado, ignora produto com etapa sem máquina, devolve cobertura depois de aplicar e valor potencial separado", () => {
    const r = simularCobertura(estado(), AGORA, { sugerir: true });
    expect(r.sugestao).not.toBeNull();
    const s = r.sugestao!;
    const p1 = s.porProduto.find((p) => p.produtoId === "p1")!;
    const p2 = s.porProduto.find((p) => p.produtoId === "p2");
    expect(p1.adicionalSugerido).toBeGreaterThan(0);
    expect(p1.porEtapa).toHaveLength(2);
    expect(p2 === undefined || p2.adicionalSugerido === 0).toBe(true);
    expect(s.valorPotencial).toBe(p1.adicionalSugerido * 2);
    expect(s.coberturaApos.minutosSemPosto).toBeLessThanOrEqual(r.somentePrevisto.minutosSemPosto);
    expect(s.iteracoes).toBeGreaterThanOrEqual(1);
  });

  it("recurso compatível verificado pelo motor aparece com o ganho em horas-pessoa", () => {
    // p1/e1 só com m1 e demanda alta → pessoas sobram; m2 e m9 são compatíveis do roteiro e não foram selecionadas
    const e = estado({ itens: [{ produtoId: "p1", quantidade: 1_000_000, valorUnitario: 2, maquinasPorEtapa: { e1: ["m1"], e2: ["m3"] } }] });
    const r = simularCobertura(e, AGORA);
    expect(r.recursosCompativeis.map((x) => x.maquinaId).sort()).toEqual(["m2", "m9"]);
    r.recursosCompativeis.forEach((x) => {
      expect(x.ganhoHoras).toBeGreaterThan(0);
      expect(x.coberturaApos).toBeGreaterThan(r.atual.percentual);
      expect(x.poolsAfetados).toEqual([{ produtoId: "p1", etapaId: "e1" }]);
    });
  });

  it("recurso compatível + carga adicional: efeito combinado verificado pelo motor (a carga só pode ajudar)", () => {
    // p1/e1 só com m1; e2 (m3) tem folga. Com m2 selecionada o produto passa a fechar mais adicional.
    const e = estado({ itens: [{ produtoId: "p1", quantidade: 500, valorUnitario: 2, maquinasPorEtapa: { e1: ["m1"], e2: ["m3"] } }] });
    const r = simularCobertura(e, AGORA, { sugerir: true });
    expect(r.recursosCompativeis.length).toBeGreaterThan(0);
    r.recursosCompativeis.forEach((x) => {
      expect(x.comCargaAdicional).toBeDefined();
      expect(x.comCargaAdicional!.coberturaApos).toBeGreaterThanOrEqual(x.coberturaApos - 1e-9);
      expect(x.comCargaAdicional!.pecas).toBeGreaterThanOrEqual(0);
    });
    // sem pedir sugestão o campo não é calculado (a análise simples continua rápida)
    expect(simularCobertura(e, AGORA).recursosCompativeis.every((x) => x.comCargaAdicional === undefined)).toBe(true);
  });

  it("semana já passada: nada a analisar (100%, 0 períodos)", () => {
    const r = simularCobertura(estado(), epochMsNoFuso("2026-11-10", "10:00"));
    expect(r.periodosAnalisados).toBe(0);
    expect(r.atual.percentual).toBe(100);
  });
});

describe("itens em edição (modo simulação / adicional digitado e ainda não salvo)", () => {
  it("substitui os itens só para simular: adicional e quantidade novos entram; o estado original não é alterado", () => {
    const base = estado();
    const antes = JSON.stringify(base);
    const e2 = aplicarRascunhoItens(base, [{ produto_id: "p1", quantidade: 600, quantidade_adicional: 1500 }]);
    expect(JSON.stringify(base)).toBe(antes);
    expect(e2.itens).toHaveLength(1);
    expect(e2.itens[0]).toMatchObject({ produtoId: "p1", quantidade: 600, quantidadeAdicional: 1500 });
    // campo ausente cai no valor salvo do produto (máquinas, valor)
    expect(e2.itens[0].maquinasPorEtapa).toEqual({ e1: ["m1"], e2: ["m3"] });
    expect(e2.itens[0].valorUnitario).toBe(2);
  });

  it("a consequência muda ao editar: mais adicional digitado => menos horas sem posto", () => {
    const base = estado();
    const zero = simularCobertura(aplicarRascunhoItens(base, [{ produto_id: "p1", quantidade: 600, quantidade_adicional: 0 }]), AGORA);
    const mil = simularCobertura(aplicarRascunhoItens(base, [{ produto_id: "p1", quantidade: 600, quantidade_adicional: 1000 }]), AGORA);
    expect(mil.atual.minutosSemPosto).toBeLessThan(zero.atual.minutosSemPosto);
  });

  it("valores inválidos são recusados (negativo / não numérico)", () => {
    expect(() => aplicarRascunhoItens(estado(), [{ produto_id: "p1", quantidade_adicional: -1 }])).toThrow();
    expect(() => aplicarRascunhoItens(estado(), [{ produto_id: "p1", quantidade_adicional: Number.NaN }])).toThrow();
    try {
      aplicarRascunhoItens(estado(), [{ produto_id: "p1", quantidade: -5 }]);
    } catch (e) {
      expect(e instanceof RascunhoInvalidoError).toBe(true);
    }
  });

  it("produto sem produto_id é ignorado", () => {
    expect(aplicarRascunhoItens(estado(), [{ quantidade: 10 }]).itens).toHaveLength(0);
  });
});
