// Indicadores consultivos × produto com rotas alternativas: produto linear idêntico; produto único => sentinela/mensagem EXATA; sem modelo vigente => nada muda.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import type { Maquina, PeriodoComDuracao, Previsao, PrevisaoItem, Produto } from "@/types/domain";
import { calcularAnaliseCapacidadeSemanal, calcularAlocacaoSemanal, calcularCapacidadeMaximaSemana, calcularItensSemanaAgregados } from "@/features/capacidade/calculations";
import { calcularProdutosProgramados, calcularResumoProgramacaoPecas, comPossivelIndisponivel } from "@/features/previsao/progressoSemana";
import ProdutosProgramados from "@/features/previsao/components/ProdutosProgramados";
import StatusProgramacao from "@/features/previsao/components/StatusProgramacao";
import AjustarCapacidadeModal from "@/features/previsao/components/AjustarCapacidadeModal";
import CoberturaEquipe from "@/features/previsao/components/CoberturaEquipe";
import { gerarHtmlProgramacaoSemana } from "@/features/previsao/pdf";
import { gerarValidacaoPrevisao } from "@/features/producao-real/validacao-previsao";
import { detectarPossivelRestricaoOperacional, calcularEconomicoPorProduto } from "@/features/producao-real/indicadores/economico";
import { gerarFilaDesvios } from "@/features/producao-real/desvios";
import EconomiaPorProduto from "@/features/producao-real/indicadores/components/EconomiaPorProduto";
import {
  INDISPONIVEL, MENSAGEM_INDICADOR_INDISPONIVEL, algumProdutoComRotasAlternativas, ehIndisponivel, idsComRotasAlternativas, indicadorOuIndisponivel,
  modeloTemRotasAlternativas, produtoTemRotasAlternativas,
} from "../indicadores";
import { lerModelosVigentes, type ClienteModelosVigentes } from "../rotasAlternativasDb";
import { C, CAN, CAIXA, MAQ, modelo } from "./fixture";

const MSG = "INDICADOR TEMPORARIAMENTE INDISPONÍVEL PARA PRODUTO COM ROTAS ALTERNATIVAS.";
const PER = [["m1", 1.6], ["m2", 1.6], ["m3", 1.5], ["t1", 1.3], ["t2", 1.3], ["t3", 1.3]].map(([id, h]) => ({ id, nome: id, duracaoHoras: h, inicio: "07:00", fim: "08:00" })) as unknown as PeriodoComDuracao[];
const mt = (a: number) => ({ m1: a, m2: a, m3: a, t1: a, t2: a, t3: a });
const CONECTOR = {
  id: CAN, nome: "Conector 3/4", referencia: "", valorUnitario: 0.18, ativo: true, prioridade: "media",
  roteiro: [
    { id: C.m8, operacao: "Rosquear + Parafusar", metas: mt(1200), maquinasIds: [MAQ.m8] }, { id: C.ros, operacao: "Rosquear", metas: mt(2000), maquinasIds: [MAQ.r3] },
    { id: C.par, operacao: "Parafusar", metas: mt(1500), maquinasIds: [MAQ.p9] }, { id: C.eti, operacao: "Etiquetar", metas: mt(3500), maquinasIds: [MAQ.et15] }, { id: C.emb, operacao: "Embalar", metas: mt(5000), maquinasIds: [MAQ.em17] },
  ],
} as Produto;
const LINEAR = {
  id: CAIXA, nome: "Caixa", referencia: "", valorUnitario: 1, ativo: true, prioridade: "media",
  roteiro: [{ id: "e1", operacao: "Embalar", metas: mt(1000), maquinasIds: ["mx"] }],
} as Produto;
const MAQS = [[MAQ.m8, "Máquina 8"], [MAQ.r3, "Rosqueadeira 3"], [MAQ.p9, "Parafusadeira 9"], [MAQ.et15, "Etiquetadora 15"], [MAQ.em17, "Embaladora 17"], ["mx", "Máq X"]]
  .map(([id, nome]) => ({ id, nome, operacao: "x", ativo: true })) as unknown as Maquina[];
