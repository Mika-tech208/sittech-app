import { describe, it, expect } from "vitest";
import {
  calcularCustoPorPecaProduzidaApontamento, calcularCustoPorPecaBoaApontamento, calcularCustoTempoParadoApontamento,
  calcularDiferencaCustoTeoricoObservadoApontamento, calcularResumoEconomico, calcularCustoIndustrialAproximado,
  calcularMargemProcessamento, detectarPossivelRestricaoOperacional,
} from "@/features/producao-real/indicadores/economico";
import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";

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
    custoHoraOperacaoVigente: 60, // R$60/h
    custoOperacionalPeriodoVigente: 60, // 60 × 1h
    custoUnitarioReferenciaPeriodoVigente: 0.6, // 60/100 meta
    produtoValorUnitario: 2, // R$2 por peça
    etapaMaquinasElegiveis: 1,
    ...over,
  };
}

// ---- Caso 1 — produto de uma única etapa ----
describe("Caso 1 — produto de etapa única", () => {
  it("custo industrial e margem calculam normalmente com só 1 etapa (isUltimaEtapa=true)", () => {
    const ap = apontamento({ apontamentoId: "a1", quantidadeProduzida: 100, quantidadeRefugo: 10, custoOperacionalPeriodoVigente: 60 });
    const custo = calcularCustoIndustrialAproximado([ap]);
    expect(custo.producaoBoaAcabada).toBe(90);
    expect(custo.custoIndustrialTotal).toBe(60);
    expect(custo.custoIndustrialPorPecaAcabada).toBeCloseTo(60 / 90, 6);

    const margem = calcularMargemProcessamento([ap]);
    expect(margem.receitaPorPeca).toBe(2);
    expect(margem.margemPorPecaAcabada).toBeCloseTo(2 - 60 / 90, 6);
  });
});

// ---- Caso 2 — produto de múltiplas etapas ----
describe("Caso 2 — produto de múltiplas etapas", () => {
  it("custo industrial soma o custo operacional de TODAS as etapas, mas produção acabada só conta a última", () => {
    const rosca = apontamento({ apontamentoId: "a1", etapaId: "e-rosca", etapaOrdem: 0, isUltimaEtapa: false, quantidadeProduzida: 100, quantidadeRefugo: 0, custoOperacionalPeriodoVigente: 40 });
    const embalagem = apontamento({ apontamentoId: "a2", etapaId: "e-emb", etapaOrdem: 1, isUltimaEtapa: true, quantidadeProduzida: 90, quantidadeRefugo: 0, custoOperacionalPeriodoVigente: 50 });
    const custo = calcularCustoIndustrialAproximado([rosca, embalagem]);
    expect(custo.custoIndustrialTotal).toBe(90); // 40 + 50, as duas etapas
    expect(custo.producaoBoaAcabada).toBe(90); // só a embalagem (última etapa)
    expect(custo.custoIndustrialPorPecaAcabada).toBeCloseTo(90 / 90, 6);
  });
});

// ---- Caso 3 — receita reconhecida somente uma vez ----
describe("Caso 3 — receita reconhecida somente uma vez", () => {
  it("receita de produção acabada não multiplica valor_unitario pela soma de todas as etapas", () => {
    const rosca = apontamento({ apontamentoId: "a1", etapaId: "e-rosca", isUltimaEtapa: false, quantidadeProduzida: 100, quantidadeRefugo: 0 });
    const embalagem = apontamento({ apontamentoId: "a2", etapaId: "e-emb", isUltimaEtapa: true, quantidadeProduzida: 90, quantidadeRefugo: 0, produtoValorUnitario: 2 });
    const margem = calcularMargemProcessamento([rosca, embalagem]);
    // receita = 90 (só a acabada) × 2 = 180 — NUNCA (100+90) × 2 = 380
    expect(margem.receitaProducaoAcabada).toBe(180);
  });
});

