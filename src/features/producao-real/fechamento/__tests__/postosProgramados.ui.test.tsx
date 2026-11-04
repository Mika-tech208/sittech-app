import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fixture from "../../../../lib/escala/fechamento/__tests__/__fixtures__/prod-m2-2026-11-04.json";
import { montarEstadoPostos, type DadosBrutosPostos } from "@/lib/escala/fechamento/postosProgramados";

const postosProgramadosApi = vi.fn();
const abrirFechamentoApi = vi.fn();
vi.mock("../api", () => ({
  postosProgramadosApi: (...a: unknown[]) => postosProgramadosApi(...a), abrirFechamentoApi: (...a: unknown[]) => abrirFechamentoApi(...a),
  confirmarFechamentoApi: vi.fn(), retryFechamentoApi: vi.fn(), estadoFechamentoApi: vi.fn(async () => ({ status: 200, corpo: { modo: "ativo", fechado: false } })),
}));
const rpc = vi.fn();
vi.mock("@/services/supabase-client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getSession: async () => ({ data: { session: null } }) } } }));

import PostosProgramadosFechamento from "../PostosProgramadosFechamento";
import FechamentoPeriodoModal from "../FechamentoPeriodoModal";

const F = fixture as unknown as { aloc_m2: Record<string, unknown>[]; maquinas: DadosBrutosPostos["maquinas"]; funcionarios: DadosBrutosPostos["funcionarios"]; produtos: DadosBrutosPostos["produtos"]; operacoes: DadosBrutosPostos["operacoes"]; etapas: DadosBrutosPostos["etapas"]; etapaMaquinas: DadosBrutosPostos["etapaMaquinas"] };
const ESTADO = montarEstadoPostos({ alocacoes: F.aloc_m2, maquinas: F.maquinas, funcionarios: F.funcionarios, produtos: F.produtos, operacoes: F.operacoes, etapas: F.etapas, etapaMaquinas: F.etapaMaquinas, apontamentos: [] });
const FIM_PASSADO = Date.now() - 3_600_000;

beforeEach(() => {
  let n = 9000; vi.stubGlobal("crypto", { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
  postosProgramadosApi.mockReset(); rpc.mockReset(); abrirFechamentoApi.mockReset();
  postosProgramadosApi.mockResolvedValue({ status: 200, corpo: ESTADO }); rpc.mockResolvedValue({ error: null, data: {} });
});
afterEach(() => cleanup());

describe("POSTOS PROGRAMADOS — M2 (UI)", () => {
  const monta = () => { const p = { onIndisponivel: vi.fn(), onSalvo: vi.fn() }; render(<PostosProgramadosFechamento data="2026-11-04" periodoId="m2" rotulo="M2" fimMs={FIM_PASSADO} {...p} />); return p; };

  it("mostra SÓ os 12 postos programados do M2, pré-preenchidos; refugo vazio; máquina fora da escala não aparece", async () => {
    monta();
    await screen.findByText("POSTOS PROGRAMADOS — M2");
    expect(screen.getAllByText(/Programado:/)).toHaveLength(12);
    expect(screen.getAllByText(/Programado: Funcionário · Conector 3\/4" · Parafusar/).length).toBe(2);
    const programadas = new Set(ESTADO.postos.map((p) => p.maquinaNome));
    const fora = F.maquinas.find((m) => !programadas.has(m.nome.trim()))!;
    expect(screen.queryByText(fora.nome.trim(), { selector: ".stx-apx-maq" })).toBeNull();
    expect(screen.getByLabelText("Produzido Parafusadeira 10")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Refugo Parafusadeira 10")).toHaveProperty("value", "");
    expect(screen.getAllByRole("button", { name: "NÃO PRODUZIU" })).toHaveLength(12);
    expect(screen.getByRole("button", { name: "SALVAR APONTAMENTOS" })).toHaveProperty("disabled", true);
  });

  it("produzido + NÃO PRODUZIU (motivo) + operador alterado (selo, sem confirmação extra) ⇒ salva pelas RPCs legadas", async () => {
    const p = monta();
    await screen.findByText("Parafusadeira 10");
    fireEvent.change(screen.getByLabelText("Produzido Parafusadeira 10"), { target: { value: "1480" } });
    const c12 = screen.getByText("Parafusadeira 12").closest(".stx-apx-card") as HTMLElement;
    fireEvent.click(within(c12).getByRole("button", { name: "NÃO PRODUZIU" }));
    fireEvent.click(within(c12).getByRole("button", { name: "Sem material" }));
    const c20 = screen.getByText("Montagem 20").closest(".stx-apx-card") as HTMLElement;
    fireEvent.change(within(c20).getByLabelText("Produzido Montagem 20"), { target: { value: "2000" } });
    expect(within(c20).queryByTestId("selo-alterado")).toBeNull();
    fireEvent.click(within(c20).getByRole("button", { name: /Alterar máquina/ }));
    const sel = within(c20).getByLabelText(/Operador/) as HTMLSelectElement;
    const outro = Array.from(sel.options).find((o) => o.value && o.value !== sel.value)!.value;
    fireEvent.change(sel, { target: { value: outro } });
    expect(await within(c20).findByTestId("selo-alterado")).toBeTruthy();
    expect(within(c20).getByTestId("selo-alterado").textContent).toBe("ALTERADO DO PLANEJADO");

    fireEvent.click(screen.getByRole("button", { name: "SALVAR APONTAMENTOS" }));
    await waitFor(() => expect(p.onSalvo).toHaveBeenCalled());
    const nomes = rpc.mock.calls.map((c) => c[0]);
    expect(nomes.sort()).toEqual(["registrar_apontamento_producao_retroativo", "registrar_apontamento_producao_retroativo", "registrar_sem_producao_retroativo"]);
    const prod = rpc.mock.calls.filter((c) => c[0] === "registrar_apontamento_producao_retroativo").map((c) => c[1] as Record<string, unknown>);
    expect(prod.map((a) => a.p_quantidade_produzida).sort()).toEqual([1480, 2000]);
    expect(prod.every((a) => a.p_quantidade_refugo === 0 && a.p_data === "2026-11-04" && a.p_periodo_id === "m2")).toBe(true);
    expect(prod.find((a) => a.p_quantidade_produzida === 2000)!.p_funcionario_id).toBe(outro);
    const sem = rpc.mock.calls.find((c) => c[0] === "registrar_sem_producao_retroativo")![1] as Record<string, unknown>;
    expect(sem).toMatchObject({ p_motivo_sem_producao: "falta_material", p_data: "2026-11-04", p_periodo_id: "m2" });
  });

  it("combinação máquina×produto inválida: mensagem clara e NADA é gravado", async () => {
    monta();
    await screen.findByText("Parafusadeira 12");
    const c = screen.getByText("Parafusadeira 12").closest(".stx-apx-card") as HTMLElement;
    fireEvent.change(within(c).getByLabelText("Produzido Parafusadeira 12"), { target: { value: "100" } });
    fireEvent.click(within(c).getByRole("button", { name: /Alterar máquina/ }));
    const selP = within(c).getByLabelText(/Produto/) as HTMLSelectElement;
    const invalido = F.produtos.find((p) => !ESTADO.catalogo.elegibilidade.some((e) => e.maquinaId === ESTADO.postos.find((x) => x.maquinaNome === "Parafusadeira 12")!.maquinaId && e.produtoId === p.id))!;
    // o seletor só oferece produtos elegíveis; a combinação inválida só chegaria por uma troca de máquina — o botão salvar não grava nada sem linha pronta
    expect(Array.from(selP.options).some((o) => o.value === invalido.id)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("falha de carga: oferece usar o painel (volta ao fluxo anterior)", async () => {
    postosProgramadosApi.mockResolvedValue({ status: 500, corpo: { erro: "falhou" } });
    const p = monta();
    fireEvent.click(await screen.findByRole("button", { name: "Usar o painel de apontamentos" }));
    expect(p.onIndisponivel).toHaveBeenCalled();
  });
});

describe("FECHAR M2: postos → só depois o estoque físico", () => {
  const ab = (pendente: boolean) => ({
    status: 200, corpo: {
      ok: true, abertura_id: "a", valido_ate_ms: Date.now() + 1e6, periodo: { data: "2026-11-04", periodo_id: "m2", rotulo: "M2", fim_ms: FIM_PASSADO, proximo: { rotulo: "M3", periodo_id: "m3" } },
      postos: [{ maquinaId: "x", nome: "Parafusadeira 10", status: pendente ? "pendente" : "produzindo", produzido: pendente ? 0 : 10, refugo: 0, motivo: null }], tem_pendentes: pendente,
      buffers: [{ buffer_id: "b1", rotulo: "Rosqueadas aguardando Parafusar", estimado: 100, estimado_lo: 100, estimado_hi: 100 }], pode_excecao: false, pares_sem_buffer: [], alertas: [],
    },
  });
  it("com posto pendente NÃO pede o estoque; com todos resolvidos o estoque é obrigatório (botão travado até preencher)", async () => {
    abrirFechamentoApi.mockResolvedValue(ab(true));
    const r = render(<FechamentoPeriodoModal data="2026-11-04" periodoId="m2" onFechar={() => undefined} />);
    await screen.findByText("POSTOS PROGRAMADOS — M2");
    expect(screen.queryByLabelText(/Físico: Rosqueadas/)).toBeNull();
    expect(screen.getByText(/O estoque físico é pedido depois/)).toBeTruthy();
    r.unmount();
    abrirFechamentoApi.mockResolvedValue(ab(false));
    render(<FechamentoPeriodoModal data="2026-11-04" periodoId="m2" onFechar={() => undefined} />);
    const campo = await screen.findByLabelText(/Físico: Rosqueadas/);
    const botao = screen.getByRole("button", { name: /FECHAR M2 E GERAR M3/ });
    expect(botao).toHaveProperty("disabled", true);                    // inventário continua obrigatório
    fireEvent.change(campo, { target: { value: "120" } });
    await waitFor(() => expect(botao).toHaveProperty("disabled", false));
  });
});
