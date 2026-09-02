import { describe, it, expect } from "vitest";
import {
  ordenarMaquinasPorNome, encontrarProdutosQueUsamMaquina, criarMaquina, atualizarMaquina, alternarMaquinaAtiva, removerMaquina,
} from "@/features/maquinas/calculations";
import { calcularMaquinasDaEtapa } from "@/features/capacidade/calculations";
import { analisarIntegridadeRoteiro } from "@/features/produtos/calculations";
import type { Maquina, Produto } from "@/types/domain";

function maquina(over: Partial<Maquina> & Pick<Maquina, "id" | "nome" | "operacao">): Maquina {
  return { ativo: true, ...over };
}

function produto(over: Partial<Produto> & Pick<Produto, "id" | "nome">): Produto {
  return { referencia: "", valorUnitario: 0, ativo: true, prioridade: "media", roteiro: [], ...over };
}

// ---- Caso A — criar máquina ----
describe("Caso A — criar máquina", () => {
  it("criarMaquina adiciona ao array com id novo e ativo=true", () => {
    const depois = criarMaquina([], { nome: "Torno 1", operacao: "Torno CNC" });
    expect(depois).toHaveLength(1);
    expect(depois[0].nome).toBe("Torno 1");
    expect(depois[0].ativo).toBe(true);
    expect(typeof depois[0].id).toBe("string");
    expect(depois[0].id.length).toBeGreaterThan(0);
  });
});

// ---- Caso B — editar preservando ID ----
describe("Caso B — editar máquina preservando ID", () => {
  it("atualizarMaquina mantém o mesmo id e o mesmo ativo, troca só os campos editados", () => {
    const original = maquina({ id: "m1", nome: "Torno 1", operacao: "Torno CNC", ativo: false });
    const depois = atualizarMaquina([original], "m1", { nome: "Torno 1 (revisado)", operacao: "Fresagem" });
    expect(depois[0].id).toBe("m1");
    expect(depois[0].nome).toBe("Torno 1 (revisado)");
    expect(depois[0].operacao).toBe("Fresagem");
    expect(depois[0].ativo).toBe(false); // ativo não é tocado pela edição
  });
});

// ---- Caso C — renomear sem quebrar Produto/Previsão ----
describe("Caso C — renomear máquina sem quebrar Produto/Previsão", () => {
  it("renomear não muda o id — relação por maquinasIds continua encontrando a máquina", () => {
    const maquinas = [maquina({ id: "m1", nome: "Torno 1", operacao: "Torno CNC" })];
    const renomeadas = atualizarMaquina(maquinas, "m1", { nome: "Torno Principal", operacao: "Torno CNC" });
    expect(renomeadas.find((m) => m.id === "m1")?.nome).toBe("Torno Principal");
    // etapa.maquinasIds guarda o id, nunca o nome — renomear a máquina não
    // quebra a elegibilidade calculada por calcularMaquinasDaEtapa
    const etapa = { maquinasIds: ["m1"], operacao: "Torno CNC" };
    expect(calcularMaquinasDaEtapa(etapa, renomeadas)).toEqual(["m1"]);
  });
});

// ---- Caso D — ativar/inativar ----
describe("Caso D — ativar/inativar máquina", () => {
  it("alternarMaquinaAtiva alterna entre true/false sem remover do array", () => {
    const maquinas = [maquina({ id: "m1", nome: "Torno 1", operacao: "Torno CNC", ativo: true })];
    const pausada = alternarMaquinaAtiva(maquinas, "m1");
    expect(pausada[0].ativo).toBe(false);
    const reativada = alternarMaquinaAtiva(pausada, "m1");
    expect(reativada[0].ativo).toBe(true);
  });
});

