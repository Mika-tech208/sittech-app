import { describe, expect, it } from "vitest";
import type { AlocacaoPlano, ApontamentoExistente, Catalogo, LinhaApontamento, VinculoSalvo } from "../tipos";
import { postosProgramados, linhasIniciais } from "../prefill";
import { adicionarExtra, desfazerNaoProduziu, editarDescricao, editarReal, escolherMotivo, etapaDoPar, informarQuantidades, marcarNaoProduziu, operacaoDaLinha, produtosDaMaquina, removerExtra } from "../linhas";
import { alteradoDoPlanejado, divergencias } from "../diff";
import { MOTIVOS_NAO_PRODUZIU, motivoDoBanco, paraSemProducao } from "../motivos";
import { bloqueiosParaSalvar, completude, linhaEmBranco, linhaIniciada, paraRpc, problemasDaLinha, problemasDoConjunto } from "../validacao";
import { lerLinhas } from "../payload";
import { estadoDosPassos } from "../passos";
import { lerModoApontamentoSimplificado } from "../modo";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CAT: Catalogo = {
  maquinas: [{ id: "m3", nome: "Rosqueadeira 3" }, { id: "m6", nome: "Rosqueadeira 6" }, { id: "m10", nome: "Parafusadeira 10" }, { id: "m15", nome: "Etiquetadora 15" }],
  funcionarios: [{ id: "f1", nome: "Caroline Souza" }, { id: "f2", nome: "Elizabeth Lima" }, { id: "f3", nome: "Samantha Reis" }],
  produtos: [{ id: "pA", nome: "Conector 3/4" }, { id: "pB", nome: "Caixa Amarela" }],
  operacoes: { oRq: "Rosquear", oPf: "Parafusar", oEt: "Etiquetar" },
  elegibilidade: [
    { maquinaId: "m3", produtoId: "pA", etapaId: "e1", operacaoId: "oRq" }, { maquinaId: "m6", produtoId: "pA", etapaId: "e1", operacaoId: "oRq" },
    { maquinaId: "m6", produtoId: "pB", etapaId: "e2", operacaoId: "oRq" }, { maquinaId: "m10", produtoId: "pA", etapaId: "e3", operacaoId: "oPf" },
    { maquinaId: "m15", produtoId: "pA", etapaId: "e4", operacaoId: "oEt" }, { maquinaId: "m15", produtoId: "pA", etapaId: "e5", operacaoId: "oEt" },   // ambíguo de propósito
  ],
};
const ALOC: AlocacaoPlano[] = [
  { maquinaId: "m6", funcionarioId: "f2", produtoId: "pA", etapaId: "e1", operacaoId: "oRq", pecas: 1546 },
  { maquinaId: "m3", funcionarioId: "f1", produtoId: "pA", etapaId: "e1", operacaoId: "oRq", pecas: 1500, pecasAdicional: 47 },
  { maquinaId: "m10", funcionarioId: "f3", produtoId: "pA", etapaId: "e3", operacaoId: "oPf", pecas: 1200 },
  { maquinaId: null, funcionarioId: "f9", produtoId: null, etapaId: null, operacaoId: null, pecas: 0 },            // pessoa sem posto: não é posto programado
];
let seq = 0; const chave = () => U(++seq);
const iniciais = (ex: ApontamentoExistente[] = [], v: VinculoSalvo[] = []) => linhasIniciais(postosProgramados(ALOC, CAT), ex, v, chave);
const por = (ls: LinhaApontamento[], maq: string) => ls.find((l) => l.planejado?.maquinaId === maq) as LinhaApontamento;

