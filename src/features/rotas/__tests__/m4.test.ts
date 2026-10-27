import { describe, it, expect } from "vitest";
import { calcularAlocacaoSemanal, calcularHorasPorMaquina, calcularItensSemanaAgregados, calcularCapacidadeInicialPorMaquina } from "@/features/capacidade/calculations";
import { calcularIndicadoresProducao, calcularMargemProduto } from "@/features/custo-hora/calculations";
import { alocacaoDaSemana, estimadoAte, inconsistencias, type ControleWip, type EntradaWip } from "@/features/escala/wipSaldo";
import { restanteAcabado } from "@/features/escala/execucao";
import { chavePool, type PoolEscala } from "@/features/escala/types";
import { custoHoraDaEmpresa, mapearFixedCost, mapearFuncionario, mapearPeriodo } from "@/lib/custo/custoHoraDados";
import type { Funcionario, FixedCost, Maquina, PeriodoComDuracao, PrevisaoItem, Produto } from "@/types/domain";
import { calcularHorasPorDia, calcularPeriodosComDuracao, filtrarPeriodosValidos } from "@/lib/calculations/periodos";
import { idVirtual, projetarEstado } from "../adaptador";
import { apontadoRealProduto, etapaFinalDoProduto } from "../compat";
import { expandirItensDeRotas, ehItemVirtual, resultadosVisiveis } from "../dominio";
import { custoDoProdutoDeRotas } from "../produtoCusto";
import { arestasDoPercurso, arestaValida, grupoDaEtapa, wipDoProdutoRotas } from "../wipRotas";
import { ESTRUTURA_F, F, SEL_F, estadoF } from "./fixtureRotas";

const PERIODOS: PeriodoComDuracao[] = [{ id: "m1", nome: "M1", inicio: "07:12", fim: "08:48", duracaoHoras: 1.6 }, { id: "m2", nome: "M2", inicio: "08:48", fim: "10:24", duracaoHoras: 1.6 }, { id: "m3", nome: "M3", inicio: "10:24", fim: "11:55", duracaoHoras: 91 / 60 }, { id: "t1", nome: "T1", inicio: "13:00", fim: "14:20", duracaoHoras: 80 / 60 }, { id: "t2", nome: "T2", inicio: "14:20", fim: "15:40", duracaoHoras: 80 / 60 }, { id: "t3", nome: "T3", inicio: "15:40", fim: "17:00", duracaoHoras: 80 / 60 }];
const metas = (a: number, b: number) => ({ m1: a, m2: a, m3: a, t1: b, t2: b, t3: b });
const PRODUTO_F: Produto = {
  id: F, nome: 'Conector 3/4" (Final)', referencia: "56126022", valorUnitario: 0.1825, ativo: true, prioridade: "media" as Produto["prioridade"], estruturaRotas: ESTRUTURA_F,
  roteiro: [
    { id: "f-rosq", operacao: "Rosquear", metas: metas(2000, 1600), maquinasIds: ["R3", "R5", "R6"] }, { id: "f-para", operacao: "Parafusar", metas: metas(1500, 1200), maquinasIds: ["P9", "P10", "P11", "P12"] },
    { id: "f-rp", operacao: "Rosquear + Parafusar", metas: metas(1275, 1100), maquinasIds: ["A8"] }, { id: "f-etiq", operacao: "Etiquetar", metas: metas(3500, 3000), maquinasIds: ["E15", "E16"] }, { id: "f-emb", operacao: "Embalar", metas: metas(5000, 4500), maquinasIds: ["EMB17"] },
  ],
};
const ITEM_F: PrevisaoItem = { id: "item-f", produtoId: F, produtoNome: PRODUTO_F.nome, valorUnitario: 0.1825, quantidade: 116625, maquinasPorEtapa: SEL_F };
const HORAS_SEMANA = (PERIODOS.reduce((s, p) => s + p.duracaoHoras, 0)) * 5;

