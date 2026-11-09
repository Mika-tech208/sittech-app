import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Maquina, PeriodoComDuracao, Previsao, Produto } from "@/types/domain";
import ItensPrevistos from "@/features/previsao/components/ItensPrevistos";
import UnificarConectorBanner from "../components/UnificarConectorBanner";
import DivisaoEntreRotas from "../components/DivisaoEntreRotas";
import PlanoFuturoSelo from "../components/PlanoFuturoSelo";
import { agruparEtapasPorRota } from "../etapasPorRota";
import { divisaoEntreRotas } from "../divisaoRotas";
import { lerGuardaProdutos, lerParametrosProdutoUnico, primeiraVigencia, modoDaSemana, type ClienteGuarda, type GuardaProdutos } from "../guardaDb";
import { produtosSelecionaveis, produtosSelecionaveisApontamento, produtosSelecionaveisPrevisao, produtosVisiveis } from "../guard";
import { ofertaUnificar } from "../unificarPrevisao";
import { TEXTO_PLANO_FUTURO } from "../planoFuturo";
import { C, CAN, CONV, AUTO, CAIXA, MAQ, modelo } from "./fixture";

const PLAN = [{ chave: "produto_unico_planejamento_desde", valor: "2026-11-09" }];
const OPER = [{ chave: "produto_unico_cutover", valor: "2026-11-09" }];
const guarda = (parametros: { chave: string; valor: unknown }[]): GuardaProdutos => ({ canonicos: new Set([CAN]), legados: new Set([CONV, AUTO]), cutover: null, parametros });
const prods = [CONV, AUTO, CAN, CAIXA].map((id) => ({ id, ativo: true }));
const ids = (l: { id: string }[]) => l.map((p) => p.id);

describe("seletor da Previsão e listas: decidem pelo MODO da semana (planejamento OU cutover)", () => {
  it("PLANEJAMENTO 09/11 (sem cutover): Previsão mostra o produto único e esconde os legados; 02/11 segue com os legados", () => {
    const g = guarda(PLAN);
    expect(ids(produtosSelecionaveisPrevisao(prods, g, "2026-11-09"))).toEqual([CAN, CAIXA]);
    expect(ids(produtosSelecionaveisPrevisao(prods, g, "2026-11-12"))).toEqual([CAN, CAIXA]);
    expect(ids(produtosSelecionaveisPrevisao(prods, g, "2026-11-02"))).toEqual([CONV, AUTO, CAIXA]);
  });
  it("OPERACIONAL: igual ao planejamento na Previsão; sem nenhum parâmetro: lista de hoje (mesma referência)", () => {
    expect(ids(produtosSelecionaveisPrevisao(prods, guarda(OPER), "2026-11-09"))).toEqual([CAN, CAIXA]);
    expect(ids(produtosSelecionaveisPrevisao(prods, guarda([]), "2026-11-09"))).toEqual([CONV, AUTO, CAIXA]);
    const semCanonico: GuardaProdutos = { canonicos: new Set(), legados: new Set(), cutover: null };
    expect(produtosSelecionaveisPrevisao(prods, semCanonico, "2026-11-09")).toBe(prods);
  });
  it("o APONTAMENTO (seleção operacional por cutover) NÃO muda com o planejamento: continua nos legados", () => {
    const g = guarda(PLAN);
    expect(ids(produtosSelecionaveis(prods, g.canonicos, g.legados, "2026-11-10", g.cutover))).toEqual([CONV, AUTO, CAIXA]);
  });
  it("APONTAMENTO MANUAL (09/11): semana em PLANEJAMENTO mostra o produto único ALÉM dos legados; cutover e semanas anteriores seguem a regra de antes", () => {
    const g = guarda(PLAN);
    expect(ids(produtosSelecionaveisApontamento(prods, g, "2026-11-09"))).toEqual([CONV, AUTO, CAN, CAIXA]);
    expect(ids(produtosSelecionaveisApontamento(prods, g, "2026-11-13"))).toEqual([CONV, AUTO, CAN, CAIXA]);
    expect(ids(produtosSelecionaveisApontamento(prods, g, "2026-11-06"))).toEqual([CONV, AUTO, CAIXA]); // semana anterior ao planejamento: legados
    expect(ids(produtosSelecionaveisApontamento(prods, guarda(OPER), "2026-11-10"))).toEqual([CAN, CAIXA]); // OPERACIONAL: só o único
    expect(ids(produtosSelecionaveisApontamento(prods, guarda([]), "2026-11-10"))).toEqual([CONV, AUTO, CAIXA]); // sem vigência: canônico escondido
    const semCanonico: GuardaProdutos = { canonicos: new Set(), legados: new Set(), cutover: null };
    expect(produtosSelecionaveisApontamento(prods, semCanonico, "2026-11-09")).toBe(prods);
  });
  it("listas sem data: o canônico aparece com planejamento OU cutover, e continua escondido sem nenhum dos dois", () => {
    expect(primeiraVigencia(guarda(PLAN))).toBe("2026-11-09");
    expect(primeiraVigencia({ cutover: "2026-11-16", parametros: [...PLAN, { chave: "produto_unico_cutover", valor: "2026-11-16" }] })).toBe("2026-11-09");
    expect(primeiraVigencia(guarda([]))).toBeNull();
    const g = guarda(PLAN);
    expect(ids(produtosVisiveis(prods, g.canonicos, primeiraVigencia(g)))).toEqual([CONV, AUTO, CAN, CAIXA]);
    expect(ids(produtosVisiveis(prods, g.canonicos, null))).toEqual([CONV, AUTO, CAIXA]);
  });
  it("modoDaSemana usa a decisão central (modoProdutoUnicoDaSemana)", () => {
    expect(modoDaSemana(guarda(PLAN), "2026-11-09")).toBe("PLANEJAMENTO");
    expect(modoDaSemana({ cutover: "2026-11-09" }, "2026-11-09")).toBe("OPERACIONAL");
    expect(modoDaSemana(guarda(PLAN), "2026-11-02")).toBe("LEGADO");
  });
});

