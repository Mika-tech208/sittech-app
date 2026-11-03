import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { EstadoApontamentosApi } from "../api";

const estadoApontamentosApi = vi.fn();
const salvarApontamentosApi = vi.fn();
vi.mock("../api", () => ({ estadoApontamentosApi: (...a: unknown[]) => estadoApontamentosApi(...a), salvarApontamentosApi: (...a: unknown[]) => salvarApontamentosApi(...a) }));
const abrirFechamentoApi = vi.fn();
vi.mock("../../fechamento/api", () => ({
  abrirFechamentoApi: (...a: unknown[]) => abrirFechamentoApi(...a), confirmarFechamentoApi: vi.fn(), retryFechamentoApi: vi.fn(),
  estadoFechamentoApi: vi.fn(async () => ({ status: 200, corpo: { modo: "ativo", fechado: false } })),
}));

import PassoApontamentos from "../PassoApontamentos";
import FechamentoPeriodoModal from "../../fechamento/FechamentoPeriodoModal";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ESTADO: EstadoApontamentosApi = {
  modo: "ativo",
  postos: [
    { maquinaId: U(1), maquinaNome: "Rosqueadeira 3", funcionarioId: U(11), funcionarioNome: "Caroline Souza", produtoId: U(21), produtoNome: "Conector 3/4", etapaId: U(31), operacaoId: U(41), operacaoNome: "Rosquear", pecas: 1500 },
    { maquinaId: U(2), maquinaNome: "Rosqueadeira 6", funcionarioId: U(12), funcionarioNome: "Elizabeth Lima", produtoId: U(21), produtoNome: "Conector 3/4", etapaId: U(31), operacaoId: U(41), operacaoNome: "Rosquear", pecas: 1546 },
  ],
  catalogo: {
    maquinas: [{ id: U(1), nome: "Rosqueadeira 3" }, { id: U(2), nome: "Rosqueadeira 6" }, { id: U(3), nome: "Etiquetadora 15" }],
    funcionarios: [{ id: U(11), nome: "Caroline Souza" }, { id: U(12), nome: "Elizabeth Lima" }],
    produtos: [{ id: U(21), nome: "Conector 3/4" }], operacoes: { [U(41)]: "Rosquear" },
    elegibilidade: [{ maquinaId: U(1), produtoId: U(21), etapaId: U(31), operacaoId: U(41) }, { maquinaId: U(2), produtoId: U(21), etapaId: U(31), operacaoId: U(41) }, { maquinaId: U(3), produtoId: U(21), etapaId: U(32), operacaoId: U(41) }],
  },
  existentes: [], vinculos: [],
};

beforeEach(() => {
  if (!globalThis.crypto?.randomUUID) { let n = 5000; vi.stubGlobal("crypto", { randomUUID: () => U(++n) }); }
  estadoApontamentosApi.mockReset(); salvarApontamentosApi.mockReset(); abrirFechamentoApi.mockReset();
  estadoApontamentosApi.mockResolvedValue({ status: 200, corpo: ESTADO });
  salvarApontamentosApi.mockResolvedValue({ status: 200, corpo: { ok: true, substituidas: 0, linhas: [] } });
});
afterEach(() => cleanup());