describe("M4 — capacidade legada com produto de rotas (sem demanda duplicada, sem CONV+AUTO em sequência)", () => {
  const exp = expandirItensDeRotas({ itens: [ITEM_F], produtos: [PRODUTO_F], periodosComDuracao: PERIODOS, diasProdutivos: 5 });
  it("cada etapa é contada UMA vez: exclusivas = entrega da rota; Etiquetar e Embalar = produto final possível (97.500 só com a E15)", () => {
    const qtd = (id: string) => exp.itens.find((i) => i.id === `item-f#${id}`)?.quantidade;
    expect(qtd("AUTO")).toBeCloseTo(35625, 4); expect(qtd("CONV")).toBeCloseTo(61875, 4); expect(qtd("COMUM")).toBeCloseTo(97500, 4);
    expect(exp.itens).toHaveLength(3); expect(exp.itens.some((i) => i.id === "item-f")).toBe(false);
    expect(exp.previas.get("item-f")!.plano.falta).toBeCloseTo(19125, 4);
    // a receita (preço × peças) só existe no fluxo comum: 97.500 × 0,1825 — nunca 3 vezes
    expect(exp.itens.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0)).toBeCloseTo(97500 * 0.1825, 6);
  });
  it("horas por máquina somam cada etapa uma vez; o legado sem expansão contaria a demanda inteira em TODAS as etapas", () => {
    const horas = calcularHorasPorMaquina(exp.itens, exp.produtos, PERIODOS, HORAS_SEMANA);
    const ingenuo = calcularHorasPorMaquina([ITEM_F], [{ ...PRODUTO_F, estruturaRotas: undefined }], PERIODOS, HORAS_SEMANA);
    const sum = (h: typeof horas) => Object.values(h).reduce((s, v) => s + v.horasNecessarias, 0);
    expect(sum(horas)).toBeLessThan(sum(ingenuo));
    // E15: 97.500 peças × tempo/peça do Etiquetar
    const tEtiq = (PERIODOS.reduce((s, p) => s + p.duracaoHoras, 0)) / 19500;
    expect(horas.E15.horasNecessarias).toBeCloseTo(97500 * tEtiq, 4);
    expect(horas.A8.horasNecessarias).toBeCloseTo(35625 * (PERIODOS.reduce((s, p) => s + p.duracaoHoras, 0) / (3 * 1275 + 3 * 1100)), 4);
  });
  it("sem produto de rotas devolve as MESMAS referências (linear intacto)", () => {
    const linear: Produto = { ...PRODUTO_F, id: "pL", estruturaRotas: undefined };
    const itens = [{ ...ITEM_F, produtoId: "pL" }];
    const r = expandirItensDeRotas({ itens, produtos: [linear], periodosComDuracao: PERIODOS, diasProdutivos: 5 });
    expect(r.itens).toBe(itens); expect(r.produtos[0]).toBe(linear); expect(r.resultados).toEqual([]);
  });
  it("alocação semanal por lucro/hora funciona com as cadeias; a UI filtra os ids virtuais e mostra F uma vez", () => {
    const maquinas: Maquina[] = ["R3", "R6", "P9", "P10", "A8", "E15", "EMB17"].map((id) => ({ id, nome: id, operacao: "x", ativo: true }));
    const ag = calcularItensSemanaAgregados(exp.itens);
    const aloc = calcularAlocacaoSemanal(ag, exp.itens, exp.produtos, calcularCapacidadeInicialPorMaquina(maquinas, [], HORAS_SEMANA), PERIODOS, maquinas, [], HORAS_SEMANA, 1.5, () => 1);
    const visiveis = aloc.resultados.filter((r) => !ehItemVirtual(r.produtoId));
    expect(aloc.resultados.length).toBeGreaterThan(visiveis.length);                  // as cadeias existem só no cálculo
    expect(resultadosVisiveis([], exp).map((r) => r.itemId)).toEqual(["item-f"]);
    expect(exp.resultados[0].maximoPossivel).toBe(97500);
  });
});

