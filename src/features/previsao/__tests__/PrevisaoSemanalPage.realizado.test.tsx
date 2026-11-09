// TELA REAL: renderiza o PrevisaoSemanalPage INTEIRO (hooks reais usePrevisoes + useApontadoRealSemana + a RPC obter_apontado_real_previsao_por_semana)
// com um cliente Supabase simulado que devolve o payload de PROD (semana 02/11/2026, ids anonimizados) e lê o que o card "Realizado até agora" MOSTRA.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import fx from "../__fixtures__/semana-2026-11-02-prod-anonimizada.json";

const chamadas: string[] = [];
vi.mock("@/services/supabase-client", async () => {
  const dados = (await import("../__fixtures__/semana-2026-11-02-prod-anonimizada.json")).default as any;
  const TABELAS: Record<string, any[]> = { previsoes: [dados.previsao] };
  const construtor = (tabela: string): any => {
    const resolve = () => ({ data: TABELAS[tabela] ?? [], error: null });
    const b: any = new Proxy(function () {}, {
      get(_t, p) {
        if (p === "then") return (ok: any, ko: any) => Promise.resolve(resolve()).then(ok, ko);
        if (p === "single" || p === "maybeSingle") return () => Promise.resolve({ data: (TABELAS[tabela] ?? [])[0] ?? null, error: null });
        return () => b;
      },
    });
    return b;
  };
  const supabase = {
    from: (t: string) => { chamadas.push(`from:${t}`); return construtor(t); },
    rpc: (nome: string, args: any) => {
      chamadas.push(`rpc:${nome}`);
      if (nome === "obter_apontado_real_previsao_por_semana") return Promise.resolve({ data: args.p_semana_inicio === "2026-11-02" ? dados.apontado.filter((r: any) => !((globalThis as any).__SEM_PRODUTO && r.produto_id === (globalThis as any).__SEM_PRODUTO)) : [], error: null });
      return Promise.resolve({ data: null, error: null });
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  };
  return { supabase };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {} }), usePathname: () => "/previsao", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/hooks/useAuthSession", () => ({
  useAuthSession: () => ({
    autenticado: true, restaurandoSessao: false, emModoRecovery: false,
    usuarioLogado: { id: "u", authUserId: "a", nome: "Admin", email: "a@x", papel: "admin", ativo: true, permissoes: [] },
    loginUsuario: "", loginSenha: "", loginErro: "", loginCarregando: false, setLoginUsuario() {}, setLoginSenha() {}, handleLogin() {}, handleLogout() {},
    minhaContaAberta: false, abrirMinhaConta() {}, setMinhaContaAberta() {}, minhaContaMsg: "", minhaSenhaAtual: "", minhaSenhaNova: "", minhaSenhaConfirma: "",
    setMinhaSenhaAtual() {}, setMinhaSenhaNova() {}, setMinhaSenhaConfirma() {}, alterarMinhaSenha() {},
    novaSenhaRecovery: "", confirmarSenhaRecovery: "", setNovaSenhaRecovery() {}, setConfirmarSenhaRecovery() {}, recoveryMsg: "", recoverySalvando: false, recoverySucesso: false,
    definirNovaSenhaRecovery() {}, concluirRecovery() {},
  }),
}));

import PrevisaoSemanalPage from "../PrevisaoSemanalPage";

const num = (s: string) => Number(s.replace(/[^\d,-]/g, "").replace(",", "."));

async function valorDoCard(): Promise<number> {
  render(<PrevisaoSemanalPage />);
  await waitFor(() => {
    const el = screen.getAllByText("Realizado até agora")[0].closest(".stx-rateio-line")!.querySelector(".v")!;
    expect(el.textContent).not.toBe("—");
  }, { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 50));
  const t = screen.getAllByText("Realizado até agora")[0].closest(".stx-rateio-line")!.querySelector(".v")!.textContent as string;
  cleanup();
  return num(t);
}

