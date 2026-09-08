import { describe, expect, it, vi, beforeEach } from "vitest";
import type { IntelligenceProvider, ProviderRunResult } from "@/features/intelligence/providers/types";
import type { IntelligenceToolContext } from "@/features/intelligence/tools/types";
import type { UsuarioIntelligence } from "@/features/intelligence/types";

// Provider fake — controlado pelo teste, nunca chama rede/API real.
// Reinjetado a cada teste via vi.mock (mesmo padrão de módulo).
let respostasEnfileiradas: ProviderRunResult[] = [];
const providerFake: IntelligenceProvider = {
  nome: "fake",
  async run() {
    const proxima = respostasEnfileiradas.shift();
    if (!proxima) throw new Error("Provider fake ficou sem respostas enfileiradas — teste mal configurado.");
    return proxima;
  },
};

vi.mock("@/features/intelligence/providers", () => ({
  obterProvider: () => providerFake,
  obterModeloConfigurado: () => "modelo-de-teste",
}));

// Precisa ser importado DEPOIS do vi.mock (hoisted pelo Vitest, mas o
// import fica explícito aqui por clareza).
const { executarConversaIntelligence, MAX_TOOL_CALLS_POR_PERGUNTA } = await import("@/features/intelligence/orchestrator");

function usuarioSemPermissao(): UsuarioIntelligence {
  return { id: "u1", nome: "Teste", papel: "usuario", permissoes: [] };
}
function ctx(): IntelligenceToolContext {
  return { supabase: {} as never, usuario: usuarioSemPermissao(), agora: new Date(2026, 8, 3) };
}

const USAGE = { inputTokens: 10, outputTokens: 5 };

describe("Orquestrador — limite de chamadas de tool (§19 da instrução, MAX 4)", () => {
  beforeEach(() => { respostasEnfileiradas = []; });

  it("caso 1: nunca executa mais que MAX_TOOL_CALLS_POR_PERGUNTA chamadas de tool, mesmo se o provider insistir em pedir mais", async () => {
    expect(MAX_TOOL_CALLS_POR_PERGUNTA).toBe(4);
    // Provider pede 1 tool call por rodada, 6 rodadas seguidas (mais que o limite).
    for (let i = 0; i < 6; i++) {
      respostasEnfileiradas.push({ type: "tool_calls", toolCalls: [{ id: `call-${i}`, name: "get_factory_overview", arguments: {} }], usage: USAGE });
    }
    const resultado = await executarConversaIntelligence(ctx(), { message: "como está a fábrica?" });
    expect(resultado.toolsChamadas.length).toBeLessThanOrEqual(4);
    expect(resultado.atingiuLimiteDeChamadas).toBe(true);
    expect(resultado.answer.length).toBeGreaterThan(0); // nunca resposta vazia mesmo no limite.
  });

  it("caso 2: resposta final direta (sem tool) não gasta nenhuma chamada de tool", async () => {
    respostasEnfileiradas.push({ type: "final_text", text: "Não há dados no período.", usage: USAGE });
    const resultado = await executarConversaIntelligence(ctx(), { message: "oi" });
    expect(resultado.toolsChamadas.length).toBe(0);
    expect(resultado.answer).toBe("Não há dados no período.");
  });

  it("caso 3: usage é somado corretamente entre as rodadas", async () => {
    respostasEnfileiradas.push({ type: "final_text", text: "ok", usage: { inputTokens: 100, outputTokens: 50 } });
    const resultado = await executarConversaIntelligence(ctx(), { message: "oi" });
    expect(resultado.usage.inputTokens).toBe(100);
    expect(resultado.usage.outputTokens).toBe(50);
  });
});

describe("Orquestrador — filtro de causalidade, no máximo 1 reformulação (§15)", () => {
  beforeEach(() => { respostasEnfileiradas = []; });

  it("caso 4: resposta sem violação passa direto, sem pedir reformulação", async () => {
    respostasEnfileiradas.push({ type: "final_text", text: "A Performance está calculada em 92%.", usage: USAGE });
    const resultado = await executarConversaIntelligence(ctx(), { message: "como está a performance?" });
    expect(resultado.causalidadeCorrigida).toBe(false);
    expect(resultado.answer).toContain("92%");
  });

  it("caso 5: resposta com causalidade indevida gera EXATAMENTE 1 pedido de reformulação, e usa a versão corrigida se ela vier limpa", async () => {
    respostasEnfileiradas.push({ type: "final_text", text: "A queda foi causado por uma parada.", usage: USAGE });
    respostasEnfileiradas.push({ type: "final_text", text: "A queda coincidiu com uma parada no mesmo período.", usage: USAGE });
    const resultado = await executarConversaIntelligence(ctx(), { message: "por que caiu?" });
    expect(resultado.causalidadeCorrigida).toBe(true);
    expect(resultado.answer).toBe("A queda coincidiu com uma parada no mesmo período.");
    expect(respostasEnfileiradas.length).toBe(0); // as duas respostas enfileiradas foram consumidas, nenhuma terceira tentativa.
  });

  it("caso 6: se a reformulação AINDA violar, nunca expõe nenhuma das duas versões causais — usa o texto seguro fixo", async () => {
    respostasEnfileiradas.push({ type: "final_text", text: "Isso foi causado por X.", usage: USAGE });
    respostasEnfileiradas.push({ type: "final_text", text: "Ainda assim, isso foi causado por Y.", usage: USAGE });
    const resultado = await executarConversaIntelligence(ctx(), { message: "por que?" });
    expect(resultado.causalidadeCorrigida).toBe(true);
    expect(resultado.answer).not.toContain("causado por");
    expect(respostasEnfileiradas.length).toBe(0); // nunca uma 3ª tentativa (nunca loop).
  });
});