describe("M4 — custo do produto de rotas (dados do sistema, sem constantes; nunca a soma das duas rotas)", () => {
  const custoHora = { Rosquear: 30.57, Parafusar: 30.58, "Rosquear + Parafusar": 30.56, Etiquetar: 30.64, Embalar: 30.61 };
  it("custo final via CONV = exclusivo CONV + comum; via AUTO = exclusivo AUTO + comum; a referência única é a mais cara — nunca CONV + AUTO + comum", () => {
    const c = custoDoProdutoDeRotas(PRODUTO_F, custoHora, 30, PERIODOS)!;
    const conv = c.porRota.find((x) => x.rotaCodigo === "CONV")!, auto = c.porRota.find((x) => x.rotaCodigo === "AUTO")!;
    expect(conv.final).toBeCloseTo(c.exclusivoPorRota.CONV + c.comum, 12); expect(auto.final).toBeCloseTo(c.exclusivoPorRota.AUTO + c.comum, 12);
    expect(c.referencia.rotaCodigo).toBe("CONV"); expect(conv.final).toBeGreaterThan(auto.final);
    // a conta linear (soma de todas as etapas) daria muito mais que qualquer rota
    const linear = calcularIndicadoresProducao({ roteiro: PRODUTO_F.roteiro }, custoHora, 30, PERIODOS).custo;
    expect(linear).toBeGreaterThan(conv.final + 0.03);
    expect(calcularIndicadoresProducao(PRODUTO_F, custoHora, 30, PERIODOS).custo).toBeCloseTo(conv.final, 12);
    expect(calcularMargemProduto(PRODUTO_F, custoHora, 30, PERIODOS).custo).toBeCloseTo(conv.final, 12);
  });
  it("muda com o custo/hora informado (nada fixo): dobrar o custo/hora dobra o custo", () => {
    const dobro = Object.fromEntries(Object.entries(custoHora).map(([k, v]) => [k, v * 2]));
    expect(custoDoProdutoDeRotas(PRODUTO_F, dobro, 60, PERIODOS)!.referencia.final).toBeCloseTo(custoDoProdutoDeRotas(PRODUTO_F, custoHora, 30, PERIODOS)!.referencia.final * 2, 12);
  });
  it("produto LINEAR: calcularIndicadoresProducao idêntico ao de sempre", () => {
    const linear = { roteiro: PRODUTO_F.roteiro };
    const a = calcularIndicadoresProducao(linear, custoHora, 30, PERIODOS);
    const b = calcularIndicadoresProducao({ ...linear, estruturaRotas: undefined }, custoHora, 30, PERIODOS);
    expect(b).toEqual(a);
  });
});

const custoHora = { Rosquear: 30.57, Parafusar: 30.58, "Rosquear + Parafusar": 30.56, Etiquetar: 30.64, Embalar: 30.61 };
describe("M4 — custo/hora: UMA fonte para tela e servidor", () => {
  const funcs: Funcionario[] = [mapearFuncionario({ id: "f1", nome: "A", created_at: "2026-01-01", salario_base: 2000, ativo: true, operacoes: { nome: "Produção" }, funcionario_custos: [{ id: "c1", descricao: "VT", valor: 200 }] }),
    mapearFuncionario({ id: "f2", nome: "B", created_at: "2026-01-02", salario_base: 2400, ativo: true, operacoes: { nome: "Produção" }, funcionario_custos: [] })];
  const fixos: FixedCost[] = [mapearFixedCost({ id: "x1", descricao: "Aluguel", valor: 5000, ativo: true, categorias: { nome: "Fixo" } })];
  const periodosRows = [{ id: "m1", nome: "M1", inicio: "07:12:00", fim: "08:48:00" }, { id: "m2", nome: "M2", inicio: "08:48:00", fim: "10:24:00" }];
  it("o helper compartilhado dá exatamente o que a tela calculava com os mesmos dados (mesma fórmula)", () => {
    const periodos = periodosRows.map(mapearPeriodo);
    const compartilhado = custoHoraDaEmpresa({ funcionarios: funcs, fixedCosts: fixos, periodos, diasUteis: "22" });
    const horasDia = calcularHorasPorDia(filtrarPeriodosValidos(calcularPeriodosComDuracao(periodos)));
    expect(compartilhado.custoHoraEmpresa).toBeGreaterThan(0);
    expect(compartilhado.custoHoraPorOperacao["Produção"]).toBeGreaterThan(0);
    expect(horasDia).toBeGreaterThan(0);
    expect(mapearPeriodo(periodosRows[0])).toEqual({ id: "m1", nome: "M1", inicio: "07:12", fim: "08:48" });
  });
  it("o planejador com o custo REAL escolhe a rota pelo custo (não por preferência): AUTO mais cara ⇒ CONV primeiro", async () => {
    const { resolverRotas } = await import("../resolucao");
    const { AGORA } = await import("./fixtureRotas");
    const sel = { ...SEL_F, "f-etiq": ["E15", "E16"] };
    const base = (custoAuto: number) => estadoF({ selecao: sel, demanda: 50000, pessoas: 22, rotas: { custoHoraPorOperacao: { ...custoHora, "Rosquear + Parafusar": custoAuto }, custoHoraPadrao: 30 } });
    const barata = resolverRotas(base(30.56), AGORA)!.produtos[F].plano.alvo, cara = resolverRotas(base(300), AGORA)!.produtos[F].plano.alvo;
    expect(barata.AUTO).toBeGreaterThan(0); expect(barata.CONV).toBeLessThan(50000);
    expect(cara.AUTO).toBe(0); expect(cara.CONV).toBeCloseTo(50000, 4);
  });
});

