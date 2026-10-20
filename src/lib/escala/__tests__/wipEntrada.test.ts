import { describe, it, expect } from "vitest";
import { lerParametros, PARAMETROS_PADRAO } from "@/features/escala/parametros";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { chavePool } from "@/features/escala/types";
import { Mundo, estadoDeTeste } from "./bancoMemoria";
import { montarEntradaEscala } from "../montarEntrada";
import { aplicarRascunhoItens, RascunhoInvalidoError } from "../simularCobertura";

const SEMANA = "2026-11-02";
const DIAS = [SEMANA, "2026-11-03"];
const AGORA = epochMsNoFuso("2026-10-30", "10:00");

describe("parâmetros da Escala", () => {
  it("padrões quando não há linhas; modo desconhecido ou inválido = desligado", () => {
    expect(lerParametros([])).toEqual(PARAMETROS_PADRAO);
    expect(lerParametros(null)).toEqual(PARAMETROS_PADRAO);
    expect(lerParametros([{ chave: "wip_modo", valor: "qualquer" }]).wipModo).toBe("desligado");
    expect(lerParametros([{ chave: "wip_modo", valor: "ativo" }, { chave: "wip_dias_limite", valor: 2 }])).toEqual({ wipModo: "ativo", wipDiasLimite: 2, atingibilidadeMargem: 0.1 });
    expect(lerParametros([{ chave: "atingibilidade_margem", valor: 0.25 }]).atingibilidadeMargem).toBe(0.25);
    expect(lerParametros([{ chave: "atingibilidade_margem", valor: 7 }]).atingibilidadeMargem).toBe(0.1); // fora de 0–1: padrão
    expect(lerParametros([{ chave: "wip_dias_limite", valor: -3 }]).wipDiasLimite).toBe(PARAMETROS_PADRAO.wipDiasLimite);
    expect(lerParametros([{ chave: "wip_dias_limite", valor: "abc" }]).wipDiasLimite).toBe(PARAMETROS_PADRAO.wipDiasLimite);
  });
});

describe("montagem da entrada com o adicional por etapa", () => {
  const comWip = () => {
    const e = estadoDeTeste(SEMANA, DIAS);
    e.parametros = { wipModo: "ativo", wipDiasLimite: 1 };
    e.itens[0].adicionalPorEtapa = { eA1: 1000, eA2: 400 };
    return e;
  };

  it("desligado: adicional do item vale só como antes e não há entrada.wip", () => {
    const e = estadoDeTeste(SEMANA, DIAS);
    e.itens[0].quantidadeAdicional = 700;
    e.itens[0].adicionalPorEtapa = { eA1: 1000, eA2: 400 }; // ignorado com o modo desligado
    const { entrada } = montarEntradaEscala(e, AGORA);
    expect(entrada.wip).toBeUndefined();
    expect(entrada.pools.find((p) => p.etapaId === "eA1")?.adicionalMax).toBe(700);
    expect(entrada.pools.find((p) => p.etapaId === "eA2")?.adicionalMax).toBe(700);
  });

  it("ativo: teto por etapa; etapa sem valor = 0; limites só para etapas que têm uma seguinte", () => {
    const { entrada } = montarEntradaEscala(comWip(), AGORA);
    const teto = (id: string) => entrada.pools.find((p) => p.etapaId === id)?.adicionalMax;
    expect(teto("eA1")).toBe(1000);
    expect(teto("eA2")).toBe(400);
    expect(teto("eB1")).toBe(0);
    const chaves = Object.keys(entrada.wip!.limites);
    expect(chaves).toContain(chavePool("pA", "eA1"));
    expect(chaves).not.toContain(chavePool("pA", "eA2")); // última etapa: sem estoque depois
  });

  it("ativo, item sem adicional por etapa: o adicional do item vale para todas as etapas (como antes)", () => {
    const e = comWip();
    e.itens[1].quantidadeAdicional = 300;
    const { entrada } = montarEntradaEscala(e, AGORA);
    expect(entrada.pools.find((p) => p.etapaId === "eB1")?.adicionalMax).toBe(300);
    expect(entrada.pools.find((p) => p.etapaId === "eB2")?.adicionalMax).toBe(300);
  });

  it("limite pela Previsão da semana seguinte (regra A): produto ausente = 0; presente = a necessidade", () => {
    const e = comWip();
    e.proximaSemana = { quantidadePorProduto: { pA: 1234 } };
    const { entrada } = montarEntradaEscala(e, AGORA);
    expect(entrada.wip!.limites[chavePool("pA", "eA1")]).toBe(1234);
    expect(entrada.wip!.limites[chavePool("pB", "eB1")]).toBe(0);
  });

  it("limite pela regra B cresce com wip_dias_limite", () => {
    const um = montarEntradaEscala(comWip(), AGORA).entrada.wip!.limites[chavePool("pA", "eA1")];
    const e = comWip();
    e.parametros = { wipModo: "ativo", wipDiasLimite: 3 };
    const tres = montarEntradaEscala(e, AGORA).entrada.wip!.limites[chavePool("pA", "eA1")];
    expect(um).toBeGreaterThan(0);
    expect(tres).toBeCloseTo(um * 3, 6);
  });

  it("mudar o parâmetro muda a escala gerada (recálculo é necessário e determinístico)", async () => {
    const DIAS5 = [SEMANA, "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
    const cenario = (modo: "ativo" | "desligado") => {
      const e = estadoDeTeste(SEMANA, DIAS5, { pessoas: 14 });
      e.itens[0].quantidade = 3000;
      e.itens[1].quantidade = 2500;
      e.itens[0].adicionalPorEtapa = { eA1: 3000, eA2: 1500 };
      e.itens[0].quantidadeAdicional = 1500;
      e.parametros = { wipModo: modo, wipDiasLimite: 1 };
      return e;
    };
    const gerar = async (modo: "ativo" | "desligado") => { const m = new Mundo(cenario(modo)); await m.recalcular(AGORA, true); return Mundo.assinatura(m.futuras(AGORA)); };
    const ativo = await gerar("ativo");
    expect(ativo === (await gerar("desligado"))).toBe(false);
    expect(ativo === (await gerar("ativo"))).toBe(true);
  });
});

describe("rascunho da tela com adicional por etapa", () => {
  it("aplica adicional_etapas ao item; valor negativo é rejeitado", () => {
    const base = estadoDeTeste(SEMANA, DIAS);
    const novo = aplicarRascunhoItens(base, [{ produto_id: "pA", quantidade: 100, quantidade_adicional: 50, adicional_etapas: { eA1: 80, eA2: 50 }, maquinas_por_etapa: { eA1: ["m1"], eA2: ["m5"] } }]);
    expect(novo.itens[0].adicionalPorEtapa).toEqual({ eA1: 80, eA2: 50 });
    expect(() => aplicarRascunhoItens(base, [{ produto_id: "pA", quantidade: 100, adicional_etapas: { eA1: -1 } }])).toThrow(RascunhoInvalidoError);
  });
  it("sem adicional_etapas o item não carrega valores por etapa", () => {
    const novo = aplicarRascunhoItens(estadoDeTeste(SEMANA, DIAS), [{ produto_id: "pA", quantidade: 100, quantidade_adicional: 50 }]);
    expect(novo.itens[0].adicionalPorEtapa).toBeUndefined();
  });
});
