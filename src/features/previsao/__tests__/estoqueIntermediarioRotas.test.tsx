import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Produto } from "@/types/domain";
import { C, CAN, CAIXA, MAQ, modelo } from "@/features/produto-canonico/__tests__/fixture";

const MSG = "INDICADOR TEMPORARIAMENTE INDISPONÍVEL PARA PRODUTO COM ROTAS ALTERNATIVAS.";
const controle = (id: string, produtoId: string) => ({
  controle: { id, produtoId, etapaOrigemId: "e1", etapaSeguinteId: "e2" }, estimado: { valor: 10 }, confirmadoDisponivel: 0, alocado: 0, status: "estimado", inconsistencias: [], acimaDoLimite: false,
});
vi.mock("@/lib/escala/wipCliente", () => ({
  consultarWip: vi.fn(async () => ({ ok: true, modoWip: true, podeAlterar: true, hoje: "2026-11-09", controles: [controle("c1", "c0000000-0000-4000-8000-000000000001"), controle("c2", "238ca607-2111-4aff-9a19-a9ae6f20da7e")] })),
  acaoWip: vi.fn(),
}));
vi.mock("@/features/previsao/estoqueIntermediarioTexto", () => ({
  alertaInconsistencia: () => "", exigeMotivo: () => false, linhaLimiteWip: () => null, linhaPrevistoWip: () => "linha", resumoCabecalhoWip: (c: unknown[]) => `${c.length} controle(s)`,
  ROTULO_STATUS_WIP: { estimado: "Estimado" }, textoUltimaConfirmacao: () => "—",
}));

import EstoqueIntermediario from "@/features/previsao/components/EstoqueIntermediario";

const mt = { m1: 1, m2: 1, m3: 1, t1: 1, t2: 1, t3: 1 };
const conector = { id: CAN, nome: "Conector 3/4", referencia: "", valorUnitario: 1, ativo: true, prioridade: "media", roteiro: [C.m8, C.ros, C.par, C.eti, C.emb].map((id, i) => ({ id, operacao: ["M8", "Rosquear", "Parafusar", "Etiquetar", "Embalar"][i], metas: mt, maquinasIds: [MAQ.m8] })) } as Produto;
const linear = { id: CAIXA, nome: "Caixa", referencia: "", valorUnitario: 1, ativo: true, prioridade: "media", roteiro: [{ id: "a", operacao: "Cortar", metas: mt, maquinasIds: [] }, { id: "b", operacao: "Embalar", metas: mt, maquinasIds: [] }] } as Produto;

describe("Estoque intermediário × produto com rotas alternativas", () => {
  it("controle do produto único mostra a mensagem (sem saldo estimado); o seletor de pares não oferece pares consecutivos por ordem do produto único", async () => {
    const { rerender } = render(<EstoqueIntermediario semanaInicio="2026-11-09" produtos={[conector, linear]} modelosRotas={[modelo()]} />);
    await waitFor(() => expect(screen.getByTestId("wip-indisponivel")).toBeTruthy());
    expect(screen.getByTestId("wip-indisponivel").textContent).toContain(MSG);
    fireEvent.click(screen.getByText("Controlar novo par de etapas"));
    const opcoes = [...document.querySelectorAll("select option")].map((o) => o.textContent ?? "");
    expect(opcoes.some((t) => t.includes("Caixa — Cortar → Embalar"))).toBe(true);
    expect(opcoes.some((t) => t.includes("Conector"))).toBe(false);
    rerender(<EstoqueIntermediario semanaInicio="2026-11-09" produtos={[conector, linear]} modelosRotas={[]} />); // sem modelo vigente: pares de sempre
    expect([...document.querySelectorAll("select option")].some((o) => (o.textContent ?? "").includes("Conector 3/4 — M8 → Rosquear"))).toBe(true);
  });
});
