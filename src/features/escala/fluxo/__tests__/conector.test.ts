// Conector (spec §5): adaptador legado — pools comuns Etiquetar/Embalar de dois produtos fundidos logicamente — e produto único com rotas
// (F#CONV / F#AUTO / F#COMUM). Sem alterar apontamentos; fallback explícito PRODUTO_EM_COMPORTAMENTO_LEGADO.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../../gerarEscala";
import { estadoDaProducao } from "../estado";
import { construirGrafo } from "../grafo";
import type { ParLegado } from "../tipos";
import { verificarRestricoesDuras } from "../restricoes";
import { checarFluxo, equipe, montar, pool, realComoPlano, rodar } from "./helpersFluxo";

const par: ParLegado = {
  id: "conector",
  produtoConvencionalId: "CONV",
  produtoAutomaticaId: "AUTO",
  etapasComuns: [
    { rotulo: "Etiquetar", etapaConvencionalId: "C-etq", etapaAutomaticaId: "A-etq" },
    { rotulo: "Embalar", etapaConvencionalId: "C-emb", etapaAutomaticaId: "A-emb" },
  ],
};
const mk = (over: { aEtqOp?: string; aEtqMaq?: string[]; aEtqMu?: number } = {}) => [
  pool({ produto: "CONV", etapa: "C-ros", op: "op-ros", ordem: 0, q: 8000, maquinas: ["r1", "r2"], mu: 400 }),
  pool({ produto: "CONV", etapa: "C-par", op: "op-par", ordem: 1, q: 8000, maquinas: ["p1", "p2"], mu: 400 }),
  pool({ produto: "CONV", etapa: "C-etq", op: "op-etq", ordem: 2, q: 8000, maquinas: ["k1"], mu: 700 }),
  pool({ produto: "CONV", etapa: "C-emb", op: "op-emb", ordem: 3, q: 8000, maquinas: ["k2"], mu: 1000 }),
  pool({ produto: "AUTO", etapa: "A-ros", op: "op-aut", ordem: 0, q: 4000, maquinas: ["x8"], mu: 300 }),
  pool({ produto: "AUTO", etapa: "A-etq", op: over.aEtqOp ?? "op-etq", ordem: 1, q: 4000, maquinas: over.aEtqMaq ?? ["k1"], mu: over.aEtqMu ?? 700 }),
  pool({ produto: "AUTO", etapa: "A-emb", op: "op-emb", ordem: 2, q: 4000, maquinas: ["k2"], mu: 1000 }),
];

