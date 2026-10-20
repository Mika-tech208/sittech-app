import { describe, it, expect } from "vitest";
import { PERIODOS_REAIS } from "@/features/escala/__tests__/helpers";
import { analisarCobertura } from "@/features/escala/cobertura";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { sugerirAdicional } from "@/features/escala/sugestaoAdicional";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { entrada, equipe, pool } from "@/features/escala/__tests__/helpers";
import type { EstadoBruto } from "../estado";
import { aplicarRascunhoItens, produtosForaDaSemana, RascunhoInvalidoError, simularCobertura } from "../simularCobertura";

// REGRA DURA: a carga adicional (e qualquer máquina sugerida) só vale para PRODUTOS JÁ PREVISTOS na semana.
// Produto C está apenas CADASTRADO (tem roteiro, máquinas compatíveis livres, produtividade e valor melhores).

const SEG = "2026-10-26";
const AGORA = epochMsNoFuso(SEG, "05:00");
const METAS = { m1: 100, m2: 100, m3: 100, t1: 100, t2: 100, t3: 100 };
const METAS_C = { m1: 900, m2: 900, m3: 900, t1: 900, t2: 900, t3: 900 }; // produtividade muito melhor

function estadoSemana(extra: Partial<EstadoBruto> = {}): EstadoBruto {
  return {
    previsaoId: "prev1",
    semanaInicio: SEG,
    diasProdutivos: [SEG, "2026-10-27"],
    periodosAtuais: PERIODOS_REAIS,
    diasExistentes: [],
    equipeProdutiva: [1, 2, 3, 4, 5, 6].map((n) => ({ funcionarioId: `f${n}`, ativo: true })),
    // PREVISTOS: A e B. C NÃO está previsto.
    itens: [
      { produtoId: "A", quantidade: 300, valorUnitario: 2, maquinasPorEtapa: { eA: ["mA"] } },
      { produtoId: "B", quantidade: 300, valorUnitario: 3, maquinasPorEtapa: { eB: ["mB"] } },
    ],
    etapas: [
      { id: "eA", produtoId: "A", operacaoId: "opA", ordem: 1, metas: METAS, maquinasCompativeis: ["mA", "mA2"] },
      { id: "eB", produtoId: "B", operacaoId: "opB", ordem: 1, metas: METAS, maquinasCompativeis: ["mB"] },
      // cadastro geral: C tem roteiro com máquinas compatíveis livres e é muito mais produtivo — mas não está na Previsão
      { id: "eC", produtoId: "C", operacaoId: "opC", ordem: 1, metas: METAS_C, maquinasCompativeis: ["mC1", "mC2"] },
    ],
    maquinasIndisponiveisPrevisao: [],
    maquinasInativas: [],
    ausencias: [],
    indisponibilidades: [],
    alocacoes: [],
    nomesOperacao: { opA: "Rosquear", opB: "Embalar", opC: "Montar" },
    nomesMaquinas: { mA: "Rosqueadeira 1", mA2: "Rosqueadeira 3", mB: "Embaladora", mC1: "Montagem C1", mC2: "Montagem C2" },
    nomesProdutos: { A: "Produto A", B: "Produto B", C: "Produto C" },
    ...extra,
  };
}

const PREVISTOS = new Set(["A", "B"]);

