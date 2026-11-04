import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/prod-m2-2026-11-04.json";
import { montarEstadoPostos, type DadosBrutosPostos } from "../postosProgramados";
import { acaoPostos, type IoPostos } from "../httpPostos";
import { linhasIniciais } from "@/features/producao-real/apontamento-simplificado/prefill";
import { alteradoDoPlanejado } from "@/features/producao-real/apontamento-simplificado/diff";
import { informarQuantidades, operacaoDaLinha } from "@/features/producao-real/apontamento-simplificado/linhas";
import { paraRpc, completude } from "@/features/producao-real/apontamento-simplificado/validacao";
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
    expect(paraRpc(ls, estado.catalogo)).toHaveLength(0);                   // nada para gravar sem o operador informar
  });
  it("pré-preenchimento: máquina/operador/produto/operação da escala; produzido vazio; refugo vazio = 0", () => {
    const l = porMaquina(linhas(), "Parafusadeira 10");
    expect(l.real).toEqual({ maquinaId: l.planejado!.maquinaId, funcionarioId: l.planejado!.funcionarioId, produtoId: l.planejado!.produtoId });
    expect(l.produzido).toBeNull(); expect(l.refugo).toBeNull(); expect(operacaoDaLinha(estado.catalogo, l)!.id).toBe(l.planejado!.operacaoId);
    expect(alteradoDoPlanejado(l, estado.catalogo)).toBe(false);
    const ok = informarQuantidades(l, { produzido: 1450 });                 // refugo não informado
    const [op] = paraRpc([ok], estado.catalogo);
    expect(op).toMatchObject({ maquina_id: l.planejado!.maquinaId, maquina_planejada_id: l.planejado!.maquinaId, produzido: 1450, refugo: 0, nao_produziu: false });
  });
  it("completude: com nenhum posto resolvido há 12 pendentes; resolvidos todos ⇒ libera o estoque físico", () => {
    expect(completude(linhas(), estado.catalogo).pendentes).toHaveLength(12);
    expect(etapaEstoqueLiberada([{ status: "pendente" }, { status: "produzindo" }])).toBe(false);
    expect(etapaEstoqueLiberada([{ status: "sem_producao" }, { status: "produzindo" }])).toBe(true);
    const todos = linhas().map((l) => informarQuantidades(l, { produzido: 100 }));
    expect(completude(todos, estado.catalogo).completo).toBe(true);
  });
});

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
