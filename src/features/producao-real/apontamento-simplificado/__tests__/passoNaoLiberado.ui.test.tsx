// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

const estado = vi.fn();
vi.mock("../api", () => ({ estadoApontamentosApi: (...a: unknown[]) => estado(...a), salvarApontamentosApi: vi.fn() }));
import PassoApontamentos from "../PassoApontamentos";

beforeEach(() => { cleanup(); estado.mockReset(); });

describe("PassoApontamentos — período ainda não liberado (lançado pela regularização)", () => {
  it("NÃO bloqueia o fechamento (onModo(true)) e mostra os postos que ainda faltam", async () => {
    estado.mockResolvedValue({ status: 200, corpo: { modo: "ativo", naoLiberado: true, postos: [] } });
    const onModo = vi.fn();
    render(<PassoApontamentos data="2026-11-06" periodoId="m2" bloqueado={false} pendentesNomes={["Parafusadeira 10", "Rosqueadeira 6"]} onModo={onModo} onSalvo={() => undefined} onNaoSalvo={() => undefined} />);
    await screen.findByText(/PERÍODO LANÇADO FORA DA PROGRAMAÇÃO AUTOMÁTICA/);
    expect(onModo).toHaveBeenCalledWith(true);
    expect(screen.getByText(/Faltam lançamentos de: Parafusadeira 10, Rosqueadeira 6/)).toBeTruthy();
    expect(screen.queryByText("NÃO FOI POSSÍVEL CARREGAR OS POSTOS PROGRAMADOS.")).toBeNull();
  });
  it("sem pendentes mostra que todos os postos têm lançamento", async () => {
    estado.mockResolvedValue({ status: 200, corpo: { modo: "ativo", naoLiberado: true, postos: [] } });
    render(<PassoApontamentos data="2026-11-06" periodoId="m2" bloqueado={false} pendentesNomes={[]} onModo={() => undefined} onSalvo={() => undefined} onNaoSalvo={() => undefined} />);
    await screen.findByText(/Todos os postos programados têm lançamento/);
  });
  it("fluxo desligado continua bloqueando (onModo(false)); erro de rede continua fail-closed", async () => {
    estado.mockResolvedValue({ status: 200, corpo: { modo: "desligado" } });
    const onModo = vi.fn();
    render(<PassoApontamentos data="2026-11-06" periodoId="m2" bloqueado={false} onModo={onModo} onSalvo={() => undefined} onNaoSalvo={() => undefined} />);
    await waitFor(() => expect(onModo).toHaveBeenCalledWith(false));
    cleanup();
    estado.mockRejectedValue(new Error("rede"));
    render(<PassoApontamentos data="2026-11-06" periodoId="m2" bloqueado={false} onModo={() => undefined} onSalvo={() => undefined} onNaoSalvo={() => undefined} />);
    await screen.findByText("NÃO FOI POSSÍVEL CARREGAR OS POSTOS PROGRAMADOS.");
  });
});
