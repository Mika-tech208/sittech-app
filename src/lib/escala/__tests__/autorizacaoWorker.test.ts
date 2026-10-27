import { describe, it, expect } from "vitest";
import { autorizarWorker } from "../autorizacaoWorker";

const CRON = "segredo-cron-com-mais-de-16";
const TOKEN = "a".repeat(64);
const valida = (ok: boolean) => async () => ok;

describe("autorização do worker /api/escala/drenar", () => {
  it("CRON_SECRET correto: autorizado (Vercel Cron / GitHub)", async () => {
    expect(await autorizarWorker(`Bearer ${CRON}`, CRON, valida(false))).toBe(true);
  });
  it("token do agendador do banco válido: autorizado (pg_cron + pg_net)", async () => {
    expect(await autorizarWorker(`Bearer ${TOKEN}`, CRON, valida(true))).toBe(true);
    expect(await autorizarWorker(`Bearer ${TOKEN}`, undefined, valida(true))).toBe(true);
  });
  it("credencial inválida: recusa (false), com ou sem CRON_SECRET configurado", async () => {
    expect(await autorizarWorker(`Bearer ${TOKEN}`, CRON, valida(false))).toBe(false);
    expect(await autorizarWorker("Bearer curto", CRON, valida(true))).toBe(false); // token curto nem chega à RPC
    expect(await autorizarWorker("", CRON, valida(true))).toBe(false);
  });
  it("nada configurado: null (503, fail closed) — nunca autoriza", async () => {
    expect(await autorizarWorker("", undefined, valida(true))).toBeNull();
    expect(await autorizarWorker("Bearer curto", "curto", valida(true))).toBeNull(); // CRON_SECRET < 16 = não configurado
  });
  it("RPC indisponível (migration do agendador ainda não aplicada): recusa em vez de lançar", async () => {
    const quebra = async () => { throw new Error("function does not exist"); };
    expect(await autorizarWorker(`Bearer ${TOKEN}`, CRON, quebra)).toBe(false);
    expect(await autorizarWorker(`Bearer ${CRON}`, CRON, quebra)).toBe(true); // o CRON_SECRET segue valendo
  });
  it("token só é aceito com prefixo Bearer", async () => {
    expect(await autorizarWorker(TOKEN, CRON, valida(true))).toBe(false);
  });
});
