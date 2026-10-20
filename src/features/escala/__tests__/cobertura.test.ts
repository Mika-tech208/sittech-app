import { describe, it, expect } from "vitest";
import { analisarCobertura, calcularCobertura, recursosCompativeisVerificados, CAUSAS } from "../cobertura";
import { gerarEscala } from "../gerarEscala";
import { comAdicional } from "./adicionalHelpers";
import { entrada, equipe, pool } from "./helpers";

const D1 = "2026-10-19";
const MIN: Record<string, number> = { m1: 96, m2: 96, m3: 91, t1: 80, t2: 80, t3: 80 };
const MIN_DIA = 523;

function analisar(e: ReturnType<typeof entrada>) {
  const r = gerarEscala(e);
  return { r, ...analisarCobertura(e, r) };
}
function periodo(c: ReturnType<typeof calcularCobertura>, periodoId: string, dia = D1) {
  return c.dias.find((d) => d.data === dia)!.periodos.find((p) => p.periodoId === periodoId)!;
}

describe("cobertura da equipe — causas do 'sem posto' (mesmo motor, só contabilidade)", () => {
  it("A) FALTA DE CARGA: máquina selecionada livre, mas a quantidade programada acabou", () => {
    // 4 pessoas, 2 produtos de 1 máquina cada, 300 peças (3 períodos). Do 4º período em diante o previsto acabou.
    const e = entrada({ funcionarios: equipe(4), pools: [pool({ produto: "pA", op: "opA", q: 300, maquinas: ["mA"] }), pool({ produto: "pB", op: "opB", q: 300, maquinas: ["mB"] })] });
    const { cobertura } = analisar(e);
    // períodos 1–3: 2 pessoas sem posto e NENHUMA máquina livre — carga programada não é o problema (só há 2 máquinas)
    expect(periodo(cobertura, "m1").causas.carga).toBe(0);
    expect(periodo(cobertura, "m1").causas.sem_recurso_compativel).toBe(2);
    // período 4 (T1): previsto esgotado, 2 máquinas selecionadas livres → 2 pessoas por falta de carga
    const t1 = periodo(cobertura, "t1");
    expect(t1.semPosto).toBe(4);
    expect(t1.causas.carga).toBe(2);
    expect(t1.causas.sem_recurso_compativel).toBe(2);
  });

  it("A) programar adicional resolve a parte de carga (e só ela)", () => {
    const e = entrada({ funcionarios: equipe(4), pools: [pool({ produto: "pA", op: "opA", q: 300, maquinas: ["mA"] }), pool({ produto: "pB", op: "opB", q: 300, maquinas: ["mB"] })] });
    const antes = analisar(e).cobertura;
    const depois = analisar(comAdicional(e, () => 100_000)).cobertura;
    expect(depois.porCausa.carga.pessoasPeriodo).toBe(0);
    expect(depois.minutosSemPosto).toBeLessThan(antes.minutosSemPosto);
    // o que sobra é falta de máquina (2 pessoas a mais que máquinas): adicional não resolve
    expect(depois.porCausa.sem_recurso_compativel.pessoasPeriodo).toBeGreaterThan(0);
  });

  it("B) FALTA DE MÁQUINA SELECIONADA: recurso compatível do roteiro livre, mas fora da Previsão — e programar MAIS PEÇAS não resolve", () => {
    const pA = { ...pool({ produto: "pA", op: "opA", q: 1_000_000, maquinas: ["mA"] }), maquinasCompativeisIds: ["mA", "mA2", "mA3"] };
    const e = entrada({ funcionarios: equipe(3), pools: [pA] });
    const { cobertura, candidatos } = analisar(e);
    cobertura.dias[0].periodos.forEach((p) => {
      expect(p.semPosto).toBe(2);
      expect(p.causas.maquina_nao_selecionada).toBe(2);
      expect(p.causas.carga).toBe(0);
      expect(p.maquinasCompativeisLivres).toEqual(["mA2", "mA3"]);
    });
    expect(candidatos.map((c) => c.maquinaId)).toEqual(["mA2", "mA3"]);

    // aumentar a quantidade (adicional) NÃO muda nada: o problema não é carga
    const comMaisPecas = analisar(comAdicional(e, () => 5_000_000)).cobertura;
    expect(comMaisPecas.minutosSemPosto).toBe(cobertura.minutosSemPosto);
    expect(comMaisPecas.porCausa.maquina_nao_selecionada.pessoasPeriodo).toBe(cobertura.porCausa.maquina_nao_selecionada.pessoasPeriodo);

    // o motor confirma: selecionar a máquina compatível reduz a ociosidade
    const { itens: recursos } = recursosCompativeisVerificados(e, cobertura, candidatos);
    expect(recursos.map((r) => r.maquinaId)).toEqual(["mA2", "mA3"]);
    expect(recursos[0].ganhoMinutos).toBe(MIN_DIA); // 1 pessoa a mais ocupada o dia todo
    expect(recursos[0].coberturaApos).toBeGreaterThan(cobertura.percentual);
    expect(recursos[0].poolsAfetados).toEqual([{ produtoId: "pA", etapaId: "pA-e1" }]);
  });

  it("B) etapa SEM nenhuma máquina selecionada também é falta de máquina (o motor a ignora, o diagnóstico não)", () => {
    // p2/e3 não tem máquina na Previsão: o motor não a simula, mas há demanda e recursos compatíveis livres
    const p1 = { ...pool({ produto: "p1", op: "opA", q: 1_000_000, maquinas: ["m1"] }), maquinasCompativeisIds: ["m1"] };
    const p2 = { ...pool({ produto: "p2", op: "opB", q: 5000, maquinas: [] }), maquinasCompativeisIds: ["m5", "m6"] };
    const e = { ...entrada({ funcionarios: equipe(3), pools: [p1] }), poolsSemMaquina: [p2] };
    const { cobertura, candidatos } = analisar(e);
    cobertura.dias[0].periodos.forEach((p) => {
      expect(p.semPosto).toBe(2);
      expect(p.causas.maquina_nao_selecionada).toBe(2);
      expect(p.maquinasCompativeisLivres).toEqual(["m5", "m6"]);
    });
    const v = recursosCompativeisVerificados(e, cobertura, candidatos);
    expect(v.itens.map((x) => x.maquinaId)).toEqual(["m5", "m6"]);
    expect(v.itens[0].poolsAfetados).toEqual([{ produtoId: "p2", etapaId: "p2-e1" }]);
    expect(v.itens[0].ganhoMinutos).toBe(MIN_DIA); // selecionar a máquina "cria" a etapa e ocupa 1 pessoa o dia todo
    expect(v.combinado!.maquinas).toEqual(["m5", "m6"]);
    expect(v.combinado!.ganhoMinutos).toBe(2 * MIN_DIA); // juntas ocupam as 2 pessoas: cobertura 100%
    expect(v.combinado!.coberturaApos).toBe(100);
  });

  it("B) recurso compatível OCUPADO ou INDISPONÍVEL não é sugerido", () => {
    const pA = { ...pool({ produto: "pA", op: "opA", q: 1_000_000, maquinas: ["mA"] }), maquinasCompativeisIds: ["mA", "mX"] };
    const e = entrada({ funcionarios: equipe(2), pools: [pA], maquinasIndisponiveisPrevisao: ["mX"] });
    const { cobertura, candidatos } = analisar(e);
    expect(candidatos).toEqual([]);
    expect(cobertura.porCausa.maquina_nao_selecionada.pessoasPeriodo).toBe(0);
  });

  it("C) RECURSO INDISPONÍVEL: a máquina selecionada da etapa com trabalho está indisponível", () => {
    const e = entrada({
      funcionarios: equipe(3),
      pools: [pool({ produto: "pA", op: "opA", q: 1_000_000, maquinas: ["mA", "mA2"] })],
      maquinasIndisponiveisPrevisao: ["mA2"],
    });
    const { cobertura } = analisar(e);
    cobertura.dias[0].periodos.forEach((p) => {
      expect(p.semPosto).toBe(2);
      expect(p.causas.recurso_indisponivel).toBe(1);
      expect(p.causas.sem_recurso_compativel).toBe(1);
    });
  });

  it("recurso bloqueado a partir de um instante vale só para os períodos seguintes", () => {
    const e = entrada({
      funcionarios: equipe(2),
      pools: [pool({ produto: "pA", op: "opA", q: 1_000_000, maquinas: ["mA", "mA2"] })],
      indisponibilidades: [{ maquinaId: "mA2", desdeMs: Date.parse("2026-10-19T16:00:00Z"), liberadaEmMs: null }], // 13:00 em SP
    });
    const { cobertura } = analisar(e);
    expect(periodo(cobertura, "m1").semPosto).toBe(0);
    expect(periodo(cobertura, "t1").causas.recurso_indisponivel).toBe(1);
  });

  it("a soma das causas é SEMPRE igual às pessoas sem posto (60 cenários aleatórios)", () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 60; i++) {
      const pools = Array.from({ length: 2 + Math.floor(rnd() * 4) }, (_, k) => {
        const maqs = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => `m${Math.floor(rnd() * 6)}`);
        return { ...pool({ produto: `p${k}`, op: `op${k % 3}`, q: 100 + Math.floor(rnd() * 20) * 100, maquinas: maqs, mu: 80 + Math.floor(rnd() * 60) }), maquinasCompativeisIds: [...maqs, `m${Math.floor(rnd() * 8)}`] };
      });
      const e = entrada({ funcionarios: equipe(2 + Math.floor(rnd() * 12)), pools, maquinasIndisponiveisPrevisao: rnd() < 0.3 ? ["m1"] : [] });
      const { cobertura, r } = analisar(rnd() < 0.5 ? comAdicional(e, () => 1500) : e);
      expect(cobertura.percentual).toBeGreaterThanOrEqual(0);
      expect(cobertura.percentual).toBeLessThanOrEqual(100);
      expect(cobertura.pessoasPeriodoSemPosto).toBe(r.alocacoes.filter((a) => !a.maquinaId).length);
      let soma = 0;
      cobertura.dias.forEach((d) =>
        d.periodos.forEach((p) => {
          soma += p.semPosto;
          expect(CAUSAS.reduce((s, c) => s + p.causas[c], 0)).toBe(p.semPosto);
        })
      );
      expect(soma).toBe(cobertura.pessoasPeriodoSemPosto);
      expect(CAUSAS.reduce((s, c) => s + cobertura.porCausa[c].pessoasPeriodo, 0)).toBe(cobertura.pessoasPeriodoSemPosto);
    }
  });
});

