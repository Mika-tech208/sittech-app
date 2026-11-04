import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/prod-m2-2026-11-04.json";
import { montarEstadoPostos, type DadosBrutosPostos } from "../postosProgramados";
import { acaoPostos, type IoPostos } from "../httpPostos";
import { linhasIniciais } from "@/features/producao-real/apontamento-simplificado/prefill";
import { alteradoDoPlanejado } from "@/features/producao-real/apontamento-simplificado/diff";
import { editarReal, informarQuantidades, marcarNaoProduziu, escolherMotivo, editarDescricao, operacaoDaLinha } from "@/features/producao-real/apontamento-simplificado/linhas";
import { problemasDaLinha, linhaPronta, completude } from "@/features/producao-real/apontamento-simplificado/validacao";
import { MOTIVOS_NAO_PRODUZIU } from "@/features/producao-real/apontamento-simplificado/motivos";
import { chaveIrma, executarGravacao, modoRpc, planejarGravacao } from "@/features/producao-real/fechamento/gravacao";
import { estadoDaGrade, etapaEstoqueLiberada, filtrarGradeProgramada, MENSAGEM_POSTOS_NAO_CARREGADOS } from "@/features/producao-real/fechamento/textos";
import type { LinhaApontamento } from "@/features/producao-real/apontamento-simplificado/tipos";

// DADOS REAIS do M2 de 04/11/2026 (escala ativa f134bd2b + cadastros do PROD, lidos em modo somente leitura)
const F = fixture as unknown as { aloc_m2: Record<string, unknown>[]; maquinas: DadosBrutosPostos["maquinas"]; funcionarios: DadosBrutosPostos["funcionarios"]; produtos: DadosBrutosPostos["produtos"]; operacoes: DadosBrutosPostos["operacoes"]; etapas: DadosBrutosPostos["etapas"]; etapaMaquinas: DadosBrutosPostos["etapaMaquinas"] };
const bruto = (o: Partial<DadosBrutosPostos> = {}): DadosBrutosPostos => ({ alocacoes: F.aloc_m2, maquinas: F.maquinas, funcionarios: F.funcionarios, produtos: F.produtos, operacoes: F.operacoes, etapas: F.etapas, etapaMaquinas: F.etapaMaquinas, apontamentos: [], ...o });
const estado = montarEstadoPostos(bruto());
let n = 0;
const chave = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const linhas = (): LinhaApontamento[] => linhasIniciais(estado.postos, estado.existentes, [], chave);
const porMaquina = (ls: LinhaApontamento[], nome: string) => ls.find((l) => l.planejado!.maquinaNome === nome)!;

