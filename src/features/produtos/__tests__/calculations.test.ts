import { describe, it, expect } from "vitest";
import {
  criarEtapaVazia, roteiroParaFormulario, roteiroParaPersistencia, adicionarEtapa, removerEtapa,
  trocarOperacaoEtapa, definirOperacaoEtapa, atualizarMetaEtapa, alternarMaquinaNaEtapa,
  ordenarProdutosPorLucroHora, produtoTemRoteiro, analisarIntegridadeRoteiro,
  criarProduto, atualizarProduto, alternarProdutoAtivo, removerProduto,
} from "@/features/produtos/calculations";
import type { Produto, RoteiroEtapa, Maquina } from "@/types/domain";
import type { RoteiroEtapaForm } from "@/features/produtos/types";

function maquina(over: Partial<Maquina> & Pick<Maquina, "id" | "nome" | "operacao">): Maquina {
  return { ativo: true, ...over };
}

function etapaForm(over: Partial<RoteiroEtapaForm> & Pick<RoteiroEtapaForm, "id" | "operacao">): RoteiroEtapaForm {
  return { metas: { m1: "", m2: "", m3: "", t1: "", t2: "", t3: "" }, maquinasIds: [], ...over };
}

function produto(over: Partial<Produto> & Pick<Produto, "id" | "nome">): Produto {
  return { referencia: "", valorUnitario: 0, ativo: true, prioridade: "media", roteiro: [], ...over };
}

// ---- Caso A — criar produto válido ----
describe("Caso A — criar produto válido", () => {
  it("criarProduto adiciona ao array com id novo e ativo=true", () => {
    const antes: Produto[] = [];
    const depois = criarProduto(antes, { nome: "Peça X", referencia: "PX-1", valorUnitario: 50, prioridade: "alta", roteiro: [] });
    expect(depois).toHaveLength(1);
    expect(depois[0].nome).toBe("Peça X");
    expect(depois[0].ativo).toBe(true);
    expect(typeof depois[0].id).toBe("string");
    expect(depois[0].id.length).toBeGreaterThan(0);
  });
});

// ---- Caso B — editar produto preservando ID ----
describe("Caso B — editar produto preservando ID", () => {
  it("atualizarProduto mantém o mesmo id e o mesmo ativo, troca só os campos editados", () => {
    const original = produto({ id: "p1", nome: "Peça X", ativo: false });
    const depois = atualizarProduto([original], "p1", { nome: "Peça X v2", referencia: "PX-2", valorUnitario: 99, prioridade: "baixa", roteiro: [] });
    expect(depois[0].id).toBe("p1");
    expect(depois[0].nome).toBe("Peça X v2");
    expect(depois[0].ativo).toBe(false); // ativo não é tocado pela edição
  });
});

// ---- Caso C — renomear produto sem quebrar Previsão/Capacidade ----
describe("Caso C — renomear produto sem quebrar Previsão/Capacidade", () => {
  it("renomear não muda o id — lookups por produtoId continuam encontrando o produto", () => {
    const produtos = [produto({ id: "p1", nome: "Nome antigo" })];
    const renomeados = atualizarProduto(produtos, "p1", { nome: "Nome novo", referencia: "", valorUnitario: 0, prioridade: "media", roteiro: [] });
    const encontrado = renomeados.find((p) => p.id === "p1");
    expect(encontrado?.nome).toBe("Nome novo");
    // um item de previsão já lançado guarda uma CÓPIA do nome no momento do
    // lançamento (PrevisaoItem.produtoNome) — não é uma referência viva, e
    // por isso não é afetado pelo rename (comportamento documentado em
    // types/domain.ts, exercitado aqui pra deixar explícito).
    const itemJaLancado = { produtoId: "p1", produtoNome: "Nome antigo", valorUnitario: 10, quantidade: 5 };
    expect(itemJaLancado.produtoNome).toBe("Nome antigo");
  });
});

// ---- Caso D — produto com uma etapa ----
describe("Caso D — produto com uma etapa", () => {
  it("roteiroParaPersistencia mantém uma única etapa", () => {
    const form = [etapaForm({ id: "e1", operacao: "Torno CNC" })];
    const persistido = roteiroParaPersistencia(form);
    expect(persistido).toHaveLength(1);
    expect(persistido[0].operacao).toBe("Torno CNC");
  });
});

// ---- Caso E — produto com múltiplas etapas ----
describe("Caso E — produto com múltiplas etapas", () => {
  it("roteiroParaPersistencia preserva a ordem das etapas (posição no array)", () => {
    const form = [
      etapaForm({ id: "e1", operacao: "Torno CNC" }),
      etapaForm({ id: "e2", operacao: "Solda" }),
      etapaForm({ id: "e3", operacao: "Montagem" }),
    ];
    const persistido = roteiroParaPersistencia(form);
    expect(persistido.map((e) => e.operacao)).toEqual(["Torno CNC", "Solda", "Montagem"]);
  });
});