const sel = { [C.m8]: [MAQ.m8], [C.ros]: [MAQ.r3], [C.par]: [MAQ.p9], [C.eti]: [MAQ.et15], [C.emb]: [MAQ.em17] };
const itemU: PrevisaoItem = { id: "iu", produtoId: CAN, produtoNome: "Conector 3/4", valorUnitario: 0.18, quantidade: 93300, maquinasPorEtapa: sel };
const itemL: PrevisaoItem = { id: "il", produtoId: CAIXA, produtoNome: "Caixa", valorUnitario: 1, quantidade: 100, maquinasPorEtapa: { e1: ["mx"] } };
const MODELOS = [modelo()];

describe("decisão única (indicadores.ts)", () => {
  it("mensagem EXATA (PRODUTO, não PRODUÇÃO) e sentinela congelado", () => {
    expect(MENSAGEM_INDICADOR_INDISPONIVEL).toBe(MSG);
    expect(INDISPONIVEL.mensagem).toBe(MSG);
    expect(Object.isFrozen(INDISPONIVEL)).toBe(true);
    expect(ehIndisponivel(INDISPONIVEL)).toBe(true);
    expect(ehIndisponivel({ maquinas: [] })).toBe(false);
    expect(ehIndisponivel(null)).toBe(false);
  });
  it("estrutura: duas rotas/convergência = alternativas; modelo de uma rota sem convergência = linear", () => {
    expect(modeloTemRotasAlternativas(modelo())).toBe(true);
    const m = modelo();
    const linear = { rotas: [m.rotas[0]], etapas: m.etapas.filter((e) => e.rotaId !== m.rotas[1].id), arestas: m.arestas.filter((a) => a.origemEtapaId !== C.m8) };
    expect(modeloTemRotasAlternativas(linear)).toBe(false);
  });
  it("sem modelos: ninguém tem rotas alternativas e o cálculo roda (mesma referência devolvida)", () => {
    const r = { a: 1 };
    expect(indicadorOuIndisponivel([CAN], [], () => r)).toBe(r);
    expect(indicadorOuIndisponivel([CAN], undefined, () => r)).toBe(r);
    expect(produtoTemRotasAlternativas(CAN, [])).toBe(false);
    expect(idsComRotasAlternativas(null).size).toBe(0);
  });
  it("com modelo: o produto único (qualquer item no conjunto) => INDISPONIVEL e o cálculo NEM RODA; produto linear => cálculo intacto", () => {
    const calc = vi.fn(() => 42);
    expect(indicadorOuIndisponivel([CAIXA, CAN], MODELOS, calc)).toBe(INDISPONIVEL);
    expect(calc).not.toHaveBeenCalled();
    expect(indicadorOuIndisponivel([CAIXA], MODELOS, calc)).toBe(42);
    expect(algumProdutoComRotasAlternativas([null, undefined, CAIXA], MODELOS)).toBe(false);
  });
});

describe("modelos vigentes (antes do planejamento/cutover nada muda)", () => {
  const tabelas = { produto_canonico: [{ produto_id: CAN, codigo: "C", nome_exibicao: "C" }], produto_produto_rotas: [] } as Record<string, unknown[]>;
  const cli = (rpcs: Record<string, unknown | "erro">): ClienteModelosVigentes => ({
    from: (t) => ({ select: async () => ({ data: t === "produto_canonico" ? tabelas.produto_canonico : [], error: null }) }),
    rpc: async (n) => (rpcs[n] === "erro" || !(n in rpcs) ? { data: null, error: { message: "x" } } : { data: rpcs[n], error: null }),
  });
  it("modelo existe mas NENHUMA vigência: []", async () => {
    expect(await lerModelosVigentes(cli({ produto_unico_cutover: null, produto_unico_planejamento_desde: null }))).toEqual([]);
  });
  it("sem produto canônico: []", async () => {
    const c: ClienteModelosVigentes = { from: () => ({ select: async () => ({ data: [], error: null }) }), rpc: async () => ({ data: "2026-11-09", error: null }) };
    expect(await lerModelosVigentes(c)).toEqual([]);
  });
});