describe("cobertura da equipe — percentual ponderado por minutos", () => {
  it("2 pessoas, 1 máquina: metade da equipe sem posto = 50%, 523 min de ociosidade por dia (8h43)", () => {
    const { cobertura } = analisar(entrada({ funcionarios: equipe(2), pools: [pool({ produto: "pA", op: "opA", q: 1_000_000, maquinas: ["mA"] })] }));
    expect(cobertura.percentual).toBeCloseTo(50, 9);
    expect(cobertura.minutosSemPosto).toBe(MIN_DIA);
    expect(cobertura.horasSemPosto).toBeCloseTo(MIN_DIA / 60, 9);
    expect(cobertura.pessoasPeriodoSemPosto).toBe(6);
  });

  it("ponderação real: a ociosidade só nos períodos da manhã pesa mais que a contagem de períodos", () => {
    // f02 só trabalha de manhã (ausente 13:00–18:00); f01 ocupa a única máquina o dia todo → f02 fica sem posto em m1,m2,m3
    const e = entrada({
      funcionarios: equipe(2),
      pools: [pool({ produto: "pA", op: "opA", q: 1_000_000, maquinas: ["mA"] })],
      ausencias: [{ funcionarioId: "f02", data: D1, inicioMin: 13 * 60, fimMin: 18 * 60 }],
    });
    const { cobertura } = analisar(e);
    const semManha = MIN.m1 + MIN.m2 + MIN.m3; // 283 min sem posto
    const disponivel = MIN_DIA + semManha; // f01 o dia todo + f02 só de manhã
    expect(cobertura.minutosSemPosto).toBe(semManha);
    expect(cobertura.minutosDisponiveis).toBe(disponivel);
    expect(cobertura.percentual).toBeCloseTo(100 * (1 - semManha / disponivel), 9);
    // por contagem de períodos seria 100×(1−3/9) = 66,67% — o tempo dá outro número
    expect(Math.abs(cobertura.percentual - 100 * (1 - 3 / 9))).toBeGreaterThan(1);
  });

  it("equipe totalmente ocupada = 100%", () => {
    const { cobertura } = analisar(entrada({ funcionarios: equipe(2), pools: [1, 2].map((n) => pool({ produto: `p${n}`, op: `op${n}`, q: 1_000_000, maquinas: [`m${n}`] })) }));
    expect(cobertura.percentual).toBe(100);
    expect(cobertura.minutosSemPosto).toBe(0);
  });

  it("só os períodos AINDA NÃO INICIADOS entram (prefixo congelado fica fora)", () => {
    const base = entrada({ funcionarios: equipe(2), pools: [pool({ produto: "pA", op: "opA", q: 1_000_000, maquinas: ["mA"] })] });
    const r0 = gerarEscala(base);
    const corte = 3;
    const congeladas = r0.alocacoes.filter((a) => ["m1", "m2", "m3"].includes(a.periodoId));
    const e = { ...base, aPartirDe: corte, congeladas };
    const { cobertura } = analisar(e);
    expect(cobertura.dias[0].periodos.map((p) => p.periodoId)).toEqual(["t1", "t2", "t3"]);
    expect(cobertura.minutosDisponiveis).toBe(2 * (80 * 3));
  });
});