describe("PASSO 1 — pré-preenchimento pela escala", () => {
  it("mostra SÓ os postos programados do período (sem a pessoa sem posto e sem máquinas não programadas), em ordem de nome", () => {
    const ls = iniciais();
    expect(ls.map((l) => l.planejado?.maquinaNome)).toEqual(["Parafusadeira 10", "Rosqueadeira 3", "Rosqueadeira 6"]);
    expect(ls.every((l) => l.origem === "PROGRAMADO" && l.situacao === "NOVA")).toBe(true);
  });
  it("pré-preenche máquina, operador, produto e operação; a pessoa só informa produzido e refugo", () => {
    const l = por(iniciais(), "m3");
    expect(l.real).toEqual({ maquinaId: "m3", funcionarioId: "f1", produtoId: "pA" });
    expect(l.planejado).toMatchObject({ funcionarioNome: "Caroline Souza", produtoNome: "Conector 3/4", operacaoNome: "Rosquear", pecas: 1547 });   // pecas + adicional
    expect(operacaoDaLinha(CAT, l)?.nome).toBe("Rosquear");
    expect(l.produzido).toBeNull(); expect(l.refugo).toBeNull();
  });
  it("alocações duplicadas na mesma máquina (não deveria existir): fica a de maior carga, determinístico", () => {
    const p = postosProgramados([...ALOC, { maquinaId: "m3", funcionarioId: "f3", produtoId: "pA", etapaId: "e1", operacaoId: "oRq", pecas: 9000 }], CAT);
    expect(p.filter((x) => x.maquinaId === "m3")).toHaveLength(1);
    expect(p.find((x) => x.maquinaId === "m3")?.funcionarioId).toBe("f3");
  });
  it("apontamento já lançado no painel volta bloqueado (EXISTENTE_PAINEL) e conta como resolvido; um sobrando vira extra", () => {
    const ex: ApontamentoExistente[] = [
      { id: "maq:m6", maquinaId: "m6", funcionarioId: "f2", produtoId: "pA", operacaoId: "oRq", produzido: 900, refugo: 3, status: "produzindo", motivoSemProducao: null, descricaoSemProducao: null },
      { id: "maq:m15", maquinaId: "m15", funcionarioId: "f1", produtoId: "pA", operacaoId: "oEt", produzido: 100, refugo: 0, status: "produzindo", motivoSemProducao: null, descricaoSemProducao: null },
    ];
    const ls = iniciais(ex);
    expect(por(ls, "m6")).toMatchObject({ situacao: "EXISTENTE_PAINEL", produzido: 900, refugo: 3 });
    const extra = ls.find((l) => l.origem === "POSTO_NAO_PLANEJADO") as LinhaApontamento;
    expect(extra).toMatchObject({ situacao: "EXISTENTE_PAINEL", real: { maquinaId: "m15" } });
    expect(editarReal(por(ls, "m6"), { funcionarioId: "f3" }, CAT)).toBe(por(ls, "m6"));       // lançado no painel: o fluxo não altera
    expect(completude(ls, CAT).pendentes.map((l) => l.planejado?.maquinaId)).toEqual(["m10", "m3"]);
  });
  it("gravado por este fluxo volta editável com a máquina REAL trocada e a descrição informada", () => {
    const ex: ApontamentoExistente[] = [{ id: "maq:m10", maquinaId: "m10", funcionarioId: null, produtoId: null, operacaoId: null, produzido: 0, refugo: 0, status: "sem_producao", motivoSemProducao: "outro", descricaoSemProducao: "Parada de máquina: correia" }];
    const v: VinculoSalvo[] = [{ apontamentoId: "maq:m10", origem: "PROGRAMADO", maquinaPlanejadaId: "m3", divergencias: ["MAQUINA"], naoProduziu: true, motivo: "PARADA", linhaChave: U(77), descricaoInformada: "correia" }];
    const l = por(iniciais(ex, v), "m3");
    expect(l).toMatchObject({ situacao: "SALVA_FLUXO", chave: U(77), naoProduziu: true, motivo: "PARADA", descricao: "correia", real: { maquinaId: "m10" } });
    expect(l.planejado?.maquinaId).toBe("m3");
    expect(por(iniciais(ex, v), "m10").situacao).toBe("NOVA");   // o posto m10 programado continua pendente: a linha gravada pertence ao m3
  });
});