// ---- Caso 4 — etapa intermediária não gera faturamento ----
describe("Caso 4 — etapa intermediária isolada não gera faturamento", () => {
  it("produto só com etapas intermediárias (nenhuma isUltimaEtapa=true) tem receita 0, não N/A inventado, nem receita da etapa intermediária", () => {
    const rosca = apontamento({ apontamentoId: "a1", etapaId: "e-rosca", isUltimaEtapa: false, quantidadeProduzida: 500, quantidadeRefugo: 0 });
    const margem = calcularMargemProcessamento([rosca]);
    expect(margem.producaoBoaAcabada).toBe(0);
    expect(margem.receitaProducaoAcabada).toBe(0); // fato: 0 peça acabada × preço conhecido = 0, não N/A
    expect(margem.custoIndustrialPorPecaAcabada).toBeNull(); // sem produção acabada -> custo/peça não calculável
  });
});

// ---- Caso 5 — refugo aumenta custo observado por peça boa ----
describe("Caso 5 — refugo aumenta custo por peça boa", () => {
  it("custo por peça boa é maior que custo por peça produzida quando há refugo", () => {
    const semRefugo = apontamento({ apontamentoId: "a1", quantidadeProduzida: 100, quantidadeRefugo: 0, custoOperacionalPeriodoVigente: 60 });
    const comRefugo = apontamento({ apontamentoId: "a2", quantidadeProduzida: 100, quantidadeRefugo: 20, custoOperacionalPeriodoVigente: 60 });
    const custoProduzidaSemRefugo = calcularCustoPorPecaProduzidaApontamento(semRefugo);
    const custoBoaComRefugo = calcularCustoPorPecaBoaApontamento(comRefugo);
    expect(custoBoaComRefugo).toBeCloseTo(60 / 80, 6);
    expect(custoBoaComRefugo!).toBeGreaterThan(custoProduzidaSemRefugo!);
  });
});

// ---- Caso 6 — parada aumenta custo observado por peça ----
describe("Caso 6 — parada gera custo do tempo ocioso", () => {
  it("custo do tempo parado é proporcional aos minutos parados × custo/hora", () => {
    const ap = apontamento({ apontamentoId: "a1", custoHoraOperacaoVigente: 60, minutosParados: 15 });
    expect(calcularCustoTempoParadoApontamento(ap)).toBeCloseTo(60 * (15 / 60), 6); // R$15
  });

  it("sem parada, custo do tempo parado é 0 (não null)", () => {
    const ap = apontamento({ apontamentoId: "a1", minutosParados: 0 });
    expect(calcularCustoTempoParadoApontamento(ap)).toBe(0);
  });
});

// ---- Caso 7 — Performance >100% não quebra o motor econômico ----
describe("Caso 7 — Performance acima de 100% não afeta cálculo de custo/margem", () => {
  it("produzida muito acima da meta continua gerando custo/peça e margem normalmente", () => {
    const ap = apontamento({ apontamentoId: "a1", metaPeriodoVigente: 50, quantidadeProduzida: 200, quantidadeRefugo: 0, custoOperacionalPeriodoVigente: 60 });
    expect(calcularCustoPorPecaProduzidaApontamento(ap)).toBeCloseTo(60 / 200, 6);
    const margem = calcularMargemProcessamento([ap]);
    expect(margem.margemPorPecaAcabada).not.toBeNull();
  });
});

// ---- Caso 8 — custo teórico vs observado ----
describe("Caso 8 — diferença entre custo teórico e observado", () => {
  it("produzida abaixo da meta -> custo observado por peça MAIOR que o teórico (diferença positiva)", () => {
    // meta 100, custo_unitario_referencia = custoOperacional/meta = 60/100 = 0.6 (teórico)
    // produziu só 60 -> observado = 60/60 = 1.0 (maior que o teórico)
    const ap = apontamento({ apontamentoId: "a1", metaPeriodoVigente: 100, quantidadeProduzida: 60, custoOperacionalPeriodoVigente: 60, custoUnitarioReferenciaPeriodoVigente: 0.6 });
    const diferenca = calcularDiferencaCustoTeoricoObservadoApontamento(ap);
    expect(diferenca).toBeCloseTo(1.0 - 0.6, 6);
    expect(diferenca!).toBeGreaterThan(0);
  });
});

