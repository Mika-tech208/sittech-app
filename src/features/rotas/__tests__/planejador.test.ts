import { describe, it, expect } from "vitest";
import { planejarRotas, projetarPool, fracaoOperavel, ALGORITMO_VERSAO, type EntradaPlanejador, type SaidaPlanejador } from "../planejador";
import { capacidadeEtapa, horasMaquinaSemana } from "../capacidade";
import { apontadoRealProduto, etapaFinalDoProduto } from "../compat";
import { estruturaLinear, ehEtapaFinal, percursoDaPeca, etapasSeguintes } from "../estrutura";
import type { ContextoCusto } from "../custo";
import type { ContextoCapacidade, EstruturaProduto, EtapaCadastro, PeriodoId } from "../tipos";

const PERIODOS = [{ id: "m1", minutos: 96 }, { id: "m2", minutos: 96 }, { id: "m3", minutos: 91 }, { id: "t1", minutos: 80 }, { id: "t2", minutos: 80 }, { id: "t3", minutos: 80 }] as ContextoCapacidade["periodos"];
const metas = (m: number, t: number): Record<PeriodoId, number> => ({ m1: m, m2: m, m3: m, t1: t, t2: t, t3: t });
const etapa = (id: string, operacao: string, ordem: number, m: number, t: number, maquinas: string[]): EtapaCadastro => ({ id, operacaoId: `op-${operacao}`, operacao, ordem, metas: metas(m, t), maquinasIds: maquinas });
const CTX = (extra: Partial<ContextoCapacidade> = {}): ContextoCapacidade => ({ periodos: PERIODOS, diasProdutivos: 5, ...extra });
const ETAPAS = [
  etapa("f-rosq", "Rosquear", 0, 2000, 1600, ["R3", "R5", "R6"]),
  etapa("f-para", "Parafusar", 1, 1500, 1200, ["P9", "P10", "P11", "P12"]),
  etapa("f-rp", "Rosquear + Parafusar", 2, 1275, 1100, ["AUTO8"]),
  etapa("f-etiq", "Etiquetar", 3, 3500, 3000, ["E15", "E16"]),
  etapa("f-emb", "Embalar", 4, 5000, 4500, ["EMB17"]),
];
const MAPA = new Map(ETAPAS.map((e) => [e.id, e]));
const F: EstruturaProduto = {
  produtoId: "F", modelo: "rotas", regraEtapaFinal: "explicita",
  rotas: [
    { id: "r-auto", codigo: "AUTO", nome: "Automática", ativa: true, preferencia: 1, etapas: ["f-rp"] },
    { id: "r-conv", codigo: "CONV", nome: "Convencional", ativa: true, preferencia: 2, etapas: ["f-rosq", "f-para"] },
  ],
  poolComum: { etapas: ["f-etiq", "f-emb"], entradaId: "f-etiq" }, etapaFinalId: "f-emb",
  convergencia: { destinoId: "f-etiq", origens: [{ rotaCodigo: "AUTO", etapaId: "f-rp" }, { rotaCodigo: "CONV", etapaId: "f-para" }] },
};
const SEL = { "f-rosq": ["R3", "R6"], "f-para": ["P10", "P9"], "f-rp": ["AUTO8"], "f-etiq": ["E15"], "f-emb": ["EMB17"] };
const SEL16 = { ...SEL, "f-etiq": ["E15", "E16"] };
const CUSTO: ContextoCusto = { periodos: PERIODOS, custoHoraPorOperacao: { Rosquear: 30.57, Parafusar: 30.58, "Rosquear + Parafusar": 30.56, Etiquetar: 30.64, Embalar: 30.61 }, custoHoraPadrao: 30 };
const horasWeek = horasMaquinaSemana(CTX());

const plan = (extra: Partial<EntradaPlanejador> = {}): SaidaPlanejador => {
  const r = planejarRotas({ estrutura: F, etapas: MAPA, demanda: 116625, ctx: CTX(), selecao: SEL, ...extra });
  if (!r.aplicavel) throw new Error("não aplicável");
  return r;
};
const codigos = (s: SaidaPlanejador) => s.motivos.map((m) => m.codigo);
// E16 ocupada por outro produto: `livre` = fração da semana ainda disponível para o Conector
const E16 = (livre: number) => ({ selecao: SEL16, ctx: CTX({ horasComprometidasPorMaquina: { E16: horasWeek * (1 - livre) } }) });

