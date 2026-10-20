import { describe, it, expect } from "vitest";
import {
  descreverFuncionario, formatarData, haHistoricoNoPlano, linhasImpactoIndicadores, linhasRemocao, nomeConfere, temHistorico, linhasConsolidacao, linhasDescarte, linhasTransferencia, linhasDeVinculos, mensagemDeErro, podeConfirmar,
  type PlanoExclusao,
} from "../exclusao";

const plano = (p: Partial<PlanoExclusao> = {}): PlanoExclusao => ({
  modo: "unificacao",
  excluido: { id: "b", nome: "Luana", ativo: true, cadastro: "2026-10-15T10:58:42+00:00", ultima_atividade: "2026-10-20", vinculos: {} },
  mantido: { id: "a", nome: "Luana", ativo: true, cadastro: "2026-09-15T15:23:58+00:00", ultima_atividade: "2026-10-20", vinculos: {} },
  transferir: { apontamentos: 15, ocorrencias: 0, ausencias: 0, semanas_equipe: 0, alocacoes_passadas: 0, custos_copiados: 0 },
  consolidar: { ausencias_identicas: 0, semanas_equipe: [], alocacoes_passadas_mesmo_periodo: [], custos_duplicados: [] },
  descartar: { alocacoes_futuras: [], alocacoes_passadas: [], ausencias: 0, semanas_equipe: 0, custos: [] },
  impacto_escala: { semanas_recalculadas: [], alocacoes_futuras_removidas: 0, observacao: "" },
  decisoes_custos: {}, bloqueios: [], pendencias: [], avisos: [], pode_executar: true, assinatura: "abc",
  ...p,
});

