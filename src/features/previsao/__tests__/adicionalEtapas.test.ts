import { describe, it, expect } from "vitest";
import type { SugestaoWip } from "@/features/escala/sugestaoWip";
import {
  acabadoDe, alterado, errosDeEtapas, estoqueEntreEtapas, linhasSugestaoWip, payloadEtapas, preencherComSugestao,
  rascunhoSalvo, resumirConfirmacaoWip, temErro, valoresSalvosDoItem, type EtapaRef,
} from "../adicionalEtapas";

const ETAPAS: EtapaRef[] = [{ id: "e1", nome: "Corte" }, { id: "e2", nome: "Costura" }, { id: "e3", nome: "Acabamento" }];
const etapasDe = (p: string) => (p === "p" || p === "q" ? ETAPAS : []);

describe("adicional por etapa — valores salvos", () => {
  it("sem linhas por etapa, o adicional do item vale igual para todas as etapas (leitura do motor)", () => {
    expect(valoresSalvosDoItem({ id: "i", produtoId: "p", quantidadeAdicional: 40 }, ETAPAS)).toEqual({ e1: "40", e2: "40", e3: "40" });
  });
  it("com linhas por etapa, etapa sem valor = 0", () => {
    expect(valoresSalvosDoItem({ id: "i", produtoId: "p", quantidadeAdicional: 10, adicionalPorEtapa: { e1: 100, e3: 10 } }, ETAPAS)).toEqual({ e1: "100", e2: "0", e3: "10" });
  });
});

describe("adicional por etapa — validação (espelha o servidor)", () => {
  it("etapa seguinte não pode passar da anterior", () => {
    const erros = errosDeEtapas(ETAPAS, { e1: "100", e2: "120", e3: "50" });
    expect(Object.keys(erros)).toEqual(["e2"]);
  });
  it("estoque intermediário válido (decrescente) não tem erro", () => {
    expect(errosDeEtapas(ETAPAS, { e1: "100", e2: "70", e3: "70" })).toEqual({});
  });
  it("negativo e texto inválido são erro; vazio conta como zero", () => {
    expect(Object.keys(errosDeEtapas(ETAPAS, { e1: "-1", e2: "0", e3: "0" }))).toEqual(["e1"]);
    expect(Object.keys(errosDeEtapas(ETAPAS, { e1: "abc", e2: "0", e3: "0" }))).toEqual(["e1"]);
    expect(errosDeEtapas(ETAPAS, { e1: "", e2: "", e3: "" })).toEqual({});
  });
  it("estoque entre etapas = A_k − A_(k+1); acabado = última etapa", () => {
    const v = { e1: "100", e2: "70", e3: "50" };
    expect(estoqueEntreEtapas(ETAPAS, v)).toEqual([{ deEtapaId: "e1", paraEtapaId: "e2", pecas: 30 }, { deEtapaId: "e2", paraEtapaId: "e3", pecas: 20 }]);
    expect(acabadoDe(ETAPAS, v)).toBe(50);
  });
});

describe("adicional por etapa — rascunho, alteração e payload", () => {
  const itens = [{ id: "i1", produtoId: "p", quantidadeAdicional: 0 }, { id: "i2", produtoId: "q", quantidadeAdicional: 5, adicionalPorEtapa: { e1: 9, e2: 7, e3: 5 } }];
  it("rascunho salvo não está alterado nem com erro", () => {
    const r = rascunhoSalvo(itens, etapasDe);
    expect(alterado(itens, etapasDe, r)).toBe(false);
    expect(temErro(itens, etapasDe, r)).toBe(false);
  });
  it("editar uma etapa marca alterado; payload leva todas as etapas com números", () => {
    const r = rascunhoSalvo(itens, etapasDe);
    r.i1 = { e1: "30", e2: "20", e3: "20" };
    expect(alterado(itens, etapasDe, r)).toBe(true);
    expect(payloadEtapas(itens, etapasDe, r).i1).toEqual({ e1: 30, e2: 20, e3: 20 });
    r.i1.e2 = "40";
    expect(temErro(itens, etapasDe, r)).toBe(true);
  });
});