describe("M2 — caso real 116.625 (E15 sozinha) e concorrência da E16", () => {
  it("demanda 116.625, AUTO 35.625, E15 97.500, E16 ocupada: final 97.500, falta 19.125, 83,6%, gargalo ETIQUETAR (corta as duas rotas)", () => {
    const s = plan();
    expect(s.versao).toBe(ALGORITMO_VERSAO);
    expect(s.capacidadePorRota.AUTO.realizavel).toBeCloseTo(35625, 6);
    expect(s.capacidadePorRota.CONV.realizavel).toBeCloseTo(81000, 6);
    expect(s.capacidadeEntrada).toBeCloseTo(116625, 6);          // 35.625+81.000 = demanda, mas isso NÃO prova que dá: o pool comum corta
    expect(s.poolComum.porOperacao.Etiquetar).toBeCloseTo(97500, 6);
    expect(s.poolComum.porOperacao.Embalar).toBeCloseTo(142500, 6);
    expect(s.poolComum.capacidade).toBeCloseTo(97500, 6);
    expect(s.finalAtingivel).toBeCloseTo(97500, 6); expect(s.falta).toBeCloseTo(19125, 6);
    expect(s.percentualAtingivel).toBeCloseTo(83.6, 1);
    expect(s.gargalo).toEqual({ tipo: "comum", etapaId: "f-etiq", operacao: "Etiquetar" });
    expect(codigos(s)).toContain("GARGALO_COMUM");
    // as rotas entregam SÓ o que o pool consome (97.500): AUTO inteira (mais barata) + CONV 61.875 — nada de WIP inútil
    expect(s.alvo.AUTO).toBeCloseTo(35625, 6); expect(s.alvo.CONV).toBeCloseTo(61875, 6);
    expect(s.alvo.AUTO + s.alvo.CONV).toBeCloseTo(s.finalAtingivel, 6);
    expect(s.wip.saldoFinal).toBeCloseTo(0, 6);
  });
  it("E16 realmente ocupada pela Caixa Amarela (concorrência) dá o mesmo resultado que E16 fora da seleção", () => {
    const comCompeticao = plan(E16(0));
    expect(comCompeticao.finalAtingivel).toBeCloseTo(97500, 6);
    expect(comCompeticao.gargalo).toEqual({ tipo: "comum", etapaId: "f-etiq", operacao: "Etiquetar" });
  });
  it.each([[0, 97500, 19125], [0.25, 116625, 0], [0.5, 116625, 0], [1, 116625, 0]])("E16 %s disponível → final %s, falta %s", (livre, final, falta) => {
    const s = plan(E16(livre));
    const etiq = 97500 * (1 + livre);
    expect(s.poolComum.porOperacao.Etiquetar).toBeCloseTo(etiq, 4);
    expect(s.poolComum.capacidade).toBeCloseTo(Math.min(etiq, 142500), 4);     // com muita E16 passa a limitar a Embalagem 17 (142.500)
    expect(s.finalAtingivel).toBeCloseTo(final, 4); expect(s.falta).toBeCloseTo(falta, 4);
    if (falta === 0) { expect(s.gargalo).toBeNull(); expect(codigos(s)).toContain("DEMANDA_ATENDIDA"); expect(s.alvo.AUTO).toBeCloseTo(35625, 6); expect(s.alvo.CONV).toBeCloseTo(81000, 6); }
  });
  it("com 25% da E16 o atingível passa de 97.500 porque a capacidade comum cresce (121.875), nunca por 'mais semiacabado'", () => {
    const s = plan(E16(0.25));
    expect(s.poolComum.capacidade).toBeCloseTo(121875, 4);
    const semE16 = plan();
    expect(semE16.capacidadeEntrada).toBeCloseTo(s.capacidadeEntrada, 6);       // entrada igual; só o pool mudou
  });
});