describe("Previsão: capacidade/possível/status", () => {
  it("produto linear: o cálculo é o de sempre; com o produto único vira sentinela (e nenhum número)", () => {
    const direto = calcularAnaliseCapacidadeSemanal([itemL], [LINEAR], MAQS, PER, 34);
    expect(indicadorOuIndisponivel([itemL.produtoId], MODELOS, () => calcularAnaliseCapacidadeSemanal([itemL], [LINEAR], MAQS, PER, 34))).toEqual(direto);
    const comUnico = indicadorOuIndisponivel([itemL, itemU].map((i) => i.produtoId), MODELOS, () => calcularCapacidadeMaximaSemana([itemL, itemU], [LINEAR, CONECTOR], MAQS, PER, 34));
    expect(ehIndisponivel(comUnico)).toBe(true);
    const aloc = indicadorOuIndisponivel([CAN], MODELOS, () => calcularAlocacaoSemanal(calcularItensSemanaAgregados([itemU]), [itemU], [CONECTOR], {}, PER, MAQS, [], 34, 1.5, () => 1));
    expect(aloc).toBe(INDISPONIVEL);
  });
  it("Possível: null para o produto único (sem número), intacto para os demais; sem ids = mesma lista", () => {
    const prog = calcularProdutosProgramados([itemL, itemU], [], null);
    expect(comPossivelIndisponivel(prog, new Set())).toBe(prog);
    const m = comPossivelIndisponivel(prog, new Set([CAN]));
    expect(m.map((p) => p.possivel)).toEqual([100, null]);
    expect(calcularResumoProgramacaoPecas(m).totalPossivel).toBeNull();
    expect(calcularResumoProgramacaoPecas(prog).totalPossivel).toBe(93400);
  });
  it("tabela de Itens previstos mostra a mensagem exata no lugar do Possível", () => {
    const prog = comPossivelIndisponivel(calcularProdutosProgramados([itemU], [], new Map()), new Set([CAN]));
    render(<ProdutosProgramados produtos={prog} naoPrevistos={[]} resumoPecas={calcularResumoProgramacaoPecas(prog)} />);
    expect(screen.getByRole("status").textContent).toContain(MSG);
  });
  it("Status da programação: mensagem no lugar do veredito; linear mostra o veredito de sempre", () => {
    const { unmount } = render(<StatusProgramacao analise={INDISPONIVEL} capacidadeMaximaSemana={INDISPONIVEL} observacoesSetup={[]} modoSimulacao={false} onAjustar={() => undefined} formatBRL={String} />);
    expect(screen.getByTestId("status-programacao-indisponivel").textContent).toContain(MSG);
    expect(screen.queryByText(/Previsão atingível|Previsão não atingível/)).toBeNull();
    unmount();
    const analise = calcularAnaliseCapacidadeSemanal([itemL], [LINEAR], MAQS, PER, 34);
    render(<StatusProgramacao analise={analise} capacidadeMaximaSemana={calcularCapacidadeMaximaSemana([itemL], [LINEAR], MAQS, PER, 34)} observacoesSetup={[]} modoSimulacao={false} onAjustar={() => undefined} formatBRL={String} />);
    expect(screen.getByText(/Previsão atingível/)).toBeTruthy();
  });
  it("'Ajustar para capacidade' não existe para rotas alternativas", () => {
    const { container } = render(<AjustarCapacidadeModal aberto onFechar={() => undefined} onAplicar={() => undefined} capacidadeMaximaSemana={INDISPONIVEL} formatBRL={String} />);
    expect(container.innerHTML).toBe("");
  });
});

