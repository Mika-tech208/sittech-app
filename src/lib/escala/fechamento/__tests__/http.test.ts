import { describe, expect, it } from "vitest";
import { acaoAbrir, acaoConfirmar, acaoReabrir, acaoRetry, lerEntrada, statusHttp, type UsuarioFechamento } from "../http";
import type { FechamentoIO, ResultadoFechamento } from "../orquestrador";

const SEM: UsuarioFechamento = { id: "u1", papel: "usuario", permissoes: ["producao_real_apontamento"] };
const COM: UsuarioFechamento = { id: "u2", papel: "usuario", permissoes: ["escala_fechamento"] };
const io = (modo: "desligado" | "sombra" | "ativo" = "desligado"): FechamentoIO => ({ modo: async () => modo } as unknown as FechamentoIO);
const CH = "11111111-1111-1111-1111-111111111111";
const base = { ok: false, estado: null, fechamentoId: null, erros: [], exigeConfirmacao: [], mensagem: null, tempos: null, hashPlanoAnterior: null, hashPlanoNovo: null } satisfies ResultadoFechamento;

describe("HTTP do fechamento", () => {
  it("sem a permissão escala_fechamento ⇒ 403 em abrir/confirmar/retry", async () => {
    expect((await acaoAbrir(io(), SEM, { data: "2026-11-03", periodo_id: "m2" })).status).toBe(403);
    expect((await acaoConfirmar(io(), SEM, { data: "2026-11-03", periodo_id: "m2", chave: CH, buffers: [] })).status).toBe(403);
    expect((await acaoRetry(io(), SEM, { fechamento_id: CH })).status).toBe(403);
  });
  it("entrada inválida ⇒ 400", async () => {
    expect((await acaoConfirmar(io("ativo"), COM, { data: "x", periodo_id: "m2", chave: CH })).status).toBe(400);
    expect((await acaoConfirmar(io("ativo"), COM, { data: "2026-11-03", periodo_id: "m2", chave: "x" })).status).toBe(400);
    expect((await acaoRetry(io("ativo"), COM, { fechamento_id: "x" })).status).toBe(400);
  });
  it("modo desligado ⇒ 503 (nada acontece)", async () => {
    expect((await acaoAbrir(io("desligado"), COM, { data: "2026-11-03", periodo_id: "m2" })).status).toBe(503);
    expect((await acaoConfirmar(io("desligado"), COM, { data: "2026-11-03", periodo_id: "m2", chave: CH, buffers: [] })).status).toBe(503);
  });
  it("fechar SEM contagem exige o perfil superior (403 para o perfil comum)", async () => {
    expect((await acaoConfirmar(io("ativo"), COM, { data: "2026-11-03", periodo_id: "m2", chave: CH, buffers: [], excecao_motivo: "galpão interditado" })).status).toBe(403);
  });
  it("correção (revisão) só com o perfil superior: o perfil comum NÃO força revisão", async () => {
    let forcou: boolean | undefined;
    const fake = { modo: async () => "ativo", fechamentoPorChave: async () => null, contexto: async () => ({ periodoJaFechado: true, periodo: { fimMs: 0, proximo: null }, postos: [], obrigatorios: [], estimativas: [], semanaInicio: "x", previsaoId: "p", fechamentoVigente: null, hashPlanoAnterior: null, resumoProducao: {}, tempoEntradaMs: 0 }), podeExcecao: async () => true, aberturaAtual: async () => null,
      registrar: async (s: { forcarRevisao: boolean }) => { forcou = s.forcarRevisao; throw new Error("parar aqui"); } } as unknown as FechamentoIO;
    const corpo = { data: "2026-11-03", periodo_id: "m2", chave: CH, buffers: [], revisao: true };
    const SUPER: UsuarioFechamento = { id: "u3", papel: "usuario", permissoes: ["escala_fechamento", "escala_fechamento_excecao"] };
    await acaoConfirmar(fake, SUPER, corpo, () => 1_000_000); expect(forcou).toBe(true);
    forcou = undefined; await acaoConfirmar(fake, COM, corpo, () => 1_000_000); expect(forcou).toBeUndefined(); // comum: validação recusa antes (PERIODO_JA_FECHADO)
  });
  it("lerEntrada: vazio vira null (nunca zero) e mapeia os campos", () => {
    const r = lerEntrada({ data: "2026-11-03", periodo_id: "m2", chave: CH, buffers: [{ buffer_id: "b1", fisico: "" }, { buffer_id: "b2", fisico: 0 }, { buffer_id: "b3", fisico: 5, motivo: "x" }], confirmou_diferenca_grande: true });
    expect("entrada" in r && r.entrada.buffers).toEqual([{ bufferId: "b1", fisico: null, motivo: null }, { bufferId: "b2", fisico: 0, motivo: null }, { bufferId: "b3", fisico: 5, motivo: "x" }]);
  });
  it("mapa de status HTTP", () => {
    expect(statusHttp({ ...base, ok: true, estado: "CONFIRMADO" })).toBe(200);
    expect(statusHttp({ ...base, estado: "ERRO_RECALCULO" })).toBe(502);
    expect(statusHttp({ ...base, estado: "RECALCULANDO" })).toBe(409);
    expect(statusHttp({ ...base, erros: [{ codigo: "PERIODO_JA_FECHADO", mensagem: "x" }] })).toBe(409);
    expect(statusHttp({ ...base, erros: [{ codigo: "BUFFER_FALTANDO", mensagem: "x" }] })).toBe(422);
    expect(statusHttp({ ...base, duplicado: true })).toBe(200);
  });
});

