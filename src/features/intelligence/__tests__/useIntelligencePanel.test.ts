import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useIntelligencePanel } from "@/features/intelligence/useIntelligencePanel";

vi.mock("@/services/supabase-client", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

import { supabase } from "@/services/supabase-client";

function mockSessao(token: string | undefined) {
  (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    data: { session: token ? { access_token: token } : null },
  });
}

describe("useIntelligencePanel — controlador do painel (§17/§18/§19 da instrução)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSessao("token-fake");
  });

  it("abrir/fechar/toggle controlam `aberta`", () => {
    const { result } = renderHook(() => useIntelligencePanel());
    expect(result.current.aberta).toBe(false);
    act(() => result.current.abrir());
    expect(result.current.aberta).toBe(true);
    act(() => result.current.fechar());
    expect(result.current.aberta).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.aberta).toBe(true);
  });

  it("contexto entre perguntas: a 2ª pergunta reenvia a 1ª pergunta+resposta como `history` (mesma técnica validada nos evals reais — nenhum armazenamento novo)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          answer: "Embalagem 17 sem dados na semana atual.",
          evidences: [], followUps: [], context: {}, usage: { inputTokens: 1, outputTokens: 1 },
          debug: { toolsChamadas: [], atingiuLimiteDeChamadas: false, causalidadeCorrigida: false },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          answer: "Comparado à semana passada, também sem dados.",
          evidences: [], followUps: [], context: {}, usage: { inputTokens: 1, outputTokens: 1 },
          debug: { toolsChamadas: [], atingiuLimiteDeChamadas: false, causalidadeCorrigida: false },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useIntelligencePanel());
    await act(async () => {
      await result.current.enviar("Analise a Embalagem 17.");
    });
    await waitFor(() => expect(result.current.turnos[0].resposta).toBeDefined());

    await act(async () => {
      await result.current.enviar("E comparado à semana passada?");
    });
    await waitFor(() => expect(result.current.turnos[1].resposta).toBeDefined());

    const segundaChamada = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(segundaChamada.history).toEqual([
      { role: "user", content: "Analise a Embalagem 17." },
      { role: "assistant", content: "Embalagem 17 sem dados na semana atual." },
    ]);
    expect(segundaChamada.message).toBe("E comparado à semana passada?");
  });

  it("nunca envia pergunta em branco nem envio duplicado enquanto já está enviando", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {})); // nunca resolve
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useIntelligencePanel());

    await act(async () => {
      await result.current.enviar("   ");
    });
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      result.current.enviar("primeira pergunta");
    });
    act(() => {
      result.current.enviar("segunda pergunta enquanto a primeira ainda carrega");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("429 vira mensagem segura de rate limit — nunca o texto cru do servidor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ erro: "Você atingiu o limite de 30 perguntas por hora." }) }));
    const { result } = renderHook(() => useIntelligencePanel());
    await act(async () => {
      await result.current.enviar("pergunta");
    });
    expect(result.current.turnos[0].erroSeguro).toBe("Limite temporário de consultas atingido. Tente novamente em alguns minutos.");
  });

  it("500 (inclui falha do provider/billing) vira mensagem genérica segura — nunca expõe o erro técnico do provider", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ erro: "Integração com o provider de IA não está configurada neste ambiente." }) }));
    const { result } = renderHook(() => useIntelligencePanel());
    await act(async () => {
      await result.current.enviar("pergunta");
    });
    expect(result.current.turnos[0].erroSeguro).toBe("A Intelligence está temporariamente indisponível.");
    expect(result.current.turnos[0].erroSeguro).not.toContain("provider");
    // detalhe técnico só existe no campo separado de debug, nunca no texto pra tela:
    expect(result.current.turnos[0].erroTecnico).toContain("provider");
  });

  it("falha de rede (fetch lança exceção) vira 'não foi possível consultar agora'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { result } = renderHook(() => useIntelligencePanel());
    await act(async () => {
      await result.current.enviar("pergunta");
    });
    expect(result.current.turnos[0].erroSeguro).toBe("Não foi possível consultar a Intelligence agora.");
  });

  it("sem sessão Supabase, nunca chama o endpoint — trata como sessão expirada", async () => {
    mockSessao(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useIntelligencePanel());
    await act(async () => {
      await result.current.enviar("pergunta");
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.turnos[0].erroSeguro).toContain("sessão expirou");
  });
});