vi.mock("@/lib/escala/disparar", () => ({ analisarCoberturaNoServidor: vi.fn(async () => ({ ok: false, erro: "não deveria ser chamado" })) }));
vi.mock("@/hooks/useWipModo", () => ({ useWipModo: () => false }));
describe("Cobertura da equipe", () => {
  it("itens com o produto único: só a mensagem, sem botão de análise nem consulta ao servidor; produto linear: painel de sempre", async () => {
    const { analisarCoberturaNoServidor } = await import("@/lib/escala/disparar");
    const props = { semanaInicio: "2026-11-09", modoSimulacao: false, salvando: false, onSalvarAdicional: async () => true, produtos: [CONECTOR, LINEAR] };
    const { unmount } = render(<CoberturaEquipe {...props} itens={[itemU, itemL]} modelosRotas={MODELOS} />);
    expect(screen.getByTestId("cobertura-indisponivel").textContent).toContain(MSG);
    expect(screen.queryByText("Analisar cobertura")).toBeNull();
    expect(analisarCoberturaNoServidor).not.toHaveBeenCalled();
    unmount();
    render(<CoberturaEquipe {...props} itens={[itemL]} modelosRotas={MODELOS} />);
    expect(screen.queryByTestId("cobertura-indisponivel")).toBeNull();
    expect(screen.getByText("Analisar cobertura")).toBeTruthy();
  });
});

describe("PDF da programação", () => {
  const prev: Previsao = { semanaInicio: "2026-11-09", itens: [itemU, itemL], itensRealizados: [], maquinasIndisponiveis: [] };
  const base = { semanaAtual: "2026-11-09", semanaAtualRec: prev, produtos: [CONECTOR, LINEAR], maquinas: MAQS, periodosComDuracao: PER, horasPorMaquinaSemana: 34, duracaoMediaPeriodo: 1.5, diasProdutivosSemana: 5, equipeProdutivaCount: 5, getLucroHora: () => 1 };
  it("com o produto único: mensagem exata, sem atingibilidade/uso por máquina/veredito linear", () => {
    const html = gerarHtmlProgramacaoSemana({ ...base, semanaAtualRec: { ...prev, itens: [itemU] }, produtos: [CONECTOR], modelosRotas: MODELOS });
    expect(html).toContain(MSG);
    expect(gerarHtmlProgramacaoSemana({ ...base, modelosRotas: MODELOS })).toContain(MSG); // semana mista: seções agregadas também indisponíveis
    expect(html).not.toMatch(/meta atingível|atinge só|% usada|Dá para cumprir/);
  });
  it("sem modelos vigentes: HTML idêntico ao de sempre (mesmo conteúdo, com ou sem o parâmetro)", () => {
    const a = gerarHtmlProgramacaoSemana(base).replace(/gerado em [^<]+/, "");
    const b = gerarHtmlProgramacaoSemana({ ...base, modelosRotas: [] }).replace(/gerado em [^<]+/, "");
    expect(b).toBe(a);
    expect(a).not.toContain(MSG);
  });
});

describe("Validação da Previsão (e Visão Geral/Intelligence que a reaproveitam)", () => {
  const previsao: Previsao = { semanaInicio: "2026-11-09", itens: [itemU, itemL], itensRealizados: [], maquinasIndisponiveis: [] };
  const run = (modelos?: typeof MODELOS) => gerarValidacaoPrevisao(previsao, [CONECTOR, LINEAR], MAQS, PER, 5, [], [], new Date("2026-11-09T10:00:00"), modelos);
  it("produto único na semana: nenhuma capacidade, projeção, déficit nem recurso pressionado; só fatos", () => {
    const r = run(MODELOS);
    expect(r.recursosPressionadosIndisponivel).toBe(true);
    expect(r.recursosPressionados).toEqual([]);
    r.itens.forEach((it) => {
      expect(it).toMatchObject({ indisponivelRotas: true, capacidadeTeoricaRestante: null, capacidadeProvavelRestante: null, projecaoFinal: null, deficitProjetado: null, estado: "indisponivel_rotas", confianca: "indisponivel" });
    });
    expect(r.itens[0].previsto).toBe(93300);
    expect(r.itens[0].faltaOperacional).toBe(93300);
  });
  it("sem modelos vigentes: resultado IDÊNTICO ao de sempre", () => {
    expect(run([])).toEqual(run());
    expect(run().recursosPressionadosIndisponivel).toBeUndefined();
    expect(run().itens.every((i) => i.indisponivelRotas === undefined && typeof i.capacidadeTeoricaRestante === "number")).toBe(true);
  });
});

