// HARD GATE: nenhuma tela OPERACIONAL trata o plano de uma semana em PLANEJAMENTO do produto único como escala liberada.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

let planejamento = true;
const SEMANA_PLAN = (iso: string) => iso >= "2026-11-09" && iso <= "2026-11-15";
vi.mock("@/hooks/useModoProdutoUnico", () => ({
  useModoProdutoUnico: () => ({ carregado: true, parametros: [], modoDe: (d: string) => (planejamento && SEMANA_PLAN(d) ? "PLANEJAMENTO" : "LEGADO"), planoFuturo: (d: string) => planejamento && SEMANA_PLAN(d) }),
}));

const api = vi.hoisted(() => ({
  abrirFechamentoApi: vi.fn(async () => ({ status: 409, corpo: { erro: "Fechamento indisponível no teste." } })),
  confirmarFechamentoApi: vi.fn(), estadoFechamentoApi: vi.fn(async () => ({ status: 200, corpo: { modo: "ativo", fechado: false } })), retryFechamentoApi: vi.fn(),
  postosProgramadosApi: vi.fn(async () => ({ status: 200, corpo: { modo: "ativo", postos: [{ maquinaId: "m1" }], catalogo: null, existentes: [] } })),
}));
vi.mock("@/features/producao-real/fechamento/api", () => api);

describe("FechamentoPeriodoModal em semana de PLANEJAMENTO", () => {
  beforeEach(() => { planejamento = true; Object.values(api).forEach((f) => (f as { mockClear?: () => void }).mockClear?.()); });
  it("não abre fechamento nem chama a API: mostra o plano futuro, sem botões de ação", async () => {
    const { default: FechamentoPeriodoModal } = await import("@/features/producao-real/fechamento/FechamentoPeriodoModal");
    render(<FechamentoPeriodoModal data="2026-11-09" periodoId="m1" onFechar={() => undefined} />);
    expect(screen.getByTestId("bloqueio-plano-futuro").textContent).toContain("PLANO FUTURO — AINDA NÃO LIBERADO PARA PRODUÇÃO");
    expect(screen.getByTestId("bloqueio-plano-futuro").textContent).toContain("AGUARDANDO NOVA PROGRAMAÇÃO");
    expect(screen.queryByText(/FECHAR PERÍODO/i)).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(api.abrirFechamentoApi).not.toHaveBeenCalled();
  });
  it("semana fora do planejamento: fluxo de hoje (a API é chamada)", async () => {
    const { default: FechamentoPeriodoModal } = await import("@/features/producao-real/fechamento/FechamentoPeriodoModal");
    render(<FechamentoPeriodoModal data="2026-11-03" periodoId="m2" onFechar={() => undefined} />);
    await waitFor(() => expect(api.abrirFechamentoApi).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("bloqueio-plano-futuro")).toBeNull();
  });
});

describe("PeriodoSeletorModal (Outro período)", () => {
  it("data de semana em PLANEJAMENTO: nenhum período selecionável e confirmar desabilitado", async () => {
    const { default: PeriodoSeletorModal } = await import("@/features/producao-real/PeriodoSeletorModal");
    const onSelecionar = vi.fn();
    const periodos = [{ id: "m1", nome: "M1", inicio: "07:00", fim: "08:40" }] as never;
    render(<PeriodoSeletorModal periodos={periodos} onSelecionar={onSelecionar} onFechar={() => undefined} dataBloqueada={() => true} />);
    expect(screen.getByRole("status").textContent).toContain("PLANO FUTURO — AINDA NÃO LIBERADO PARA PRODUÇÃO");
    expect((screen.getByText("Ver este período") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/M1 ·/)).toBeNull();
  });
  it("sem bloqueio: comportamento de hoje (aviso de 'nenhum período encerrado' continua, sem selo)", async () => {
    const { default: PeriodoSeletorModal } = await import("@/features/producao-real/PeriodoSeletorModal");
    render(<PeriodoSeletorModal periodos={[]} onSelecionar={() => undefined} onFechar={() => undefined} />);
    expect(screen.queryByText(/PLANO FUTURO/)).toBeNull();
  });
});

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/services/supabase-client", () => ({ supabase: { rpc } }));

