// HARD GATE (4) do planejamento do produto único: semana em PLANEJAMENTO (plano futuro, não liberado) NÃO abre nem confirma fechamento físico, em NENHUM modo da flag.
// Semanas LEGADO/OPERACIONAL continuam podendo fechar período não liberado (regularização) — o bloqueio é só do PLANEJAMENTO.
import { describe, expect, it } from "vitest";
import { abrirFechamento, confirmarFechamento, MENSAGEM_PLANEJAMENTO, type ContextoFechamento, type FechamentoIO } from "../orquestrador";
import { acaoAbrir, acaoConfirmar, type UsuarioFechamento } from "../http";
import type { ModoFechamento } from "@/features/escala/fechamento/tipos";

const COM: UsuarioFechamento = { id: "u2", papel: "usuario", permissoes: ["escala_fechamento"] };
const CTX_PLANEJAMENTO: ContextoFechamento = {
  semanaInicio: "2026-11-09", previsaoId: "prev", periodo: { data: "2026-11-09", periodoId: "m1", rotulo: "M1", inicioMs: 1, fimMs: 2, proximo: null },
  postos: [], obrigatorios: [], estimativas: [], periodoJaFechado: false, fechamentoVigente: null, hashPlanoAnterior: null, resumoProducao: {}, tempoEntradaMs: 0, emPlanejamento: true,
};
function io(modo: ModoFechamento, ctx: ContextoFechamento = CTX_PLANEJAMENTO): FechamentoIO & { gravou: number } {
  const o = {
    gravou: 0, modo: async () => modo, contexto: async () => ctx, fechamentoPorChave: async () => null, podeExcecao: async () => false,
    abrir: async () => { o.gravou++; return { aberturaId: "x", validoAteMs: 1 }; }, aberturaAtual: async () => null,
    registrar: async () => { o.gravou++; return "f"; },
  };
  return o as unknown as FechamentoIO & { gravou: number };
}

describe("semana em PLANEJAMENTO: nenhum fechamento físico", () => {
  for (const modo of ["ativo", "sombra"] as const) {
    it(`modo ${modo}: abrir e confirmar recusados (PERIODO_EM_PLANEJAMENTO) e NADA é gravado`, async () => {
      const f = io(modo);
      const a = await abrirFechamento(f, { data: "2026-11-09", periodoId: "m1", usuarioId: "u" });
      expect(a.ok).toBe(false); expect(a.erro).toBe(MENSAGEM_PLANEJAMENTO); expect(a.erros?.[0].codigo).toBe("PERIODO_EM_PLANEJAMENTO");
      const c = await confirmarFechamento(f, { data: "2026-11-09", periodoId: "m1", chave: "k", buffers: [] }, "u");
      expect(c.ok).toBe(false); expect(c.erros[0].codigo).toBe("PERIODO_EM_PLANEJAMENTO");
      expect(f.gravou).toBe(0);
    });
  }
  it("HTTP: 422 nas duas ações", async () => {
    const f = io("ativo");
    expect((await acaoAbrir(f, COM, { data: "2026-11-09", periodo_id: "m1" })).status).toBe(422);
    expect((await acaoConfirmar(f, COM, { data: "2026-11-09", periodo_id: "m1", chave: "11111111-1111-1111-1111-111111111111", buffers: [] })).status).toBe(422);
  });
  it("semana que NÃO é planejamento (emPlanejamento ausente) abre normalmente — a regularização de período não liberado continua possível", async () => {
    const f = io("ativo", { ...CTX_PLANEJAMENTO, emPlanejamento: undefined });
    const a = await abrirFechamento(f, { data: "2026-11-09", periodoId: "m1", usuarioId: "u" });
    expect(a.ok).toBe(true); expect(f.gravou).toBe(1);
  });
});
