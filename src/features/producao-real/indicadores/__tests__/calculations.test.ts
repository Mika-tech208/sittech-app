import { describe, it, expect } from "vitest";
import {
  agruparPorMaquina, agruparPorProduto, calcularCapacidadePerdidaApontamento, calcularOEEApontamento,
  calcularParetoParadas, calcularPerformanceApontamento, calcularResumoIndicadores,
  type ApontamentoIndicador, type ParadaIndicador,
} from "@/features/producao-real/indicadores/calculations";

function apontamento(over: Partial<ApontamentoIndicador> & Pick<ApontamentoIndicador, "apontamentoId">): ApontamentoIndicador {
  return {
    data: "2026-09-01",
    periodoId: "m1",
    periodoNome: "M1",
    status: "produzindo",
    motivoSemProducao: null,
    produtoId: "prod-1",
    produtoNome: "Produto 1",
    maquinaId: "maq-1",
    maquinaNome: "Máquina 1",
    operacaoId: "op-1",
    operacaoNome: "Operação 1",
    funcionarioId: "func-1",
    funcionarioNome: "Funcionário 1",
    etapaId: "etapa-1",
    etapaOrdem: 0,
    isUltimaEtapa: true,
    quantidadeProduzida: 100,
    quantidadeRefugo: 0,
    metaPeriodoVigente: 100,
    duracaoPeriodoHorasVigente: 1, // 60 min
    minutosParados: 0,
    ...over,
  };
}

function parada(over: Partial<ParadaIndicador> & Pick<ParadaIndicador, "paradaId" | "apontamentoId">): ParadaIndicador {
  return {
    data: "2026-09-01",
    periodoId: "m1",
    minutos: 10,
    motivoId: "motivo-1",
    motivoNome: "Setup",
    motivoCategoria: "operacional",
    origem: "manual",
    produtoId: "prod-1",
    produtoNome: "Produto 1",
    maquinaId: "maq-1",
    maquinaNome: "Máquina 1",
    operacaoId: "op-1",
    operacaoNome: "Operação 1",
    funcionarioId: "func-1",
    funcionarioNome: "Funcionário 1",
    ...over,
  };
}

// ---- Caso 1 — última etapa conta como produção acabada ----
describe("Caso 1 — última etapa conta como produção acabada", () => {
  it("apontamento com isUltimaEtapa=true soma em producaoAcabadaTotal", () => {
    const ap = apontamento({ apontamentoId: "a1", isUltimaEtapa: true, quantidadeProduzida: 100, quantidadeRefugo: 10 });
    const resumo = calcularResumoIndicadores([ap], []);
    expect(resumo.producaoAcabadaTotal).toBe(90); // 100 - 10 refugo
  });
});

// ---- Caso 2 — etapa intermediária NÃO aumenta produção acabada ----
describe("Caso 2 — etapa intermediária não conta como produção acabada", () => {
  it("apontamento com isUltimaEtapa=false soma em producaoProcessada, mas não em producaoAcabada", () => {
    const ap = apontamento({ apontamentoId: "a1", isUltimaEtapa: false, quantidadeProduzida: 100, quantidadeRefugo: 0 });
    const resumo = calcularResumoIndicadores([ap], []);
    expect(resumo.producaoAcabadaTotal).toBe(0);
    expect(resumo.producaoProcessadaTotal).toBe(100);
  });

  it("mistura de etapa final + intermediária do mesmo produto separa corretamente os dois totais", () => {
    const final = apontamento({ apontamentoId: "a1", isUltimaEtapa: true, quantidadeProduzida: 50, quantidadeRefugo: 0 });
    const intermediaria = apontamento({ apontamentoId: "a2", isUltimaEtapa: false, quantidadeProduzida: 70, quantidadeRefugo: 0, etapaOrdem: 0 });
    const resumo = calcularResumoIndicadores([final, intermediaria], []);
    expect(resumo.producaoAcabadaTotal).toBe(50);
    expect(resumo.producaoProcessadaTotal).toBe(120);
  });
});

// ---- Caso 3 — produto de uma única etapa funciona ----
describe("Caso 3 — produto de etapa única", () => {
  it("isUltimaEtapa=true numa única etapa (ordem 0) conta normalmente como produção acabada", () => {
    const ap = apontamento({ apontamentoId: "a1", etapaOrdem: 0, isUltimaEtapa: true, quantidadeProduzida: 30, quantidadeRefugo: 5 });
    const resumo = calcularResumoIndicadores([ap], []);
    expect(resumo.producaoAcabadaTotal).toBe(25);
  });
});

