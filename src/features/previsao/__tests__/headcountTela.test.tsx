import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ItensPrevistos, { type ItensPrevistosProps } from "@/features/previsao/components/ItensPrevistos";
import { gerarHtmlProgramacaoSemana, type GerarProgramacaoParams } from "@/features/previsao/pdf";
import { calcularAnaliseCapacidadeSemanal } from "@/features/capacidade/calculations";
import type { EstadoFuncionariosNecessarios } from "@/features/previsao/useFuncionariosNecessarios";
import type { FuncionariosNecessariosResultado } from "@/lib/escala/funcionariosNecessarios";
import { textoFuncionariosNecessarios, textoMaquinasEnvolvidas, funcionariosNecessariosDe, TEXTO_USO_HORAS_MAQUINA } from "@/features/previsao/textosEquipe";
import type { Maquina, PeriodoComDuracao, Previsao, Produto } from "@/types/domain";

// 15 máquinas únicas em 3 itens (3 compartilhadas entre itens): o número de máquinas NUNCA pode aparecer como headcount.
const PERIODOS: PeriodoComDuracao[] = [{ id: "m1", nome: "M1", inicio: "07:00", fim: "15:00", duracaoHoras: 8 }];
const maq = (id: string): Maquina => ({ id, nome: `Maq ${id}`, operacao: "Op", ativo: true });
const MAQUINAS = Array.from({ length: 15 }, (_, i) => maq(`m${i + 1}`));
const metas = { m1: 100, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 };
const produto = (id: string, etapas: Record<string, string[]>): Produto => ({
  id, nome: `Produto ${id}`, referencia: id, valorUnitario: 1, ativo: true, prioridade: "media" as never,
  roteiro: Object.entries(etapas).map(([eid, ms]) => ({ id: eid, operacao: "Op", metas, maquinasIds: ms })),
});
// item A: m1..m6 ; item B: m5..m10 (compartilha m5,m6) ; item C: m9..m15 (compartilha m9,m10) => 15 únicas, soma por item = 6+6+7 = 19
const A = { e1: ["m1", "m2", "m3"], e2: ["m4", "m5", "m6"] };
const B = { e3: ["m5", "m6", "m7"], e4: ["m8", "m9", "m10"] };
const C = { e5: ["m9", "m10", "m11", "m12"], e6: ["m13", "m14", "m15"] };
const PRODUTOS = [produto("A", A), produto("B", B), produto("C", C)];
const item = (id: string, pid: string, mpe: Record<string, string[]>) => ({ id, produtoId: pid, produtoNome: `Produto ${pid}`, valorUnitario: 1, quantidade: 100, maquinasPorEtapa: mpe });
const SEMANA: Previsao = { semanaInicio: "2026-11-02", itens: [item("i1", "A", A), item("i2", "B", B), item("i3", "C", C)], itensRealizados: [] };

const OK14: FuncionariosNecessariosResultado = {
  semanaInicio: "2026-11-02", funcionariosNecessarios: 14, maquinasEnvolvidas: { total: 15, maquinas: [] }, equipeReferencia: 45,
  producaoReferencia: { creditoTotal: 0, faltaTotal: 0, porEtapa: [] }, comparacao: [], faltaPorLimiteDeMaquina: { total: 0, porEtapa: [] },
  faltaPorEquipe: { n: 13, total: 0, porEtapa: [] }, periodosAnalisados: { total: 24, primeiro: null, ultimo: null, dias: [] },
  busca: { metodo: "binaria", monotonico: true, rodadas: 7, tolerancia: 1e-6, equipeVirtualMax: 45 }, avisos: [],
};

function props(estado: EstadoFuncionariosNecessarios): ItensPrevistosProps {
  return {
    loading: false, produtos: PRODUTOS, maquinas: MAQUINAS, periodosComDuracao: PERIODOS, horasPorMaquinaSemana: 40, semana: SEMANA,
    showForm: false, setShowForm: () => {}, editingId: null, form: { produtoId: "", quantidade: "", maquinasPorEtapa: {} },
    onSelecionarProduto: () => {}, onQuantidadeChange: () => {}, onToggleMaquina: () => {}, onSubmit: () => {}, salvando: false, onCancelar: () => {},
    onEditar: () => {}, onExcluir: () => {}, analise: calcularAnaliseCapacidadeSemanal(SEMANA.itens, PRODUTOS, MAQUINAS, PERIODOS, 40),
    valorPrevistoSemana: 300, equipeProdutivaCount: 12, funcionariosNecessarios: estado, formatBRL: (v) => `R$ ${v}`,
  };
}