describe("Conector legado — fusão lógica dos pools comuns", () => {
  it("funde Etiquetar e Embalar (um nó por etapa comum), com os trechos exclusivos alimentando o nó comum", () => {
    const g = construirGrafo(mk(), { paresLegado: [par] });
    expect(g.fusoes.map((f) => f.rotulo)).toEqual(["Etiquetar", "Embalar"]);
    const etq = g.nos[g.noDoPool["CONV|C-etq"]];
    expect(g.noDoPool["AUTO|A-etq"]).toBe(etq.id);
    expect(etq.membros).toEqual(["CONV|C-etq", "AUTO|A-etq"]);
    expect(etq.quantidade).toBe(12000);
    expect(g.entradas[etq.id].sort()).toEqual(["AUTO|A-ros", "CONV|C-par"]);
    expect(g.grupos).toHaveLength(1);
    expect(g.nos[g.grupos[0].sink].etapaId).toBe("C-emb");
    // peso do ramo = Q_ramo / ΣQ
    expect(g.arestas["CONV|C-par"].peso).toBeCloseTo(8000 / 12000, 6);
    expect(g.arestas["AUTO|A-ros"].peso).toBeCloseTo(4000 / 12000, 6);
  });

  it("demanda comum = Q_conv + Q_auto − boas do Embalar de AMBOS; o pool do ramo automática sai com rem 0 (sem duplicidade)", () => {
    const pools = mk();
    const m0 = montar({ pools, funcionarios: equipe(8), c: 1, extra: {} });
    const real = realComoPlano(m0.planoCompleto, pools, 1, m0.entrada.slots);
    const e = estadoDaProducao(m0.entrada, { ...m0.dados, apontamentos: real.map((a) => ({ ...a, lancadoEmMs: 1 })) }, { paresLegado: [par] });
    expect(e.poolsFundidos).toHaveLength(2);
    expect(e.remPorPool["AUTO|A-etq"]).toBe(0);
    expect(e.remPorPool["AUTO|A-emb"]).toBe(0);
    const boasEmb = e.etapas.filter((x) => x.etapaId === "C-emb" || x.etapaId === "A-emb").reduce((s, x) => s + x.boas.lo, 0);
    const proj = e.projecao.boas["CONV|C-emb"].lo; // inclui o que as linhas congeladas ainda produzem até aPartirDe
    expect(e.remPorPool["CONV|C-emb"]).toBeCloseTo(12000 - proj, 1);
    expect(proj).toBeGreaterThanOrEqual(boasEmb);
    expect(e.poolsFundidos[1].demandaComum).toBe(12000);
    expect(e.diagnosticos.filter((d) => d.codigo === "POOL_FUNDIDO")).toHaveLength(2);
  });

  it("a Etiquetadora compartilhada nunca recebe duas pessoas, e o plano de fluxo respeita todas as restrições duras", () => {
    const m0 = montar({ pools: mk(), funcionarios: equipe(8), c: 1 });
    const apontamentos = realComoPlano(m0.planoCompleto, mk(), 1, m0.entrada.slots);
    const x = rodar({ pools: mk(), funcionarios: equipe(8), c: 1, apontamentos, opcoes: { paresLegado: [par] } });
    expect(x.r.diagnostico.planoEscolhido).toBe("fluxo");
    expect(checarFluxo(x)).toEqual([]);
    const porSlot = new Map<string, number>();
    x.r.resultado.alocacoes.filter((a) => a.maquinaId === "k1").forEach((a) => porSlot.set(`${a.data}${a.periodoId}`, (porSlot.get(`${a.data}${a.periodoId}`) ?? 0) + 1));
    expect([...porSlot.values()].every((n) => n === 1)).toBe(true);
    expect(x.r.resultado.alocacoes.some((a) => a.maquinaId && (a.etapaId === "A-etq" || a.etapaId === "A-emb") && a.pecas > 0)).toBe(false); // linhas saem no produto convencional
  });

  it("Máquina 8 (trecho exclusivo) não produz além do que o pool comum + teto de 1 período absorvem", () => {
    const pools = mk();
    const m0 = montar({ pools, funcionarios: equipe(8), c: 1 });
    const apontamentos = realComoPlano(m0.planoCompleto, pools, 1, m0.entrada.slots);
    const flux = rodar({ pools, funcionarios: equipe(8), c: 1, apontamentos, opcoes: { paresLegado: [par] } });
    expect(flux.r.diagnostico.planoEscolhido).toBe("fluxo");
    const d = flux.r.diagnostico;
    const ros = d.estado.demanda.find((z) => z.chave === "AUTO|A-ros")!;
    expect(ros.limitadoPorUtilidade).toBe(true);
    expect(ros.remFluxo).toBeLessThan(ros.demandaFluxo);
    const prod8 = (al: typeof flux.r.resultado.alocacoes) => al.filter((a) => a.maquinaId === "x8").reduce((s, a) => s + a.pecas, 0);
    expect(prod8(flux.r.resultado.alocacoes)).toBeLessThanOrEqual(ros.remFluxo + 1e-6);
    expect(ros.remFluxo).toBeLessThanOrEqual((ros.consumoDownstream as number) + (ros.tetoPeriodo as number));
    // o motor atual (sem fluxo) deixaria a Máquina 8 produzir mais
    expect(prod8(gerarEscala(flux.entrada).alocacoes)).toBeGreaterThanOrEqual(prod8(flux.r.resultado.alocacoes));
  });

  it("sem fusão (par ausente da config) os pools continuam separados — e o resultado ainda é válido", () => {
    const x = rodar({ pools: mk(), funcionarios: equipe(8), c: 1 });
    expect(x.r.diagnostico.estado.poolsFundidos).toHaveLength(0);
    expect(checarFluxo(x)).toEqual([]);
  });
});