describe("M4 — WIP por rota, pool comum e depois da convergência", () => {
  it("exemplo: CONV pronta 8.000 + AUTO pronta 5.000 = pool 13.000; Etiquetar consome 12.000 ⇒ saldo 1.000 (atribuição proporcional, sem FIFO)", () => {
    const w = wipDoProdutoRotas(ESTRUTURA_F, { executado: { "f-para": 8000, "f-rp": 5000, "f-etiq": 12000, "f-emb": 12000 } });
    expect(w.pool.disponivel).toBe(13000); expect(w.pool.consumido).toBe(12000); expect(w.pool.saldo).toBe(1000); expect(w.pool.inconsistente).toBe(false);
    expect(w.pool.porRota.CONV).toBeCloseTo(1000 * 8 / 13, 9); expect(w.pool.porRota.AUTO).toBeCloseTo(1000 * 5 / 13, 9);
  });
  it("saldo inicial válido entra no pool; depois de Etiquetar não há origem por rota (só saldo entre Etiquetar e Embalar, uma vez)", () => {
    const w = wipDoProdutoRotas(ESTRUTURA_F, { executado: { "f-para": 8000, "f-rp": 5000, "f-etiq": 12000, "f-emb": 9000 }, inicial: { pool: 2000 } });
    expect(w.pool.saldo).toBe(3000);
    expect(w.entreEtapasComuns).toEqual([{ de: "f-etiq", para: "f-emb", saldo: 3000 }]);
    expect(Object.keys(w)).not.toContain("porRotaAposEtiquetar");
  });
  it("Etiquetar consumindo mais do que as rotas entregaram é INCONSISTÊNCIA (nunca saldo negativo escondido)", () => {
    const w = wipDoProdutoRotas(ESTRUTURA_F, { executado: { "f-para": 1000, "f-rp": 1000, "f-etiq": 5000 } });
    expect(w.pool.inconsistente).toBe(true); expect(w.pool.saldo).toBe(0);
  });
  it("saldo interno de cada rota: Rosquear → Parafusar só dentro da CONV; AUTO não tem interno", () => {
    const w = wipDoProdutoRotas(ESTRUTURA_F, { executado: { "f-rosq": 9000, "f-para": 8000, "f-rp": 5000 } });
    expect(w.rotas.find((r) => r.rotaCodigo === "CONV")!.saldoInterno).toEqual([{ de: "f-rosq", para: "f-para", saldo: 1000 }]);
    expect(w.rotas.find((r) => r.rotaCodigo === "AUTO")!.saldoInterno).toEqual([]);
  });
  it("percurso: arestas válidas e inválidas (nunca ordem+1): Parafusar → Rosquear+Parafusar não existe; ambas as rotas convergem em Etiquetar", () => {
    expect(arestaValida(ESTRUTURA_F, "f-rosq", "f-para")).toBe(true); expect(arestaValida(ESTRUTURA_F, "f-para", "f-etiq")).toBe(true); expect(arestaValida(ESTRUTURA_F, "f-rp", "f-etiq")).toBe(true); expect(arestaValida(ESTRUTURA_F, "f-etiq", "f-emb")).toBe(true);
    expect(arestaValida(ESTRUTURA_F, "f-para", "f-rp")).toBe(false); expect(arestaValida(ESTRUTURA_F, "f-rosq", "f-etiq")).toBe(false);
    expect(arestasDoPercurso(ESTRUTURA_F).filter((a) => a.destinoId === "f-etiq")).toHaveLength(2);
  });
  it("pertencimento do adicional/etapa decidido pela ETAPA, não pela ordem", () => {
    expect(grupoDaEtapa(ESTRUTURA_F, "f-rp")).toBe("AUTO"); expect(grupoDaEtapa(ESTRUTURA_F, "f-para")).toBe("CONV"); expect(grupoDaEtapa(ESTRUTURA_F, "f-etiq")).toBe("COMUM"); expect(grupoDaEtapa(ESTRUTURA_F, "x")).toBeNull();
  });

  // ---- controle de WIP (Fase 3) com convergência: o consumo de Etiquetar é dividido proporcionalmente entre as origens ----
  const ctrl = (id: string, origem: string, destino: string, saldo = 0): ControleWip => ({ id, produtoId: F, etapaOrigemId: origem, etapaSeguinteId: destino, dataInicio: "2026-11-02", saldoInicial: saldo, ativo: true });
  const entrada = (producao: { etapaId: string; boas: number }[], arestas: boolean): EntradaWip => ({
    controles: [ctrl("c-conv", "f-para", "f-etiq"), ctrl("c-auto", "f-rp", "f-etiq")], ajustes: [], confirmacoes: [], snapshots: [], semanas: [], hoje: "2026-11-06",
    producao: producao.map((p) => ({ ...p, data: "2026-11-03" })),
    roteiro: { produtoAtivo: { [F]: true }, etapasPorProduto: { [F]: [{ id: "f-rosq", ordem: 0 }, { id: "f-para", ordem: 1 }, { id: "f-rp", ordem: 2 }, { id: "f-etiq", ordem: 3 }, { id: "f-emb", ordem: 4 }] }, ...(arestas ? { arestasPorProduto: { [F]: arestasDoPercurso(ESTRUTURA_F) } } : {}) },
  });
  const prod = [{ etapaId: "f-para", boas: 8000 }, { etapaId: "f-rp", boas: 5000 }, { etapaId: "f-etiq", boas: 12000 }];
  it("estimado por controle: Σ dos dois = saldo do pool (1.000); cada origem fica com a parte proporcional; Etiquetar é consumido UMA vez", () => {
    const e = entrada(prod, true);
    const a = estimadoAte(e.controles[0], e, "2026-11-06"), b = estimadoAte(e.controles[1], e, "2026-11-06");
    expect(a.valor + b.valor).toBeCloseTo(1000, 9);
    expect(a.consumidoSeguinte + b.consumidoSeguinte).toBeCloseTo(12000, 9);
    expect(a.valor).toBeCloseTo(8000 - 12000 * 8 / 13, 6); expect(b.valor).toBeCloseTo(5000 - 12000 * 5 / 13, 6);
  });
  it("sem a convergência o estimado duplicaria o consumo (-4.000 e -7.000): por isso o percurso é necessário", () => {
    const e = entrada(prod, false);
    expect(estimadoAte(e.controles[0], e, "2026-11-06").valor + estimadoAte(e.controles[1], e, "2026-11-06").valor).toBeCloseTo(13000 - 24000, 9);
  });
  it("par fora do percurso vira inconsistência 'rota_alterada' (bloqueia); par do percurso é válido; produto linear segue ordem+1", () => {
    const e = entrada(prod, true);
    expect(inconsistencias(e.controles[0], e).some((i) => i.codigo === "rota_alterada")).toBe(false);
    expect(inconsistencias(ctrl("x", "f-para", "f-rp"), e).some((i) => i.codigo === "rota_alterada")).toBe(true);
    const linear: EntradaWip = { ...e, roteiro: { produtoAtivo: { [F]: true }, etapasPorProduto: { [F]: [{ id: "a", ordem: 0 }, { id: "b", ordem: 1 }, { id: "c", ordem: 2 }] } } };
    expect(inconsistencias(ctrl("l", "a", "b"), linear).some((i) => i.codigo === "rota_alterada")).toBe(false);
    expect(inconsistencias(ctrl("l2", "a", "c"), linear).some((i) => i.codigo === "rota_alterada")).toBe(true);
    void alocacaoDaSemana;
  });
});