describe("M2 — cenários de demanda e de entrada", () => {
  it("demanda 20.000: AUTO=20.000, CONV=0, sem excesso (rota mais barata primeiro; a CONV não é ligada)", () => {
    const s = plan({ demanda: 20000, custo: CUSTO });
    expect(s.alvo.AUTO).toBeCloseTo(20000, 6); expect(s.alvo.CONV).toBe(0);
    expect(s.finalAtingivel).toBeCloseTo(20000, 6); expect(s.falta).toBe(0); expect(s.wip.saldoFinal).toBeCloseTo(0, 6);
    expect(codigos(s)).toContain("SEM_EXCESSO_DE_PRODUCAO");
  });
  it("AUTO parada: AUTO=0 e a CONV segura o que pode; a falta é só do PRODUTO FINAL (entrada insuficiente, não gargalo comum)", () => {
    const s = plan({ ...E16(1), ctx: CTX({ maquinasIndisponiveis: ["AUTO8"] }) });
    expect(s.capacidadePorRota.AUTO.realizavel).toBe(0);
    expect(s.alvo.AUTO).toBe(0); expect(s.alvo.CONV).toBeCloseTo(81000, 6);
    expect(s.finalAtingivel).toBeCloseTo(81000, 6); expect(s.falta).toBeCloseTo(35625, 6);
    expect(s.gargalo).toMatchObject({ tipo: "entrada" });
    expect(codigos(s)).toContain("ROTA_SEM_CAPACIDADE");
  });
  it("AUTO acima da expectativa (39.000): a CONV cai proporcionalmente, o total respeita a demanda final e não sobra excesso", () => {
    const s = plan({ ...E16(1), fatorDesempenho: { "f-rp": 39000 / 35625 } });
    expect(s.capacidadePorRota.AUTO.realizavel).toBeCloseTo(39000, 4);
    expect(s.alvo.AUTO).toBeCloseTo(39000, 4); expect(s.alvo.CONV).toBeCloseTo(116625 - 39000, 4);
    expect(s.alvo.AUTO + s.alvo.CONV).toBeCloseTo(116625, 4);
    expect(codigos(s)).toContain("DESEMPENHO_AJUSTA");
    // demanda menor que as duas juntas: a AUTO maior ocupa mais, a CONV reduz ainda mais, nada passa da demanda
    const menor = plan({ ...E16(1), demanda: 90000, fatorDesempenho: { "f-rp": 39000 / 35625 } });
    expect(menor.alvo.AUTO + menor.alvo.CONV).toBeCloseTo(90000, 4); expect(menor.alvo.CONV).toBeCloseTo(51000, 4);
  });
});