describe("regra dura — carga adicional só em produtos JÁ PREVISTOS na semana", () => {
  it("1) Produto C só cadastrado: nenhuma sugestão, recomendação ou diagnóstico o menciona", () => {
    const sim = simularCobertura(estadoSemana(), AGORA, { sugerir: true });
    expect(sim.sugestao!.totalPecas).toBeGreaterThan(0); // há carga a sugerir… para A e B
    expect(sim.sugestao!.porProduto.map((p) => p.produtoId).sort()).toEqual(["A", "B"]);
    expect(produtosForaDaSemana(sim, PREVISTOS)).toEqual([]);
    expect(JSON.stringify(sim)).not.toContain('"produtoId":"C"');
    expect(Object.keys(sim.nomes.produtos).sort()).toEqual(["A", "B"]); // nem o catálogo inteiro sai na resposta
    expect(Object.keys(sim.nomes.etapas)).not.toContain("eC");
    sim.adicional.forEach((a) => expect(PREVISTOS.has(a.produtoId)).toBe(true));
  });

  it("2) e 3) C com faturamento E produtividade maiores continua proibido (no motor, mesmo estando nos pools)", () => {
    const comC = entrada({
      funcionarios: equipe(6),
      pools: [
        pool({ produto: "A", etapa: "eA", op: "opA", q: 300, maquinas: ["mA"], valor: 2 }),
        pool({ produto: "B", etapa: "eB", op: "opB", q: 300, maquinas: ["mB"], valor: 3 }),
        pool({ produto: "C", etapa: "eC", op: "opC", q: 300, maquinas: ["mC1", "mC2"], valor: 1000, metas: METAS_C }), // valor ×300, produtividade ×9
      ],
    });
    // SEM a regra, C seria o primeiro a receber carga (maior valor): prova de que é a regra que o barra
    const livre = sugerirAdicional(comC);
    expect(livre.porProduto.find((p) => p.produtoId === "C")!.adicionalSugerido).toBeGreaterThan(0);
    // COM a regra (produtos previstos da semana), C nunca recebe nada e nem aparece
    const r = sugerirAdicional(comC, { produtosPermitidos: PREVISTOS });
    expect(r.porProduto.map((p) => p.produtoId)).toEqual(["A", "B"]);
    const escala = gerarEscala(r.entradaComSugestao);
    expect(escala.alocacoes.some((a) => a.produtoId === "C" && (a.pecasAdicional ?? 0) > 0)).toBe(false);
    expect(Object.keys(escala.adicionalProduzido).some((k) => k.startsWith("C|"))).toBe(false);
    r.entradaComSugestao.pools.filter((p) => p.produtoId === "C").forEach((p) => expect(p.adicionalMax ?? 0).toBe(0));
  });

  it("4) máquina compatível de produto fora da semana não entra como solução de cobertura", () => {
    // C (fora da semana) com máquinas compatíveis livres e demanda saturada: SEM a regra viraria candidata
    const pA = { ...pool({ produto: "A", etapa: "eA", op: "opA", q: 1_000_000, maquinas: ["mA"] }), maquinasCompativeisIds: ["mA"] };
    const pC = { ...pool({ produto: "C", etapa: "eC", op: "opC", q: 1_000_000, maquinas: ["mC0"] }), maquinasCompativeisIds: ["mC0", "mC1", "mC2"] };
    const e = entrada({ funcionarios: equipe(4), pools: [pA, pC] });
    const r = gerarEscala(e);
    const livre = analisarCobertura(e, r).candidatos.map((c) => c.maquinaId);
    expect(livre).toEqual(["mC1", "mC2"]); // sem a regra: só as de C apareceriam
    const restrito = analisarCobertura(e, r, PREVISTOS).candidatos;
    expect(restrito).toEqual([]); // com a regra: nada de C
  });

  it("5) máquina compatível não selecionada de produto PREVISTO pode ser sugerida (junto com a carga)", () => {
    // A previsto e saturado (q enorme) só com mA; mA2 é compatível no roteiro e não foi selecionada
    const sim = simularCobertura(
      estadoSemana({ itens: [{ produtoId: "A", quantidade: 1_000_000, valorUnitario: 2, maquinasPorEtapa: { eA: ["mA"] } }] }),
      AGORA,
      { sugerir: true }
    );
    const rec = sim.recomendacoes.find((r) => r.maquinas.includes("mA2"));
    expect(rec).toBeDefined();
    expect(rec!.poolsAfetados).toEqual([{ produtoId: "A", etapaId: "eA" }]);
    expect(rec!.coberturaPara).toBeGreaterThan(rec!.coberturaDe);
    expect(sim.nomes.maquinas.mA2).toBe("Rosqueadeira 3");
    // e nenhuma máquina de C (cadastrada, livre, compatível) aparece
    expect(sim.recomendacoes.flatMap((r) => r.maquinas)).not.toContain("mC1");
    expect(produtosForaDaSemana(sim, new Set(["A"]))).toEqual([]);
  });

  it("6) nenhum produto da semana consegue absorver carga: sugestão adicional = 0 (mesmo havendo máquinas livres de outro produto)", () => {
    // todas as máquinas selecionadas de A e B ficam ocupadas pelo previsto a semana inteira; sobra gente, não sobra máquina
    const sim = simularCobertura(
      estadoSemana({
        itens: [
          { produtoId: "A", quantidade: 5_000_000, valorUnitario: 2, maquinasPorEtapa: { eA: ["mA"] } },
          { produtoId: "B", quantidade: 5_000_000, valorUnitario: 3, maquinasPorEtapa: { eB: ["mB"] } },
        ],
      }),
      AGORA,
      { sugerir: true }
    );
    expect(sim.sugestao!.totalPecas).toBe(0);
    sim.sugestao!.porProduto.forEach((p) => expect(p.adicionalSugerido).toBe(0));
    expect(produtosForaDaSemana(sim, PREVISTOS)).toEqual([]);
    // as máquinas livres de C existem (compatíveis), mas C não está previsto: nada é recomendado com elas
    expect(sim.recomendacoes.flatMap((r) => r.maquinas)).not.toContain("mC1");
  });

  it("7) produtos fora da semana capazes de absorver a carga continuam ignorados", () => {
    const e = entrada({
      funcionarios: equipe(5),
      pools: [
        pool({ produto: "A", etapa: "eA", op: "opA", q: 100000, maquinas: ["mA"] }), // saturado
        pool({ produto: "C", etapa: "eC", op: "opC", q: 100, maquinas: ["mC1", "mC2", "mC3"], metas: METAS_C }), // sobra capacidade ociosa em C
      ],
    });
    const r = sugerirAdicional(e, { produtosPermitidos: new Set(["A"]) });
    expect(r.totalPecas).toBe(0);
    expect(r.porProduto.map((p) => p.produtoId)).toEqual(["A"]);
    // enquanto sem a regra C absorveria muito
    expect(sugerirAdicional(e).totalPecas).toBeGreaterThan(0);
  });

  it("a verificação final denuncia qualquer produto de fora da semana (e é vazia nos casos normais)", () => {
    const base = { adicional: [], etapasSemMaquina: [], recursosCompativeis: [], sugestao: null, recomendacoes: [] };
    expect(produtosForaDaSemana(base, PREVISTOS)).toEqual([]);
    expect(
      produtosForaDaSemana(
        { ...base, recomendacoes: [{ poolsAfetados: [{ produtoId: "C" }], adicionalPorProduto: [{ produtoId: "A" }, { produtoId: "D" }] }] },
        PREVISTOS
      )
    ).toEqual(["C", "D"]);
  });

  it("adicional manual só em itens JÁ PREVISTOS: item novo (produto fora da semana) é recusado", () => {
    const e = estadoSemana();
    expect(() => aplicarRascunhoItens(e, [{ produto_id: "C", quantidade: 1000, quantidade_adicional: 500 }])).toThrow();
    try {
      aplicarRascunhoItens(e, [{ produto_id: "A", quantidade: 300, quantidade_adicional: 100 }, { produto_id: "C", quantidade_adicional: 1 }]);
    } catch (err) {
      expect(err instanceof RascunhoInvalidoError).toBe(true);
      expect((err as Error).message).toContain("fora da Previsão");
    }
    // itens previstos continuam aceitos
    expect(aplicarRascunhoItens(e, [{ produto_id: "A", quantidade: 300, quantidade_adicional: 100 }]).itens).toHaveLength(1);
  });

  it("o previsto original nunca é alterado pela sugestão (total programado = previsto + adicional, em campos separados)", () => {
    const e = estadoSemana();
    const antes = JSON.stringify(e.itens);
    const sim = simularCobertura(e, AGORA, { sugerir: true });
    expect(JSON.stringify(e.itens)).toBe(antes);
    sim.adicional.forEach((a) => expect(a.previsto).toBe(300));
  });
});
