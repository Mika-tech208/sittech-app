import { describe, it, expect } from "vitest";
import { juntarProdutoNome, resumirLancamentos } from "../lancamentosMaquina";
import { mensagemErroRegistrarLancamento } from "../calculations";

const L = (nome: string, qtd: number) => ({ status: "produzindo", quantidade_produzida: qtd, motivo_sem_producao: null, produtos: { nome } });

describe("resumirLancamentos (vários lançamentos por máquina/período)", () => {
  it("sem linhas = pendente", () => {
    expect(resumirLancamentos([])).toEqual({ estadoPeriodo: "pendente", produtoNome: null, quantidadeProduzida: null, motivoSemProducao: null, lancamentos: 0 });
  });
  it("um lançamento = comportamento de sempre", () => {
    expect(resumirLancamentos([L("Luva 3\"", 1000)])).toEqual({ estadoPeriodo: "apontado", produtoNome: "Luva 3\"", quantidadeProduzida: 1000, motivoSemProducao: null, lancamentos: 1 });
  });
  it("dois produtos na mesma máquina/período: soma a produção e lista os dois produtos", () => {
    const r = resumirLancamentos([L("Conector 2\"", 1000), L("Luva 3\"", 400)]);
    expect(r.estadoPeriodo).toBe("apontado");
    expect(r.produtoNome).toBe("Conector 2\" + Luva 3\"");
    expect(r.quantidadeProduzida).toBe(1400);
    expect(r.lancamentos).toBe(2);
  });
  it("troca de operador (mesmo produto, duas linhas): soma e não repete o produto", () => {
    const r = resumirLancamentos([L("Conector 2\"", 700), L("Conector 2\"", 300)]);
    expect(r.produtoNome).toBe("Conector 2\"");
    expect(r.quantidadeProduzida).toBe(1000);
    expect(r.lancamentos).toBe(2);
  });
  it("quantidade textual (numeric do banco) é somada corretamente", () => {
    expect(resumirLancamentos([{ ...L("A", 0), quantidade_produzida: "1500.5" }, L("B", 10)]).quantidadeProduzida).toBe(1510.5);
  });
  it("sem produção (linha única) mantém o motivo", () => {
    const r = resumirLancamentos([{ status: "sem_producao", quantidade_produzida: 0, motivo_sem_producao: "sem_programacao", produtos: null }]);
    expect(r).toMatchObject({ estadoPeriodo: "sem_producao", motivoSemProducao: "sem_programacao", lancamentos: 1 });
  });
  it("juntarProdutoNome ignora vazios e repetidos", () => {
    expect(juntarProdutoNome(null, "A")).toBe("A");
    expect(juntarProdutoNome("A", "A")).toBe("A");
    expect(juntarProdutoNome("A", "B")).toBe("A + B");
    expect(juntarProdutoNome("A + B", "B")).toBe("A + B");
    expect(juntarProdutoNome(null, null)).toBeNull();
  });
});

describe("mensagens do formulário para as novas regras", () => {
  it("duplicata, sem produção e produção em máquina sem produção têm texto claro", () => {
    expect(mensagemErroRegistrarLancamento("Já existe um lançamento da máquina x neste período (m2 de 2026-11-07) com o mesmo produto e operador — edite o existente")).toMatch(/mesmo produto e operador/);
    expect(mensagemErroRegistrarLancamento("APONTAMENTO_MAQUINA_COM_PRODUCAO: a máquina já tem produção")).toMatch(/já tem produção/);
    expect(mensagemErroRegistrarLancamento("APONTAMENTO_MAQUINA_SEM_PRODUCAO: a máquina está marcada")).toMatch(/sem produção/);
    expect(mensagemErroRegistrarLancamento('duplicate key value violates unique constraint "uq_apontamentos_producao_linha"')).toMatch(/mesmo produto e operador/);
    expect(mensagemErroRegistrarLancamento('Já existe um apontamento "sem produção" para a máquina x')).toMatch(/sem produção/);
  });
});
