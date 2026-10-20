import { describe, it, expect } from "vitest";
import { analisarAtingibilidade } from "../atingibilidade";
import { calcularCobertura, analisarCobertura, CAUSAS, resumirPessoasComPosto } from "../cobertura";
import { gerarEscala } from "../gerarEscala";
import { chavePool, type ResultadoEscala } from "../types";
import { entrada, equipe, pool, checarInvariantes } from "./helpers";
import { cenarioAleatorio, comWip, produto } from "./adicionalWipHelpers";

const DIA = "2026-10-19";

describe("atingibilidade do previsto × cobertura da equipe", () => {
  it("cobertura 100% e previsto IMPOSSÍVEL ao mesmo tempo (uma máquina só, carga maior que a capacidade)", () => {
    // 1 pessoa, 1 máquina: 6 períodos × 100 = 600 de capacidade; previsto 1000
    const e = entrada({ funcionarios: equipe(1), pools: [pool({ produto: "A", op: "op", q: 1000, maquinas: ["m1"], mu: 100 })] }, [DIA]);
    const r = gerarEscala(e);
    expect(calcularCobertura(e, r).percentual).toBe(100);
    const a = analisarAtingibilidade(e, r);
    expect(a.status).toBe("impossivel");
    expect(a.produtos[0].causa).toBe("capacidade_maquinas");
    expect(a.produtos[0].faltaMinima).toBeCloseTo(400, 6);
    expect(a.produtos[0].faltaPlano).toBeCloseTo(400, 6);
    expect(a.produtos[0].acao?.tipo).toBe("reduzir_quantidade");
    expect(a.produtos[0].acao?.quantidade).toBe(600);
  });

  it("atingível quando cabe com folga; em risco quando fecha sem folga (margem)", () => {
    const folgada = entrada({ funcionarios: equipe(2), pools: [pool({ produto: "A", op: "op", q: 300, maquinas: ["m1"], mu: 100 })] }, [DIA]);
    expect(analisarAtingibilidade(folgada, gerarEscala(folgada)).status).toBe("atingivel");
    const justa = entrada({ funcionarios: equipe(1), pools: [pool({ produto: "A", op: "op", q: 600, maquinas: ["m1"], mu: 100 })] }, [DIA]);
    const a = analisarAtingibilidade(justa, gerarEscala(justa));
    expect(a.status).toBe("em_risco");
    expect(a.produtos[0].causa).toBe("folga_curta");
    expect(a.produtos[0].faltaPlano).toBe(0);
    // margem zero: fechar justo é atingível
    expect(analisarAtingibilidade(justa, gerarEscala(justa), { margem: 0 }).status).toBe("atingivel");
  });

  it("máquinas compartilhadas que não dão conta do conjunto => impossível por capacidade conjunta", () => {
    // duas etapas de produtos diferentes usam a MESMA máquina: 2 × 400 = 800 > 600 períodos-máquina possíveis
    const e = entrada({ funcionarios: equipe(4), pools: [pool({ produto: "A", op: "o1", q: 400, maquinas: ["mS"], mu: 100 }), pool({ produto: "B", op: "o2", q: 400, maquinas: ["mS"], mu: 100 })] }, [DIA]);
    const a = analisarAtingibilidade(e, gerarEscala(e));
    expect(a.produtos.every((p) => p.status === "impossivel")).toBe(true);
    expect(a.produtos.map((p) => p.causa)).toEqual(["capacidade_conjunta", "capacidade_conjunta"]);
  });

  it("equipe insuficiente: períodos-pessoa necessários > disponíveis", () => {
    const e = entrada({ funcionarios: equipe(1), pools: [pool({ produto: "A", op: "o1", q: 400, maquinas: ["m1"], mu: 100 }), pool({ produto: "B", op: "o2", q: 400, maquinas: ["m2"], mu: 100 })] }, [DIA]);
    const a = analisarAtingibilidade(e, gerarEscala(e));
    expect(a.equipe.insuficiente).toBe(true);
    expect(a.produtos.some((p) => p.causa === "equipe_insuficiente")).toBe(true);
    expect(a.status).toBe("impossivel");
  });

  it("etapa sem máquina selecionada: impossível, com as compatíveis como ação", () => {
    const sem = { ...pool({ produto: "A", op: "o1", q: 100, maquinas: [], mu: 100 }), maquinasCompativeisIds: ["m9", "m8"] };
    const ok = pool({ produto: "B", op: "o2", q: 100, maquinas: ["m1"], mu: 100 });
    const e = { ...entrada({ funcionarios: equipe(2), pools: [ok] }, [DIA]), poolsSemMaquina: [sem] };
    const a = analisarAtingibilidade(e, gerarEscala(e));
    const pa = a.produtos.find((p) => p.produtoId === "A")!;
    expect(pa.status).toBe("impossivel");
    expect(pa.causa).toBe("sem_maquina");
    expect(pa.acao).toMatchObject({ tipo: "selecionar_maquina", compativeis: ["m8", "m9"] });
  });

  it("máquina do gargalo ficou livre com peças faltando => em risco + ação de priorizar a máquina (por períodos)", () => {
    // diagnóstico puro sobre um plano dado: 300 peças, capacidade 600, o plano deixou 100 e a máquina livre
    const e = entrada({ funcionarios: equipe(2), pools: [pool({ produto: "A", op: "o1", q: 300, maquinas: ["m1"], mu: 100 })] }, [DIA]);
    const plano: ResultadoEscala = {
      alocacoes: e.slots.flatMap((s) => ["f01", "f02"].map((f) => ({ data: s.data, periodoId: s.periodoId, funcionarioId: f, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, motivoSemPosto: "x", excecaoRevezamento: false, motivoExcecao: null }))),
      alertas: [], resumoSlots: [], primeiraGeracaoComSemanaEmAndamento: false, pecasRestantes: { [chavePool("A", "A-e1")]: 100 }, adicionalProduzido: {},
    } as unknown as ResultadoEscala;
    const a = analisarAtingibilidade(e, plano);
    const p = a.produtos[0];
    expect(p.status).toBe("em_risco");
    expect(p.causa).toBe("maquina_livre_nao_priorizada");
    expect(p.faltaPlano).toBe(100);
    expect(p.acao).toMatchObject({ tipo: "priorizar_maquina", maquinaId: "m1" });
    expect(p.acao?.periodos).toBe(1); // 100 peças / (100 por período × 1 máquina)
    expect(p.periodosNecessarios).toBe(1);
  });

  it("passado congelado: o que já foi produzido não conta como necessidade", () => {
    const base = entrada({ funcionarios: equipe(1), pools: [pool({ produto: "A", op: "o1", q: 1000, maquinas: ["m1"], mu: 100 })] }, [DIA]);
    const e = {
      ...base,
      aPartirDe: 2,
      congeladas: [0, 1].map((i) => ({ data: DIA, periodoId: base.slots[i].periodoId, funcionarioId: "f01", maquinaId: "m1", produtoId: "A", etapaId: "A-e1", operacaoId: "o1", pecas: 100, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null })),
    };
    const a = analisarAtingibilidade(e, gerarEscala(e));
    expect(a.produtos[0].etapas[0].necessidade).toBe(800);
    expect(a.produtos[0].etapas[0].capacidadeMaquinas).toBe(400); // 4 períodos restantes
  });
});