describe("PassoApontamentos (UI)", () => {
  const monta = (over: Partial<Parameters<typeof PassoApontamentos>[0]> = {}) => {
    const p = { onModo: vi.fn(), onSalvo: vi.fn(), onNaoSalvo: vi.fn() };
    render(<PassoApontamentos data="2026-11-03" periodoId="m2" {...p} {...over} />);
    return p;
  };

  it("flag desligada: avisa o pai (onModo(false)) e não renderiza nada", async () => {
    estadoApontamentosApi.mockResolvedValue({ status: 200, corpo: { modo: "desligado" } });
    const p = monta();
    await waitFor(() => expect(p.onModo).toHaveBeenCalledWith(false));
    expect(screen.queryByTestId("passo-apontamentos")).toBeNull();
  });

  it("mostra só os postos programados, pré-preenchidos; produzido+refugo; NÃO PRODUZIU com motivo; salva o lote", async () => {
    const p = monta();
    await screen.findByText("Rosqueadeira 3");
    expect(screen.getAllByText(/Programado:/)).toHaveLength(2);
    expect(screen.queryByText("Etiquetadora 15", { selector: ".stx-apx-maq" })).toBeNull();           // máquina não programada: sem cartão
    expect(screen.getByText(/Programado: Caroline · Conector 3\/4 · Rosquear · 1\.500 pç/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "SALVAR APONTAMENTOS" })).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Produzido Rosqueadeira 3"), { target: { value: "1480" } });
    fireEvent.change(screen.getByLabelText("Refugo Rosqueadeira 3"), { target: { value: "12" } });
    const cartao6 = screen.getByText("Rosqueadeira 6").closest(".stx-apx-card") as HTMLElement;
    fireEvent.click(within(cartao6).getByRole("button", { name: "NÃO PRODUZIU" }));
    expect(await screen.findByText("Escolha o motivo do NÃO PRODUZIU.")).toBeTruthy();
    fireEvent.click(within(cartao6).getByRole("button", { name: "Sem material" }));
    await waitFor(() => expect(p.onNaoSalvo).toHaveBeenLastCalledWith(true));

    fireEvent.click(screen.getByRole("button", { name: "SALVAR APONTAMENTOS" }));
    await waitFor(() => expect(salvarApontamentosApi).toHaveBeenCalledTimes(1));
    const [data, periodo, linhas] = salvarApontamentosApi.mock.calls[0];
    expect([data, periodo]).toEqual(["2026-11-03", "m2"]);
    expect(linhas).toEqual([
      expect.objectContaining({ maquina_planejada_id: U(1), maquina_id: U(1), produto_id: U(21), funcionario_id: U(11), produzido: 1480, refugo: 12, nao_produziu: false }),
      expect.objectContaining({ maquina_planejada_id: U(2), maquina_id: U(2), produto_id: null, nao_produziu: true, motivo: "SEM_MATERIAL" }),
    ]);
    await waitFor(() => expect(p.onSalvo).toHaveBeenCalled());
  });

  it("tudo editável: trocar a máquina/operador marca a divergência e vai no payload como REAL; o programado continua exibido", async () => {
    monta();
    await screen.findByText("Rosqueadeira 3");
    const cartao = screen.getByText("Rosqueadeira 3").closest(".stx-apx-card") as HTMLElement;
    fireEvent.change(within(cartao).getByLabelText("Produzido Rosqueadeira 3"), { target: { value: "700" } });
    fireEvent.click(within(cartao).getByRole("button", { name: "Alterar máquina / operador / produto" }));
    fireEvent.change(within(cartao).getByLabelText(/Operador/), { target: { value: U(12) } });
    fireEvent.change(within(cartao).getByLabelText("Máquina"), { target: { value: U(3) } });
    const selo = await within(cartao).findByText("ALTERADO DO PLANEJADO");
    expect(selo.getAttribute("title")).toBe("Planejado ≠ real: máquina alterada, operador alterado");
    expect(within(cartao).getByText(/Programado: Caroline/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "SALVAR APONTAMENTOS" }));
    await waitFor(() => expect(salvarApontamentosApi).toHaveBeenCalled());
    expect(salvarApontamentosApi.mock.calls[0][2][0]).toMatchObject({ maquina_planejada_id: U(1), maquina_id: U(3), funcionario_id: U(12), produto_id: U(21), produzido: 700 });
  });

  it("selo ALTERADO DO PLANEJADO: aparece só quando operador, máquina ou produto mudam; some ao voltar ao plano; salvar não pede confirmação extra", async () => {
    monta();
    await screen.findByText("Rosqueadeira 3");
    const cartao = screen.getByText("Rosqueadeira 3").closest(".stx-apx-card") as HTMLElement;
    fireEvent.change(within(cartao).getByLabelText("Produzido Rosqueadeira 3"), { target: { value: "700" } });
    expect(screen.queryAllByTestId("selo-alterado")).toHaveLength(0);                    // só quantidades: nada alterado
    fireEvent.click(within(cartao).getByRole("button", { name: "Alterar máquina / operador / produto" }));
    fireEvent.change(within(cartao).getByLabelText(/Operador/), { target: { value: U(12) } });
    expect((await within(cartao).findByTestId("selo-alterado")).textContent).toBe("ALTERADO DO PLANEJADO");
    expect(screen.queryAllByTestId("selo-alterado")).toHaveLength(1);                    // só nesta linha
    fireEvent.change(within(cartao).getByLabelText(/Operador/), { target: { value: U(11) } });
    await waitFor(() => expect(screen.queryAllByTestId("selo-alterado")).toHaveLength(0));
    fireEvent.change(within(cartao).getByLabelText(/Operador/), { target: { value: U(12) } });
    await screen.findByTestId("selo-alterado");
    fireEvent.click(screen.getByRole("button", { name: "SALVAR APONTAMENTOS" }));        // um toque: sem diálogo de confirmação
    await waitFor(() => expect(salvarApontamentosApi).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("NÃO PRODUZIU oferece 'Parada' com esse nome e grava o motivo fino PARADA", async () => {
    monta();
    await screen.findByText("Rosqueadeira 3");
    const cartao = screen.getByText("Rosqueadeira 3").closest(".stx-apx-card") as HTMLElement;
    fireEvent.click(within(cartao).getByRole("button", { name: "NÃO PRODUZIU" }));
    expect(within(cartao).getAllByRole("button").map((b) => b.textContent)).toContain("Parada");
    fireEvent.click(within(cartao).getByRole("button", { name: "Parada" }));
    fireEvent.click(screen.getByRole("button", { name: "SALVAR APONTAMENTOS" }));
    await waitFor(() => expect(salvarApontamentosApi).toHaveBeenCalled());
    expect(salvarApontamentosApi.mock.calls[0][2][0]).toMatchObject({ maquina_id: U(1), nao_produziu: true, motivo: "PARADA" });
  });

  it("+ ADICIONAR APONTAMENTO cria linha FORA DA ESCALA (maquina_planejada_id null); em branco não bloqueia nem é enviada", async () => {
    monta();
    await screen.findByText("Rosqueadeira 3");
    fireEvent.click(screen.getByRole("button", { name: "+ ADICIONAR APONTAMENTO" }));
    expect(await screen.findByText("FORA DA ESCALA")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Produzido Rosqueadeira 3"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "SALVAR APONTAMENTOS" }));
    await waitFor(() => expect(salvarApontamentosApi).toHaveBeenCalled());
    expect(salvarApontamentosApi.mock.calls[0][2]).toHaveLength(1);       // a extra vazia não vai
    cleanup(); salvarApontamentosApi.mockClear();

    monta();
    await screen.findByText("Rosqueadeira 3");
    fireEvent.click(screen.getByRole("button", { name: "+ ADICIONAR APONTAMENTO" }));
    const extra = (await screen.findByText("FORA DA ESCALA")).closest(".stx-apx-card") as HTMLElement;
    const selects = within(extra).getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: U(3) } });
    fireEvent.change(selects[1], { target: { value: U(11) } });
    fireEvent.change(selects[2], { target: { value: U(21) } });
    fireEvent.change(within(extra).getByLabelText(/Produzido/), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("Produzido Rosqueadeira 3"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "SALVAR APONTAMENTOS" }));
    await waitFor(() => expect(salvarApontamentosApi).toHaveBeenCalled());
    expect(salvarApontamentosApi.mock.calls[0][2][1]).toMatchObject({ maquina_planejada_id: null, maquina_id: U(3), produzido: 300 });
  });

  it("erro do servidor: mostra a mensagem, não recarrega e mantém o que foi digitado", async () => {
    salvarApontamentosApi.mockResolvedValue({ status: 422, corpo: { erro: "LINHA[x]: Meta não cadastrada", mensagem: "Nada foi gravado." } });
    const p = monta();
    await screen.findByText("Rosqueadeira 3");
    fireEvent.change(screen.getByLabelText("Produzido Rosqueadeira 3"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "SALVAR APONTAMENTOS" }));
    expect(await screen.findByText(/Meta não cadastrada/)).toBeTruthy();
    expect(p.onSalvo).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Produzido Rosqueadeira 3") as HTMLInputElement).value).toBe("9");
  });
});