describe("M2 — equipe, revezamento, calendário e máquinas", () => {
  it("fração operável: sem revezamento k/m; com revezamento duro k×ceil(P/2)/(m×P)", () => {
    expect(fracaoOperavel(2, 1, 6, false)).toBeCloseTo(0.5, 9); expect(fracaoOperavel(2, 5, 6, false)).toBe(1); expect(fracaoOperavel(2, 0, 6, false)).toBe(0); expect(fracaoOperavel(2, undefined, 6, true)).toBe(1);
    expect(fracaoOperavel(2, 1, 6, true)).toBeCloseTo(0.25, 9); expect(fracaoOperavel(2, 2, 6, true)).toBeCloseTo(0.5, 9); expect(fracaoOperavel(2, 4, 6, true)).toBe(1);
  });
  it("falta de operador na AUTO: capacidade da AUTO cai a 0 e a CONV não é afetada", () => {
    const s = plan({ ...E16(1), equipe: { pessoasPorOperacao: { "op-Rosquear + Parafusar": 0 }, revezamentoDuro: false } });
    expect(s.capacidadePorRota.AUTO.realizavel).toBe(0); expect(s.capacidadePorRota.CONV.realizavel).toBeCloseTo(81000, 6);
    expect(s.finalAtingivel).toBeCloseTo(81000, 6); expect(codigos(s)).toContain("EQUIPE_LIMITA");
  });
  it("falta de operador em ROSQUEAR (1 de 2 máquinas): CONV cai a 54.000 (Rosquear passa a limitar); AUTO intacta", () => {
    const s = plan({ ...E16(1), equipe: { pessoasPorOperacao: { "op-Rosquear": 1 }, revezamentoDuro: false } });
    expect(s.capacidadePorRota.CONV.realizavel).toBeCloseTo(54000, 4); expect(s.capacidadePorRota.CONV.limitante?.operacao).toBe("Rosquear");
    expect(s.capacidadePorRota.AUTO.realizavel).toBeCloseTo(35625, 6); expect(s.finalAtingivel).toBeCloseTo(89625, 4);
  });
  it("falta de operador em PARAFUSAR (1 de 2 máquinas): CONV cai a 40.500; Rosquear não muda", () => {
    const s = plan({ ...E16(1), equipe: { pessoasPorOperacao: { "op-Parafusar": 1 }, revezamentoDuro: false } });
    expect(s.capacidadePorRota.CONV.realizavel).toBeCloseTo(40500, 4); expect(s.capacidadePorRota.CONV.limitante?.operacao).toBe("Parafusar");
    expect(s.finalAtingivel).toBeCloseTo(76125, 4);
  });
  it("não existe número fixo de operadores por rota: a equipe é por OPERAÇÃO (a mesma aptidão serve às duas rotas)", () => {
    const folgada = plan({ ...E16(1), equipe: { pessoasPorOperacao: { "op-Rosquear": 9, "op-Parafusar": 9, "op-Rosquear + Parafusar": 9 }, revezamentoDuro: false } });
    expect(folgada.finalAtingivel).toBeCloseTo(116625, 4);
  });
  it("revezamento duro: capacidade realizável (menor que a nominal) é usada, nunca a nominal", () => {
    const s = plan({ ...E16(1), equipe: { pessoasPorOperacao: { "op-Parafusar": 2 }, revezamentoDuro: true } });
    expect(s.capacidadePorRota.CONV.realizavel).toBeCloseTo(40500, 4);          // 2 pessoas, 2 máquinas, 6 períodos, revezando ⇒ metade
    expect(s.capacidadePorRota.CONV.nominal).toBeCloseTo(81000, 4);
    expect(codigos(s)).toContain("REVEZAMENTO_LIMITA");
  });
  it("capacidade realizável já calculada pela Escala entra como TETO por etapa (o menor vale)", () => {
    const s = plan({ ...E16(1), capacidadeRealizavelEscala: { "f-para": 60000, "f-rp": 99999 } });
    expect(s.capacidadePorRota.CONV.realizavel).toBeCloseTo(60000, 4);
    expect(s.capacidadePorRota.AUTO.realizavel).toBeCloseTo(35625, 6);           // teto acima do nominal não aumenta
  });
  it("sábado produtivo (6 dias): AUTO 42.750, CONV 97.200 e a E15 sozinha (117.000) já cobre 116.625", () => {
    const s = plan({ ctx: CTX({ diasProdutivos: 6 }) });
    expect(s.capacidadePorRota.AUTO.realizavel).toBeCloseTo(42750, 4); expect(s.capacidadePorRota.CONV.realizavel).toBeCloseTo(97200, 4);
    expect(s.poolComum.capacidade).toBeCloseTo(117000, 4);
    expect(s.finalAtingivel).toBeCloseTo(116625, 4); expect(s.falta).toBe(0);
    expect(s.alvo.AUTO).toBeCloseTo(42750, 4); expect(s.alvo.CONV).toBeCloseTo(116625 - 42750, 4);
  });
  it("máquina indisponível: Parafusar P9 fora ⇒ CONV 40.500, final 76.125, gargalo de ENTRADA", () => {
    const s = plan({ ...E16(1), ctx: CTX({ maquinasIndisponiveis: ["P9"], horasComprometidasPorMaquina: { E16: 0 } }) });
    expect(s.capacidadePorRota.CONV.realizavel).toBeCloseTo(40500, 4);
    expect(s.finalAtingivel).toBeCloseTo(76125, 4); expect(s.falta).toBeCloseTo(40500, 4);
    expect(s.gargalo).toMatchObject({ tipo: "entrada" });
    if (s.gargalo?.tipo === "entrada") expect(s.gargalo.limitantes.find((l) => l.rotaCodigo === "CONV")).toMatchObject({ operacao: "Parafusar", realizavel: 40500 });
  });
  it("máximo por rota (V1 'maximo'): limita a rota, a outra completa e o motivo é registrado", () => {
    const s = plan({ ...E16(1), limiteMaximoPorRota: { AUTO: 10000 } });
    expect(s.alvo.AUTO).toBeCloseTo(10000, 6); expect(s.alvo.CONV).toBeCloseTo(81000, 6); expect(s.finalAtingivel).toBeCloseTo(91000, 6);
    expect(codigos(s)).toContain("LIMITE_MAXIMO_ROTA");
  });
});