describe("atingibilidade — propriedades (cenários aleatórios)", () => {
  it("as provas são SEGURAS: o plano nunca produz acima do limite; atingível => nada falta; impossível => o plano realmente falha", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const { base } = cenarioAleatorio(seed);
      const e = { ...base, pools: base.pools.map((p) => ({ ...p, adicionalMax: 0 })) };
      const r = gerarEscala(e);
      const a = analisarAtingibilidade(e, r);
      a.produtos.forEach((p) => {
        p.etapas.forEach((et) => {
          expect(et.produzidoNoPlano).toBeLessThanOrEqual(et.capacidadeMaquinas + 1e-6);
          expect(et.faltaPlano).toBeLessThanOrEqual(et.necessidade + 1e-6);
        });
        if (p.status === "atingivel") expect(p.faltaPlano).toBe(0);
        if (p.status === "impossivel") expect(p.faltaPlano > 0 || p.faltaMinima > 0).toBe(true);
        if (p.faltaPlano > 0) expect(p.status === "em_risco" || p.status === "impossivel").toBe(true);
      });
    }
  });
});

describe("pessoas com posto por período", () => {
  it("mínimo, máximo e média", () => {
    // 3 pessoas, 1 máquina: sempre 1 com posto
    const e = entrada({ funcionarios: equipe(3), pools: [pool({ produto: "A", op: "o1", q: 600, maquinas: ["m1"], mu: 100 })] }, [DIA]);
    const r = gerarEscala(e);
    const s = resumirPessoasComPosto(e, r);
    expect(s).toMatchObject({ periodos: 6, minimo: 1, maximo: 1, media: 1, disponiveisMedia: 3 });
    expect(s.periodoMinimo).not.toBeNull();
  });
  it("mínimo/máximo/média coerentes com a escala (aleatórios)", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { base } = cenarioAleatorio(seed);
      const r = gerarEscala(base);
      const s = resumirPessoasComPosto(base, r);
      expect(s.minimo).toBeLessThanOrEqual(s.media + 1e-9);
      expect(s.media).toBeLessThanOrEqual(s.maximo + 1e-9);
      const comPosto = r.alocacoes.filter((a) => a.maquinaId).length;
      expect(s.media * s.periodos).toBeCloseTo(comPosto, 6);
    }
  });
});