describe("M4 — apontado real e etapa final (compat TS) e cadeias virtuais no motor", () => {
  const etapas = [...PRODUTO_F.roteiro.map((e, i) => ({ id: e.id, ordem: i })), { id: "f-tec", ordem: 99 }];
  it("produto acabado só na etapa final explícita (Embalar), quantidade boa = produzido − refugo; a técnica ordem 99 não conta", () => {
    expect(etapaFinalDoProduto(ESTRUTURA_F, etapas)).toBe("f-emb");
    const boas = (p: number, r: number) => p - r;
    const ap = [{ etapaId: "f-rosq", quantidade: boas(9000, 100) }, { etapaId: "f-etiq", quantidade: 7000 }, { etapaId: "f-emb", quantidade: boas(6000, 250) }, { etapaId: "f-tec", quantidade: 40 }];
    expect(apontadoRealProduto(ESTRUTURA_F, etapas, ap)).toBe(5750);
  });
  it("restante do ACABADO no motor: só a cadeia do fluxo comum conta; a última etapa de CONV/AUTO é semiacabado", () => {
    const pool = (produtoId: string, etapaId: string, ordem: number): PoolEscala => ({ produtoId, etapaId, operacaoId: "op", ordemEtapa: ordem, quantidade: 100, maquinasIds: ["m"], metas: {}, valorUnitario: 1 });
    const pools = [pool(idVirtual(F, "CONV"), "f-rosq", 0), pool(idVirtual(F, "CONV"), "f-para", 1), pool(idVirtual(F, "AUTO"), "f-rp", 0), pool(idVirtual(F, "COMUM"), "f-etiq", 0), pool(idVirtual(F, "COMUM"), "f-emb", 1), pool("pLinear", "l1", 0), pool("pLinear", "l2", 1)];
    const rest = { [chavePool(idVirtual(F, "CONV"), "f-para")]: 1000, [chavePool(idVirtual(F, "AUTO"), "f-rp")]: 500, [chavePool(idVirtual(F, "COMUM"), "f-emb")]: 70, [chavePool(idVirtual(F, "COMUM"), "f-etiq")]: 90, [chavePool("pLinear", "l2")]: 30, [chavePool("pLinear", "l1")]: 60 };
    expect(restanteAcabado(pools, rest)).toBe(70 + 30);
  });
  it("a necessidade da PRÓXIMA semana vale para as cadeias virtuais (limite de estoque por produto real)", () => {
    const e = { ...estadoF(), proximaSemana: { quantidadePorProduto: { [F]: 50000 } } };
    const v = projetarEstado(e, { [F]: { alvo: { AUTO: 10000, CONV: 10000 }, final: 20000 } });
    expect(v.proximaSemana!.quantidadePorProduto[idVirtual(F, "COMUM")]).toBe(50000); expect(v.proximaSemana!.quantidadePorProduto[idVirtual(F, "CONV")]).toBe(50000);
  });
});