// ---- Caso 9 — custo industrial aproximado acumulando etapas (com refugo entre etapas) ----
describe("Caso 9 — custo industrial acumulado embute o efeito do refugo entre etapas", () => {
  it("perda de quantidade entre etapas eleva o custo por peça acabada além da soma simples dos custos/peça de cada etapa", () => {
    const rosca = apontamento({ apontamentoId: "a1", etapaId: "e-rosca", isUltimaEtapa: false, quantidadeProduzida: 1000, quantidadeRefugo: 20, custoOperacionalPeriodoVigente: 500 });
    const embalagem = apontamento({ apontamentoId: "a2", etapaId: "e-emb", isUltimaEtapa: true, quantidadeProduzida: 950, quantidadeRefugo: 10, custoOperacionalPeriodoVigente: 400 });
    const custo = calcularCustoIndustrialAproximado([rosca, embalagem]);
    // custo total 900, produção acabada 940 (950-10)
    expect(custo.custoIndustrialTotal).toBe(900);
    expect(custo.producaoBoaAcabada).toBe(940);
    expect(custo.custoIndustrialPorPecaAcabada).toBeCloseTo(900 / 940, 6);
  });
});

// ---- Caso 10 — margem de processamento por peça acabada ----
describe("Caso 10 — margem de processamento por peça acabada", () => {
  it("margem = valor_unitario - custo industrial por peça acabada", () => {
    const ap = apontamento({ apontamentoId: "a1", quantidadeProduzida: 100, quantidadeRefugo: 0, custoOperacionalPeriodoVigente: 60, produtoValorUnitario: 1.5 });
    const margem = calcularMargemProcessamento([ap]);
    expect(margem.margemPorPecaAcabada).toBeCloseTo(1.5 - 0.6, 6);
    expect(margem.margemPct).toBeCloseTo(((1.5 - 0.6) / 1.5) * 100, 6);
  });
});

// ---- Caso 11 — margem total do período ----
describe("Caso 11 — margem total aproximada do período", () => {
  it("margem total = receita de produção acabada - custo industrial total", () => {
    const ap = apontamento({ apontamentoId: "a1", quantidadeProduzida: 100, quantidadeRefugo: 0, custoOperacionalPeriodoVigente: 60, produtoValorUnitario: 2 });
    const margem = calcularMargemProcessamento([ap]);
    expect(margem.receitaProducaoAcabada).toBe(200); // 100 × 2
    expect(margem.margemTotalAproximada).toBe(200 - 60);
  });
});

// ---- Caso 12 — margem por hora ----
describe("Caso 12 — margem de processamento por hora de capacidade consumida", () => {
  it("margem/hora usa a soma da duração de TODAS as etapas produzindo do produto, não só a etapa final", () => {
    const rosca = apontamento({ apontamentoId: "a1", etapaId: "e-rosca", isUltimaEtapa: false, quantidadeProduzida: 100, quantidadeRefugo: 0, custoOperacionalPeriodoVigente: 40, duracaoPeriodoHorasVigente: 1 });
    const embalagem = apontamento({ apontamentoId: "a2", etapaId: "e-emb", isUltimaEtapa: true, quantidadeProduzida: 100, quantidadeRefugo: 0, custoOperacionalPeriodoVigente: 40, duracaoPeriodoHorasVigente: 1, produtoValorUnitario: 2 });
    const margem = calcularMargemProcessamento([rosca, embalagem]);
    expect(margem.horasConsumidasTotais).toBe(2); // 1h rosca + 1h embalagem
    // receita 200, custo total 80, margem total 120, /2h = 60/h
    expect(margem.margemPorHora).toBeCloseTo(60, 6);
  });
});

