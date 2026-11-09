// @vitest-environment jsdom
// Fluxo EXATO de 09/11/2026: Produção real → Apontamentos realizados → Editar apontamento → campo Produto.
// Com produto_unico_cutover = null e a semana em PLANEJAMENTO (modo manual), o seletor mostra os legados E o "Conector 3/4" (Produto Único)";
// ao selecionar o único e salvar, a RPC editar_apontamento_producao recebe o produto único e a MESMA quantidade/operador (nada é migrado sozinho).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

const CONV = "27c229d7-f192-41eb-aad1-0c69ece53eba", AUTO = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee", UNICO = "d640534d-1e0b-4512-b087-2aca0a828b17", CAIXA = "cx-1";
const rpc = vi.fn();
const tabelas: Record<string, unknown[]> = {
  roteiro_etapa_maquinas: [CONV, AUTO, UNICO, CAIXA].map((id, i) => ({ roteiro_etapas: { produto_id: id, produtos: { id, nome: ["Conector 3/4\"", "Conector 3/4\" - Maquina Automatica ", "Conector 3/4\" (Produto Único)", "Caixa Amarela 4x4"][i], ativo: true } } })),
  produto_canonico: [{ produto_id: UNICO }],
  produto_legado_mapa: [{ produto_legado_id: CONV }, { produto_legado_id: AUTO }],
  apontamento_paradas: [],
  motivos_parada: [],
};
function builder(tabela: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "returns", "in", "is", "limit"]) b[m] = () => b;
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tabelas[tabela] ?? [], error: null }).then(ok);
  return b;
}
vi.mock("@/services/supabase-client", () => ({ supabase: { from: (t: string) => builder(t), rpc: (...a: unknown[]) => rpc(...a) } }));
import ResumoApontamentoModal from "../ResumoApontamentoModal";

const APONTAMENTO = {
  id: "ap-1", data: "2026-11-09", periodoId: "m1", periodoNome: "M1", maquinaId: "mq-rosq3", maquinaNome: "Rosqueadeira 3", produtoId: CONV, produtoNome: "Conector 3/4\"",
  funcionarioId: "f-1", funcionarioNome: "Elizabeth", quantidadeProduzida: 1848, quantidadeRefugo: 0, status: "produzindo" as const, motivoSemProducao: null, descricaoSemProducao: null, observacao: null,
  metaPeriodoVigente: 2000, duracaoPeriodoHorasVigente: 1.6, performancePct: 92,
};

beforeEach(() => {
  cleanup(); rpc.mockReset();
  rpc.mockImplementation(async (nome: string) => {
    if (nome === "produto_unico_cutover") return { data: null, error: null };
    if (nome === "produto_unico_planejamento_desde") return { data: "2026-11-09", error: null };
    if (nome === "editar_apontamento_producao") return { data: { meta_periodo_vigente: 2000 }, error: null };
    return { data: null, error: null };
  });
});

describe("Editar apontamento de 09/11: seletor de Produto com o cutover desligado", () => {
  it("lista os legados e o Produto Único; selecionar o único e salvar chama a RPC com o produto novo e o resto intacto", async () => {
    const onEditado = vi.fn();
    render(<ResumoApontamentoModal apontamento={APONTAMENTO} funcionariosAtivos={[{ id: "f-1", nome: "Elizabeth" }]} podeConverterStatus={false} onFechar={() => undefined} onEditado={onEditado} onExcluido={() => undefined} />);
    fireEvent.click(screen.getByText("Editar apontamento"));
    const sel = (await screen.findAllByRole("combobox")).find((s) => Array.from((s as HTMLSelectElement).options).some((o) => /Conector/.test(o.textContent ?? ""))) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(sel.options).map((o) => o.textContent?.trim())).toContain("Conector 3/4\" (Produto Único)"));
    expect(Array.from(sel.options).map((o) => o.textContent?.trim())).toEqual(expect.arrayContaining(["Conector 3/4\"", "Conector 3/4\" - Maquina Automatica"]));
    fireEvent.change(sel, { target: { value: UNICO } });
    fireEvent.change(screen.getByPlaceholderText(/balança/i), { target: { value: "migrar para o produto único" } });
    fireEvent.click(screen.getByText("Salvar alterações"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("editar_apontamento_producao", expect.objectContaining({ p_apontamento_id: "ap-1", p_produto_id: UNICO, p_funcionario_id: "f-1", p_quantidade_produzida: 1848, p_quantidade_refugo: 0 })));
    await waitFor(() => expect(onEditado).toHaveBeenCalledWith("ap-1", expect.objectContaining({ produtoId: UNICO, quantidadeProduzida: 1848 })));
  });

  it("com o cutover desligado e SEM planejamento habilitado, o único continua escondido (legado puro)", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: null }));
    render(<ResumoApontamentoModal apontamento={APONTAMENTO} funcionariosAtivos={[{ id: "f-1", nome: "Elizabeth" }]} podeConverterStatus={false} onFechar={() => undefined} onEditado={() => undefined} onExcluido={() => undefined} />);
    fireEvent.click(screen.getByText("Editar apontamento"));
    await waitFor(() => expect(screen.getAllByRole("option").some((o) => /Conector 3\/4" - Maq/.test(o.textContent ?? ""))).toBe(true));
    expect(screen.queryByText("Conector 3/4\" (Produto Único)")).toBeNull();
  });
});