describe("M2 — WIP (somente projeção em memória)", () => {
  it("exemplo da especificação: CONV entrega 8.000 + AUTO 5.000, Etiquetar consome 12.000 ⇒ pool 1.000 (rateio proporcional, sem FIFO)", () => {
    const w = projetarPool({}, 0, { CONV: 8000, AUTO: 5000 }, 12000);
    expect(w.saldoFinal).toBeCloseTo(1000, 9); expect(w.entregas.total).toBe(13000);
    expect(w.saldoFinalPorRota.CONV).toBeCloseTo(1000 * 8 / 13, 9); expect(w.saldoFinalPorRota.AUTO).toBeCloseTo(1000 * 5 / 13, 9);
    expect(w.acimaDoLimite).toBe(false);
  });
  it("WIP inicial reduz o que as rotas precisam entregar (nada produzido a mais)", () => {
    const s = plan({ demanda: 20000, wipInicial: { pool: 8000 }, custo: CUSTO });
    expect(s.finalAtingivel).toBeCloseTo(20000, 6); expect(s.alvo.AUTO + s.alvo.CONV).toBeCloseTo(12000, 6); expect(s.wip.saldoFinal).toBeCloseTo(0, 6);
    expect(codigos(s)).toContain("WIP_INICIAL_USADO");
  });
  it("WIP inicial por rota conta como semiacabado pronto; WIP maior que a demanda não gera produção nova", () => {
    const s = plan({ demanda: 10000, wipInicial: { porRota: { CONV: 25000 } } });
    expect(s.alvo.AUTO).toBe(0); expect(s.alvo.CONV).toBe(0); expect(s.finalAtingivel).toBeCloseTo(10000, 6);
    expect(s.wip.saldoFinal).toBeCloseTo(15000, 6);
  });
  it("limite de WIP: saldo projetado acima do limite é sinalizado (o planejador não inventa consumo)", () => {
    const s = plan({ demanda: 10000, wipInicial: { pool: 20000 }, limiteWip: 5000 });
    expect(s.wip.acimaDoLimite).toBe(true); expect(codigos(s)).toContain("WIP_ACIMA_DO_LIMITE");
    expect(plan({ demanda: 10000, wipInicial: { pool: 20000 }, limiteWip: 10000 }).wip.acimaDoLimite).toBe(false);
  });
  it("o WIP também ajuda quando o pool é gargalo? Não: o consumo continua limitado pelo pool comum", () => {
    const s = plan({ wipInicial: { pool: 50000 } });
    expect(s.finalAtingivel).toBeCloseTo(97500, 6); expect(s.gargalo).toMatchObject({ tipo: "comum" });
    expect(s.alvo.AUTO + s.alvo.CONV).toBeCloseTo(47500, 6);                   // 97.500 − 50.000 já prontos
  });
});