// ---- Caso 13 — produto sem produção acabada não gera receita fictícia ----
describe("Caso 13 — sem produção acabada, nunca inventa receita", () => {
  it("sem_producao não entra em nenhum cálculo econômico", () => {
    const ap = apontamento({
      apontamentoId: "a1", status: "sem_producao", motivoSemProducao: "falta_material",
      produtoId: null, produtoNome: null, etapaId: null, etapaOrdem: null, isUltimaEtapa: null,
      operacaoId: null, funcionarioId: null, quantidadeProduzida: 0, quantidadeRefugo: 0,
      metaPeriodoVigente: null, custoHoraOperacaoVigente: null, custoOperacionalPeriodoVigente: null,
      custoUnitarioReferenciaPeriodoVigente: null, produtoValorUnitario: null,
    });
    const resumo = calcularResumoEconomico([ap]);
    expect(resumo.custoOperacionalTotal).toBeNull();
    expect(resumo.custoTempoParadoTotal).toBeNull();
    const margem = calcularMargemProcessamento([ap]);
    expect(margem.receitaProducaoAcabada).toBeNull(); // nenhum apontamento produzindo -> sem preço conhecido
    expect(margem.margemTotalAproximada).toBeNull();
  });
});

// ---- Caso 14 — divisão por zero / N/A ----
describe("Caso 14 — N/A em vez de divisão por zero", () => {
  it("quantidade produzida 0 -> custo por peça produzida null, não Infinity", () => {
    const ap = apontamento({ apontamentoId: "a1", quantidadeProduzida: 0, custoOperacionalPeriodoVigente: 60 });
    expect(calcularCustoPorPecaProduzidaApontamento(ap)).toBeNull();
  });

  it("custo_operacional null (sem_producao) -> nenhum cálculo por peça é inventado", () => {
    const ap = apontamento({ apontamentoId: "a1", status: "sem_producao", custoOperacionalPeriodoVigente: null, custoHoraOperacaoVigente: null });
    expect(calcularCustoPorPecaProduzidaApontamento(ap)).toBeNull();
    expect(calcularCustoTempoParadoApontamento(ap)).toBeNull();
  });

  it("grupo vazio -> resumo econômico todo null, nunca 0 inventado", () => {
    const resumo = calcularResumoEconomico([]);
    expect(resumo.custoOperacionalTotal).toBeNull();
    expect(resumo.custoMedioPorPecaProduzida).toBeNull();
  });
});

// ---- Caso 15 (parcial — a filtragem por RPC é testada ao vivo em DEV) ----
// Aqui validamos só que o motor econômico, quando recebe um SUBCONJUNTO
// já filtrado (como a RPC devolveria pra um produto/máquina específico),
// calcula corretamente sobre esse subconjunto, sem vazar dado de fora dele.
describe("Caso 15 — cálculo correto sobre subconjunto filtrado", () => {
  it("calcularResumoEconomico sobre só os apontamentos de 1 produto não mistura outro produto", () => {
    const produtoA = apontamento({ apontamentoId: "a1", produtoId: "prod-A", custoOperacionalPeriodoVigente: 60, quantidadeProduzida: 100 });
    const produtoB = apontamento({ apontamentoId: "a2", produtoId: "prod-B", custoOperacionalPeriodoVigente: 999, quantidadeProduzida: 100 });
    const resumoSoA = calcularResumoEconomico([produtoA]);
    expect(resumoSoA.custoOperacionalTotal).toBe(60); // não inclui os 999 do produto B
  });
});