describe("RegularizacaoHistoricaModal", () => {
  const estado = (datas: string[]) => ({ datas, periodos: [{ id: "m1", nome: "M1", inicio: "07:00", fim: "08:40" }], maquinas: [], funcionarios: [], produtos: [], combinacoes: [], apontamentos: [], estado_periodos: [] });
  it("recusa datas de semana em PLANEJAMENTO (só oferece as demais)", async () => {
    planejamento = true;
    rpc.mockResolvedValue({ data: estado(["2026-11-10", "2026-11-03"]), error: null });
    const { default: RegularizacaoHistoricaModal } = await import("@/features/producao-real/RegularizacaoHistoricaModal");
    render(<RegularizacaoHistoricaModal onFechar={() => undefined} />);
    await waitFor(() => expect(screen.getByText("03/11/2026")).toBeTruthy());
    expect(screen.queryByText("10/11/2026")).toBeNull();
  });
  it("só datas do plano futuro: mostra o bloqueio, sem formulário", async () => {
    planejamento = true;
    rpc.mockResolvedValue({ data: estado(["2026-11-10"]), error: null });
    const { default: RegularizacaoHistoricaModal } = await import("@/features/producao-real/RegularizacaoHistoricaModal");
    render(<RegularizacaoHistoricaModal onFechar={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("bloqueio-plano-futuro")).toBeTruthy());
    expect(screen.queryByText("1. Data")).toBeNull();
  });
});

describe("Escala: grade e TV", () => {
  it("GradeEscala em planoFuturo: todo período 'PLANO FUTURO — NÃO LIBERADO', célula não clicável", async () => {
    const { default: GradeEscala } = await import("@/features/escala/components/GradeEscala");
    const dia = { data: "2099-11-09", versao: 1, atualizadoEm: "", periodos: [{ id: "m1", nome: "M1", inicio: "07:00", fim: "08:40" }] } as never;
    const aloc = [{ data: "2099-11-09", periodoId: "m1", funcionarioId: "f1", maquinaId: "m1", produtoId: "p", etapaId: "e", operacaoId: "o", pecas: 1, origem: "auto", excecaoRevezamento: false, motivoExcecao: null, motivoSemPosto: null }] as never;
    const nomes = { maquinas: new Map([["m1", "Máq"]]), produtos: new Map(), operacoes: new Map(), funcionarios: new Map([["f1", "Ana"]]) };
    const onEditar = vi.fn();
    const { container } = render(<GradeEscala dia={dia} alocacoes={aloc} funcionarios={["f1"]} nomes={nomes} agoraMs={0} onEditar={onEditar} planoFuturo />);
    expect(screen.getByTestId("nao-liberado").textContent).toBe("PLANO FUTURO — AINDA NÃO LIBERADO PARA PRODUÇÃO");
    fireEvent.click(container.querySelector(".stx-esc-cell")!);
    expect(onEditar).not.toHaveBeenCalled();
  });
  it("GradeEscala sem planoFuturo e sem liberação: idêntica à de hoje (sem selo, clicável no futuro)", async () => {
    const { default: GradeEscala } = await import("@/features/escala/components/GradeEscala");
    const dia = { data: "2099-11-09", versao: 1, atualizadoEm: "", periodos: [{ id: "m1", nome: "M1", inicio: "07:00", fim: "08:40" }] } as never;
    const aloc = [{ data: "2099-11-09", periodoId: "m1", funcionarioId: "f1", maquinaId: "m1", produtoId: "p", etapaId: "e", operacaoId: "o", pecas: 1, origem: "auto", excecaoRevezamento: false, motivoExcecao: null, motivoSemPosto: null }] as never;
    const nomes = { maquinas: new Map([["m1", "Máq"]]), produtos: new Map(), operacoes: new Map(), funcionarios: new Map([["f1", "Ana"]]) };
    const onEditar = vi.fn();
    const { container } = render(<GradeEscala dia={dia} alocacoes={aloc} funcionarios={["f1"]} nomes={nomes} agoraMs={0} onEditar={onEditar} />);
    expect(screen.queryByTestId("nao-liberado")).toBeNull();
    fireEvent.click(container.querySelector(".stx-esc-cell")!);
    expect(onEditar).toHaveBeenCalledWith("m1", "f1");
  });
  it("TV: visaoLiberacaoTv com planoFuturo bloqueia atual e próximo mesmo que o snapshot diga 'liberado' e mesmo em simulação", async () => {
    const { visaoLiberacaoTv } = await import("@/features/escala/fechamento/visaoTv");
    const liberacao = { m1: { liberado: true, motivo: "CONFIRMADO" }, m2: { liberado: true, motivo: "CONFIRMADO" } };
    const base = { liberacao, atual: { id: "m1", nome: "M1" }, proximo: { id: "m2", nome: "M2" }, agoraMs: 0 };
    const v = visaoLiberacaoTv({ ...base, planoFuturo: true, ignorar: true });
    expect(v.atual.liberado).toBe(false);
    expect(v.proximo.liberado).toBe(false);
    expect(v.atual.bloqueio?.titulo).toBe("PLANO FUTURO — AINDA NÃO LIBERADO PARA PRODUÇÃO");
    expect(visaoLiberacaoTv(base).atual.liberado).toBe(true); // sem planoFuturo: igual a hoje
  });
});
