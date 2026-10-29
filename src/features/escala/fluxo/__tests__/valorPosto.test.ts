// A/B/C do posto (valor do posto OCUPADO, +1 pessoa, +1 máquina) e diagnóstico de saturação com precedência determinística. Análise do POSTO; nenhuma pessoa entra nos cálculos.
import { describe, it, expect } from "vitest";
import { classificarSaturacao, PRECEDENCIA_SATURACAO, type EntradaSaturacao } from "../saturacao";
import { analisarCapacidade, type ResultadoReplan } from "../capacidade";
import { avaliarPlano } from "../avaliar";
import { planejarComFluxo } from "../planejar";
import { prepararFluxo } from "../estado";
import { equipe, linhaPlano, montar, pool } from "./helpersFluxo";
import type { AlocacaoEscala } from "../../types";
import type { OpcoesFluxo } from "../tipos";

const base: EntradaSaturacao = { postosOcupados: 1, postosMaximos: 2, pessoasLivres: 1, valorMaisUmaPessoa: 0, valorMaisUmaMaquina: 0, periodosApos: 5, etapaFinal: false, faltaMaterial: false, limitadaAFrente: false, demandaCoberta: false };
const e = (o: Partial<EntradaSaturacao>): EntradaSaturacao => ({ ...base, ...o });

describe("saturação — regra de precedência explícita e determinística", () => {
  it("cada um dos seis motivos é alcançável", () => {
    expect(classificarSaturacao(e({ postosOcupados: 2 })).primaria).toBe("SATURADO_POR_MAQUINA");
    expect(classificarSaturacao(e({ pessoasLivres: 0, valorMaisUmaPessoa: 40 })).primaria).toBe("SATURADO_POR_PESSOA");
    expect(classificarSaturacao(e({ periodosApos: 0 })).primaria).toBe("SATURADO_POR_TEMPO");
    expect(classificarSaturacao(e({ faltaMaterial: true })).primaria).toBe("SATURADO_POR_WIP");
    expect(classificarSaturacao(e({ limitadaAFrente: true })).primaria).toBe("SATURADO_POR_DOWNSTREAM");
    expect(classificarSaturacao(e({ demandaCoberta: true })).primaria).toBe("SATURADO_POR_DEMANDA");
    expect(classificarSaturacao(e({ valorMaisUmaPessoa: 30 })).primaria).toBeNull(); // posto livre e útil: não saturado
  });
  it("precedência: MAQUINA > PESSOA > TEMPO > WIP > DOWNSTREAM > DEMANDA; o primário é o primeiro verdadeiro e todos aparecem em `motivos`", () => {
    const tudo = classificarSaturacao(e({ postosOcupados: 2, periodosApos: 0, faltaMaterial: true, limitadaAFrente: true, demandaCoberta: true }));
    expect(tudo.motivos).toEqual(["SATURADO_POR_MAQUINA", "SATURADO_POR_TEMPO", "SATURADO_POR_WIP", "SATURADO_POR_DOWNSTREAM", "SATURADO_POR_DEMANDA"]);
    expect(tudo.primaria).toBe("SATURADO_POR_MAQUINA");
    expect(classificarSaturacao(e({ faltaMaterial: true, limitadaAFrente: true, demandaCoberta: true })).primaria).toBe("SATURADO_POR_WIP");
    expect(PRECEDENCIA_SATURACAO[0]).toBe("SATURADO_POR_MAQUINA");
    expect(classificarSaturacao(e({ postosOcupados: 2, valorMaisUmaMaquina: 20 })).motivos).toEqual(["SATURADO_POR_MAQUINA"]); // só a máquina limita
  });
  it("determinística (mesma entrada, mesma saída) e posto final nunca é TEMPO", () => {
    const x = e({ postosOcupados: 2, demandaCoberta: true });
    expect(JSON.stringify(classificarSaturacao(x))).toBe(JSON.stringify(classificarSaturacao({ ...x })));
    expect(classificarSaturacao(e({ periodosApos: 0, etapaFinal: true })).motivos).not.toContain("SATURADO_POR_TEMPO");
  });
});