describe("M2 — custo, economia, estabilidade e rotas disjuntas", () => {
  it("custo estimado = Σ entrega×exclusivo + final×comum; economia AUTO = volume AUTO × (exclusivo CONV − exclusivo AUTO)", () => {
    const s = plan({ ...E16(1), custo: CUSTO, valorUnitario: 0.1825 });
    const c = s.custo!;
    expect(c.exclusivoPorPeca.CONV).toBeGreaterThan(c.exclusivoPorPeca.AUTO);
    expect(c.estimado).toBeCloseTo(35625 * c.exclusivoPorPeca.AUTO + 81000 * c.exclusivoPorPeca.CONV + 116625 * c.comumPorPeca, 6);
    expect(c.economiaAuto!.porPeca).toBeCloseTo(c.exclusivoPorPeca.CONV - c.exclusivoPorPeca.AUTO, 12);
    expect(c.economiaAuto!.volume).toBeCloseTo(35625, 6);
    expect(c.economiaAuto!.total).toBeCloseTo(35625 * c.economiaAuto!.porPeca, 6);
    expect(c.economiaAuto!.total).toBeGreaterThan(600); expect(c.economiaAuto!.total).toBeLessThan(900);   // ≈ R$ 724/semana nos dados reais
    expect(c.finalPorPeca.CONV).toBeCloseTo(c.exclusivoPorPeca.CONV + c.comumPorPeca, 12);                   // nunca CONV + AUTO + comum
    expect(c.margem).toBeCloseTo(116625 * 0.1825 - c.estimado, 6);
  });
  it("comum cobrado UMA vez sobre o produto final: não existe 'Etiquetar da CONV' e 'Etiquetar da AUTO'", () => {
    const a = plan({ demanda: 50000, custo: CUSTO }), b = plan({ demanda: 50000, custo: CUSTO, divisaoAnterior: undefined });
    expect(a.custo!.estimado).toBeCloseTo(a.alvo.AUTO * a.custo!.exclusivoPorPeca.AUTO + a.alvo.CONV * a.custo!.exclusivoPorPeca.CONV + 50000 * a.custo!.comumPorPeca, 9);
    expect(b.custo!.estimado).toBeCloseTo(a.custo!.estimado, 12);
  });
  it("sem economia real quando a AUTO não entrega nada (demanda coberta só pela CONV porque a AUTO está parada)", () => {
    const s = plan({ ...E16(1), ctx: CTX({ maquinasIndisponiveis: ["AUTO8"] }), custo: CUSTO });
    expect(s.custo!.economiaAuto!.total).toBe(0);
  });
  it("NUNCA sacrifica atendimento por custo: se a rota barata não tem capacidade, a cara entrega o restante", () => {
    const s = plan({ ...E16(1), demanda: 100000, custo: CUSTO });
    expect(s.finalAtingivel).toBeCloseTo(100000, 6); expect(s.alvo.AUTO).toBeCloseTo(35625, 6); expect(s.alvo.CONV).toBeCloseTo(64375, 6);
  });
  it("se a ordem de custo se inverte (AUTO mais cara), a CONV é enchida primeiro — a preferência da rota só desempata", () => {
    const caro: ContextoCusto = { ...CUSTO, custoHoraPorOperacao: { ...CUSTO.custoHoraPorOperacao, "Rosquear + Parafusar": 300 } };
    const s = plan({ ...E16(1), demanda: 50000, custo: caro });
    expect(s.alvo.CONV).toBeCloseTo(50000, 6); expect(s.alvo.AUTO).toBe(0);
  });
  it("sem custo informado: desempate pela preferência (AUTO=1 antes de CONV=2)", () => {
    const s = plan({ ...E16(1), demanda: 30000 });
    expect(s.alvo.AUTO).toBeCloseTo(30000, 6); expect(s.alvo.CONV).toBe(0);
  });
  it("estabilidade: divisão anterior viável a ≤1% do ótimo é mantida; uma bem pior é reotimizada", () => {
    const perto = plan({ ...E16(1), demanda: 50000, custo: CUSTO, divisaoAnterior: { AUTO: 35000, CONV: 15000 }, toleranciaEstabilidade: 0.01 });
    expect(perto.estabilidade.divisaoAnteriorMantida).toBe(true); expect(perto.alvo.AUTO).toBeCloseTo(35000, 6); expect(perto.alvo.CONV).toBeCloseTo(15000, 6);
    const longe = plan({ ...E16(1), demanda: 50000, custo: CUSTO, divisaoAnterior: { AUTO: 20000, CONV: 30000 }, toleranciaEstabilidade: 0.01 });
    expect(longe.estabilidade.divisaoAnteriorMantida).toBe(false); expect(longe.alvo.AUTO).toBeCloseTo(35625, 6); expect(longe.alvo.CONV).toBeCloseTo(14375, 6);
    // a estabilidade nunca reduz o atendimento
    expect(perto.finalAtingivel).toBeCloseTo(longe.finalAtingivel, 6);
    // sem tolerância informada a estabilidade NÃO existe (o 1% não é regra de negócio): vale sempre a divisão de menor custo
    const sem = plan({ ...E16(1), demanda: 50000, custo: CUSTO, divisaoAnterior: { AUTO: 35000, CONV: 15000 } });
    expect(sem.estabilidade.divisaoAnteriorMantida).toBe(false); expect(sem.alvo.AUTO).toBeCloseTo(35625, 6);
  });
  it("divisão anterior inviável (acima da capacidade atual) é ajustada, nunca excede o realizável", () => {
    const s = plan({ ...E16(1), demanda: 50000, custo: CUSTO, divisaoAnterior: { AUTO: 90000, CONV: 0 } });
    expect(s.alvo.AUTO).toBeLessThanOrEqual(35625 + 1e-6); expect(s.alvo.AUTO + s.alvo.CONV).toBeCloseTo(50000, 6);
  });
  it("rotas disjuntas: a soma das capacidades é exata; máquina compartilhada entre rotas é sinalizada", () => {
    expect(codigos(plan({ ...E16(1) }))).not.toContain("MAQUINAS_COMPARTILHADAS_ENTRE_ROTAS");
    const comp = plan({ ...E16(1), selecao: { ...SEL16, "f-rp": ["AUTO8", "R3"] } });
    const mapa = new Map(MAPA); mapa.set("f-rp", { ...(MAPA.get("f-rp") as EtapaCadastro), maquinasIds: ["AUTO8", "R3"] });
    const s2 = plan({ ...E16(1), etapas: mapa, selecao: { ...SEL16, "f-rp": ["AUTO8", "R3"] } });
    expect(codigos(s2)).toContain("MAQUINAS_COMPARTILHADAS_ENTRE_ROTAS"); expect(comp.aplicavel).toBe(true);
  });
});