describe("postos programados do M2 de hoje (dados reais) — 1:1 com a escala ativa", () => {
  it("12 postos, exatamente as alocações do período; máquina e operador/produto/operação da escala", () => {
    expect(estado.postos).toHaveLength(12);
    expect(estado.postos).toHaveLength(new Set(F.aloc_m2.map((a) => a.maquina_id)).size);
    const aloc = new Map(F.aloc_m2.map((a) => [a.maquina_id as string, a]));
    for (const p of estado.postos) {
      const a = aloc.get(p.maquinaId)!;
      expect([p.funcionarioId, p.produtoId, p.etapaId, p.operacaoId]).toEqual([a.funcionario_id, a.produto_id, a.etapa_id, a.operacao_id]);
      expect(p.pecas).toBe(Number(a.pecas ?? 0) + Number(a.pecas_adicional ?? 0));
    }
    const p10 = estado.postos.find((p) => p.maquinaNome === "Parafusadeira 10")!;
    expect([p10.funcionarioNome, p10.produtoNome, p10.operacaoNome]).toEqual([F.funcionarios.find((f) => f.id === p10.funcionarioId)!.nome, 'Conector 3/4"', "Parafusar"]);
  });
  it("máquina SEM posto programado (desligada) não aparece, nem como pedido de 'sem produção'", () => {
    const programadas = new Set(estado.postos.map((p) => p.maquinaId));
    expect(F.maquinas.length).toBeGreaterThan(estado.postos.length);        // há máquinas cadastradas fora da escala
    const ls = linhas();
    expect(ls).toHaveLength(12); expect(ls.every((l) => l.origem === "PROGRAMADO" && programadas.has(l.real.maquinaId!))).toBe(true);
    expect(planejarGravacao(ls, estado.catalogo)).toHaveLength(0);          // nada para gravar sem o operador informar
  });
  it("pré-preenchimento: máquina/operador/produto/operação da escala; produzido vazio; refugo vazio = 0", () => {
    const l = porMaquina(linhas(), "Parafusadeira 10");
    expect(l.real).toEqual({ maquinaId: l.planejado!.maquinaId, funcionarioId: l.planejado!.funcionarioId, produtoId: l.planejado!.produtoId });
    expect(l.produzido).toBeNull(); expect(l.refugo).toBeNull(); expect(operacaoDaLinha(estado.catalogo, l)!.id).toBe(l.planejado!.operacaoId);
    expect(alteradoDoPlanejado(l, estado.catalogo)).toBe(false);
    const ok = informarQuantidades(l, { produzido: 1450 });                 // refugo não informado
    const [op] = planejarGravacao([ok], estado.catalogo);
    expect(op).toMatchObject({ tipo: "producao", maquinaId: l.planejado!.maquinaId, produzido: 1450, refugo: 0 });
  });
  it("completude: com nenhum posto resolvido há 12 pendentes; resolvidos todos ⇒ libera o estoque físico", () => {
    expect(completude(linhas(), estado.catalogo).pendentes).toHaveLength(12);
    expect(etapaEstoqueLiberada([{ status: "pendente" }, { status: "produzindo" }])).toBe(false);
    expect(etapaEstoqueLiberada([{ status: "sem_producao" }, { status: "produzindo" }])).toBe(true);
    const todos = linhas().map((l) => informarQuantidades(l, { produzido: 100 }));
    expect(completude(todos, estado.catalogo).completo).toBe(true);
  });
});

describe("NÃO PRODUZIU (mecanismo legado sem_producao)", () => {
  it("cada motivo grava sem_producao na máquina PROGRAMADA com o motivo/descrição esperados", () => {
    const base = porMaquina(linhas(), "Montagem 18");
    const esperado: Record<string, [string, string | null]> = { SEM_MATERIAL: ["falta_material", null], PARADA: ["outro", "Parada de máquina"], AUSENCIA: ["falta_operador", null], SETUP_REGULAGEM: ["outro", "Setup/regulagem"], FALTA_COMPONENTE: ["falta_material", "Falta de componente"] };
    for (const m of MOTIVOS_NAO_PRODUZIU.filter((x) => x.codigo !== "OUTRO")) {
      const l = escolherMotivo(marcarNaoProduziu(base), m.codigo);
      expect(linhaPronta(l, estado.catalogo)).toBe(true);
      expect(planejarGravacao([l], estado.catalogo)).toEqual([{ tipo: "sem_producao", chave: l.chave, maquinaId: base.planejado!.maquinaId, motivo: esperado[m.codigo][0], descricao: esperado[m.codigo][1] }]);
    }
  });
  it("'Outro' exige descrição; sem motivo não grava", () => {
    const l = marcarNaoProduziu(porMaquina(linhas(), "Montagem 18"));
    expect(problemasDaLinha(l, estado.catalogo).map((p) => p.codigo)).toContain("MOTIVO_OBRIGATORIO");
    const o = escolherMotivo(l, "OUTRO"); expect(problemasDaLinha(o, estado.catalogo).map((p) => p.codigo)).toContain("DESCRICAO_OBRIGATORIA");
    expect(planejarGravacao([editarDescricao(o, "motor queimado")], estado.catalogo)[0]).toMatchObject({ motivo: "outro", descricao: "motor queimado" });
  });
});