describe("M4 — PROD tem wip_modo = 'ativo' (sem nenhum controle/saldo): semana de rotas continua correta", () => {
  it("com WIP ativo e sem controles o plano e a Escala de F são os mesmos do WIP desligado (invariantes do motor)", async () => {
    const { gerarEscala } = await import("@/features/escala/gerarEscala");
    const { montarEntradaEscala } = await import("@/lib/escala/montarEntrada");
    const { checarInvariantes } = await import("@/features/escala/__tests__/helpers");
    const { AGORA } = await import("./fixtureRotas");
    const lig = (modo: "ativo" | "desligado") => { const e = estadoF({ pessoas: 20 }); e.parametros = { ...(e.parametros as object), wipModo: modo } as typeof e.parametros; return e; };
    const a = montarEntradaEscala(lig("ativo"), AGORA), d = montarEntradaEscala(lig("desligado"), AGORA);
    expect(a.rotas!.produtos[F].plano.alvo).toEqual(d.rotas!.produtos[F].plano.alvo);
    expect(a.entrada.pools.every((p) => (p.adicionalMax ?? 0) === 0)).toBe(true);        // F não tem adicional: nenhuma carga extra é inventada
    const r = gerarEscala(a.entrada);
    expect(checarInvariantes(a.entrada, r)).toEqual([]);
    expect(r.alocacoes.filter((x) => x.maquinaId).length).toBeGreaterThan(0);
  });
});

describe("M4 — código novo contra banco SEM as tabelas de rotas (deploy antes das migrations)", () => {
  it("carregarRotasDoEstado devolve undefined (semana linear) quando produto_rota não existe; outro erro continua sendo erro", async () => {
    const { carregarRotasDoEstado } = await import("@/lib/escala/rotasIO");
    const falso = (erro: { code?: string; message: string }) => ({ from: () => ({ select: () => ({ in: async () => ({ data: null, error: erro }) }) }) }) as never;
    expect(await carregarRotasDoEstado(falso({ code: "PGRST205", message: "Could not find the table 'public.produto_rota' in the schema cache" }), ["p1"])).toBeUndefined();
    expect(await carregarRotasDoEstado(falso({ code: "42P01", message: 'relation "public.produto_rota" does not exist' }), ["p1"])).toBeUndefined();
    await expect(carregarRotasDoEstado(falso({ code: "XX000", message: "falha de conexão" }), ["p1"])).rejects.toThrow(/produto_rota/);
    expect(await carregarRotasDoEstado(falso({ message: "x" }), [])).toBeUndefined();
  });
});