describe("leitura dos parâmetros (RPCs independentes e tolerantes)", () => {
  const cli = (rpcs: Record<string, unknown | "erro">, tabelas: Record<string, unknown[]> = { produto_canonico: [{ produto_id: CAN }], produto_legado_mapa: [{ produto_legado_id: CONV }] }): ClienteGuarda => ({
    from: (t) => ({ select: async () => ({ data: tabelas[t] ?? [], error: null }) }),
    rpc: async (n) => (rpcs[n] === "erro" || !(n in rpcs) ? { data: null, error: { message: "x" } } : { data: rpcs[n], error: null }),
  });
  it("lê planejamento e cutover separadamente", async () => {
    expect(await lerParametrosProdutoUnico(cli({ produto_unico_planejamento_desde: "2026-11-09", produto_unico_cutover: null }))).toEqual([{ chave: "produto_unico_planejamento_desde", valor: "2026-11-09" }]);
    const g = await lerGuardaProdutos(cli({ produto_unico_planejamento_desde: "2026-11-09", produto_unico_cutover: "2026-11-16" }));
    expect(g.planejamentoDesde).toBe("2026-11-09");
    expect(g.cutover).toBe("2026-11-16");
  });
  it("RPC de planejamento ainda inexistente (não migrada) ou com erro: só o cutover vale; nada quebra", async () => {
    const g = await lerGuardaProdutos(cli({ produto_unico_cutover: "2026-11-16" }));
    expect(g.planejamentoDesde).toBeNull();
    expect(g.cutover).toBe("2026-11-16");
    expect(modoDaSemana(g, "2026-11-09")).toBe("LEGADO");
    const nada = await lerGuardaProdutos(cli({ produto_unico_planejamento_desde: "erro", produto_unico_cutover: "erro" }));
    expect(nada.parametros).toEqual([]);
  });
});