describe("tudo editável + ALTERADO DO PLANEJADO", () => {
  const cat = estado.catalogo;
  it("alterar OPERADOR: grava a produção com o operador real; selo; sem confirmação extra", () => {
    const l0 = porMaquina(linhas(), "Parafusadeira 12");
    const outro = F.funcionarios.find((f) => f.id !== l0.planejado!.funcionarioId && f.ativo !== false)!.id;
    const l = informarQuantidades(editarReal(l0, { funcionarioId: outro }, cat), { produzido: 900, refugo: 3 });
    expect(alteradoDoPlanejado(l, cat)).toBe(true);
    expect(planejarGravacao([l], cat)).toEqual([{ tipo: "producao", chave: l.chave, maquinaId: l0.planejado!.maquinaId, produtoId: l0.planejado!.produtoId, funcionarioId: outro, produzido: 900, refugo: 3 }]);
  });
  it("alterar PRODUTO (combinação válida): operação derivada, selo", () => {
    const l0 = porMaquina(linhas(), "Parafusadeira 12");
    const alt = cat.elegibilidade.find((e) => e.maquinaId === l0.planejado!.maquinaId && e.produtoId !== l0.planejado!.produtoId);
    if (!alt) return; // máquina com um único produto elegível
    const l = informarQuantidades(editarReal(l0, { produtoId: alt.produtoId }, cat), { produzido: 500 });
    expect(alteradoDoPlanejado(l, cat)).toBe(true); expect(operacaoDaLinha(cat, l)!.id).toBe(alt.operacaoId);
  });
  it("combinação INVÁLIDA máquina×produto continua recusada (nada para gravar)", () => {
    const l0 = porMaquina(linhas(), "Parafusadeira 12");
    const invalido = F.produtos.find((p) => !cat.elegibilidade.some((e) => e.maquinaId === l0.planejado!.maquinaId && e.produtoId === p.id))!.id;
    const l = informarQuantidades({ ...l0, real: { ...l0.real, produtoId: invalido } }, { produzido: 100 });
    expect(problemasDaLinha(l, cat).map((p) => p.codigo)).toContain("PRODUTO_SEM_ETAPA_NA_MAQUINA");
    expect(planejarGravacao([l], cat)).toHaveLength(0);
  });
  it("alterar MÁQUINA: produção na máquina REAL + sem_producao 'Produção realizada em X' na programada (resolve o posto); chaves distintas e válidas", () => {
    const l0 = porMaquina(linhas(), "Parafusadeira 12");
    const livre = cat.maquinas.find((m) => !estado.postos.some((p) => p.maquinaId === m.id) && cat.elegibilidade.some((e) => e.maquinaId === m.id && e.produtoId === l0.planejado!.produtoId))!;
    const l = informarQuantidades(editarReal(l0, { maquinaId: livre.id }, cat), { produzido: 700 });
    expect(alteradoDoPlanejado(l, cat)).toBe(true);
    const ops = planejarGravacao([l], cat);
    expect(ops).toEqual([
      { tipo: "producao", chave: l.chave, maquinaId: livre.id, produtoId: l0.planejado!.produtoId, funcionarioId: l0.planejado!.funcionarioId, produzido: 700, refugo: 0 },
      { tipo: "sem_producao", chave: chaveIrma(l.chave), maquinaId: l0.planejado!.maquinaId, motivo: "outro", descricao: `Produção realizada em ${livre.nome}` },
    ]);
    expect(chaveIrma(l.chave)).not.toBe(l.chave); expect(chaveIrma(l.chave)).toMatch(/^[0-9a-f-]{36}$/i);
  });
  it("duas linhas na mesma máquina real são bloqueadas antes de gravar", async () => {
    const { problemasDoConjunto } = await import("@/features/producao-real/apontamento-simplificado/validacao");
    const [a, b] = [porMaquina(linhas(), "Parafusadeira 10"), porMaquina(linhas(), "Parafusadeira 12")];
    const b2 = { ...b, real: { ...b.real, maquinaId: a.real.maquinaId } };
    expect(problemasDoConjunto([a, b2])).toHaveLength(1);
  });
});