describe("Conector legado — fallback explícito PRODUTO_EM_COMPORTAMENTO_LEGADO", () => {
  const casos: [string, ReturnType<typeof mk>][] = [
    ["operação diferente", mk({ aEtqOp: "outra-op" })],
    ["conjunto de máquinas diferente", mk({ aEtqMaq: ["k1", "k3"] })],
    ["metas incompatíveis", mk({ aEtqMu: 900 })],
  ];
  casos.forEach(([nome, pools]) => {
    it(`${nome}: não funde, avisa e segue válido`, () => {
      const m0 = montar({ pools, funcionarios: equipe(8), c: 1 });
      const e = estadoDaProducao(m0.entrada, { ...m0.dados, apontamentos: [] }, { paresLegado: [par] });
      expect(e.poolsFundidos).toHaveLength(0);
      const dg = e.diagnosticos.filter((d) => d.codigo === "PRODUTO_EM_COMPORTAMENTO_LEGADO");
      expect(dg).toHaveLength(1);
      expect(dg[0].severidade).toBe("aviso");
      expect(e.remPorPool["AUTO|A-etq"]).toBeGreaterThanOrEqual(0);
      const x = rodar({ pools, funcionarios: equipe(8), c: 1, opcoes: { paresLegado: [par] } });
      expect(verificarRestricoesDuras(x.r.entradaFluxo, x.r.resultado.alocacoes)).toEqual([]);
    });
  });
  it("sufixo das cadeias errado (etapa comum não é o trecho final): legado", () => {
    const errado: ParLegado = { ...par, etapasComuns: [{ rotulo: "Etiquetar", etapaConvencionalId: "C-par", etapaAutomaticaId: "A-etq" }] };
    const g = construirGrafo(mk(), { paresLegado: [errado] });
    expect(g.fusoes).toHaveLength(0);
    expect(g.diagnosticos.some((d) => d.codigo === "PRODUTO_EM_COMPORTAMENTO_LEGADO")).toBe(true);
  });
  it("só um dos produtos na Previsão: nada a fundir (info), sem exceção", () => {
    const so = mk().filter((p) => p.produtoId === "CONV");
    const g = construirGrafo(so, { paresLegado: [par] });
    expect(g.fusoes).toHaveLength(0);
    expect(g.diagnosticos.filter((d) => d.codigo === "PRODUTO_EM_COMPORTAMENTO_LEGADO")[0].severidade).toBe("info");
  });
  it("metas × f diferentes entre os ramos NÃO impedem a fusão quando os fatores embutidos são informados", () => {
    const pools = mk().map((p) => (p.etapaId === "A-etq" ? { ...p, metas: Object.fromEntries(Object.entries(p.metas).map(([k, v]) => [k, v * 0.8])) } : p));
    expect(construirGrafo(pools, { paresLegado: [par] }).fusoes).toHaveLength(0);
    expect(construirGrafo(pools, { paresLegado: [par], fatoresEmbutidos: { "AUTO|A-etq": 0.8 } }).fusoes).toHaveLength(2);
  });
});

