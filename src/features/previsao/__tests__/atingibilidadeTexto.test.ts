import { describe, it, expect } from "vitest";
import type { AtingibilidadeProduto } from "@/features/escala/atingibilidade";
import type { DiagnosticoGlobal } from "@/features/escala/atingibilidade";
import { diagnosticoGlobalTexto, explicacaoRecursoCompartilhado, rotuloStatusProduto, faltaDoProduto, manchete, periodosTexto, ROTULO_BENEFICIO, ROTULO_STATUS, textoAcao, textoGanhos, NOTA_INDEPENDENTES } from "../atingibilidadeTexto";

const base: AtingibilidadeProduto = { produtoId: "p", status: "em_risco", causa: "maquina_livre_nao_priorizada", faltaPlano: 8400, faltaMinima: 0, valorEmRisco: 0, gargaloEtapaId: "e", periodosNecessarios: 2, acao: null, etapas: [] };

describe("textos da atingibilidade", () => {
  it("quatro estados com os rótulos pedidos", () => {
    expect(ROTULO_STATUS).toEqual({ atingivel: "Atingível", atingivel_no_limite: "Atingível no limite", em_risco: "Em risco", impossivel: "Impossível com a capacidade atual" });
  });
  it("manchete: em risco de faltar X peças", () => {
    expect(manchete(base)).toBe("Em risco de faltar 8.400 peças");
  });
  it("manchete: impossível usa a falta mínima provada quando o plano não mostra falta", () => {
    expect(manchete({ ...base, status: "impossivel", faltaPlano: 0, faltaMinima: 1200 })).toBe("Impossível com a capacidade atual — faltam 1.200 peças");
    expect(faltaDoProduto({ faltaPlano: 5, faltaMinima: 9 })).toBe(9);
  });
  it("manchete: atingível no limite mostra a folga", () => {
    const t = manchete({ ...base, status: "atingivel_no_limite", faltaPlano: 0, etapas: [{ folgaPercentual: 3.2 } as never] });
    expect(t).toContain("Atingível no limite");
    expect(t).toContain("folga de só 3,2%");
  });
  it("ação de priorizar máquina com número de períodos", () => {
    expect(textoAcao({ tipo: "priorizar_maquina", produtoId: "p", etapaId: "e", maquinaId: "m15", periodos: 2 }, () => "Etiquetadora 15")).toBe("Priorizar Etiquetadora 15 nos próximos 2 períodos.");
    expect(textoAcao({ tipo: "priorizar_maquina", produtoId: "p", etapaId: "e", maquinaId: "m15", periodos: 1 }, () => "Etiquetadora 15")).toBe("Priorizar Etiquetadora 15 nos próximos 1 período.");
    expect(textoAcao(null, () => "")).toBeNull();
  });
  it("períodos necessários e a nota de independência", () => {
    expect(periodosTexto(0)).toBeNull();
    expect(periodosTexto(3)).toContain("3 períodos");
    expect(NOTA_INDEPENDENTES).toContain("não é contradição");
  });

  it("diagnóstico global da semana: necessário, disponível e déficit — sem afirmar que cada produto é impossível", () => {
    const d: DiagnosticoGlobal = { cabe: false, equipe: { necessarioPeriodosPessoa: 346.1, disponivelPeriodosPessoa: 337, deficit: 9.1, insuficiente: true }, recursosSaturados: [{ maquinas: ["m1"], produtos: ["p"], necessarioPeriodosMaquina: 32, disponivelPeriodosMaquina: 24, deficit: 8 }], mensagem: "Programação semanal não cabe na equipe disponível" };
    const t = diagnosticoGlobalTexto(d, () => "Conector", () => "Etiquetadora");
    expect(t[0].titulo).toBe("Programação semanal não cabe na equipe disponível");
    expect(t[0].linhas.join(" | ")).toContain("Necessário (no mínimo): 346,1 pessoas-período");
    expect(t[0].linhas.join(" | ")).toContain("Disponível: 337 pessoas-período");
    expect(t[0].linhas.join(" | ")).toContain("Déficit: 9,1 pessoas-período");
    expect(t[0].linhas.join(" | ")).toContain("não que cada produto, sozinho, seja impossível");
    expect(t[1].titulo).toBe("Recurso compartilhado saturado");
    expect(diagnosticoGlobalTexto({ ...d, equipe: { ...d.equipe, insuficiente: false }, recursosSaturados: [] }, () => "", () => "")).toEqual([]);
  });

  it("benefícios da recomendação com rótulo e texto próprios", () => {
    expect(ROTULO_BENEFICIO).toEqual({ produtivo: "Ganho produtivo", cobertura: "Ganho de cobertura", margem: "Ganho de margem" });
    const margem = textoGanhos({ beneficios: ["margem"], faltaReduzida: 0, minutosOciososReduzidos: 0, produtos: [{ produtoId: "p", de: "atingivel_no_limite", para: "atingivel", faltaDe: 0, faltaPara: 0 }] }, () => "Caixa Amarela");
    expect(margem).toEqual(["Caixa Amarela passa de Atingível no limite para Atingível.", "Peças faltantes: sem alteração."]);
    const produtivo = textoGanhos({ beneficios: ["produtivo"], faltaReduzida: 3200, minutosOciososReduzidos: 0, produtos: [] }, () => "x");
    expect(produtivo).toEqual(["Falta reduzida em 3.200 peças."]);
  });

  it("recurso compartilhado: rótulo 'Impossível com a configuração atual' e explicação de quem disputa a capacidade", () => {
    expect(rotuloStatusProduto({ status: "impossivel", causa: "recurso_compartilhado_saturado" })).toBe("Impossível com a configuração atual");
    expect(rotuloStatusProduto({ status: "impossivel", causa: "capacidade_maquinas" })).toBe("Impossível com a capacidade atual");
    expect(rotuloStatusProduto({ status: "em_risco", causa: "semana_sem_equipe" })).toBe("Em risco");
    const d: DiagnosticoGlobal = { cabe: false, equipe: { necessarioPeriodosPessoa: 1, disponivelPeriodosPessoa: 9, deficit: 0, insuficiente: false }, mensagem: null,
      recursosSaturados: [{ maquinas: ["e15"], produtos: ["a", "b", "c"], necessarioPeriodosMaquina: 32, disponivelPeriodosMaquina: 24, deficit: 8 }] };
    const nomeP = (id: string) => ({ a: "Conector 3/4\"", b: "Luva 3/4\"", c: "Pino" })[id] as string;
    expect(explicacaoRecursoCompartilhado("a", d, nomeP, () => "Etiquetadora 15")).toBe("Este produto disputa capacidade de Etiquetadora 15 com Luva 3/4\", Pino.");
    expect(explicacaoRecursoCompartilhado("z", d, nomeP, () => "x")).toBeNull();
  });
});