describe("gravação pelas RPCs LEGADAS (sem contrato novo)", () => {
  const ctx = { data: "2026-11-04", periodoId: "m2", fimMs: 1_000_000 };
  const mk = (agora: number) => {
    const chamadas: { nome: string; args: Record<string, unknown> }[] = []; const esperas: number[] = [];
    return { chamadas, esperas, io: { rpc: async (nome: string, args: Record<string, unknown>) => { chamadas.push({ nome, args }); return { error: null }; }, agora: () => agora, esperar: async (ms: number) => { esperas.push(ms); }, traduzErro: (m: string | undefined) => m ?? "" } };
  };
  const ops = planejarGravacao([informarQuantidades(porMaquina(linhas(), "Montagem 19"), { produzido: 650, refugo: 2 }), escolherMotivo(marcarNaoProduziu(porMaquina(linhas(), "Montagem 20")), "PARADA")], estado.catalogo);
  it("período em curso ⇒ RPCs do período atual; terminado ⇒ RPCs retroativas com data/período", async () => {
    const a = mk(ctx.fimMs - 120_000); const ra = await executarGravacao(ops, ctx, a.io);
    expect(ra).toEqual({ gravadas: 2, erro: null }); expect(a.chamadas.map((c) => c.nome)).toEqual(["registrar_apontamento_producao", "registrar_sem_producao"]);
    expect(a.chamadas[0].args).toMatchObject({ p_quantidade_produzida: 650, p_quantidade_refugo: 2, p_paradas: [] }); expect("p_data" in a.chamadas[0].args).toBe(false);
    const r = mk(ctx.fimMs + 60_000); await executarGravacao(ops, ctx, r.io);
    expect(r.chamadas.map((c) => c.nome)).toEqual(["registrar_apontamento_producao_retroativo", "registrar_sem_producao_retroativo"]);
    expect(r.chamadas[1].args).toMatchObject({ p_data: "2026-11-04", p_periodo_id: "m2", p_motivo_sem_producao: "outro", p_descricao_sem_producao: "Parada de máquina" });
  });
  it("na virada do período NUNCA grava 'agora' (esperaria cair no período errado): espera o fim e usa a retroativa", async () => {
    expect(modoRpc(ctx.fimMs - 5_000, ctx.fimMs)).toEqual({ modo: "retro", esperarMs: 7_000 });
    expect(modoRpc(ctx.fimMs - 20_000, ctx.fimMs).modo).toBe("agora");
    const x = mk(ctx.fimMs - 5_000); await executarGravacao(ops, ctx, x.io); expect(x.esperas[0]).toBe(7_000); expect(x.chamadas[0].nome).toBe("registrar_apontamento_producao_retroativo");
  });
  it("erro na RPC (ex.: combinação sem etapa): para no 1º erro, devolve a mensagem e informa quantas já foram gravadas", async () => {
    let i = 0; const io = { ...mk(ctx.fimMs + 1).io, rpc: async () => (++i === 2 ? { error: { message: "Nenhuma etapa do roteiro" } } : { error: null }) };
    expect(await executarGravacao(ops, ctx, io)).toEqual({ gravadas: 1, erro: { chave: ops[1].chave, mensagem: "Nenhuma etapa do roteiro" } });
  });
});


// ============ REGRAS DEFINITIVAS (04/11) ============
const io = (o: Partial<IoPostos> = {}): IoPostos => ({ carregar: async () => estado, modo: async () => "ativo", liberado: async () => ({ liberado: true }), ...o });
const usuarioPainel = { id: "u", papel: "usuario" as const, permissoes: ["producao_real_apontamento"] };

