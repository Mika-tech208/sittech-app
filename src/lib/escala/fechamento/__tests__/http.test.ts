import { describe, expect, it } from "vitest";
import { acaoAbrir, acaoConfirmar, acaoRetry, lerEntrada, statusHttp, type UsuarioFechamento } from "../http";
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