// ---- Restrição operacional (estimativa) ----
describe("Restrição operacional observada — nunca 'gargalo confirmado', mínimo 2 sinais", () => {
  it("retorna null pra produto de etapa única (nada pra comparar)", () => {
    const ap = apontamento({ apontamentoId: "a1" });
    expect(detectarPossivelRestricaoOperacional([ap], [ap])).toBeNull();
  });

  it("sinaliza a etapa só quando acumula pelo menos 2 sinais (menor volume + performance baixa)", () => {
    const rosca = apontamento({
      apontamentoId: "a1", etapaId: "e-rosca", etapaOrdem: 0, isUltimaEtapa: false, maquinaId: "maq-rosca",
      quantidadeProduzida: 80, metaPeriodoVigente: 100, minutosParados: 0, // performance baixa: 80/100=80% (<90%)
    });
    const embalagem = apontamento({
      apontamentoId: "a2", etapaId: "e-emb", etapaOrdem: 1, isUltimaEtapa: true, maquinaId: "maq-emb",
      quantidadeProduzida: 95, metaPeriodoVigente: 100, minutosParados: 0, // performance ok: 95%
    });
    const resultado = detectarPossivelRestricaoOperacional([rosca, embalagem], [rosca, embalagem]);
    expect(resultado).not.toBeNull();
    expect(resultado!.etapaSinalizada?.etapaId).toBe("e-rosca"); // menor volume (80<95) + performance <90%
    expect(resultado!.etapaSinalizada!.sinais).toBeGreaterThanOrEqual(2);
  });

  it("não sinaliza nenhuma etapa quando nenhuma acumula 2+ sinais (classificação conservadora)", () => {
    const rosca = apontamento({ apontamentoId: "a1", etapaId: "e-rosca", etapaOrdem: 0, isUltimaEtapa: false, maquinaId: "maq-rosca", quantidadeProduzida: 98, metaPeriodoVigente: 100 });
    const embalagem = apontamento({ apontamentoId: "a2", etapaId: "e-emb", etapaOrdem: 1, isUltimaEtapa: true, maquinaId: "maq-emb", quantidadeProduzida: 99, metaPeriodoVigente: 100 });
    const resultado = detectarPossivelRestricaoOperacional([rosca, embalagem], [rosca, embalagem]);
    expect(resultado!.etapaSinalizada).toBeNull();
    expect(resultado!.observacao).toMatch(/sem restrição/i);
  });

  it("sinal de 'sem produção na máquina' soma corretamente quando há registro sem_producao na mesma máquina da etapa", () => {
    const rosca = apontamento({ apontamentoId: "a1", etapaId: "e-rosca", etapaOrdem: 0, isUltimaEtapa: false, maquinaId: "maq-rosca", quantidadeProduzida: 90, metaPeriodoVigente: 100 });
    const embalagem = apontamento({ apontamentoId: "a2", etapaId: "e-emb", etapaOrdem: 1, isUltimaEtapa: true, maquinaId: "maq-emb", quantidadeProduzida: 85, metaPeriodoVigente: 100 });
    const semProducaoNaRosca = apontamento({
      apontamentoId: "a3", status: "sem_producao", maquinaId: "maq-rosca", motivoSemProducao: "falta_material",
      produtoId: null, produtoNome: null, etapaId: null, etapaOrdem: null, isUltimaEtapa: null,
      operacaoId: null, funcionarioId: null, quantidadeProduzida: 0, quantidadeRefugo: 0,
      metaPeriodoVigente: null, custoHoraOperacaoVigente: null, custoOperacionalPeriodoVigente: null,
      custoUnitarioReferenciaPeriodoVigente: null,
    });
    const todos = [rosca, embalagem, semProducaoNaRosca];
    const resultado = detectarPossivelRestricaoOperacional([rosca, embalagem], todos);
    const etapaRosca = resultado!.etapas.find((e) => e.etapaId === "e-rosca")!;
    expect(etapaRosca.temSemProducaoNaMaquina).toBe(true);
    const etapaEmb = resultado!.etapas.find((e) => e.etapaId === "e-emb")!;
    expect(etapaEmb.temSemProducaoNaMaquina).toBe(false);
  });
});