describe("possível restrição operacional (economia e desvios de fluxo)", () => {
  const ap = (over: Partial<ApontamentoIndicador>): ApontamentoIndicador => ({
    apontamentoId: Math.random().toString(), data: "2026-11-10", periodoId: "m1", periodoNome: "M1", status: "produzindo", motivoSemProducao: null, produtoId: CAN, produtoNome: "Conector 3/4",
    maquinaId: "mq", maquinaNome: "M", operacaoId: "o", operacaoNome: "Op", funcionarioId: "f", funcionarioNome: "F", etapaId: "e", etapaOrdem: 0, isUltimaEtapa: false,
    quantidadeProduzida: 100, quantidadeRefugo: 0, metaPeriodoVigente: 100, duracaoPeriodoHorasVigente: 1.5, minutosParados: 0, custoHoraOperacaoVigente: 30, custoOperacionalPeriodoVigente: 45,
    custoUnitarioReferenciaPeriodoVigente: 0.45, produtoValorUnitario: 0.18, etapaMaquinasElegiveis: 1, ...over,
  });
  // M8 (menor volume + performance baixa) seria sinalizada como "restrição" pelo critério linear — falso com rotas paralelas
  const m8 = ap({ etapaId: "e-m8", etapaOrdem: 0, maquinaId: "m8", quantidadeProduzida: 40, metaPeriodoVigente: 100 });
  const emb = ap({ etapaId: "e-emb", etapaOrdem: 4, isUltimaEtapa: true, maquinaId: "emb", quantidadeProduzida: 95, metaPeriodoVigente: 100 });
  it("sem ids: critério de sempre (sinaliza); com o produto único: indisponível, sem etapa sinalizada", () => {
    expect(detectarPossivelRestricaoOperacional([m8, emb], [m8, emb])!.etapaSinalizada?.etapaId).toBe("e-m8");
    const r = detectarPossivelRestricaoOperacional([m8, emb], [m8, emb], new Set([CAN]))!;
    expect(r.indisponivelRotas).toBe(true);
    expect(r.etapaSinalizada).toBeNull();
    expect(r.observacao).toBe(MSG);
    expect(detectarPossivelRestricaoOperacional([m8, emb], [m8, emb], new Set(["outro"]))!.etapaSinalizada?.etapaId).toBe("e-m8");
  });
  it("Desvios: o desvio de fluxo some para o produto único (ausência) e continua para os demais", () => {
    const hoje = new Date("2026-11-11T12:00:00");
    const tipos = (ids?: Set<string>) => gerarFilaDesvios([m8, emb], [], hoje, ids).incidentes.map((i) => i.desvioPrincipal.tipo);
    expect(tipos()).toContain("possivel_restricao_operacional");
    expect(tipos(new Set([CAN]))).not.toContain("possivel_restricao_operacional");
  });
  it("Economia por produto: a restrição do produto único mostra a mensagem; margem/custo seguem", () => {
    const grupos = [{ chave: CAN, rotulo: "Conector 3/4", apontamentos: [m8, emb] }] as never;
    const itens = calcularEconomicoPorProduto(grupos, [m8, emb], new Set([CAN]));
    render(<EconomiaPorProduto itens={itens} />);
    fireEvent.click(screen.getByText("Conector 3/4"));
    expect(screen.getByRole("status").textContent).toContain(MSG);
  });
});