describe("Conector — produto único com rotas (F#CONV / F#AUTO / F#COMUM)", () => {
  // Compatível com o desenho de 02/11: depois da convergência não há identidade CONV/AUTO nas etapas comuns; o WIP dos dois trechos
  // exclusivos alimenta o pool comum; o apontamento mantém a rota só em etapa exclusiva.
  const pools = [
    pool({ produto: "F#CONV", etapa: "fc-ros", op: "op-ros", ordem: 0, q: 8000, maquinas: ["r1", "r2"], mu: 400 }),
    pool({ produto: "F#CONV", etapa: "fc-par", op: "op-par", ordem: 1, q: 8000, maquinas: ["p1", "p2"], mu: 400 }),
    pool({ produto: "F#AUTO", etapa: "fa-ros", op: "op-aut", ordem: 0, q: 4000, maquinas: ["x8"], mu: 300 }),
    pool({ produto: "F#COMUM", etapa: "fx-etq", op: "op-etq", ordem: 0, q: 12000, maquinas: ["k1"], mu: 700 }),
    pool({ produto: "F#COMUM", etapa: "fx-emb", op: "op-emb", ordem: 1, q: 12000, maquinas: ["k2"], mu: 1000 }),
  ];
  const lig = [{ produtoOrigemId: "F#CONV", produtoDestinoId: "F#COMUM" }, { produtoOrigemId: "F#AUTO", produtoDestinoId: "F#COMUM" }];

  it("um único grupo, final no pool comum; ramos exclusivos alimentam o primeiro pool comum", () => {
    const g = construirGrafo(pools, { ligacoes: lig });
    expect(g.grupos).toHaveLength(1);
    expect(g.nos[g.grupos[0].sink].produtoId).toBe("F#COMUM");
    expect(g.nos[g.grupos[0].sink].etapaId).toBe("fx-emb");
    expect(g.entradas["F#COMUM|fx-etq"].sort()).toEqual(["F#AUTO|fa-ros", "F#CONV|fc-par"]);
    expect(g.arestas["F#CONV|fc-par"].peso + g.arestas["F#AUTO|fa-ros"].peso).toBeCloseTo(1, 9);
    expect(g.arestas["F#CONV|fc-par"].peso).toBeCloseTo(8000 / 12000, 9);
  });

  it("apontamento só em etapa exclusiva vira WIP do pool comum; a demanda das exclusivas é a parte (peso) da demanda comum menos o WIP do ramo", () => {
    const m0 = montar({ pools, funcionarios: equipe(8), c: 1 });
    // exclusivas produziram bem acima do que o pool comum consumiu (que não produziu nada: zero confirmado)
    const idx = m0.entrada.slots;
    const apont = m0.planoCompleto.filter((a) => a.maquinaId && idx.findIndex((s) => s.data === a.data && s.periodoId === a.periodoId) <= 1).map((a) => {
      const exclusiva = a.produtoId !== "F#COMUM";
      const base = { data: a.data, periodoId: a.periodoId, maquinaId: a.maquinaId as string, produtoId: a.produtoId as string, etapaId: a.etapaId as string, funcionarioId: a.funcionarioId, operacaoId: a.operacaoId, lancadoEmMs: 1, refugo: 0, meta: 0, motivo: null as string | null };
      return exclusiva ? { ...base, status: "produzindo" as const, boas: 300 } : { ...base, status: "sem_producao" as const, boas: 0, motivo: "outro" };
    });
    const e = estadoDaProducao(m0.entrada, { ...m0.dados, apontamentos: apont }, { ligacoes: lig });
    const wipConv = e.pares.find((p) => p.produtoId === "F#CONV")!;
    const wipAuto = e.pares.find((p) => p.produtoId === "F#AUTO")!;
    expect(wipConv.etapaSeguinteId).toBe("fx-etq");
    expect(wipAuto.etapaSeguinteId).toBe("fx-etq");
    expect(wipConv.wip.lo).toBeGreaterThan(0);
    expect(wipAuto.wip.lo).toBeGreaterThan(0);
    const dComum = e.demanda.find((d) => d.etapaId === "fx-etq")!.demandaFluxo;
    const dConv = e.demanda.find((d) => d.etapaId === "fc-par")!.demandaFluxo;
    const wipConvNoMotor = e.projecao.wip["F#CONV|fc-par"].lo; // WIP já projetado até aPartirDe (o que o motor enxerga)
    expect(dConv).toBeCloseTo(Math.max(0, (8000 / 12000) * dComum - wipConvNoMotor), 0);
    const x = rodar({ pools, funcionarios: equipe(8), c: 1, apontamentos: apont, opcoes: { ligacoes: lig } });
    expect(checarFluxo(x)).toEqual([]);
    // não existe pool comum duplicado por identidade: uma única demanda final
    expect(x.r.diagnostico.estado.produtos).toHaveLength(1);
    void realComoPlano;
  });
});