// ---- Caso E — produto relacionado por maquinasIds ----
describe("Caso E — produto relacionado à máquina por maquinasIds", () => {
  it("encontrarProdutosQueUsamMaquina descobre o relacionamento só por ID, nunca por nome/operação", () => {
    const produtos = [
      produto({
        id: "p1", nome: "Peça A",
        roteiro: [{ id: "e1", operacao: "Torno CNC", metas: { m1: 1, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: ["m1"] }],
      }),
    ];
    expect(encontrarProdutosQueUsamMaquina("m1", produtos)).toHaveLength(1);
    expect(encontrarProdutosQueUsamMaquina("m1", produtos)[0].produto.id).toBe("p1");
    expect(encontrarProdutosQueUsamMaquina("m2", produtos)).toHaveLength(0);
  });
});

// ---- Caso F — produtosQueUsamMaquina (múltiplas etapas/produtos) ----
describe("Caso F — encontrarProdutosQueUsamMaquina com múltiplos produtos e etapas", () => {
  it("retorna todas as etapas de um produto que usam a máquina, e ignora produtos que não usam", () => {
    const produtos = [
      produto({
        id: "p1", nome: "Peça A",
        roteiro: [
          { id: "e1", operacao: "Torno CNC", metas: { m1: 1, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: ["m1"] },
          { id: "e2", operacao: "Solda", metas: { m1: 1, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: ["m1", "m2"] },
        ],
      }),
      produto({ id: "p2", nome: "Peça B", roteiro: [{ id: "e3", operacao: "Solda", metas: { m1: 1, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: ["m2"] }] }),
    ];
    const usosM1 = encontrarProdutosQueUsamMaquina("m1", produtos);
    expect(usosM1).toHaveLength(1);
    expect(usosM1[0].etapas.map((e) => e.id)).toEqual(["e1", "e2"]);
    const usosM2 = encontrarProdutosQueUsamMaquina("m2", produtos);
    expect(usosM2.map((u) => u.produto.id)).toEqual(["p1", "p2"]);
  });
});

// ---- Caso G — máquina não utilizada por produto ----
describe("Caso G — máquina não utilizada por nenhum produto", () => {
  it("encontrarProdutosQueUsamMaquina retorna array vazio", () => {
    const produtos = [produto({ id: "p1", nome: "Peça A", roteiro: [] })];
    expect(encontrarProdutosQueUsamMaquina("m-sem-uso", produtos)).toEqual([]);
  });
});

// ---- Caso H — máquina inativa ----
describe("Caso H — máquina inativa", () => {
  it("calcularMaquinasDaEtapa nunca oferece máquina inativa, mesmo marcada explicitamente no roteiro", () => {
    const maquinas = [maquina({ id: "m1", nome: "Torno 1", operacao: "Torno CNC", ativo: false })];
    const etapa = { maquinasIds: ["m1"], operacao: "Torno CNC" };
    expect(calcularMaquinasDaEtapa(etapa, maquinas)).toEqual([]);
  });
  it("máquina inativa continua existindo no cadastro (ordenarMaquinasPorNome não filtra)", () => {
    const maquinas = [maquina({ id: "m1", nome: "Torno 1", operacao: "Torno CNC", ativo: false })];
    expect(ordenarMaquinasPorNome(maquinas)).toHaveLength(1);
  });
});

// ---- Caso I — máquina referenciada por produto e depois inativada ----
describe("Caso I — máquina referenciada por produto, depois inativada", () => {
  it("a referência em produto.roteiro é preservada, mas a máquina some da elegibilidade calculada", () => {
    const produtos = [
      produto({
        id: "p1", nome: "Peça A",
        roteiro: [{ id: "e1", operacao: "Torno CNC", metas: { m1: 1, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: ["m1"] }],
      }),
    ];
    let maquinas = [maquina({ id: "m1", nome: "Torno 1", operacao: "Torno CNC", ativo: true })];
    expect(encontrarProdutosQueUsamMaquina("m1", produtos)).toHaveLength(1); // referência continua visível
    maquinas = alternarMaquinaAtiva(maquinas, "m1"); // inativa
    expect(encontrarProdutosQueUsamMaquina("m1", produtos)).toHaveLength(1); // ainda referenciada (não é apagado)
    const etapa = produtos[0].roteiro[0];
    expect(calcularMaquinasDaEtapa(etapa, maquinas)).toEqual([]); // mas não é mais elegível
    const integridade = analisarIntegridadeRoteiro(produtos[0].roteiro, maquinas);
    expect(integridade[0].maquinasInativas).toEqual(["m1"]);
  });
});

// ---- Caso J — mudança de operação causando incompatibilidade ----
describe("Caso J — mudança de operação da máquina causando incompatibilidade no roteiro", () => {
  it("atualizarMaquina troca a operação; calcularMaquinasDaEtapa (seleção explícita) continua aceitando a máquina, mas analisarIntegridadeRoteiro sinaliza a divergência", () => {
    let maquinas = [maquina({ id: "m1", nome: "Torno 1", operacao: "Torno CNC" })];
    const roteiro = [{ id: "e1", operacao: "Torno CNC", metas: { m1: 1, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: ["m1"] }];
    // antes da mudança: tudo consistente
    expect(analisarIntegridadeRoteiro(roteiro, maquinas)[0].maquinasOperacaoDivergente).toEqual([]);

    // usuário edita a máquina e muda a operação
    maquinas = atualizarMaquina(maquinas, "m1", { nome: "Torno 1", operacao: "Fresagem" });

    // COMPORTAMENTO ATUAL: calcularMaquinasDaEtapa não invalida uma seleção
    // explícita em maquinasIds por causa da operação — continua elegível
    expect(calcularMaquinasDaEtapa(roteiro[0], maquinas)).toEqual(["m1"]);
    // mas a integridade do roteiro agora sinaliza a divergência
    expect(analisarIntegridadeRoteiro(roteiro, maquinas)[0].maquinasOperacaoDivergente).toEqual(["m1"]);
  });
});

// ---- Caso K — exclusão conforme comportamento atual ----
describe("Caso K — exclusão de máquina (hard delete, comportamento atual)", () => {
  it("removerMaquina remove do array; referências em produto.roteiro ficam órfãs (maquinasInexistentes)", () => {
    const maquinas = [maquina({ id: "m1", nome: "Torno 1", operacao: "Torno CNC" }), maquina({ id: "m2", nome: "Torno 2", operacao: "Torno CNC" })];
    const depois = removerMaquina(maquinas, "m1");
    expect(depois.map((m) => m.id)).toEqual(["m2"]);

    const roteiro = [{ id: "e1", operacao: "Torno CNC", metas: { m1: 1, m2: 0, m3: 0, t1: 0, t2: 0, t3: 0 }, maquinasIds: ["m1", "m2"] }];
    const integridade = analisarIntegridadeRoteiro(roteiro, depois);
    expect(integridade[0].maquinasInexistentes).toEqual(["m1"]);
  });
});

// ---- Caso L — elegibilidade em Previsão após a correção da Parte 1 ----
describe("Caso L — elegibilidade de máquina na Previsão (Parte 1)", () => {
  it("roteiro com 2 das 3 máquinas da operação -> só essas 2 ficam elegíveis pra seleção semanal", () => {
    const maquinas = [
      maquina({ id: "m1", nome: "Torno 1", operacao: "Torno CNC" }),
      maquina({ id: "m2", nome: "Torno 2", operacao: "Torno CNC" }),
      maquina({ id: "m3", nome: "Torno 3", operacao: "Torno CNC" }), // fora do roteiro
    ];
    const etapa = { maquinasIds: ["m1", "m2"], operacao: "Torno CNC" };
    const elegiveis = calcularMaquinasDaEtapa(etapa, maquinas);
    expect(elegiveis).toEqual(["m1", "m2"]);
    expect(elegiveis).not.toContain("m3");
  });
});