describe("TUDO editável + planejado preservado (planejado × real)", () => {
  it("troca máquina, operador e produto sem bloquear; o planejado é a MESMA referência congelada", () => {
    const l0 = por(iniciais(), "m3");
    const plan = l0.planejado;
    let l = editarReal(l0, { maquinaId: "m6" }, CAT);
    l = editarReal(l, { funcionarioId: "f3" }, CAT);
    l = editarReal(l, { produtoId: "pB" }, CAT);
    l = informarQuantidades(l, { produzido: 700, refugo: 5 });
    expect(l.real).toEqual({ maquinaId: "m6", funcionarioId: "f3", produtoId: "pB" });
    expect(l.planejado).toBe(plan);
    expect(Object.isFrozen(l.planejado)).toBe(true);
    expect(l.planejado).toMatchObject({ maquinaId: "m3", funcionarioId: "f1", produtoId: "pA" });
    expect(() => { (l.planejado as { maquinaId: string }).maquinaId = "x"; }).toThrow();     // objeto congelado: nenhuma escrita acidental
    expect(divergencias(l, CAT)).toEqual(["MAQUINA", "OPERADOR", "PRODUTO"]);                   // operação rq→rq: igual
    expect(l0.real.maquinaId).toBe("m3");                                                       // imutável: a linha original não mudou
  });
  it("trocar a máquina mantém o produto se for elegível lá, senão limpa o produto (a pessoa escolhe) — nunca bloqueia", () => {
    const l0 = por(iniciais(), "m3");
    expect(editarReal(l0, { maquinaId: "m6" }, CAT).real.produtoId).toBe("pA");
    expect(editarReal(l0, { maquinaId: "m10" }, CAT).real.produtoId).toBe("pA");
    const l1 = editarReal(editarReal(editarReal(l0, { maquinaId: "m6" }, CAT), { produtoId: "pB" }, CAT), { maquinaId: "m3" }, CAT);   // pB não existe na m3
    expect(l1.real).toEqual({ maquinaId: "m3", funcionarioId: "f1", produtoId: null });
    expect(problemasDaLinha(informarQuantidades(l1, { produzido: 10 }), CAT).map((p) => p.codigo)).toContain("PRODUTO_OBRIGATORIO");
  });
  it("operação é derivada do par máquina×produto; par ambíguo ou sem etapa é sinalizado", () => {
    expect(etapaDoPar(CAT, "m10", "pA")?.operacaoId).toBe("oPf");
    expect(etapaDoPar(CAT, "m15", "pA")).toBeNull();            // 2 etapas: ambíguo (o banco recusa)
    expect(etapaDoPar(CAT, "m3", "pB")).toBeNull();
    const l = informarQuantidades(editarReal(editarReal(por(iniciais(), "m3"), { maquinaId: "m15" }, CAT), { produtoId: "pA" }, CAT), { produzido: 5 });
    expect(problemasDaLinha(l, CAT).map((p) => p.codigo)).toContain("PRODUTO_SEM_ETAPA_NA_MAQUINA");
    expect(produtosDaMaquina(CAT, "m6").map((p) => p.id)).toEqual(["pA", "pB"]);
    expect(divergencias(editarReal(por(iniciais(), "m3"), { maquinaId: "m10" }, CAT), CAT)).toEqual(["MAQUINA", "OPERACAO"]);
  });
  it("selo ALTERADO DO PLANEJADO: operador, máquina ou produto; só quantidades ou voltar ao plano não acionam", () => {
    const l = por(iniciais(), "m3");
    expect(alteradoDoPlanejado(informarQuantidades(l, { produzido: 1, refugo: 0 }), CAT)).toBe(false);
    expect(alteradoDoPlanejado(editarReal(l, { funcionarioId: "f3" }, CAT), CAT)).toBe(true);
    expect(alteradoDoPlanejado(editarReal(l, { maquinaId: "m6" }, CAT), CAT)).toBe(true);
    expect(alteradoDoPlanejado(editarReal(editarReal(l, { maquinaId: "m6" }, CAT), { produtoId: "pB" }, CAT), CAT)).toBe(true);
    expect(alteradoDoPlanejado(editarReal(editarReal(l, { funcionarioId: "f3" }, CAT), { funcionarioId: "f1" }, CAT), CAT)).toBe(false);
    expect(alteradoDoPlanejado(marcarNaoProduziu(editarReal(l, { maquinaId: "m6" }, CAT), "PARADA"), CAT)).toBe(true);   // PLANEJADO m3 / REAL m6, sem exigir NÃO PRODUZIU na m3
    expect(alteradoDoPlanejado(adicionarExtra([], U(1))[0], CAT)).toBe(false);                                          // extra não tem plano para comparar
  });
  it("sem alteração não há divergência; sem produção só compara a máquina", () => {
    const l = por(iniciais(), "m3");
    expect(divergencias(l, CAT)).toEqual([]);
    expect(divergencias(marcarNaoProduziu(editarReal(l, { funcionarioId: "f3" }, CAT), "SEM_MATERIAL"), CAT)).toEqual([]);
    expect(divergencias(marcarNaoProduziu(editarReal(l, { maquinaId: "m6" }, CAT), "SEM_MATERIAL"), CAT)).toEqual(["MAQUINA"]);
  });
});