describe("API dos postos: fonte da grade do tablet", () => {
  it("permissão: quem opera o painel OU fecha o período lê; sem permissão 403; parâmetros inválidos 400", async () => {
    expect((await acaoPostos(io(), { id: "u", papel: "usuario", permissoes: [] }, "2026-11-04", "m2")).status).toBe(403);
    expect((await acaoPostos(io(), usuarioPainel, "x", "m2")).status).toBe(400);
    expect((await acaoPostos(io(), usuarioPainel, "2026-11-04", "m2")).status).toBe(200);
    expect((await acaoPostos(io(), { id: "u", papel: "usuario", permissoes: ["escala_fechamento"] }, "2026-11-04", "m2")).status).toBe(200);
  });
  it("fechamento ATIVO: 12 postos do período; flag desligada/sombra: fluxo anterior (sem postos); período NÃO liberado: nenhum posto (+ predecessor para fechar o anterior)", async () => {
    const ativo = await acaoPostos(io(), usuarioPainel, "2026-11-04", "m2");
    expect(ativo.corpo.modo).toBe("ativo"); expect((ativo.corpo.postos as unknown[]).length).toBe(12);
    for (const m of ["desligado", "sombra"] as const) expect((await acaoPostos(io({ modo: async () => m }), usuarioPainel, "2026-11-04", "m2")).corpo).toMatchObject({ modo: m, postos: [] });
    const nao = await acaoPostos(io({ liberado: async () => ({ liberado: false, predecessor: { data: "2026-11-04", periodo: "m2", rotulo: "M2" } }) }), usuarioPainel, "2026-11-04", "m3");
    expect(nao.corpo).toMatchObject({ naoLiberado: true, postos: [], predecessor: { periodo: "m2" } });
  });
  it("B: falha ao buscar a escala (carregar, flag ou liberação) ⇒ HTTP 500 sem postos: FAIL CLOSED, nunca as 22 máquinas", async () => {
    for (const falha of [{ carregar: async () => { throw new Error("banco fora"); } }, { modo: async () => { throw new Error("x"); } }, { liberado: async () => { throw new Error("y"); } }]) {
      const r = await acaoPostos(io(falha), usuarioPainel, "2026-11-04", "m2");
      expect(r.status).toBe(500); expect(r.corpo.postos).toBeUndefined();
    }
  });
});

describe("TABLET: grade = só os postos programados do período (regra definitiva)", () => {
  const ativas = F.maquinas.filter((m) => m.ativo !== false).map((m) => ({ id: m.id, nome: m.nome.trim(), estadoPeriodo: "pendente" }));
  const programados = new Set(estado.postos.map((p) => p.maquinaId));
  it("A: 22 máquinas ativas, 12 programadas ⇒ o tablet mostra 12 (os mesmos da escala)", () => {
    expect(ativas).toHaveLength(22);
    const g = filtrarGradeProgramada(ativas, programados);
    expect(g).toHaveLength(12); expect(g.map((m) => m.id).sort()).toEqual([...programados].sort());
  });
  it("B: falha ao buscar a escala ⇒ estado 'erro' (mensagem clara), nunca 'legado' com as 22", () => {
    expect(MENSAGEM_POSTOS_NAO_CARREGADOS).toBe("NÃO FOI POSSÍVEL CARREGAR OS POSTOS PROGRAMADOS.");
    for (const r of [null, { status: 500, corpo: {} }, { status: 401, corpo: {} }, { status: 403, corpo: {} }, { status: 200, corpo: {} }, { status: 200, corpo: { modo: "?" } }]) expect(estadoDaGrade(r)).toBe("erro");
    expect(estadoDaGrade({ status: 200, corpo: { modo: "ativo", postos: [{}] } })).toBe("programada");
    expect(estadoDaGrade({ status: 200, corpo: { modo: "ativo", naoLiberado: true, postos: [] } })).toBe("nao_liberada");
    expect(estadoDaGrade({ status: 200, corpo: { modo: "desligado", postos: [] } })).toBe("legado");   // só com o fechamento desligado o fluxo anterior segue
  });
  it("C: máquina fora do plano só aparece por + ADICIONAR APONTAMENTO (exceção explícita) ou se já tiver apontamento", () => {
    const fora = ativas.find((m) => !programados.has(m.id))!;
    expect(filtrarGradeProgramada(ativas, programados).some((m) => m.id === fora.id)).toBe(false);
    const g = filtrarGradeProgramada(ativas, programados, new Set([fora.id]));
    expect(g).toHaveLength(13); expect(g.some((m) => m.id === fora.id)).toBe(true);
    expect(filtrarGradeProgramada(ativas.map((m) => (m.id === fora.id ? { ...m, estadoPeriodo: "apontado" } : m)), programados)).toHaveLength(13);
  });
});