describe("A/B/C no posto ocupado", () => {
  const DIAS = ["2026-10-26", "2026-10-27"];
  const opcoes: OpcoesFluxo = { objetivo: "financeiro", atingibilidadeModo: "sombra", economiaSlots: 99 };
  // U (3 máquinas, 1.000) → E (1 máquina, 2.000, etapa FINAL) e um produto de enchimento F. 5 pessoas.
  const pools = [
    pool({ produto: "P", etapa: "P-U", op: "opU", ordem: 1, q: 100000, maquinas: ["u1", "u2", "u3"], mu: 1000, valor: 0.5 }),
    pool({ produto: "P", etapa: "P-E", op: "opE", ordem: 2, q: 100000, maquinas: ["e1"], mu: 2000, valor: 0.5 }),
    pool({ produto: "F", etapa: "F-1", op: "opF", ordem: 1, q: 900000, maquinas: ["f1", "f2", "f3"], mu: 100, valor: 0.01 }),
  ];
  // plano vigente FRACO: 1 pessoa em U, 1 em E, 3 em F em todos os períodos
  const plano = (slots: Parameters<typeof linhaPlano>[0]) => slots.map((_, i) => i).flatMap((i) => [
    linhaPlano(slots, i, "f01", "u1", "P", "P-U", "opU", 1000), linhaPlano(slots, i, "f02", "e1", "P", "P-E", "opE", 2000),
    linhaPlano(slots, i, "f03", "f1", "F", "F-1", "opF", 100), linhaPlano(slots, i, "f04", "f2", "F", "F-1", "opF", 100), linhaPlano(slots, i, "f05", "f3", "F", "F-1", "opF", 100),
  ]);
  const m = montar({ pools, funcionarios: equipe(5), c: 1, plano, extra: { revezamentoDuro: false }, dias: DIAS });
  const ctx = prepararFluxo(m.entrada, m.dados, opcoes);
  const futuras = m.planoCompleto.filter((a) => (ctx.idxSlot.get(`${a.data}|${a.periodoId}`) ?? -1) >= ctx.aPartirDe);

  it("B = 0 sem máquina livre e C é informativo; A com resto fixo = remoção exata do posto (confere com avaliarPlano)", () => {
    const an = analisarCapacidade(ctx, m.planoCompleto);
    const t0 = ctx.aPartirDe;
    const rE = an.capacidade.find((c) => c.slot === t0 && c.etapaId === "P-E")!;
    expect(rE.postosOcupados).toBe(1);
    expect(rE.postosMaximos).toBe(1);
    expect(rE.valorMaisUmaPessoa).toBe(0); // B
    expect(rE.saturacao?.primaria).toBe("SATURADO_POR_MAQUINA");
    expect(rE.valorMaisUmaMaquinaInformativo).toBeGreaterThanOrEqual(0); // C (informativo)
    // conferência exata da remoção do posto E no 1º período mutável
    const alvo = futuras.find((a) => a.etapaId === "P-E" && ctx.idxSlot.get(`${a.data}|${a.periodoId}`) === t0)!;
    const sem = m.planoCompleto.map((a) => (a === alvo ? ({ ...a, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0 } as AlocacaoEscala) : a));
    const a0 = avaliarPlano(m.entrada, m.dados, m.planoCompleto, opcoes).financeiro!.total.rsProjetadoFechamento;
    const a1 = avaliarPlano(m.entrada, m.dados, sem, opcoes).financeiro!.total.rsProjetadoFechamento;
    expect(rE.valorPostoOcupadoRestoFixo).toBeCloseTo(a0 - a1, 1);
  });

  it("LIÇÃO EMBALAGEM 17: posto ocupado com valor 0 no resto FIXO (falso zero) tem valor POSITIVO com o resto REPLANEJADO; B = 0; saturação por máquina; explicação obrigatória", () => {
    const idx = (a: AlocacaoEscala) => ctx.idxSlot.get(`${a.data}|${a.periodoId}`) ?? -1;
    // replaneja o resto da semana DEPOIS do período do posto removido (que fica congelado, como no pipeline)
    const replanejar = (plano: AlocacaoEscala[]): ResultadoReplan => {
      const ap = ctx.aPartirDe + 1;
      const ent = { ...m.entrada, aPartirDe: ap, congeladas: plano.filter((a) => idx(a) < ap) };
      const r = planejarComFluxo(ent, { ...m.dados, planoVigente: plano }, { ...opcoes, atingibilidadeModo: "off" });
      const full = plano.filter((a) => idx(a) < ap).concat(r.resultado.alocacoes.filter((a) => idx(a) >= ap));
      const av = avaliarPlano(m.entrada, m.dados, full, opcoes);
      return { valor: av.financeiro!.total.rsProjetadoFechamento, pecasFinais: av.totais.finalEntregueLo, wipFinal: av.totais.wipFinalLo };
    };
    const an = analisarCapacidade(ctx, m.planoCompleto, undefined, undefined, undefined, { replanejar, slotsReplan: 1 });
    expect(an.replanejamentos).toBeGreaterThan(1);
    const rE = an.capacidade.find((c) => c.slot === ctx.aPartirDe && c.etapaId === "P-E")!;
    expect(rE.valorPostoOcupadoRestoFixo).toBe(0); // falso zero: o resto fraco não aproveita a capacidade de E
    expect(rE.valorPostoOcupadoRestoReplanejado).toBeGreaterThan(100); // o resto replanejado enche U e E fica limitante
    expect(rE.valorMaisUmaPessoa).toBe(0); // B
    expect(rE.saturacao?.primaria).toBe("SATURADO_POR_MAQUINA");
    expect(rE.explicacaoValorZero).toContain("RESTO DA SEMANA FIXO");
    expect(rE.explicacaoValorZero).toContain("resto replanejado");
    an.capacidade.filter((c) => c.postosOcupados > 0 && (c.valorPostoOcupadoRestoFixo ?? 0) <= 1e-6).forEach((c) => expect(c.explicacaoValorZero).toBeTruthy());
  });

  it("determinístico e sem identificador de pessoa no resultado", () => {
    const a = analisarCapacidade(ctx, m.planoCompleto);
    const b = analisarCapacidade(ctx, m.planoCompleto);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toMatch(/funcionario/i);
  });
});