describe("NÃO PRODUZIU + motivos → sem_producao existente", () => {
  it("botão rápido zera quantidades e exige motivo; escolher motivo completa; desfazer volta ao normal", () => {
    let l = informarQuantidades(por(iniciais(), "m3"), { produzido: 50, refugo: 1 });
    l = marcarNaoProduziu(l);
    expect(l).toMatchObject({ naoProduziu: true, produzido: null, refugo: null, motivo: null });
    expect(problemasDaLinha(l, CAT).map((p) => p.codigo)).toEqual(["MOTIVO_OBRIGATORIO"]);
    l = escolherMotivo(l, "SEM_MATERIAL");
    expect(problemasDaLinha(l, CAT)).toEqual([]);
    expect(desfazerNaoProduziu(l)).toMatchObject({ naoProduziu: false, motivo: null });
  });
  it("OUTRO exige descrição; os demais não", () => {
    let l = escolherMotivo(marcarNaoProduziu(por(iniciais(), "m3")), "OUTRO");
    expect(problemasDaLinha(l, CAT).map((p) => p.codigo)).toEqual(["DESCRICAO_OBRIGATORIA"]);
    l = editarDescricao(l, "balança quebrou");
    expect(problemasDaLinha(l, CAT)).toEqual([]);
    expect(problemasDaLinha(escolherMotivo(marcarNaoProduziu(por(iniciais(), "m3")), "PARADA"), CAT)).toEqual([]);
  });
  it("mapeamento dos 6 motivos para o CHECK do banco (5 motivos grossos) e descrição", () => {
    expect(MOTIVOS_NAO_PRODUZIU.map((m) => [m.codigo, paraSemProducao(m.codigo, m.exigeDescricao ? "x y z" : "")])).toEqual([
      ["SEM_MATERIAL", { motivo: "falta_material", descricao: null }],
      ["PARADA", { motivo: "outro", descricao: "Parada de máquina" }],
      ["AUSENCIA", { motivo: "falta_operador", descricao: null }],
      ["SETUP_REGULAGEM", { motivo: "outro", descricao: "Setup/regulagem" }],
      ["FALTA_COMPONENTE", { motivo: "falta_material", descricao: "Falta de componente" }],
      ["OUTRO", { motivo: "outro", descricao: "x y z" }],
    ]);
    expect(paraSemProducao("PARADA", " correia ")).toEqual({ motivo: "outro", descricao: "Parada de máquina: correia" });
    expect(motivoDoBanco("falta_operador")).toBe("AUSENCIA");
    expect(motivoDoBanco("manutencao_programada")).toBeNull();
  });
  it("NÃO PRODUZIU só existe para posto programado no botão rápido; máquinas não programadas não geram pendência", () => {
    const ls = iniciais();
    expect(completude(ls, CAT).pendentes).toHaveLength(3);
    expect(ls.some((l) => l.real.maquinaId === "m15")).toBe(false);
  });
});

