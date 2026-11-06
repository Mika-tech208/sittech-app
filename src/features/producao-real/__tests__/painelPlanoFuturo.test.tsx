// A tela do tablet (painel de Produção Real) em período de semana em PLANEJAMENTO: sem postos, sem apontamento, sem fechamento, sem 'Outro período' para essa semana.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

let periodo = { id: "m1", nome: "M1", inicio: "07:00", fim: "08:40", data: "2026-11-09" };
let planejamento = true;
const maquinasView = [{ id: "m1", nome: "Rosqueadeira 3", estadoPeriodo: "pendente", estadoMaquina: "livre", produtoNome: null, quantidadeProduzida: null, motivoSemProducao: null, ocorrenciaAberta: null }];

vi.mock("@/services/supabase-client", () => ({ supabase: { rpc: async () => ({ data: null, error: null }), from: () => ({ select: async () => ({ data: [], error: null }) }) } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("@/components/shell/Sidebar", () => ({ default: () => null }));
vi.mock("@/components/shell/TopBarActions", () => ({ default: () => null }));
vi.mock("@/components/shell/LoginScreen", () => ({ default: () => <div>login</div> }));
vi.mock("@/components/shell/RecoveryPasswordScreen", () => ({ default: () => null }));
vi.mock("@/components/shell/AccountModal", () => ({ default: () => null }));
vi.mock("@/components/shell/AcessoNegado", () => ({ default: () => null }));
vi.mock("@/components/shell/GlobalStyles", () => ({ default: () => null }));
vi.mock("@/features/escala/fechamento/SeloFechamento", () => ({ default: () => null }));
vi.mock("@/features/producao-real/fechamento/FechamentoPeriodoModal", () => ({ default: () => <div data-testid="modal-fechamento" /> }));
vi.mock("@/features/producao-real/RegularizacaoHistoricaModal", () => ({ default: () => <div data-testid="modal-regularizacao" /> }));
vi.mock("@/hooks/useTema", () => ({ useTema: () => ["light", () => undefined] }));
vi.mock("@/hooks/useSidebarState", () => ({ useSidebarState: () => ({ gruposAbertos: {}, toggleGrupo: () => undefined, recolhida: false, onToggleRecolhida: () => undefined, toggleRecolhida: () => undefined, gavetaAberta: false, fecharGaveta: () => undefined, abrirGaveta: () => undefined }) }));
vi.mock("@/hooks/useAuthSession", () => ({
  useAuthSession: () => ({ autenticado: true, emModoRecovery: false, restaurandoSessao: false, usuarioLogado: { admin: true, permissoes: [] }, abrirMinhaConta: () => undefined, handleLogout: () => undefined }),
}));
vi.mock("@/lib/permissoes", () => ({ temPermissao: () => true }));
vi.mock("@/hooks/useCadastrosBase", () => ({ useCadastrosBase: () => ({ loading: false, periodos: [] }) }));
vi.mock("@/hooks/useFuncionarios", () => ({ useFuncionarios: () => ({ loading: false, funcionarios: [] }) }));
vi.mock("@/hooks/useFuncionariosElegibilidade", () => ({ useFuncionariosElegibilidade: () => ({ loading: false, funcionarios: [] }) }));
vi.mock("@/hooks/useMaquinas", () => ({ useMaquinas: () => ({ loading: false, maquinas: [{ id: "m1", nome: "Rosqueadeira 3", ativo: true, operacao: "Rosquear" }] }) }));
vi.mock("@/hooks/usePrevisoes", () => ({ usePrevisoes: () => ({ loading: false, previsoes: [] }) }));
vi.mock("@/hooks/useCustos", () => ({ useCustos: () => ({ loading: false, fixedCosts: [] }) }));
vi.mock("@/hooks/useApontamentosRealizados", () => ({ useApontamentosRealizados: () => ({ buscar: async () => [] }) }));
vi.mock("@/hooks/useProducaoRealPainel", () => ({
  dataLocalSP: () => "2026-11-09", horaLocalSP: () => "08:00:00",
  useProducaoRealPainel: () => ({ periodoAtual: periodo, maquinasView, loading: false, erro: null, modoRetroativo: false, recarregar: () => undefined, marcarMaquinaApontada: () => undefined, marcarMaquinaSemProducao: () => undefined, marcarMaquinaPendente: () => undefined, marcarOcorrenciaAberta: () => undefined, marcarOcorrenciaEncerrada: () => undefined }),
}));
vi.mock("@/hooks/useModoProdutoUnico", () => ({
  useModoProdutoUnico: () => ({ carregado: true, parametros: [], modoDe: () => "LEGADO", planoFuturo: (d: string) => planejamento && d >= "2026-11-09" && d <= "2026-11-15" }),
}));
const api = vi.hoisted(() => ({
  estadoFechamentoApi: vi.fn(async () => ({ status: 200, corpo: { modo: "ativo", fechado: false } })),
  postosProgramadosApi: vi.fn(async () => ({ status: 200, corpo: { modo: "ativo", postos: [{ maquinaId: "m1" }], catalogo: null, existentes: [] } })),
}));
vi.mock("@/features/producao-real/fechamento/api", () => api);

import ProducaoRealPainelPage from "@/features/producao-real/ProducaoRealPainelPage";

describe("painel do tablet × semana em PLANEJAMENTO", () => {
  beforeEach(() => { planejamento = true; periodo = { id: "m1", nome: "M1", inicio: "07:00", fim: "08:40", data: "2026-11-09" }; api.estadoFechamentoApi.mockClear(); api.postosProgramadosApi.mockClear(); });

  it("mostra PLANO FUTURO / AGUARDANDO NOVA PROGRAMAÇÃO e nenhuma ação operacional (sem postos, apontamento, fechamento, regularização, parada)", async () => {
    render(<ProducaoRealPainelPage />);
    expect(screen.getByTestId("bloqueio-plano-futuro").textContent).toContain("PLANO FUTURO — AINDA NÃO LIBERADO PARA PRODUÇÃO");
    expect(screen.getByTestId("bloqueio-plano-futuro").textContent).toContain("AGUARDANDO NOVA PROGRAMAÇÃO");
    expect(screen.queryByText("Rosqueadeira 3")).toBeNull();
    expect(screen.queryByText(/FECHAR PERÍODO/i)).toBeNull();
    expect(screen.queryByText(/ADICIONAR APONTAMENTO/i)).toBeNull();
    expect(screen.queryByText(/REGULARIZAR APONTAMENTOS/i)).toBeNull();
    expect(screen.queryByText(/Informar máquina parada/i)).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(api.postosProgramadosApi).not.toHaveBeenCalled();
    expect(api.estadoFechamentoApi).not.toHaveBeenCalled();
  });

  it("'Outro período' abre, mas a data da semana em PLANEJAMENTO não libera nenhum período", async () => {
    render(<ProducaoRealPainelPage />);
    fireEvent.click(screen.getByText("Outro período"));
    expect((screen.getByText("Ver este período") as HTMLButtonElement).disabled).toBe(true);
  });

  it("período de semana fora do planejamento: tela de hoje (postos consultados, tile da máquina, sem selo)", async () => {
    periodo = { ...periodo, data: "2026-11-03" };
    render(<ProducaoRealPainelPage />);
    await waitFor(() => expect(api.postosProgramadosApi).toHaveBeenCalled());
    expect(screen.queryByTestId("bloqueio-plano-futuro")).toBeNull();
    await waitFor(() => expect(screen.getByText("Rosqueadeira 3")).toBeTruthy());
  });
});