function sugestao(): SugestaoWip {
  return {
    itens: [
      { produtoId: "p", etapaId: "e1", ordem: 1, quantidade: 100, tipo: "intermediario", maquinas: ["m1"], estoquePecas: 30, proximaEtapaId: "e2" },
      { produtoId: "p", etapaId: "e2", ordem: 2, quantidade: 70, tipo: "intermediario", maquinas: ["m2"], estoquePecas: 0, proximaEtapaId: "e3" },
      { produtoId: "p", etapaId: "e3", ordem: 3, quantidade: 70, tipo: "acabado", maquinas: ["m3"], estoquePecas: 0, proximaEtapaId: null },
    ],
    porProduto: [{ produtoId: "p", acabado: 70, estoque: [{ etapaId: "e1", proximaEtapaId: "e2", pecas: 30 }], estoqueTotal: 30, valorPotencial: 700, coberturaSemEle: { percentual: 80, pessoasPeriodoSemPosto: 5, horasSemPosto: 10 } }],
    acabadoTotal: 70, estoqueTotal: 30, valorPotencial: 700,
    antes: { percentual: 70, pessoasPeriodoSemPosto: 9, horasSemPosto: 20 },
    depois: { percentual: 95.5, pessoasPeriodoSemPosto: 1, horasSemPosto: 2 },
    iteracoes: 2,
  };
}

describe("adicional por etapa — sugestão", () => {
  it("preencher zera tudo e usa a sugestão por etapa; produto fora da sugestão fica 0", () => {
    const itens = [{ id: "i1", produtoId: "p" }, { id: "i2", produtoId: "q", quantidadeAdicional: 9 }];
    const r = preencherComSugestao(itens, etapasDe, sugestao());
    expect(r.i1).toEqual({ e1: "100", e2: "70", e3: "70" });
    expect(r.i2).toEqual({ e1: "0", e2: "0", e3: "0" });
    expect(temErro(itens, etapasDe, r)).toBe(false);
  });
  it("produto em dois itens: só o primeiro recebe", () => {
    const itens = [{ id: "a", produtoId: "p" }, { id: "b", produtoId: "p" }];
    const r = preencherComSugestao(itens, etapasDe, sugestao());
    expect(r.a.e1).toBe("100");
    expect(r.b.e1).toBe("0");
  });
  it("linhas: produto, etapa, máquina, quantidade e destino (acabado × estoque aguardando a próxima etapa)", () => {
    const nomes: Record<string, string> = { e1: "Corte", e2: "Costura", e3: "Acabamento" };
    const l = linhasSugestaoWip(sugestao(), () => "Caixa", (id) => nomes[id], (id) => `Máq ${id}`);
    expect(l.map((x) => x.destino)).toEqual(["Estoque intermediário (aguardando Costura)", "Etapa intermediária (alimenta Acabamento, sem estoque parado)", "Produto acabado"]);
    expect(l[0]).toMatchObject({ produto: "Caixa", etapa: "Corte", maquinas: ["Máq m1"], quantidade: 100 });
  });
  it("confirmação mostra cobertura antes → depois e o que ainda sobra sem posto", () => {
    const r = resumirConfirmacaoWip(sugestao(), () => "Caixa");
    expect(r.linhas[0]).toContain("70 peças de produto acabado");
    expect(r.linhas[0]).toContain("30 peças de estoque intermediário");
    expect(r.linhas[1]).toContain("70,0% → 95,5%");
    expect(r.linhas[2]).toContain("1 pessoas-período");
    expect(r.produtos).toEqual([{ produtoId: "p", nome: "Caixa", acabado: 70, estoque: 30 }]);
  });
});