describe("PASSO 2 — POSTO_NAO_PLANEJADO (extras)", () => {
  it("adicionar extra: linha vazia ignorada; iniciada precisa estar correta; vai para a RPC sem posto programado", () => {
    let ls = adicionarExtra(iniciais(), U(900));
    const extra = ls.find((l) => l.chave === U(900)) as LinhaApontamento;
    expect(extra).toMatchObject({ origem: "POSTO_NAO_PLANEJADO", planejado: null, situacao: "NOVA" });
    expect(linhaEmBranco(extra)).toBe(true);
    expect(completude(ls, CAT).pendentes).toHaveLength(3);                // extra em branco não é pendência
    ls = ls.map((l) => (l.chave === U(900) ? editarReal(l, { maquinaId: "m15" }, CAT) : l));
    expect(bloqueiosParaSalvar(ls, CAT).map((b) => b.chave)).toEqual([U(900)]);   // iniciada, mas sem produto/operador/produzido
    ls = ls.map((l) => (l.chave === U(900) ? informarQuantidades(editarReal(editarReal(l, { produtoId: "pA" }, CAT), { funcionarioId: "f1" }, CAT), { produzido: 40 }) : l));
    expect(problemasDaLinha(ls.find((l) => l.chave === U(900)) as LinhaApontamento, CAT).map((p) => p.codigo)).toContain("PRODUTO_SEM_ETAPA_NA_MAQUINA");   // m15 é ambígua
    ls = ls.map((l) => (l.chave === U(900) ? editarReal(l, { maquinaId: "m6", produtoId: "pB" }, CAT) : l)).map((l) => (l.planejado?.maquinaId === "m6" ? marcarNaoProduziu(l, "AUSENCIA") : l));
    // m6 já está usada pelo posto programado → conflito de máquina
    expect(problemasDoConjunto(ls)).toHaveLength(1);
  });
  it("extra válida entra no payload com maquina_planejada_id = null; extra já criada pode ser removida; programado nunca", () => {
    let ls = adicionarExtra(iniciais(), U(901));
    ls = ls.map((l) => (l.chave === U(901) ? informarQuantidades(editarReal(editarReal(editarReal(l, { maquinaId: "m6" }, CAT), { produtoId: "pB" }, CAT), { funcionarioId: "f2" }, CAT), { produzido: 40, refugo: 2 }) : l));
    ls = ls.map((l) => (l.planejado?.maquinaId === "m6" ? marcarNaoProduziu(l, "SEM_MATERIAL") : l));
    // m6 duplicada → remove a programada de m6 do conjunto simulando troca de máquina: o programado m6 usa m3 livre? (m3 ocupada) → usa m15? ambígua. Troca m6→m10 e m10→m6 NÃO existe; então só validamos o payload do extra isolado:
    const soExtra = ls.filter((l) => l.chave === U(901));
    expect(paraRpc(soExtra, CAT)).toEqual([{ chave: U(901), maquina_planejada_id: null, maquina_id: "m6", produto_id: "pB", funcionario_id: "f2", produzido: 40, refugo: 2, nao_produziu: false, motivo: null, descricao: "" }]);
    expect(removerExtra(ls, U(901)).some((l) => l.chave === U(901))).toBe(false);
    const prog = por(ls, "m3");
    expect(removerExtra(ls, prog.chave)).toHaveLength(ls.length);
  });
});

describe("completude: o que o fechamento passa a exigir", () => {
  it("completo = todo posto programado com produzido(+refugo) OU NÃO PRODUZIU com motivo; extras opcionais", () => {
    let ls = iniciais();
    expect(completude(ls, CAT).completo).toBe(false);
    ls = ls.map((l) => (l.planejado?.maquinaId === "m3" ? informarQuantidades(l, { produzido: 1500, refugo: 10 }) : l));
    ls = ls.map((l) => (l.planejado?.maquinaId === "m6" ? marcarNaoProduziu(l) : l));
    expect(completude(ls, CAT).completo).toBe(false);                       // m10 pendente e m6 sem motivo
    ls = ls.map((l) => (l.planejado?.maquinaId === "m6" ? escolherMotivo(l, "AUSENCIA") : l)).map((l) => (l.planejado?.maquinaId === "m10" ? informarQuantidades(l, { produzido: 0 }) : l));
    const c = completude(ls, CAT);
    expect(c).toMatchObject({ completo: true, pendentes: [], comProblema: [], conjunto: [] });
  });
  it("refugo vazio = 0; refugo maior que produzido e valores inválidos são recusados", () => {
    const l = por(iniciais(), "m3");
    expect(problemasDaLinha(informarQuantidades(l, { produzido: 10 }), CAT)).toEqual([]);
    expect(paraRpc([informarQuantidades(l, { produzido: 10 })], CAT)[0].refugo).toBe(0);
    expect(problemasDaLinha(informarQuantidades(l, { produzido: 10, refugo: 11 }), CAT).map((p) => p.codigo)).toEqual(["REFUGO_MAIOR_QUE_PRODUZIDO"]);
    expect({ ...l, produzido: 1.5 }.produzido).toBe(1.5);
    expect(problemasDaLinha({ ...l, produzido: 1.5 }, CAT).map((p) => p.codigo)).toContain("PRODUZIDO_INVALIDO");
    expect(informarQuantidades(l, { produzido: -5 }).produzido).toBe(0);
  });
  it("posto intocado é pendente (não erro); iniciado com erro bloqueia o salvar mas não as linhas prontas", () => {
    const ls = iniciais().map((l) => (l.planejado?.maquinaId === "m3" ? informarQuantidades(l, { produzido: 5 }) : l.planejado?.maquinaId === "m6" ? informarQuantidades(l, { refugo: 3 }) : l));
    expect(linhaIniciada(por(ls, "m10"))).toBe(false);
    expect(bloqueiosParaSalvar(ls, CAT).map((b) => b.chave)).toEqual([por(ls, "m6").chave]);
    expect(paraRpc(ls, CAT).map((r) => r.maquina_id)).toEqual(["m3"]);
  });
  it("NÃO PRODUZIU vai ao payload sem produto/operador e com o motivo fino", () => {
    const l = escolherMotivo(marcarNaoProduziu(por(iniciais(), "m10")), "SETUP_REGULAGEM", " ajuste ");
    expect(paraRpc([l], CAT)).toEqual([{ chave: l.chave, maquina_planejada_id: "m10", maquina_id: "m10", produto_id: null, funcionario_id: null, produzido: 0, refugo: 0, nao_produziu: true, motivo: "SETUP_REGULAGEM", descricao: "ajuste" }]);
  });
});