// ---- Caso F — uma etapa com múltiplas máquinas elegíveis ----
describe("Caso F — uma etapa com múltiplas máquinas elegíveis", () => {
  it("alternarMaquinaNaEtapa acumula IDs ao marcar mais de uma máquina", () => {
    let form = [etapaForm({ id: "e1", operacao: "Torno CNC" })];
    form = alternarMaquinaNaEtapa(form, "e1", "m1");
    form = alternarMaquinaNaEtapa(form, "e1", "m2");
    expect(form[0].maquinasIds).toEqual(["m1", "m2"]);
  });
});

// ---- Caso G — remoção de máquina do roteiro ----
describe("Caso G — remoção de máquina do roteiro", () => {
  it("alternarMaquinaNaEtapa remove o ID quando ele já estava marcado", () => {
    let form = [etapaForm({ id: "e1", operacao: "Torno CNC", maquinasIds: ["m1", "m2"] })];
    form = alternarMaquinaNaEtapa(form, "e1", "m1");
    expect(form[0].maquinasIds).toEqual(["m2"]);
  });
  it("trocarOperacaoEtapa reseta as máquinas selecionadas (dependem da operação)", () => {
    let form = [etapaForm({ id: "e1", operacao: "Torno CNC", maquinasIds: ["m1", "m2"] })];
    form = trocarOperacaoEtapa(form, "e1", "Solda");
    expect(form[0].maquinasIds).toEqual([]);
  });
  it("COMPORTAMENTO ATUAL: definirOperacaoEtapa (fluxo 'nova operação') NÃO reseta as máquinas — inconsistente com trocarOperacaoEtapa, preservado", () => {
    let form = [etapaForm({ id: "e1", operacao: "Torno CNC", maquinasIds: ["m1", "m2"] })];
    form = definirOperacaoEtapa(form, "e1", "Rosquear");
    expect(form[0].maquinasIds).toEqual(["m1", "m2"]);
  });
});

// ---- Caso H — produto sem etapas ----
describe("Caso H — produto sem etapas", () => {
  it("produtoTemRoteiro é false pra roteiro vazio ou ausente", () => {
    expect(produtoTemRoteiro({ roteiro: [] })).toBe(false);
    expect(produtoTemRoteiro({ roteiro: undefined as unknown as RoteiroEtapa[] })).toBe(false);
  });
  it("analisarIntegridadeRoteiro de um roteiro vazio não gera nenhum problema", () => {
    expect(analisarIntegridadeRoteiro([], [])).toEqual([]);
  });
});