describe("M2 — estrutura explícita (etapa final, percurso) e produtos lineares", () => {
  it("etapa final fora de max(ordem): Embalar (ordem 4) é a final mesmo com 'Etapa Técnica' ordem 99 no roteiro; o planejador a ignora", () => {
    const tecnica = etapa("f-tec", "Etapa Técnica", 99, 100, 100, ["T1"]);
    const etapas = [...ETAPAS, tecnica];
    const mapa = new Map(etapas.map((e) => [e.id, e]));
    expect(etapas.reduce((m, e) => (e.ordem > m.ordem ? e : m)).id).toBe("f-tec");     // max(ordem) apontaria a técnica
    expect(etapaFinalDoProduto(F, etapas)).toBe("f-emb");                               // o modelo diz Embalar
    expect(ehEtapaFinal(F, "f-tec")).toBe(false);
    const com = planejarRotas({ estrutura: F, etapas: mapa, demanda: 116625, ctx: CTX(), selecao: SEL }) as SaidaPlanejador;
    const sem = plan();
    expect(com.finalAtingivel).toBeCloseTo(sem.finalAtingivel, 9); expect(com.alvo).toEqual(sem.alvo); expect(com.poolComum.etapas.map((x) => x.etapaId)).toEqual(["f-etiq", "f-emb"]);
  });
  it("percurso: CONV = Rosquear → Parafusar → pool; AUTO = Rosquear+Parafusar → pool; Parafusar → Rosquear+Parafusar é impossível", () => {
    expect(percursoDaPeca(F, "CONV")).toEqual(["f-rosq", "f-para", "f-etiq", "f-emb"]);
    expect(percursoDaPeca(F, "AUTO")).toEqual(["f-rp", "f-etiq", "f-emb"]);
    expect(etapasSeguintes(F, "f-para")).toEqual(["f-etiq"]); expect(etapasSeguintes(F, "f-para")).not.toContain("f-rp");
    // o planejador não troca a ordem: reordenar `ordem` das etapas não muda o resultado
    const embaralhado = new Map(ETAPAS.map((e) => [e.id, { ...e, ordem: 10 - e.ordem }]));
    const s = planejarRotas({ estrutura: F, etapas: embaralhado, demanda: 116625, ctx: CTX(), selecao: SEL }) as SaidaPlanejador;
    expect(s.alvo).toEqual(plan().alvo); expect(s.finalAtingivel).toBeCloseTo(97500, 6);
  });
  it("produto LINEAR não passa pelo planejador (aplicavel=false) e o caminho legado fica intacto", () => {
    const lin = estruturaLinear("P", [{ id: "a", ordem: 0 }, { id: "b", ordem: 1 }]);
    const r = planejarRotas({ estrutura: lin, etapas: MAPA, demanda: 1000, ctx: CTX(), selecao: {} });
    expect(r).toMatchObject({ aplicavel: false, motivo: "produto_linear" });
  });
  it("compatibilidade do apontado real/indicadores: linear = etapa de maior ordem; rotas = final explícita (Embalar), nunca max(ordem)", () => {
    const lin = [{ id: "a", ordem: 0 }, { id: "b", ordem: 1 }, { id: "c", ordem: 2 }];
    expect(etapaFinalDoProduto(estruturaLinear("P", lin), lin)).toBe("c"); expect(etapaFinalDoProduto(null, lin)).toBe("c");
    expect(apontadoRealProduto(estruturaLinear("P", lin), lin, [{ etapaId: "a", quantidade: 90 }, { etapaId: "c", quantidade: 40 }, { etapaId: "c", quantidade: 10 }])).toBe(50);
    const tec = [...ETAPAS, etapa("f-tec", "Etapa Técnica", 99, 1, 1, ["T1"])];
    const ap = [{ etapaId: "f-rosq", quantidade: 500 }, { etapaId: "f-rp", quantidade: 300 }, { etapaId: "f-etiq", quantidade: 700 }, { etapaId: "f-emb", quantidade: 600 }, { etapaId: "f-tec", quantidade: 9 }];
    expect(apontadoRealProduto(F, tec, ap)).toBe(600);                                  // só Embalar conta como produto acabado
    expect(apontadoRealProduto(F, tec, [])).toBe(0);
  });
  it("CONTROLE HUMANO: etapa cadastrada como compatível mas NÃO marcada na Previsão = capacidade 0; o planejador nunca a adiciona", () => {
    // Etiquetar tem E15 e E16 no cadastro; a Previsão marcou só a E15 ⇒ E16 contribui 0 mesmo livre
    const so15 = plan({ selecao: { ...SEL, "f-etiq": ["E15"] }, ctx: CTX({ horasComprometidasPorMaquina: { E16: 0 } }) });
    expect(so15.poolComum.porOperacao.Etiquetar).toBeCloseTo(97500, 6);
    // nenhuma marcação em Etiquetar ⇒ pool 0 (não cai para as elegíveis do cadastro)
    const nenhuma = plan({ selecao: { ...SEL, "f-etiq": [] } });
    expect(nenhuma.poolComum.porOperacao.Etiquetar).toBe(0); expect(nenhuma.finalAtingivel).toBe(0);
    // chave ausente também ⇒ 0
    const { ["f-etiq"]: _omitida, ...semChave } = SEL; void _omitida;
    expect(plan({ selecao: semChave }).poolComum.porOperacao.Etiquetar).toBe(0);
    // rota sem máquina marcada: AUTO = 0 e a CONV atende sozinha; CONV sem máquina: AUTO sozinha
    const semAuto = plan({ ...E16(1), selecao: { ...SEL16, "f-rp": [] } });
    expect(semAuto.capacidadePorRota.AUTO.realizavel).toBe(0); expect(semAuto.alvo.AUTO).toBe(0); expect(semAuto.alvo.CONV).toBeCloseTo(81000, 6);
    const semConv = plan({ ...E16(1), selecao: { ...SEL16, "f-rosq": [], "f-para": [] } });
    expect(semConv.capacidadePorRota.CONV.realizavel).toBe(0); expect(semConv.alvo.CONV).toBe(0); expect(semConv.alvo.AUTO).toBeCloseTo(35625, 6);
  });
  it("etapa dos dados: capacidadeEtapa do pool não depende de qual rota alimenta (uma capacidade comum só)", () => {
    const direto = capacidadeEtapa(MAPA.get("f-etiq") as EtapaCadastro, CTX(), ["E15"]).pecas;
    expect(plan().poolComum.porOperacao.Etiquetar).toBeCloseTo(direto, 9);
  });
});