describe("exclusão/unificação de funcionário — apresentação", () => {
  it("diferencia dois cadastros de mesmo nome por data de cadastro e atividade", () => {
    expect(descreverFuncionario({ nome: "Luana", cadastro: "2026-10-15T10:58:42+00:00", ultima_atividade: "2026-10-20", apontamentos: 15 }))
      .toBe("Luana · cadastrado em 15/10/2026 · 15 apontamentos · última atividade 20/10/2026");
    expect(descreverFuncionario({ nome: "Luana ", cadastro: "2026-09-15T15:23:58+00:00", ultima_atividade: null, apontamentos: 1, ativo: false }))
      .toBe("Luana · cadastrado em 15/09/2026 · 1 apontamento · sem atividade registrada · inativo");
    expect(formatarData(null)).toBe("");
  });

  it("resume vínculos, transferência, consolidação e descarte em linguagem clara", () => {
    expect(linhasDeVinculos({ apontamentos: 90, semanas_equipe: 9, ausencias: 1, alocacoes: 23, custos: 11 })).toEqual([
      "90 apontamentos de produção", "9 semanas na equipe", "1 ausência", "23 alocações de escala", "11 custos extras cadastrados",
    ]);
    const p = plano({
      transferir: { apontamentos: 15, ocorrencias: 0, ausencias: 1, semanas_equipe: 1, alocacoes_passadas: 2, custos_copiados: 1 },
      consolidar: {
        ausencias_identicas: 1, semanas_equipe: [{ semana_inicio: "2026-10-12", previsao_id: "p", produtivo_excluido: true, produtivo_mantido: false, produtivo_final: true, difere: true }],
        alocacoes_passadas_mesmo_periodo: [], custos_duplicados: [{ id: "c", descricao: "VT", valor: 100 }],
      },
      descartar: { alocacoes_futuras: [{ data: "2030-01-07", periodo_id: "t1" }], alocacoes_passadas: [], ausencias: 0, semanas_equipe: 0, custos: [{ id: "d", descricao: "Bônus", valor: 30 }] },
    });
    expect(linhasTransferencia(p)).toEqual(["15 apontamentos de produção", "1 semana na equipe", "1 ausência", "2 alocações de escala já realizadas", "1 custo extra copiado"]);
    expect(linhasConsolidacao(p).length).toBe(3);
    expect(linhasDescarte(p)[0]).toContain("1 alocação futura da Escala");
    expect(linhasDescarte(p)[1]).toContain("Bônus");
  });

  it("só confirma simulação pronta e válida para o destino escolhido", () => {
    expect(podeConfirmar(plano(), "a", "a")).toBe(true);
    expect(podeConfirmar(plano(), "c", "a")).toBe(false); // trocou o destino => simular de novo
    expect(podeConfirmar(plano({ pode_executar: false }), "a", "a")).toBe(false);
    expect(podeConfirmar(null, "a", "a")).toBe(false);
    expect(podeConfirmar(plano({ modo: "exclusao", mantido: null }), null, null)).toBe(true);
  });

  it("traduz os erros do backend sem expor detalhes técnicos", () => {
    expect(mensagemDeErro("FUNC_SOMENTE_ADMIN: x")).toContain("administradores");
    expect(mensagemDeErro("FUNC_ASSINATURA_DESATUALIZADA: ...")).toContain("Simule novamente");
    expect(mensagemDeErro("violates foreign key constraint")).toBe("Não foi possível concluir. Nada foi alterado.");
    expect(mensagemDeErro(null)).toBe("Não foi possível concluir. Nada foi alterado.");
  });

  it("exclusão sem unificar: lista o que será apagado por tabela e o impacto nos indicadores", () => {
    const p = plano({
      modo: "exclusao", mantido: null,
      remover: { apontamentos: 91, apontamento_paradas: 4, apontamento_historico: 2, ocorrencias: 0, notificacoes_ocorrencia: 0, ausencias: 1, ausencias_historico: 0, semanas_equipe: 9, alocacoes_passadas: 4, alocacoes_futuras: 19, custos: Array.from({ length: 11 }, (_, i) => ({ id: String(i), descricao: "c" + i, valor: 1 })) },
      impacto_indicadores: {
        apontamentos: { n: 91, de: "2026-09-15", ate: "2026-10-20", dias: 30, quantidade_produzida: 12000, quantidade_refugo: 80, custo_operacional: 1500.5, valor_produzido: 30000, horas: 145.6 },
        paradas_minutos: 120, semanas_equipe: { n: 9, produtivas: 8, de: "2026-08-24", ate: "2026-10-19" }, ausencias: { n: 1, de: "2026-10-06", ate: "2026-10-06" }, custos_mensais_extras: 300,
      },
    });
    expect(linhasRemocao(p)).toEqual([
      "91 apontamentos de produção", "4 paradas lançadas nesses apontamentos", "2 registros de histórico de edição de apontamentos", "9 semanas na equipe", "1 ausência",
      "23 alocações de escala (4 já realizadas e 19 futuras)", "11 custos extras",
    ]);
    const imp = linhasImpactoIndicadores(p);
    expect(imp[0]).toContain("15/09/2026 a 20/10/2026");
    expect(imp[0]).toContain("91 apontamentos");
    expect(imp[0]).toContain("OEE");
    expect(imp.some((l) => l.startsWith("Equipe e capacidade"))).toBe(true);
    expect(imp.some((l) => l.startsWith("Faltas e ausências"))).toBe(true);
    expect(haHistoricoNoPlano(p)).toBe(true);
    expect(haHistoricoNoPlano(plano({ modo: "exclusao", mantido: null, remover: { apontamentos: 0, apontamento_paradas: 0, apontamento_historico: 0, ocorrencias: 0, notificacoes_ocorrencia: 0, ausencias: 0, ausencias_historico: 0, semanas_equipe: 0, alocacoes_passadas: 0, alocacoes_futuras: 3, custos: [] } }))).toBe(false);
  });

  it("confirmação forte: o nome digitado precisa conferir (caixa e espaços não importam)", () => {
    expect(nomeConfere("LUANA", "Luana")).toBe(true);
    expect(nomeConfere("  luana ", "Luana")).toBe(true);
    expect(nomeConfere("Maria  Clara", "maria clara")).toBe(true);
    expect(nomeConfere("Luan", "Luana")).toBe(false);
    expect(nomeConfere("", "Luana")).toBe(false);
    expect(nomeConfere("x", "")).toBe(false);
  });

  it("tem histórico quando há qualquer vínculo além de custos extras", () => {
    expect(temHistorico({ apontamentos: 0, ocorrencias: 0, ausencias: 0, semanas_equipe: 0, alocacoes: 0, custos: 11 })).toBe(false);
    expect(temHistorico({ apontamentos: 1, ocorrencias: 0, ausencias: 0, semanas_equipe: 0, alocacoes: 0, custos: 0 })).toBe(true);
    expect(temHistorico({ apontamentos: 0, ocorrencias: 0, ausencias: 0, semanas_equipe: 9, alocacoes: 0, custos: 0 })).toBe(true);
  });
});