// ---- Caso 4 — Performance agregada não é média simples ----
describe("Caso 4 — Performance agregada usa soma de numerador/denominador", () => {
  it("dá um resultado diferente da média simples das % individuais quando os apontamentos têm pesos diferentes", () => {
    // ap1: meta 200/h, 1h, sem parada -> teórica 200, produzida 100 -> 50%
    // ap2: meta 10/h, 1h, sem parada -> teórica 10, produzida 10 -> 100%
    const ap1 = apontamento({ apontamentoId: "a1", metaPeriodoVigente: 200, quantidadeProduzida: 100 });
    const ap2 = apontamento({ apontamentoId: "a2", metaPeriodoVigente: 10, quantidadeProduzida: 10 });
    const mediaSimples = (50 + 100) / 2; // 75% — NÃO é o que queremos
    const resumo = calcularResumoIndicadores([ap1, ap2], []);
    // agregado = soma produzida (110) / soma teórica (210) × 100
    const esperadoAgregado = (110 / 210) * 100;
    expect(resumo.performancePct).not.toBeCloseTo(mediaSimples, 1);
    expect(resumo.performancePct).toBeCloseTo(esperadoAgregado, 6);
  });
});

// ---- Caso 5 — Performance acima de 100% funciona ----
describe("Caso 5 — Performance sem teto de 100%", () => {
  it("produzida acima da teórica gera performance > 100, individual e agregada", () => {
    const ap = apontamento({ apontamentoId: "a1", metaPeriodoVigente: 100, quantidadeProduzida: 150 });
    expect(calcularPerformanceApontamento(ap)).toBeCloseTo(150, 6);
    const resumo = calcularResumoIndicadores([ap], []);
    expect(resumo.performancePct).toBeCloseTo(150, 6);
  });
});

// ---- Caso 6 — paradas manuais e automáticas contam uma vez cada ----
describe("Caso 6 — paradas manuais e automáticas (por ocorrência) somam uma vez cada", () => {
  it("uma parada manual + uma automática no mesmo apontamento somam os minutos das duas, sem dobrar nenhuma", () => {
    const ap = apontamento({ apontamentoId: "a1", minutosParados: 25 });
    const manual = parada({ paradaId: "p1", apontamentoId: "a1", minutos: 10, origem: "manual" });
    const automatica = parada({ paradaId: "p2", apontamentoId: "a1", minutos: 15, origem: "ocorrencia", motivoId: "motivo-2", motivoNome: "Quebra" });
    const resumo = calcularResumoIndicadores([ap], [manual, automatica]);
    expect(resumo.minutosParadosTotais).toBe(25);
    expect(resumo.quantidadeParadas).toBe(2);
  });
});

// ---- Caso 7 — capacidade perdida usa os snapshots do apontamento ----
describe("Caso 7 — capacidade perdida usa snapshots (meta/duração vigentes)", () => {
  it("aplica meta_periodo_vigente / duracao_periodo_minutos × minutos_parados", () => {
    // meta 120/h (60 min), 20 min parados -> 120/60 × 20 = 40 peças perdidas
    const ap = apontamento({ apontamentoId: "a1", metaPeriodoVigente: 120, duracaoPeriodoHorasVigente: 1, minutosParados: 20 });
    expect(calcularCapacidadePerdidaApontamento(ap)).toBeCloseTo(40, 6);
  });

  it("sem parada, capacidade perdida é 0 (não null)", () => {
    const ap = apontamento({ apontamentoId: "a1", minutosParados: 0 });
    expect(calcularCapacidadePerdidaApontamento(ap)).toBe(0);
  });
});

// ---- Caso 8 — sem_producao não vira produção ----
describe("Caso 8 — sem_producao nunca vira produção/OEE/capacidade perdida", () => {
  it("apontamento sem_producao (quantidades 0, meta null) não soma em nenhum total de peças nem em OEE", () => {
    const ap = apontamento({
      apontamentoId: "a1", status: "sem_producao", motivoSemProducao: "falta_material",
      produtoId: null, produtoNome: null, etapaId: null, etapaOrdem: null, isUltimaEtapa: null,
      operacaoId: null, operacaoNome: null, funcionarioId: null, funcionarioNome: null,
      quantidadeProduzida: 0, quantidadeRefugo: 0, metaPeriodoVigente: null,
    });
    const resumo = calcularResumoIndicadores([ap], []);
    expect(resumo.producaoAcabadaTotal).toBe(0);
    expect(resumo.producaoProcessadaTotal).toBe(0);
    expect(resumo.performancePct).toBeNull();
    expect(resumo.disponibilidadePct).toBeNull();
    expect(resumo.oeePct).toBeNull();
    expect(resumo.capacidadePerdidaPecas).toBeNull();
    expect(resumo.periodosSemProducaoExplicito).toBe(1);
    expect(resumo.periodosProdutivos).toBe(0);
    expect(calcularOEEApontamento(ap)).toBeNull();
  });
});