describe("REABRIR PERÍODO (janela de correção)", () => {
  const admin = (rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>) => ({ rpc }) as never;
  it("sem permissão ⇒ 403 e nada é chamado", async () => {
    let chamou = false;
    const r = await acaoReabrir(admin(async () => { chamou = true; return { data: null, error: null }; }), SEM, { data: "2026-11-04", periodo_id: "t3", motivo: "lançamento errado" });
    expect(r.status).toBe(403); expect(chamou).toBe(false);
  });
  it("motivo obrigatório ⇒ 422; data/período inválidos ⇒ 400", async () => {
    const a = admin(async () => ({ data: null, error: null }));
    expect((await acaoReabrir(a, COM, { data: "2026-11-04", periodo_id: "t3", motivo: " " })).status).toBe(422);
    expect((await acaoReabrir(a, COM, { data: "x", periodo_id: "t3", motivo: "abc def" })).status).toBe(400);
  });
  it("Elizabeth (escala_fechamento) e admin reabrem; a RPC recebe usuário, período e motivo", async () => {
    let args: Record<string, unknown> = {};
    const a = admin(async (_n, x) => { args = x; return { data: [{ abertura_id: "ab1", valido_ate: "2026-11-04T21:00:00Z", renovada: false }], error: null }; });
    const r = await acaoReabrir(a, COM, { data: "2026-11-04", periodo_id: "t3", motivo: "produzido digitado errado" });
    expect(r.status).toBe(200); expect(r.corpo.ok).toBe(true);
    expect(args).toMatchObject({ p_usuario: "u2", p_data: "2026-11-04", p_periodo: "t3", p_motivo: "produzido digitado errado" });
    expect((await acaoReabrir(a, { id: "adm", papel: "admin" }, { data: "2026-11-04", periodo_id: "t3", motivo: "conferência" })).status).toBe(200);
  });
  it("período não confirmado ⇒ 422 com a mensagem do banco; falha inesperada ⇒ 500 genérico", async () => {
    const naoConf = admin(async () => ({ data: null, error: { message: "REABERTURA_PERIODO_NAO_CONFIRMADO: o período t3 de 2026-11-04 não está confirmado (nada a reabrir)" } }));
    const r = await acaoReabrir(naoConf, COM, { data: "2026-11-04", periodo_id: "t3", motivo: "abc def" });
    expect(r.status).toBe(422); expect(String(r.corpo.erro)).toContain("não está confirmado");
    const boom = admin(async () => ({ data: null, error: { message: "connection reset" } }));
    expect((await acaoReabrir(boom, COM, { data: "2026-11-04", periodo_id: "t3", motivo: "abc def" })).status).toBe(500);
  });
});