describe("ItensPrevistos — dois indicadores separados (máquinas envolvidas × funcionários necessários)", () => {
  it("com o valor do servidor: 'Funcionários necessários para executar esta programação: 14' e, separado, 'Máquinas envolvidas na semana: 15'", () => {
    render(<ItensPrevistos {...props({ status: "ok", dados: OK14 })} />);
    expect(screen.getByTestId("funcionarios-necessarios").textContent).toContain("Funcionários necessários para executar esta programação: 14");
    expect(screen.getByTestId("maquinas-envolvidas").textContent).toBe("Máquinas envolvidas na semana: 15");
  });

  it("máquinas envolvidas continua = máquinas ÚNICAS (15), não a soma por item (19)", () => {
    render(<ItensPrevistos {...props({ status: "ok", dados: OK14 })} />);
    expect(screen.getByTestId("maquinas-envolvidas").textContent).toContain(": 15");
    expect(screen.getByTestId("maquinas-envolvidas").textContent).not.toContain("19");
  });

  it("enquanto o servidor não responde: 'calculando…' — nunca o número de máquinas como headcount", () => {
    render(<ItensPrevistos {...props({ status: "calculando" })} />);
    const t = screen.getByTestId("funcionarios-necessarios").textContent ?? "";
    expect(t).toContain("calculando…");
    expect(t).not.toMatch(/programação: \d/);
    expect(screen.getByTestId("maquinas-envolvidas").textContent).toContain("15");
  });

  it("indisponível (ex.: Previsão não salva): mostra o motivo, sem número de headcount", () => {
    render(<ItensPrevistos {...props({ status: "indisponivel", motivo: "Salve a Previsão" })} />);
    const t = screen.getByTestId("funcionarios-necessarios").textContent ?? "";
    expect(t).toContain("indisponível (Salve a Previsão)");
    expect(t).not.toMatch(/programação: \d/);
  });

  it("a frase por item 'precisa de X funcionários' NÃO existe mais; 'usa N máquinas' (fato) permanece", () => {
    const { container } = render(<ItensPrevistos {...props({ status: "ok", dados: OK14 })} />);
    const txt = container.textContent ?? "";
    expect(txt).not.toMatch(/precisa de \d+ funcion/);
    expect(txt).not.toContain("você vai usar");
    expect(txt).toContain("usa 6 máquinas");
    expect(txt).toContain("usa 7 máquinas");
  });

  it("compara com a equipe marcada sem chamar de 'ativos' e sinaliza quando falta gente", () => {
    render(<ItensPrevistos {...props({ status: "ok", dados: OK14 })} />);
    expect(screen.getByTestId("funcionarios-necessarios").textContent).toContain("equipe produtiva marcada nesta semana: 12 — 2 a menos do que o necessário");
  });

  it("'Uso estimado em horas-máquina' tem o texto de carga média (não é nº de pessoas, pode passar de 100%)", () => {
    const { container } = render(<ItensPrevistos {...props({ status: "ok", dados: OK14 })} />);
    expect(container.textContent).toContain("carga média e pode passar de 100%");
    expect(TEXTO_USO_HORAS_MAQUINA).toContain("Não é a % de pessoas necessárias nem o pico de equipe");
  });
});

describe("PDF — mesmo número da tela, nunca o de máquinas", () => {
  const base: GerarProgramacaoParams = {
    semanaAtual: "2026-11-02", semanaAtualRec: SEMANA, produtos: PRODUTOS, maquinas: MAQUINAS, periodosComDuracao: PERIODOS, horasPorMaquinaSemana: 40,
    duracaoMediaPeriodo: 8, diasProdutivosSemana: 4, equipeProdutivaCount: 12, getLucroHora: () => 0, funcionariosNecessarios: 14,
  };
  it("com o headcount do servidor: 14 e, separado, máquinas envolvidas 15", () => {
    const html = gerarHtmlProgramacaoSemana(base);
    expect(html).toContain("Funcionários necessários para executar esta programação: <b>14</b>");
    expect(html).toContain("Máquinas envolvidas na semana: <b>15</b>");
    expect(html).not.toMatch(/Funcionários pra esse item/);
    expect(html).toContain("Máquinas desse item: <b>6</b>");
  });
  it("sem valor disponível: 'não calculado' (e não 15)", () => {
    const html = gerarHtmlProgramacaoSemana({ ...base, funcionariosNecessarios: null });
    expect(html).toContain("Funcionários necessários para executar esta programação: <b>não calculado</b>");
    expect(html).toContain("Máquinas envolvidas na semana: <b>15</b>");
  });
});

describe("textosEquipe", () => {
  it("estados do servidor e rótulos", () => {
    expect(textoFuncionariosNecessarios({ status: "ok", dados: OK14 })).toBe("Funcionários necessários para executar esta programação: 14");
    expect(textoFuncionariosNecessarios({ status: "calculando" })).toBe("Funcionários necessários para executar esta programação: calculando…");
    expect(funcionariosNecessariosDe({ status: "calculando" })).toBeNull();
    expect(funcionariosNecessariosDe({ status: "indisponivel", motivo: "x" })).toBeNull();
    expect(funcionariosNecessariosDe({ status: "ok", dados: OK14 })).toBe(14);
    expect(textoMaquinasEnvolvidas(15)).toBe("Máquinas envolvidas na semana: 15");
  });
});