// ---- Caso 9 — N/A quando não existe denominador confiável ----
describe("Caso 9 — N/A em vez de inventar dado", () => {
  it("duração zerada -> performance/disponibilidade/capacidade perdida null", () => {
    const ap = apontamento({ apontamentoId: "a1", duracaoPeriodoHorasVigente: 0 });
    expect(calcularPerformanceApontamento(ap)).toBeNull();
    expect(calcularCapacidadePerdidaApontamento(ap)).toBeNull();
  });

  it("nenhum apontamento com denominador válido -> resumo agregado null (não 0 inventado)", () => {
    const ap = apontamento({ apontamentoId: "a1", metaPeriodoVigente: null, status: "sem_producao", produtoId: null, produtoNome: null, etapaId: null, etapaOrdem: null, isUltimaEtapa: null, quantidadeProduzida: 0, quantidadeRefugo: 0, operacaoId: null, funcionarioId: null });
    const resumo = calcularResumoIndicadores([ap], []);
    expect(resumo.performancePct).toBeNull();
    expect(resumo.qualidadePct).toBeNull();
    expect(resumo.disponibilidadePct).toBeNull();
  });
});

// ---- Caso 10 — Pareto de paradas ----
describe("Caso 10 — Pareto de motivos de parada", () => {
  it("ordena por minutos desc e acumula % corretamente", () => {
    const paradas = [
      parada({ paradaId: "p1", apontamentoId: "a1", motivoId: "m1", motivoNome: "Setup", minutos: 30 }),
      parada({ paradaId: "p2", apontamentoId: "a2", motivoId: "m2", motivoNome: "Quebra", minutos: 60 }),
      parada({ paradaId: "p3", apontamentoId: "a3", motivoId: "m1", motivoNome: "Setup", minutos: 10 }),
    ];
    const pareto = calcularParetoParadas(paradas);
    expect(pareto[0].motivoId).toBe("m2"); // 60 min primeiro
    expect(pareto[0].minutos).toBe(60);
    expect(pareto[1].motivoId).toBe("m1");
    expect(pareto[1].minutos).toBe(40); // 30 + 10 do mesmo motivo
    expect(pareto[1].percentualAcumulado).toBeCloseTo(100, 6);
  });
});

// ---- Caso 11 — agrupamento preserva contexto pra drill-down ----
describe("Caso 11 — agrupamento genérico preserva apontamentos brutos (drill-down)", () => {
  it("agruparPorMaquina mantém os apontamentos originais de cada máquina, permitindo reagrupar por produto depois", () => {
    const apMaq1Prod1 = apontamento({ apontamentoId: "a1", maquinaId: "maq-1", maquinaNome: "M1", produtoId: "p1", produtoNome: "Produto A" });
    const apMaq1Prod2 = apontamento({ apontamentoId: "a2", maquinaId: "maq-1", maquinaNome: "M1", produtoId: "p2", produtoNome: "Produto B" });
    const apMaq2 = apontamento({ apontamentoId: "a3", maquinaId: "maq-2", maquinaNome: "M2" });
    const gruposMaquina = agruparPorMaquina([apMaq1Prod1, apMaq1Prod2, apMaq2], []);
    expect(gruposMaquina).toHaveLength(2);
    const grupoM1 = gruposMaquina.find((g) => g.chave === "maq-1")!;
    expect(grupoM1.apontamentos).toHaveLength(2);
    const subProdutos = agruparPorProduto(grupoM1.apontamentos, grupoM1.paradas);
    expect(subProdutos.map((g) => g.chave).sort()).toEqual(["p1", "p2"]);
  });
});

// ---- Caso 12 — qualidade e disponibilidade agregadas ----
describe("Caso 12 — Qualidade e Disponibilidade agregadas somam numerador/denominador", () => {
  it("qualidade agregada = soma(boa) / soma(produzida), não média das qualidades individuais", () => {
    const ap1 = apontamento({ apontamentoId: "a1", quantidadeProduzida: 100, quantidadeRefugo: 50 }); // 50%
    const ap2 = apontamento({ apontamentoId: "a2", quantidadeProduzida: 10, quantidadeRefugo: 0 }); // 100%
    const resumo = calcularResumoIndicadores([ap1, ap2], []);
    // soma boa = 50+10=60, soma produzida=110 -> 54.54...%
    expect(resumo.qualidadePct).toBeCloseTo((60 / 110) * 100, 6);
    expect(resumo.qualidadePct).not.toBeCloseTo(75, 1); // média simples seria 75%
  });

  it("disponibilidade agregada soma duração/parados de todos os apontamentos produzindo", () => {
    const ap1 = apontamento({ apontamentoId: "a1", duracaoPeriodoHorasVigente: 1, minutosParados: 10 }); // 60min, 10 parado -> 83.3%
    const ap2 = apontamento({ apontamentoId: "a2", duracaoPeriodoHorasVigente: 2, minutosParados: 0 }); // 120min, 0 parado -> 100%
    const resumo = calcularResumoIndicadores([ap1, ap2], []);
    // soma duração 180, soma parados 10 -> (170/180)*100
    expect(resumo.disponibilidadePct).toBeCloseTo((170 / 180) * 100, 6);
  });
});
