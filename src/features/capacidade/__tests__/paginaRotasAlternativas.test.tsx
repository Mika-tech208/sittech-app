// Tela de Capacidade semanal: com o produto único na semana, alocação/déficit/ociosidade viram a mensagem exata; produto linear mantém a tela de sempre.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { mondayOf, toISODate } from "@/lib/date";

const SEMANA = toISODate(mondayOf(new Date()));
const CAN = "c0000000-0000-4000-8000-000000000001";
const MSG = "INDICADOR TEMPORARIAMENTE INDISPONÍVEL PARA PRODUTO COM ROTAS ALTERNATIVAS.";
let produtoItem = CAN;
let modelosVigentes: unknown[] = [];
const mt = { m1: 1000, m2: 1000, m3: 1000, t1: 1000, t2: 1000, t3: 1000 };

vi.mock("@/services/supabase-client", () => ({ supabase: { rpc: async () => ({ data: null, error: null }), from: () => ({ select: async () => ({ data: [], error: null }) }) } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("@/components/shell/Sidebar", () => ({ default: () => null }));
vi.mock("@/components/shell/TopBarActions", () => ({ default: () => null }));
vi.mock("@/components/shell/RecoveryPasswordScreen", () => ({ default: () => null }));
vi.mock("@/components/shell/AccountModal", () => ({ default: () => null }));
vi.mock("@/components/shell/AcessoNegado", () => ({ default: () => null }));
vi.mock("@/components/shell/GlobalStyles", () => ({ default: () => null }));
vi.mock("@/components/shell/LoginScreen", () => ({ default: () => <div>login</div> }));
vi.mock("@/hooks/useTema", () => ({ useTema: () => ["light", () => undefined] }));
vi.mock("@/hooks/useSidebarState", () => ({ useSidebarState: () => ({ gruposAbertos: {}, toggleGrupo: () => undefined, recolhida: false, toggleRecolhida: () => undefined, gavetaAberta: false, fecharGaveta: () => undefined, abrirGaveta: () => undefined }) }));
vi.mock("@/hooks/useAuthSession", () => ({ useAuthSession: () => ({ autenticado: true, emModoRecovery: false, restaurandoSessao: false, usuarioLogado: { admin: true }, abrirMinhaConta: () => undefined, handleLogout: () => undefined }) }));
vi.mock("@/lib/permissoes", () => ({ temPermissao: () => true }));
vi.mock("@/hooks/useCadastrosBase", () => ({
  useCadastrosBase: () => ({ loading: false, erro: null, periodos: [{ id: "m1", nome: "M1", inicio: "07:00", fim: "08:30" }, { id: "t1", nome: "T1", inicio: "13:00", fim: "14:30" }], diasUteis: "5", diasUteisSemana: "5", operacoes: ["Rosquear"], atualizarConfiguracoesEmpresa: () => undefined }),
}));
vi.mock("@/hooks/useFuncionarios", () => ({ useFuncionarios: () => ({ loading: false, erro: null, funcionarios: [] }) }));
vi.mock("@/hooks/useMaquinas", () => ({ useMaquinas: () => ({ loading: false, erro: null, maquinas: [{ id: "mq", nome: "Rosqueadeira 3", operacao: "Rosquear", ativo: true }] }) }));
vi.mock("@/hooks/useProdutos", () => ({
  useProdutos: () => ({ loading: false, erro: null, produtos: [{ id: produtoItem, nome: "Produto", referencia: "", valorUnitario: 1, ativo: true, prioridade: "media", roteiro: [{ id: "e1", operacao: "Rosquear", metas: mt, maquinasIds: ["mq"] }] }] }),
}));
vi.mock("@/hooks/useCustos", () => ({ useCustos: () => ({ loading: false, erro: null, fixedCosts: [] }) }));
vi.mock("@/hooks/usePrevisoes", () => ({
  usePrevisoes: () => ({ loading: false, erro: null, maquinasEmParada: new Set(), upsertSemana: async () => true, previsoes: [{ semanaInicio: SEMANA, itens: [{ id: "i", produtoId: produtoItem, produtoNome: "Produto", valorUnitario: 1, quantidade: 500, maquinasPorEtapa: { e1: ["mq"] } }], itensRealizados: [], maquinasIndisponiveis: [] }] }),
}));
vi.mock("@/hooks/useModelosRotasAlternativas", () => ({ useModelosRotasAlternativas: () => modelosVigentes }));

import CapacidadeSemanalPage from "@/features/capacidade/CapacidadeSemanalPage";
import { modelo } from "@/features/produto-canonico/__tests__/fixture";

describe("CapacidadeSemanalPage", () => {
  beforeEach(() => { produtoItem = CAN; modelosVigentes = []; });
  it("produto linear / sem modelo vigente: alocação por produto e capacidade por operação como sempre", () => {
    render(<CapacidadeSemanalPage />);
    expect(screen.getByText("Alocação por produto")).toBeTruthy();
    expect(screen.getByText("Capacidade por operação")).toBeTruthy();
    expect(screen.queryByText(MSG, { exact: false })).toBeNull();
  });
  it("produto único na semana (modelo vigente): nenhuma alocação, déficit nem horas ociosas — mensagem exata no lugar", () => {
    modelosVigentes = [modelo()];
    render(<CapacidadeSemanalPage />);
    expect(screen.queryByText("Alocação por produto")).toBeNull();
    expect(screen.queryByText("Atendidos por completo")).toBeNull();
    expect(screen.getAllByText(MSG, { exact: false }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("capacidade-indisponivel")).toBeTruthy();
    expect(screen.getByText("Máquinas nesta semana")).toBeTruthy(); // configuração de máquinas continua disponível
  });
});
