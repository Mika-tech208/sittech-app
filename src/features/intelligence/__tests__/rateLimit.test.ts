import { describe, expect, it, beforeEach } from "vitest";
import { checarRateLimit, _resetarRateLimitParaTeste } from "@/features/intelligence/rateLimit";

describe("Rate limit — 30 perguntas/usuário/hora (§25)", () => {
  beforeEach(() => _resetarRateLimitParaTeste());

  it("caso 1: as primeiras 30 chamadas são permitidas", () => {
    const agora = Date.now();
    for (let i = 0; i < 30; i++) {
      const r = checarRateLimit("user-1", agora);
      expect(r.permitido).toBe(true);
    }
  });

  it("caso 2: a 31ª chamada na mesma janela é negada", () => {
    const agora = Date.now();
    for (let i = 0; i < 30; i++) checarRateLimit("user-1", agora);
    const r = checarRateLimit("user-1", agora);
    expect(r.permitido).toBe(false);
    expect(r.restantes).toBe(0);
  });

  it("caso 3: usuários diferentes têm contadores independentes", () => {
    const agora = Date.now();
    for (let i = 0; i < 30; i++) checarRateLimit("user-1", agora);
    const r = checarRateLimit("user-2", agora);
    expect(r.permitido).toBe(true);
  });

  it("caso 4: chamada 1h+1min depois libera de novo (janela deslizante)", () => {
    const agora = Date.now();
    for (let i = 0; i < 30; i++) checarRateLimit("user-1", agora);
    const depois = agora + 61 * 60 * 1000;
    const r = checarRateLimit("user-1", depois);
    expect(r.permitido).toBe(true);
  });
});