// ---- Caso I — referência a máquina inexistente ----
describe("Caso I — referência a máquina inexistente, conforme comportamento atual", () => {
  it("analisarIntegridadeRoteiro identifica IDs em maquinasIds sem Maquina correspondente", () => {
    const roteiro: RoteiroEtapa[] = [
      { id: "e1", operacao: "Torno CNC", metas: { m1: 0, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: ["m1", "m-excluida"] },
    ];
    const maquinas = [maquina({ id: "m1", nome: "Torno 1", operacao: "Torno CNC" })];
    const resultado = analisarIntegridadeRoteiro(roteiro, maquinas);
    expect(resultado[0].maquinasInexistentes).toEqual(["m-excluida"]);
  });
  it("analisarIntegridadeRoteiro identifica máquina que existe mas está inativa", () => {
    const roteiro: RoteiroEtapa[] = [
      { id: "e1", operacao: "Torno CNC", metas: { m1: 0, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: ["m1"] },
    ];
    const maquinas = [maquina({ id: "m1", nome: "Torno 1", operacao: "Torno CNC", ativo: false })];
    const resultado = analisarIntegridadeRoteiro(roteiro, maquinas);
    expect(resultado[0].maquinasInativas).toEqual(["m1"]);
    expect(resultado[0].maquinasInexistentes).toEqual([]);
  });
  it("analisarIntegridadeRoteiro sinaliza etapa sem operação e sem máquinas", () => {
    const roteiro: RoteiroEtapa[] = [
      { id: "e1", operacao: "", metas: { m1: 0, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: [] },
    ];
    const resultado = analisarIntegridadeRoteiro(roteiro, []);
    expect(resultado[0].semOperacao).toBe(true);
    expect(resultado[0].semMaquinas).toBe(true);
  });
  it("analisarIntegridadeRoteiro identifica máquina ativa cuja operação mudou e não bate mais com a etapa", () => {
    const roteiro: RoteiroEtapa[] = [
      { id: "e1", operacao: "Torno CNC", metas: { m1: 0, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: ["m1"] },
    ];
    // m1 foi cadastrada em "Torno CNC" e ficou elegível nesse roteiro; depois
    // alguém editou a máquina e trocou a operação pra "Fresagem" — a máquina
    // continua ativa e existindo, só não bate mais com a etapa.
    const maquinasDepoisDaEdicao = [maquina({ id: "m1", nome: "Torno 1", operacao: "Fresagem", ativo: true })];
    const resultado = analisarIntegridadeRoteiro(roteiro, maquinasDepoisDaEdicao);
    expect(resultado[0].maquinasOperacaoDivergente).toEqual(["m1"]);
    expect(resultado[0].maquinasInativas).toEqual([]);
    expect(resultado[0].maquinasInexistentes).toEqual([]);
  });
});

// ---- Caso J — alteração de valor unitário refletindo nos cálculos que dependem dele ----
describe("Caso J — alteração de valor unitário", () => {
  it("atualizarProduto troca o valorUnitario, e ordenarProdutosPorLucroHora reordena de acordo com um getLucroHora que depende dele", () => {
    const produtos = [
      produto({ id: "a", nome: "A", valorUnitario: 10, roteiro: [{ id: "e1", operacao: "X", metas: { m1: 1, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: [] }] }),
      produto({ id: "b", nome: "B", valorUnitario: 100, roteiro: [{ id: "e2", operacao: "X", metas: { m1: 1, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: [] }] }),
    ];
    const getLucroHora = (p: Produto) => p.valorUnitario; // simplificação só pra exercitar a dependência
    expect(ordenarProdutosPorLucroHora(produtos, getLucroHora).map((p) => p.id)).toEqual(["b", "a"]);

    const aAtualizado = atualizarProduto(produtos, "a", { nome: "A", referencia: "", valorUnitario: 500, prioridade: "media", roteiro: produtos[0].roteiro });
    expect(ordenarProdutosPorLucroHora(aAtualizado, getLucroHora).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

// ---- Caso K — alteração da ordem das etapas, se suportada ----
describe("Caso K — ordem das etapas", () => {
  it("hoje não existe reordenação — só adicionar (sempre no fim) e remover; roteiroParaFormulario/Persistencia preservam a ordem dada", () => {
    const roteiro: RoteiroEtapa[] = [
      { id: "e1", operacao: "A", metas: { m1: 0, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: [] },
      { id: "e2", operacao: "B", metas: { m1: 0, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: [] },
    ];
    const form = roteiroParaFormulario(roteiro);
    expect(form.map((e) => e.operacao)).toEqual(["A", "B"]);
    const comEtapaNova = adicionarEtapa(form, "C");
    expect(comEtapaNova.map((e) => e.operacao)).toEqual(["A", "B", "C"]); // sempre entra no fim
    const semPrimeira = removerEtapa(comEtapaNova, comEtapaNova[0].id);
    expect(semPrimeira.map((e) => e.operacao)).toEqual(["B", "C"]);
  });
});

// ---- Caso L — produto inativo/excluído, conforme comportamento atual ----
describe("Caso L — produto inativo/excluído", () => {
  it("alternarProdutoAtivo alterna entre true/false sem remover do array", () => {
    const produtos = [produto({ id: "p1", nome: "P1", ativo: true })];
    const pausado = alternarProdutoAtivo(produtos, "p1");
    expect(pausado[0].ativo).toBe(false);
    const reativado = alternarProdutoAtivo(pausado, "p1");
    expect(reativado[0].ativo).toBe(true);
  });
  it("removerProduto é destrutivo (hard delete) — comportamento atual preservado, não recomendado pro banco", () => {
    const produtos = [produto({ id: "p1", nome: "P1" }), produto({ id: "p2", nome: "P2" })];
    const depois = removerProduto(produtos, "p1");
    expect(depois.map((p) => p.id)).toEqual(["p2"]);
  });
});

// ---- extras: criarEtapaVazia / round-trip formulário↔persistência ----
describe("criarEtapaVazia e round-trip formulário/persistência", () => {
  it("criarEtapaVazia usa a operação padrão e metas/maquinasIds vazios", () => {
    const etapa = criarEtapaVazia("Torno CNC");
    expect(etapa.operacao).toBe("Torno CNC");
    expect(etapa.maquinasIds).toEqual([]);
    expect(etapa.metas.m1).toBe("");
  });
  it("roteiroParaFormulario → roteiroParaPersistencia preserva id, operação, metas numéricas e maquinasIds", () => {
    const roteiro: RoteiroEtapa[] = [
      { id: "e1", operacao: "Torno CNC", metas: { m1: 5, m2: 3, m3: 0, t1: 2, t2: 0, t3: 0 }, maquinasIds: ["m1"] },
    ];
    const form = roteiroParaFormulario(roteiro);
    expect(form[0].metas.m1).toBe("5");
    const persistido = roteiroParaPersistencia(form);
    expect(persistido).toEqual(roteiro);
  });
  it("roteiroParaPersistencia descarta etapas sem operação selecionada", () => {
    const form = [etapaForm({ id: "e1", operacao: "" }), etapaForm({ id: "e2", operacao: "Solda" })];
    const persistido = roteiroParaPersistencia(form);
    expect(persistido).toHaveLength(1);
    expect(persistido[0].operacao).toBe("Solda");
  });
  it("atualizarMetaEtapa troca só a meta do período informado", () => {
    let form = [etapaForm({ id: "e1", operacao: "Torno CNC" })];
    form = atualizarMetaEtapa(form, "e1", "m2", "12");
    expect(form[0].metas.m2).toBe("12");
    expect(form[0].metas.m1).toBe("");
  });
});