describe("Unificar na semana de PLANEJAMENTO", () => {
  const itens = [
    { id: "1", produtoId: CONV, produtoNome: 'Conector 3/4"', quantidade: 64800 },
    { id: "2", produtoId: AUTO, produtoNome: 'Conector 3/4" - Maquina Automatica', quantidade: 28500 },
  ];
  it("oferece em PLANEJAMENTO (sem cutover), com o modo; não oferece em semana LEGADO", () => {
    const o = ofertaUnificar(itens, guarda(PLAN), "2026-11-09");
    expect(o).toMatchObject({ total: 93300, modo: "PLANEJAMENTO", jaTemUnico: false });
    expect(ofertaUnificar(itens, guarda(PLAN), "2026-11-02")).toBeNull();
    expect(ofertaUnificar(itens, guarda([]), "2026-11-09")).toBeNull();
  });
  it("o banner deixa claro que é plano futuro e confirma 64.800 + 28.500 = 93.300 retirando os dois itens antigos; só executa após a confirmação", async () => {
    const onUnificar = vi.fn().mockResolvedValue(null);
    render(<UnificarConectorBanner oferta={ofertaUnificar(itens, guarda(PLAN), "2026-11-09")!} onUnificar={onUnificar} />);
    expect(screen.getByTestId("unificar-planejamento").textContent).toContain("operação de hoje");
    expect(screen.getByText(/PLANEJAMENTO com o produto único/)).toBeTruthy();
    fireEvent.click(screen.getByText("Unificar em Conector 3/4"));
    const conf = screen.getByTestId("unificar-confirmacao").textContent!;
    expect(conf).toContain("64.800");
    expect(conf).toContain("28.500");
    expect(conf).toContain("93.300");
    expect(conf).toContain("retirando os dois itens antigos");
    expect(onUnificar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Sim, unificar"));
    await waitFor(() => expect(onUnificar).toHaveBeenCalledTimes(1));
  });
});

const PER = [["m1", 1.6], ["m2", 1.6], ["m3", 1.5], ["t1", 1.3], ["t2", 1.3], ["t3", 1.3]].map(([id, h]) => ({ id, nome: id, duracaoHoras: h })) as unknown as PeriodoComDuracao[];
const mt = (a: number) => ({ m1: a, m2: a, m3: a, t1: a, t2: a, t3: a });
const PRODUTO = {
  id: CAN, nome: "Conector 3/4", referencia: "", valorUnitario: 0.18, ativo: true, prioridade: "media",
  roteiro: [
    { id: C.m8, operacao: "Rosquear + Parafusar", metas: mt(1200), maquinasIds: [MAQ.m8] }, { id: C.ros, operacao: "Rosquear", metas: mt(2000), maquinasIds: [MAQ.r3] },
    { id: C.par, operacao: "Parafusar", metas: mt(1500), maquinasIds: [MAQ.p9] }, { id: C.eti, operacao: "Etiquetar", metas: mt(3500), maquinasIds: [MAQ.et15] }, { id: C.emb, operacao: "Embalar", metas: mt(5000), maquinasIds: [MAQ.em17] },
  ],
} as Produto;
const MAQS = [[MAQ.m8, "Máquina 8", "Rosquear + Parafusar"], [MAQ.r3, "Rosqueadeira 3", "Rosquear"], [MAQ.p9, "Parafusadeira 9", "Parafusar"], [MAQ.et15, "Etiquetadora 15", "Etiquetar"], [MAQ.em17, "Embaladora 17", "Embalar"]]
  .map(([id, nome, operacao]) => ({ id, nome, operacao, ativo: true })) as unknown as Maquina[];

describe("seleção de máquinas por ROTA na Previsão", () => {
  it("agrupa: ROTA CONVENCIONAL (Rosquear, Parafusar), ROTA AUTOMÁTICA (Máquina 8), DOWNSTREAM (Etiquetar, Embalar); sem modelo = um grupo sem título", () => {
    const g = agruparEtapasPorRota(PRODUTO.roteiro, modelo());
    expect(g.map((x) => x.titulo)).toEqual(["ROTA CONVENCIONAL", "ROTA AUTOMÁTICA", "DOWNSTREAM — comum às duas rotas"]);
    expect(g[0].etapas.map((e) => e.operacao)).toEqual(["Rosquear", "Parafusar"]);
    expect(g[1].etapas.map((e) => e.operacao)).toEqual(["Rosquear + Parafusar"]);
    expect(g[2].etapas.map((e) => e.operacao)).toEqual(["Etiquetar", "Embalar"]);
    expect(agruparEtapasPorRota(PRODUTO.roteiro, null)).toEqual([{ chave: "todas", titulo: null, etapas: PRODUTO.roteiro }]);
  });
  function renderItens(modelos: ReturnType<typeof modelo>[], guardaP: GuardaProdutos) {
    const semana: Previsao = { semanaInicio: "2026-11-09", itens: [], itensRealizados: [], maquinasIndisponiveis: [] };
    return render(
      <ItensPrevistos
        loading={false} produtos={[PRODUTO]} maquinas={MAQS} periodosComDuracao={PER} horasPorMaquinaSemana={34} semana={semana}
        showForm setShowForm={() => undefined} editingId={null}
        form={{ produtoId: CAN, quantidade: "93300", maquinasPorEtapa: { [C.m8]: [MAQ.m8], [C.ros]: [MAQ.r3], [C.par]: [MAQ.p9], [C.eti]: [MAQ.et15], [C.emb]: [MAQ.em17] } }}
        onSelecionarProduto={() => undefined} onQuantidadeChange={() => undefined} onToggleMaquina={() => undefined} onSubmit={() => undefined} salvando={false}
        onCancelar={() => undefined} onEditar={() => undefined} onExcluir={() => undefined}
        analise={{ maquinas: [], gargalos: [], atingivel: true, maquinaMaisCarregada: null }} valorPrevistoSemana={0} equipeProdutivaCount={5} formatBRL={(v) => String(v)}
        modelosCanonicos={modelos} guardaProdutos={guardaP}
      />,
    );
  }
  it("a tela mostra os três blocos na ordem Rosquear, Parafusar, Máquina 8, Etiquetar, Embalar (semana de planejamento: o produto único está no seletor)", () => {
    const { container } = renderItens([modelo()], guarda(PLAN));
    const titulos = [...container.querySelectorAll("[data-grupo-rota]")].map((n) => n.getAttribute("data-grupo-rota"));
    expect(titulos).toEqual(["ROTA CONVENCIONAL", "ROTA AUTOMÁTICA", "DOWNSTREAM — comum às duas rotas"]);
    const opcoes = [...container.querySelectorAll("select option")].map((o) => o.textContent);
    expect(opcoes.some((t) => t?.includes("Conector 3/4"))).toBe(true);
    const nomes = [...container.querySelectorAll(".stx-etapa-card > p")].map((n) => n.textContent);
    expect(nomes).toEqual(["Rosquear", "Parafusar", "Rosquear + Parafusar", "Etiquetar", "Embalar"]);
  });
  it("produto linear (sem modelo): a tela de hoje, sem títulos de rota", () => {
    const { container } = renderItens([], { canonicos: new Set(), legados: new Set(), cutover: null });
    expect(container.querySelectorAll("[data-grupo-rota]").length).toBe(0);
    expect([...container.querySelectorAll(".stx-etapa-card > p")].map((n) => n.textContent)).toEqual(["Rosquear + Parafusar", "Rosquear", "Parafusar", "Etiquetar", "Embalar"]);
  });
});

describe("divisão entre rotas (só leitura, vinda do plano)", () => {
  const linhas = [
    { data: "2026-11-09", produtoId: CAN, etapaId: C.par, pecas: 6000 }, { data: "2026-11-09", produtoId: CAN, etapaId: C.m8, pecas: 4000 },
    { data: "2026-11-09", produtoId: CAN, etapaId: C.ros, pecas: 7000 }, // etapa interna da convencional: não conta (não é a saída da rota)
    { data: "2026-11-10", produtoId: CAN, etapaId: C.par, pecas: 5000 }, { data: "2026-11-10", produtoId: CAN, etapaId: C.m8, pecas: 5000 },
    { data: "2026-11-10", produtoId: CAIXA, etapaId: C.par, pecas: 999 },
  ];
  it("soma a saída de cada rota por dia e na semana (Parafusar × Máquina 8)", () => {
    const d = divisaoEntreRotas(linhas, modelo());
    expect(d.temDados).toBe(true);
    expect(d.rotas.map((r) => r.etapaSaidaId)).toEqual([C.par, C.m8]);
    expect(d.porDia["2026-11-09"]).toMatchObject({ [d.rotas[0].rotaId]: 6000, [d.rotas[1].rotaId]: 4000 });
    expect(d.total[d.rotas[0].rotaId]).toBe(11000);
    expect(d.total[d.rotas[1].rotaId]).toBe(9000);
    expect(d.totalGeral).toBe(20000);
  });
  it("sem modelo, sem linhas do produto único ou sem peças: nada (nenhum número enganoso)", () => {
    expect(divisaoEntreRotas(linhas, null).temDados).toBe(false);
    expect(divisaoEntreRotas([{ data: "2026-11-09", produtoId: CAIXA, etapaId: C.par, pecas: 5 }], modelo()).temDados).toBe(false);
    const { container } = render(<DivisaoEntreRotas linhas={[]} modelo={modelo()} />);
    expect(container.innerHTML).toBe("");
  });
  it("a tabela mostra rota, dia e semana com percentuais", () => {
    render(<DivisaoEntreRotas linhas={linhas} modelo={modelo()} nomeEtapa={(id) => (id === C.par ? "Parafusar" : id === C.m8 ? "Máquina 8" : null)} />);
    const t = screen.getByTestId("divisao-rotas").textContent!;
    expect(t).toContain("saída: Parafusar");
    expect(t).toContain("saída: Máquina 8");
    expect(t).toContain("11.000");
    expect(t).toContain("55%");
  });
});

describe("selo de plano futuro", () => {
  it("texto exato", () => {
    render(<PlanoFuturoSelo />);
    expect(screen.getByTestId("plano-futuro-selo").textContent).toContain(TEXTO_PLANO_FUTURO);
    expect(TEXTO_PLANO_FUTURO).toBe("PLANO FUTURO / AINDA NÃO LIBERADO PARA PRODUÇÃO");
  });
});