describe("FechamentoPeriodoModal com a flag do apontamento simplificado", () => {
  const abertura = (pend: boolean) => ({
    status: 200, corpo: {
      ok: true, abertura_id: "ab", valido_ate_ms: Date.now() + 1e6, periodo: { data: "2026-11-03", periodo_id: "m2", rotulo: "M2", fim_ms: 1, proximo: { rotulo: "M3", periodo_id: "m3" } },
      postos: [{ maquinaId: "a", nome: "Rosqueadeira 3", status: pend ? "pendente" : "produzindo", produzido: 0, refugo: 0, motivo: null }], tem_pendentes: pend,
      buffers: [{ buffer_id: "b1", rotulo: "Rosqueadas aguardando Parafusar", estimado: 100, estimado_lo: 100, estimado_hi: 100 }], pode_excecao: false, pares_sem_buffer: [], alertas: [],
    },
  });

  it("flag DESLIGADA: mostra o fluxo anterior (seção Apontamentos com 'Atualizar'), sem passos e sem o novo componente", async () => {
    estadoApontamentosApi.mockResolvedValue({ status: 200, corpo: { modo: "desligado" } });
    abrirFechamentoApi.mockResolvedValue(abertura(true));
    render(<FechamentoPeriodoModal data="2026-11-03" periodoId="m2" onFechar={() => undefined} />);
    expect(await screen.findByRole("button", { name: "Atualizar" })).toBeTruthy();
    expect(screen.getByText(/faltam: Rosqueadeira 3/)).toBeTruthy();
    expect(screen.queryByLabelText("Passos do fechamento")).toBeNull();
    expect(screen.queryByTestId("passo-apontamentos")).toBeNull();
  });

  it("flag ATIVA: passos 1–6 + apontamentos dentro do modal; o botão de fechar só libera quando os postos estão salvos e o estoque informado", async () => {
    abrirFechamentoApi.mockResolvedValue(abertura(true));
    render(<FechamentoPeriodoModal data="2026-11-03" periodoId="m2" onFechar={() => undefined} />);
    expect(await screen.findByTestId("passo-apontamentos")).toBeTruthy();
    expect(screen.getByLabelText("Passos do fechamento").querySelectorAll("li")).toHaveLength(6);
    expect(screen.queryByRole("button", { name: "Atualizar" })).toBeNull();
    const botao = screen.getByRole("button", { name: /FECHAR M2 E GERAR M3/ });
    expect(botao).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Físico: Rosqueadas aguardando Parafusar"), { target: { value: "100" } });
    expect(botao).toHaveProperty("disabled", true);                       // ainda há posto programado pendente (servidor)

    // salva os apontamentos -> o servidor passa a reportar o posto como coletado -> libera
    abrirFechamentoApi.mockResolvedValue(abertura(false));
    await screen.findByText("Rosqueadeira 3", { selector: ".stx-apx-maq" });
    fireEvent.change(screen.getByLabelText("Produzido Rosqueadeira 3"), { target: { value: "1480" } });
    expect(botao).toHaveProperty("disabled", true);                       // alteração não salva também trava
    fireEvent.click(screen.getByRole("button", { name: "SALVAR APONTAMENTOS" }));
    await waitFor(() => expect(salvarApontamentosApi).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: /FECHAR M2 E GERAR M3/ })).toHaveProperty("disabled", false));
  });
});
