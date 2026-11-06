// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@/services/supabase-client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
import RegularizacaoHistoricaModal from "../RegularizacaoHistoricaModal";

const ESTADO = {
  datas: ["2026-11-05"],
  periodos: [{ id: "m1", nome: "M1", inicio: "07:12", fim: "08:48" }, { id: "m2", nome: "M2", inicio: "08:48", fim: "10:24" }],
  maquinas: [{ id: "mq1", nome: "Máquina 1" }, { id: "mq2", nome: "Máquina 2" }],
  funcionarios: [{ id: "f1", nome: "Ana" }, { id: "f2", nome: "Bia" }],
  produtos: [{ id: "p1", nome: "Produto A" }, { id: "p2", nome: "Produto B" }],
  combinacoes: [
    { maquina_id: "mq1", produto_id: "p1", etapa_id: "e1", operacao: "Furar", metas: {} },
    { maquina_id: "mq2", produto_id: "p2", etapa_id: "e2", operacao: "Rosquear", metas: {} },
  ],
  estado_periodos: [{ periodo_id: "m1", estado: "CONFIRMADO" }],
  apontamentos: [{ id: "a1", periodo_id: "m1", maquina_id: "mq1", maquina: "Máquina 1", funcionario_id: "f1", funcionario: "Ana", produto_id: "p1", produto: "Produto A", etapa_id: "e1", operacao: "Furar", status: "produzindo", motivo_sem_producao: null, produzido: 100, refugo: 1, regularizado: false, planejado: { funcionario: "Zé", produto: "Produto C" } }],
};

beforeEach(() => {
  cleanup(); rpc.mockReset();
  rpc.mockImplementation(async (nome: string) => (nome === "regularizacao_historica_estado" ? { data: ESTADO, error: null } : { data: { ok: true, acao: "INCLUIDO" }, error: null }));
});

describe("Regularização histórica (tela)", () => {
  it("lista o existente com o planejado, filtra produtos pela máquina e salva em sequência chamando a RPC com os campos livres", async () => {
    render(<RegularizacaoHistoricaModal onFechar={() => undefined} />);
    await screen.findByText(/Apontamentos existentes \(1\)/);
    expect(screen.getByText(/Planejado: Zé/)).toBeTruthy();
    expect(screen.getByText(/Fechamento deste período: CONFIRMADO/)).toBeTruthy();
    const [selData, selMaq, selOper, selProd] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(selData.value).toBe("2026-11-05");
    fireEvent.change(selMaq, { target: { value: "mq2" } });
    expect(Array.from(selProd.options).map((o) => o.textContent)).toEqual(["Selecione…", "Produto B"]);   // só o produto cadastrado para a máquina
    fireEvent.change(selOper, { target: { value: "f2" } });
    fireEvent.change(selProd, { target: { value: "p2" } });
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "250" } });
    fireEvent.change(screen.getAllByRole("spinbutton")[1], { target: { value: "5" } });
    fireEvent.click(screen.getByText("Salvar e adicionar outro"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("regularizar_apontamento_historico", expect.objectContaining({ p_data: "2026-11-05", p_periodo_id: "m1", p_maquina_id: "mq2", p_funcionario_id: "f2", p_produto_id: "p2", p_produzido: 250, p_refugo: 5, p_etapa_id: "e2", p_apontamento_id: null })));
    await screen.findByText(/Pode lançar o próximo/);
    expect((screen.getAllByRole("combobox")[1] as HTMLSelectElement).value).toBe("");       // formulário limpo para o próximo
  });
  it("máquina que já tem apontamento no período oferece editar o existente (sem duplicar) e a edição envia o id", async () => {
    render(<RegularizacaoHistoricaModal onFechar={() => undefined} />);
    await screen.findByText(/Apontamentos existentes \(1\)/);
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "mq1" } });
    fireEvent.click(screen.getByText("Editar o existente"));
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "180" } });
    fireEvent.click(screen.getByText("Salvar alteração"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("regularizar_apontamento_historico", expect.objectContaining({ p_apontamento_id: "a1", p_produzido: 180, p_maquina_id: "mq1" })));
  });
  it("erro do banco vira mensagem em português", async () => {
    rpc.mockImplementation(async (nome: string) => (nome === "regularizacao_historica_estado" ? { data: ESTADO, error: null } : { data: null, error: { message: "COMBINACAO_INVALIDA: x" } }));
    render(<RegularizacaoHistoricaModal onFechar={() => undefined} />);
    await screen.findByText(/Apontamentos existentes/);
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "mq2" } });
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "f1" } });
    fireEvent.change(screen.getAllByRole("combobox")[3], { target: { value: "p2" } });
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "10" } });
    fireEvent.click(screen.getByText("Salvar e adicionar outro"));
    await screen.findByText(/não tem este produto\/operação cadastrado/);
  });
  it("SEM PRODUÇÃO: marca, escolhe o motivo e chama a RPC própria sem pedir operador/produto/quantidades", async () => {
    render(<RegularizacaoHistoricaModal onFechar={() => undefined} />);
    await screen.findByText(/Apontamentos existentes/);
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "mq2" } });
    fireEvent.click(screen.getByLabelText(/SEM PRODUÇÃO/));
    expect(screen.queryByText("4. Operador")).toBeNull();
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "falta_operador" } });
    fireEvent.click(screen.getByText("Salvar e adicionar outro"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("regularizar_sem_producao_historico", expect.objectContaining({ p_data: "2026-11-05", p_periodo_id: "m1", p_maquina_id: "mq2", p_motivo: "falta_operador", p_descricao: null, p_apontamento_id: null })));
  });
});