describe("payload do servidor (lerLinhas) — nunca confia no cliente", () => {
  const ok = { chave: U(1), maquina_planejada_id: U(2), maquina_id: U(3), produto_id: U(4), funcionario_id: U(5), produzido: 10, refugo: 1, nao_produziu: false };
  it("aceita linha válida e NÃO PRODUZIU válido", () => {
    expect(lerLinhas({ linhas: [ok, { chave: U(6), maquina_id: U(7), nao_produziu: true, motivo: "PARADA" }] })).toMatchObject({ linhas: [{ produzido: 10 }, { nao_produziu: true, motivo: "PARADA", produto_id: null, maquina_planejada_id: null }] });
  });
  it.each([
    [{ linhas: "x" }, "linhas inválidas"], [{ linhas: [{ ...ok, chave: "abc" }] }, "chave inválida"], [{ linhas: [{ ...ok, maquina_id: "m" }] }, "máquina inválida"],
    [{ linhas: [{ ...ok, produzido: -1 }] }, "produzido inválido"], [{ linhas: [{ ...ok, produzido: 1.5 }] }, "produzido inválido"], [{ linhas: [{ ...ok, refugo: 11 }] }, "refugo inválido"],
    [{ linhas: [{ ...ok, produto_id: null }] }, "produto inválido"], [{ linhas: [{ ...ok, funcionario_id: "z" }] }, "operador inválido"],
    [{ linhas: [{ chave: U(6), maquina_id: U(7), nao_produziu: true }] }, "motivo do NÃO PRODUZIU inválido"], [{ linhas: [{ chave: U(6), maquina_id: U(7), nao_produziu: true, motivo: "OUTRO" }] }, "descreva o motivo"],
    [{ linhas: [ok, { ...ok, chave: U(9) }] }, "duas linhas na mesma máquina"], [{ linhas: [ok, { ...ok, maquina_id: U(8) }] }, "chaves de linha repetidas"],
    [{ linhas: [{ ...ok, maquina_planejada_id: "xx" }] }, "posto programado inválido"],
  ])("recusa %j", (body, trecho) => { expect(JSON.stringify(lerLinhas(body))).toContain(trecho); });
});

describe("6 passos e flag", () => {
  const base = { apontamentosCompletos: false, inventarioCompleto: false, fase: "form" as const };
  it("progride 1→6", () => {
    expect(estadoDosPassos(base)).toEqual(["ativo", "pendente", "pendente", "pendente", "pendente", "pendente"]);
    expect(estadoDosPassos({ ...base, apontamentosCompletos: true })).toEqual(["feito", "feito", "ativo", "pendente", "pendente", "pendente"]);
    expect(estadoDosPassos({ ...base, apontamentosCompletos: true, inventarioCompleto: true })).toEqual(["feito", "feito", "feito", "ativo", "pendente", "pendente"]);
    expect(estadoDosPassos({ apontamentosCompletos: true, inventarioCompleto: true, fase: "recalculando" })).toEqual(["feito", "feito", "feito", "ativo", "ativo", "pendente"]);
    expect(estadoDosPassos({ apontamentosCompletos: true, inventarioCompleto: true, fase: "confirmado" })).toEqual(["feito", "feito", "feito", "feito", "feito", "feito"]);
  });
  it("flag: qualquer coisa diferente de ativo = desligado (padrão)", () => {
    expect(lerModoApontamentoSimplificado([])).toBe("desligado");
    expect(lerModoApontamentoSimplificado([{ chave: "apontamento_simplificado_modo", valor: "ativo" }])).toBe("ativo");
    expect(lerModoApontamentoSimplificado([{ chave: "apontamento_simplificado_modo", valor: "sombra" }])).toBe("desligado");
    expect(lerModoApontamentoSimplificado([{ chave: "outra", valor: "ativo" }])).toBe("desligado");
  });
});