describe("tela real: card \"Realizado até agora\" (semana 02/11/2026, payload de PROD)", () => {
  beforeAll(() => {
    if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, media: "" });
    if (!(window as any).ResizeObserver) (window as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-08T15:00:00Z"));
  });
  afterAll(() => { vi.useRealTimers(); cleanup(); });

  it("o card exibe o valor COM a Caixa 4x2 (24.168,54 = 18.107,73 + 6.060,81)", async () => {
    const { container } = render(<PrevisaoSemanalPage />);
    await waitFor(() => expect(screen.getAllByText("Realizado até agora")[0]).toBeInTheDocument(), { timeout: 8000 });
    await waitFor(() => {
      const linha = screen.getAllByText("Realizado até agora")[0].closest(".stx-rateio-line") as HTMLElement;
      expect(linha.querySelector(".v")!.textContent).not.toBe("—");
    }, { timeout: 8000 });
    const linha = screen.getAllByText("Realizado até agora")[0].closest(".stx-rateio-line") as HTMLElement;
    const exibido = linha.querySelector(".v")!.textContent as string;
    // eslint-disable-next-line no-console
    console.log("CARD EXIBIDO:", exibido, "| RPCs:", [...new Set(chamadas)].join(","));
    expect(num(exibido)).toBeCloseTo(24168.54, 1);
    void container; void fx;
  }, 20000);

  it("CONTRAFACTUAL: COM a 4x2 − SEM a 4x2 = R$ 6.060,81 exatos (mesmo componente, mesmo caminho)", async () => {
    (globalThis as any).__SEM_PRODUTO = undefined;
    const com = await valorDoCard();
    (globalThis as any).__SEM_PRODUTO = (fx as any).produto4x2;
    const sem = await valorDoCard();
    (globalThis as any).__SEM_PRODUTO = undefined;
    // eslint-disable-next-line no-console
    console.log(`CONTRAFACTUAL: COM=${com} SEM=${sem} DIFERENÇA=${(com - sem).toFixed(2)}`);
    expect(sem).toBeCloseTo(18107.73, 1);
    expect(com - sem).toBeCloseTo(6060.81, 1);
  }, 30000);

  it("TABELA \"Itens previstos\": linha da 4x2 mostra 56.400 / 27.930 / R$ 6.060,81 / falta 0 / ENCERRADO; total em R$ = card", async () => {
    render(<PrevisaoSemanalPage />);
    await waitFor(() => expect(document.querySelector(".stx-prev-valor")).not.toBeNull(), { timeout: 8000 });
    await waitFor(() => {
      const total = document.querySelector(".stx-prev-valor .stx-prev-table-row.total");
      expect(total?.textContent).toContain("24.168,54");
    }, { timeout: 8000 });
    const tabela = document.querySelector(".stx-prev-valor") as HTMLElement;
    const cabecalho = tabela.querySelector(".stx-prev-table-head")!.textContent!;
    expect(cabecalho).toContain("Valor realizado");
    const linha = [...tabela.querySelectorAll(".stx-prev-table-row")].find((r) => r.textContent!.includes("Caixa Amarela 4x2")) as HTMLElement;
    const celulas = [...linha.children].map((c) => c.textContent!.replace(/\s+/g, " ").trim());
    // eslint-disable-next-line no-console
    console.log("LINHA 4x2:", JSON.stringify(celulas));
    expect(celulas[1]).toBe("56.400");
    expect(celulas[3]).toContain("27.930");
    expect(celulas[4]).toBe("R$ 6.060,81");
    expect(celulas[5]).toBe("0");
    expect(celulas[6]).toBe("ENCERRADO");
    // todas as linhas de produto trazem R$ e somam o total
    const soma = [...tabela.querySelectorAll(".stx-prev-table-row:not(.total)")].map((r) => num((r.children[4] as HTMLElement).textContent!)).reduce((a, b) => a + b, 0);
    expect(soma).toBeCloseTo(24168.54, 1);
    cleanup();
  }, 30000);

  it("CARD: nomenclatura final, valores e composição por produto que soma R$ 24.168,54", async () => {
    render(<PrevisaoSemanalPage />);
    await waitFor(() => expect(screen.getAllByText("Valor operacional restante")[0]).toBeInTheDocument(), { timeout: 8000 });
    await waitFor(() => expect(screen.getAllByText("Realizado até agora")[0].closest(".stx-rateio-line")!.querySelector(".v")!.textContent).not.toBe("—"), { timeout: 8000 });
    const valorDe = (rotulo: string) => (screen.getAllByText(rotulo)[0].closest(".stx-rateio-line")!.querySelector(".v") as HTMLElement).textContent!.replace(/\u00a0/g, " ");
    expect(valorDe("Previsto original")).toBe("R$ 39.823,20");
    expect(valorDe("Realizado até agora")).toBe("R$ 24.168,54");
    expect(valorDe("Valor operacional restante")).toBe("R$ 10.697,78");
    expect(screen.queryByText("Falta realizar")).toBeNull();
    const det = document.querySelector("details.stx-prev-composicao") as HTMLElement;
    const linhas = [...det.querySelectorAll(".stx-rateio-line")].map((l) => l.textContent!.replace(/\s+/g, " ").trim());
    // eslint-disable-next-line no-console
    console.log("COMPOSIÇÃO:\n" + linhas.join("\n"));
    expect(linhas.some((l) => l.includes("Caixa Amarela 4x2 (encerrado)") && l.includes("R$ 6.060,81"))).toBe(true);
    expect(linhas.find((l) => l.startsWith("Total realizado"))).toContain("R$ 24.168,54");
    expect(linhas.find((l) => l.includes("Cancelado"))).toContain("R$ 6.177,99");
    expect(linhas.find((l) => l.includes("Previsto operacional"))).toContain("R$ 33.645,21");
    expect(linhas.find((l) => l.includes("Produzido acima da meta"))).toContain("R$ 1.221,10");
    if (process.env.DUMP_HTML) { // só para gerar o screenshot da tela (opcional)
      det.setAttribute("open", "");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.DUMP_HTML, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${document.body.innerHTML}</body></html>`);
    }
    cleanup();
  }, 30000);

  it("BARRA LATERAL (opção B): o card mostra o PREVISTO ORIGINAL R$ 39.823,20, com a 4x2, e não o ativo R$ 27.584,40", async () => {
    render(<PrevisaoSemanalPage />);
    await waitFor(() => expect(document.querySelector(".stx-sidebar-meta-card")).not.toBeNull(), { timeout: 8000 });
    await waitFor(() => expect(document.querySelector(".stx-sidebar-meta-valor")!.textContent!.replace(/\u00a0/g, " ")).toBe("R$ 39.823,20"), { timeout: 8000 });
    const card = document.querySelector(".stx-sidebar-meta-card") as HTMLElement;
    expect(card.textContent).toContain("Previsto original da semana");
    expect(card.textContent).toContain("inclui produtos encerrados");
    expect(card.textContent).not.toContain("27.584,40");
    expect(screen.queryByText("Meta semanal")).toBeNull();
    cleanup();
  }, 30000);
});