describe("novas causas de falta de cobertura (WIP)", () => {
  it("estoque no limite => pessoas ociosas por 'limite_estoque', somando exatamente os sem posto", () => {
    // etapa 1 com 3 máquinas, etapa 2 com 1: a etapa 1 enche o estoque permitido (100) e as máquinas livres ficam bloqueadas
    const base = entrada({ funcionarios: equipe(8), pools: produto("P", [["m1", "m3", "m4"], ["m2"]], { q: 100, mu: 100 }) }, [DIA]);
    const e = comWip(base, { limite: 100 });
    const r = gerarEscala(e);
    const { cobertura } = analisarCobertura(e, r);
    expect(CAUSAS.reduce((s, c) => s + cobertura.porCausa[c].pessoasPeriodo, 0)).toBe(cobertura.pessoasPeriodoSemPosto);
    expect(cobertura.porCausa.limite_estoque.pessoasPeriodo).toBeGreaterThan(0);
  });

  it("etapa seguinte sem material => 'aguardando_etapa_anterior'", () => {
    // etapa 1 com 1 máquina (gargalo), etapa 2 com 3 máquinas e adicional liberado: as máquinas da etapa 2 esperam o material
    const base = entrada({ funcionarios: equipe(8), pools: produto("P", [["m1"], ["m2", "m3", "m4"]], { q: 100, mu: 100 }) }, [DIA]);
    const e = comWip(base, { limite: 100000 });
    const { cobertura } = analisarCobertura(e, gerarEscala(e));
    expect(cobertura.porCausa.aguardando_etapa_anterior.pessoasPeriodo).toBeGreaterThan(0);
  });

  it("sem WIP as novas causas ficam em zero (comportamento anterior)", () => {
    const e = entrada({ funcionarios: equipe(6), pools: produto("P", [["m1"], ["m2"]], { q: 100, mu: 100 }) }, [DIA]);
    const { cobertura } = analisarCobertura(e, gerarEscala(e));
    expect(cobertura.porCausa.limite_estoque.pessoasPeriodo).toBe(0);
    expect(cobertura.porCausa.aguardando_etapa_anterior.pessoasPeriodo).toBe(0);
  });

  it("em cenários aleatórios com WIP, as causas sempre somam os sem posto de cada período", () => {
    for (let seed = 1; seed <= 80; seed++) {
      const { com } = cenarioAleatorio(seed);
      const r = gerarEscala(com);
      expect(checarInvariantes(com, r)).toEqual([]);
      const { cobertura } = analisarCobertura(com, r);
      cobertura.dias.forEach((d) => d.periodos.forEach((p) => expect(CAUSAS.reduce((s, c) => s + p.causas[c], 0)).toBe(p.semPosto)));
    }
  });
});
