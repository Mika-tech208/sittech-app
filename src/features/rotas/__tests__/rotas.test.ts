import { describe, it, expect } from "vitest";
import { calcularCapacidadeMaximaProduto } from "@/features/capacidade/calculations";
import type { PeriodoComDuracao, Produto } from "@/types/domain";
import { necessidadePorEtapa } from "../demanda";
import { analisarCapacidadeRotas, capacidadeEtapa, capacidadeLinear, capacidadeRota, horasMaquinaSemana, tempoPorPeca } from "../capacidade";
import { ehEtapaFinal, estruturaLinear, etapasAnteriores, etapasSeguintes, rotaDaEtapa, percursoDaPeca, todasAsEtapas, validarEstrutura } from "../estrutura";
import type { ContextoCapacidade, EstruturaProduto, EtapaCadastro, PeriodoId } from "../tipos";

// ---- condições atuais (cadastro de out/26): períodos 96/96/91/80/80/80 min; metas por máquina por período ----
const PERIODOS = [{ id: "m1", minutos: 96 }, { id: "m2", minutos: 96 }, { id: "m3", minutos: 91 }, { id: "t1", minutos: 80 }, { id: "t2", minutos: 80 }, { id: "t3", minutos: 80 }] as ContextoCapacidade["periodos"];
const metas = (m: number, t: number): Record<PeriodoId, number> => ({ m1: m, m2: m, m3: m, t1: t, t2: t, t3: t });
const etapa = (id: string, operacao: string, ordem: number, m: number, t: number, maquinas: string[]): EtapaCadastro => ({ id, operacaoId: `op-${operacao}`, operacao, ordem, metas: metas(m, t), maquinasIds: maquinas });
const CTX = (extra: Partial<ContextoCapacidade> = {}): ContextoCapacidade => ({ periodos: PERIODOS, diasProdutivos: 5, ...extra });

// Produto F (Conector 3/4" Final): CONV = Rosquear → Parafusar; AUTO = Rosquear + Parafusar; POOL COMUM = Etiquetar → Embalar (final). `ordem` 0..4 é só rótulo.
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
// seleção da Previsão de 26/10: Rosq. 3+6 · Parafus. 10+9 · Máq. Automática 8 · Etiquetadora 15 · Embalagem 17
const SEL = { "f-rosq": ["R3", "R6"], "f-para": ["P10", "P9"], "f-rp": ["AUTO8"], "f-etiq": ["E15"], "f-emb": ["EMB17"] };

describe("convergência e estrutura do produto F (E, F, etapa final explícita)", () => {
  it("E) CONV e AUTO convergem no MESMO pool: a última etapa de cada rota alimenta a mesma entrada do pool comum", () => {
    expect(etapasSeguintes(F, "f-para")).toEqual(["f-etiq"]);
    expect(etapasSeguintes(F, "f-rp")).toEqual(["f-etiq"]);
    expect(etapasSeguintes(F, "f-rosq")).toEqual(["f-para"]);
    expect(etapasAnteriores(F, "f-etiq").sort()).toEqual(["f-para", "f-rp"]);
    expect(etapasSeguintes(F, "f-etiq")).toEqual(["f-emb"]);
    expect(percursoDaPeca(F, "CONV")).toEqual(["f-rosq", "f-para", "f-etiq", "f-emb"]);
    expect(percursoDaPeca(F, "AUTO")).toEqual(["f-rp", "f-etiq", "f-emb"]);
    expect(rotaDaEtapa(F, "f-rp")?.codigo).toBe("AUTO"); expect(rotaDaEtapa(F, "f-etiq")).toBeNull(); // comum não tem rota
  });
  it("F) Etiquetar e Embalar existem UMA vez só (sem 'Etiquetar CONV/AUTO'); a estrutura válida não tem problemas", () => {
    const ids = todasAsEtapas(F);
    expect(ids.filter((id) => MAPA.get(id)?.operacao === "Etiquetar")).toHaveLength(1);
    expect(ids.filter((id) => MAPA.get(id)?.operacao === "Embalar")).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validarEstrutura(F, ETAPAS)).toEqual([]);
  });
  it("etapa comum duplicada por rota é rejeitada ('Etiquetar CONV' + 'Etiquetar AUTO')", () => {
    const extra = [...ETAPAS, etapa("f-etiq-conv", "Etiquetar", 5, 3500, 3000, ["E15"])];
    const ruim: EstruturaProduto = { ...F, rotas: [{ ...F.rotas[0] }, { ...F.rotas[1], etapas: ["f-rosq", "f-para", "f-etiq-conv"] }] };
    expect(validarEstrutura(ruim, extra).join(" | ")).toMatch(/também aparece como etapa exclusiva/);
  });
  it("a etapa final é a MARCADA, não a de maior ordem: com ordem embaralhada Embalar continua final; em produto linear vale o legado (max ordem)", () => {
    expect(ehEtapaFinal(F, "f-emb")).toBe(true); expect(ehEtapaFinal(F, "f-etiq")).toBe(false); expect(ehEtapaFinal(F, "f-rp")).toBe(false); // f-rp tem ordem 2, f-etiq 3 — irrelevante
    const embaralhado = ETAPAS.map((e) => (e.id === "f-emb" ? { ...e, ordem: 1 } : e));
    expect(embaralhado.reduce((m, e) => (e.ordem > m.ordem ? e : m)).id).not.toBe("f-emb"); // por max(ordem) NÃO seria Embalar...
    expect(F.etapaFinalId).toBe("f-emb");                                                    // ...mas o modelo diz que é
    const lin = estruturaLinear("P", [{ id: "a", ordem: 0 }, { id: "c", ordem: 2 }, { id: "b", ordem: 1 }]);
    expect(lin).toMatchObject({ modelo: "linear", regraEtapaFinal: "max_ordem_legado", etapaFinalId: "c" });
    expect(lin.rotas[0].etapas).toEqual(["a", "b", "c"]); expect(etapasSeguintes(lin, "a")).toEqual(["b"]); expect(etapasSeguintes(lin, "c")).toEqual([]);
  });
  it("estruturas inválidas: etapa final fora do pool, final que não é a última, rota sem etapa, etapa órfã", () => {
    expect(validarEstrutura({ ...F, etapaFinalId: "f-etiq" }, ETAPAS).join()).toMatch(/última do pool comum/);
    expect(validarEstrutura({ ...F, etapaFinalId: "f-rp" }, ETAPAS).join()).toMatch(/precisa estar no pool comum/);
    expect(validarEstrutura({ ...F, rotas: [F.rotas[0], { ...F.rotas[1], etapas: [] }] }, ETAPAS).join()).toMatch(/sem etapas exclusivas/);
    expect(validarEstrutura({ ...F, rotas: [F.rotas[0], { ...F.rotas[1], etapas: ["f-rosq"] }] }, ETAPAS).join()).toMatch(/não está em exatamente um lugar/);
  });
});

describe("fluxo da fábrica: sem sequência linear falsa e sem demanda duplicada (revisão)", () => {
  it("as rotas são caminhos ALTERNATIVOS: nenhuma peça CONV passa por Rosquear+Parafusar e nenhuma AUTO por Rosquear/Parafusar convencionais", () => {
    expect(percursoDaPeca(F, "CONV")).toEqual(["f-rosq", "f-para", "f-etiq", "f-emb"]);
    expect(percursoDaPeca(F, "AUTO")).toEqual(["f-rp", "f-etiq", "f-emb"]);
    expect(percursoDaPeca(F, "CONV")).not.toContain("f-rp"); expect(percursoDaPeca(F, "AUTO")).not.toContain("f-rosq"); expect(percursoDaPeca(F, "AUTO")).not.toContain("f-para");
    expect(etapasSeguintes(F, "f-para")).toEqual(["f-etiq"]); expect(etapasSeguintes(F, "f-para")).not.toContain("f-rp"); // Parafusar → Etiquetar, NUNCA → Rosquear + Parafusar
    expect(etapasAnteriores(F, "f-rp")).toEqual([]);                                                                         // a automática não recebe nada de Parafusar convencional
  });
  it("a leitura por `ordem` (0→1→2→3→4) é FALSA e diferente do modelo: ela encadearia Parafusar → Rosquear+Parafusar", () => {
    const porOrdem = [...ETAPAS].sort((a, b) => a.ordem - b.ordem).map((x) => x.id);
    expect(porOrdem).toEqual(["f-rosq", "f-para", "f-rp", "f-etiq", "f-emb"]);
    expect(percursoDaPeca(F, "CONV")).not.toEqual(porOrdem); expect(percursoDaPeca(F, "AUTO")).not.toEqual(porOrdem);
    expect(etapasSeguintes(F, "f-para")).not.toEqual([porOrdem[porOrdem.indexOf("f-para") + 1]]);
  });
  it("rotas contêm SÓ etapas exclusivas (trecho antes da convergência); Etiquetar/Embalar ficam uma vez no fluxo comum", () => {
    const exclusivas = F.rotas.flatMap((r) => r.etapas);
    expect(exclusivas.sort()).toEqual(["f-para", "f-rosq", "f-rp"]);
    expect(exclusivas).not.toContain("f-etiq"); expect(exclusivas).not.toContain("f-emb");
    expect(F.poolComum?.etapas).toEqual(["f-etiq", "f-emb"]);
  });
  it("convergência EXPLÍCITA: a última etapa exclusiva de cada rota (Parafusar; Rosquear + Parafusar) converge em Etiquetar", () => {
    expect(F.convergencia).toEqual({ destinoId: "f-etiq", origens: [{ rotaCodigo: "AUTO", etapaId: "f-rp" }, { rotaCodigo: "CONV", etapaId: "f-para" }] });
  });
  it("demanda comum NÃO é duplicada: AUTO 35.625 + CONV 81.000 ⇒ Etiquetar = Embalar = 116.625 (uma necessidade cada), exclusivas só o que cada rota entrega", () => {
    const n = necessidadePorEtapa(F, { AUTO: 35625, CONV: 81000 });
    expect(n).toEqual({ "f-rp": 35625, "f-rosq": 81000, "f-para": 81000, "f-etiq": 116625, "f-emb": 116625 });
    expect(Object.keys(n).filter((k) => k === "f-etiq")).toHaveLength(1);
  });
});

describe("capacidade — AUTO, gargalo da Etiquetadora 15 e competição por capacidade (G, H, I)", () => {
  it("G) a AUTO calcula 35.625/semana a partir de metas × períodos × dias (nada fixo): 7.125/dia × 5", () => {
    const ctx = CTX();
    const auto = capacidadeRota(F, "AUTO", MAPA, ctx, SEL);
    expect(auto.pecas).toBeCloseTo(35625, 6);
    expect(auto.limitante?.operacao).toBe("Rosquear + Parafusar");
    expect(capacidadeEtapa(MAPA.get("f-rp") as EtapaCadastro, ctx).pecas / 5).toBeCloseTo(7125, 6);
    // muda quando as condições mudam: 4 dias → 28.500; máquina indisponível → 0; meta menor → proporcional
    expect(capacidadeRota(F, "AUTO", MAPA, CTX({ diasProdutivos: 4 }), SEL).pecas).toBeCloseTo(28500, 6);
    expect(capacidadeRota(F, "AUTO", MAPA, CTX({ maquinasIndisponiveis: ["AUTO8"] }), SEL).pecas).toBe(0);
  });
  it("a CONV de 26/10 é limitada por Parafusar: 2 parafusadeiras × 8.100/dia × 5 = 81.000 (não é demanda fixa)", () => {
    const conv = capacidadeRota(F, "CONV", MAPA, CTX(), SEL);
    expect(conv.pecas).toBeCloseTo(81000, 6); expect(conv.limitante?.operacao).toBe("Parafusar");
    expect(capacidadeRota(F, "CONV", MAPA, CTX(), { ...SEL, "f-para": ["P10", "P9", "P11"] }).pecas).toBeCloseTo(108000, 6); // mais uma máquina: o limite passa a ser Rosquear (2 máquinas)
  });
  it("H) Etiquetadora 15 SOZINHA (97.500) não atende a demanda final 116.625: o modelo de rotas enxerga o gargalo comum que os dois produtos separados escondiam", () => {
    const a = analisarCapacidadeRotas(F, MAPA, 116625, CTX(), SEL);
    expect(a.capacidadeEntrada).toBeCloseTo(116625, 6);          // 35.625 (AUTO) + 81.000 (CONV) = demanda
    expect(a.capacidadeComum).toBeCloseTo(97500, 6);             // Etiquetar com E15 = 19.500/dia × 5
    expect(a.maxEntregavel).toBeCloseTo(97500, 6);               // 116.625 fica limitado a 97.500
    expect(a.atende).toBe(false); expect(a.falta).toBeCloseTo(19125, 6);
    expect(a.gargalo).toEqual({ tipo: "comum", etapaId: "f-etiq", operacao: "Etiquetar" });
    expect(a.folga).toBeLessThan(0);
    // visto como dois produtos separados cada um "cabe" (81.000 ≤ 97.500 e 35.625 ≤ 97.500) — o mascaramento que o modelo novo elimina
    const etiq = capacidadeEtapa(MAPA.get("f-etiq") as EtapaCadastro, CTX(), ["E15"]).pecas;
    expect(81000 <= etiq && 35625 <= etiq).toBe(true);
  });
  it("com capacidade adicional comum (E16 livre) a demanda cabe; o gargalo some", () => {
    const a = analisarCapacidadeRotas(F, MAPA, 116625, CTX(), { ...SEL, "f-etiq": ["E15", "E16"] });
    expect(a.capacidadeComum).toBeCloseTo(142500, 6);            // Etiquetar 195.000 (E15+E16) — passa a limitar Embalar (1 máquina: 142.500)
    expect(a.atende).toBe(true); expect(a.gargalo).toBeNull(); expect(a.folga).toBeCloseTo(0, 9); // entrada (116.625) = demanda: atende no limite (as rotas, não o pool comum, é que fecham)
    const maisMaquinas = { ...SEL, "f-etiq": ["E15", "E16"], "f-rosq": ["R3", "R5", "R6"], "f-para": ["P9", "P10", "P11", "P12"] };   // CONV 162.000 + AUTO 35.625 > Embalar
    const maior = analisarCapacidadeRotas(F, MAPA, 150000, CTX(), maisMaquinas);
    expect(maior.gargalo).toEqual({ tipo: "comum", etapaId: "f-emb", operacao: "Embalar" });   // agora quem limita é o pool comum (Embalar: 1 máquina = 142.500)
    expect(maior.maxEntregavel).toBeCloseTo(142500, 6);
  });
  it("I) a Etiquetadora 16 NÃO é assumida livre quando a Caixa Amarela a ocupa (70.500 peças = a semana inteira dela): Etiquetar fica em 97.500", () => {
    const caixaEtiq = etapa("c-etiq", "Etiquetar", 1, 2500, 2200, ["E15", "E16"]);
    const horasCaixa = 70500 * tempoPorPeca(caixaEtiq, CTX());
    expect(horasCaixa).toBeCloseTo(horasMaquinaSemana(CTX()), 6);     // a Caixa Amarela consome a E16 inteira
    const ctx = CTX({ horasComprometidasPorMaquina: { E16: horasCaixa } });
    const etiq = capacidadeEtapa(MAPA.get("f-etiq") as EtapaCadastro, ctx, ["E15", "E16"]);
    expect(etiq.porMaquina.E16).toBeCloseTo(0, 6); expect(etiq.pecas).toBeCloseTo(97500, 6);
    const a = analisarCapacidadeRotas(F, MAPA, 116625, ctx, { ...SEL, "f-etiq": ["E15", "E16"] });
    expect(a.atende).toBe(false); expect(a.maxEntregavel).toBeCloseTo(97500, 6); expect(a.gargalo).toMatchObject({ tipo: "comum", operacao: "Etiquetar" });
    // ignorando a competição (o ERRO a evitar) a capacidade seria fictícia: 195.000
    expect(capacidadeEtapa(MAPA.get("f-etiq") as EtapaCadastro, CTX(), ["E15", "E16"]).pecas).toBeCloseTo(195000, 6);
    // com a Caixa Amarela ocupando só parte (30.000 peças) só o que sobra entra — nenhuma capacidade fictícia
    const parcial = capacidadeEtapa(MAPA.get("f-etiq") as EtapaCadastro, CTX({ horasComprometidasPorMaquina: { E16: 30000 * tempoPorPeca(caixaEtiq, CTX()) } }), ["E15", "E16"]);
    const livreE16 = (horasMaquinaSemana(CTX()) - 30000 * tempoPorPeca(caixaEtiq, CTX())) / tempoPorPeca(MAPA.get("f-etiq") as EtapaCadastro, CTX());
    expect(parcial.pecas).toBeCloseTo(97500 + livreE16, 6);
  });
  it("AUTO parada: a demanda continua 116.625 e a CONV é o que resta (sem 'impossível por cadastro')", () => {
    const a = analisarCapacidadeRotas(F, MAPA, 116625, CTX({ maquinasIndisponiveis: ["AUTO8"] }), { ...SEL, "f-etiq": ["E15", "E16"] });
    expect(a.demanda).toBe(116625); expect(a.capacidadePorRota.find((r) => r.rotaCodigo === "CONV")?.pecas).toBeCloseTo(81000, 6);
    expect(a.maxEntregavel).toBeCloseTo(81000, 6); expect(a.falta).toBeCloseTo(35625, 6); expect(a.gargalo?.tipo).toBe("entrada");
    const lim = (a.gargalo as { limitantes: { rotaCodigo: string; operacao: string; pecas: number }[] }).limitantes;
    expect(lim.map((x) => `${x.rotaCodigo}:${x.operacao}`)).toEqual(["AUTO:Rosquear + Parafusar", "CONV:Parafusar"]); expect(lim[0].pecas).toBe(0); expect(lim[1].pecas).toBeCloseTo(81000, 6);
  });
});

describe("J) produtos lineares: rota implícita reproduz EXATAMENTE a capacidade do caminho legado", () => {
  // gerador determinístico (LCG) de produtos lineares aleatórios
  const lcg = (semente: number) => { let s = semente >>> 0; return () => ((s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 4294967296); };
  it("1.000 produtos lineares aleatórios: capacidadeLinear (nova) == calcularCapacidadeMaximaProduto (legado), mesma seleção de máquinas", () => {
    const rnd = lcg(20261106);
    const periodos = PERIODOS.map((p) => ({ id: p.id, nome: p.id.toUpperCase(), inicio: "00:00", fim: "00:00", duracaoHoras: p.minutos / 60 })) as unknown as PeriodoComDuracao[];
    for (let caso = 0; caso < 1000; caso++) {
      const nEtapas = 1 + Math.floor(rnd() * 5);
      const dias = 1 + Math.floor(rnd() * 7);
      const etapas: EtapaCadastro[] = [];
      const selecao: Record<string, string[]> = {};
      for (let i = 0; i < nEtapas; i++) {
        const nMaq = Math.floor(rnd() * 4); // 0 = etapa sem máquina marcada
        const maquinas = Array.from({ length: nMaq + 1 }, (_, k) => `m${caso}-${i}-${k}`);
        const e = etapa(`e${caso}-${i}`, `Op${i}`, i, 500 + Math.floor(rnd() * 3000), rnd() < 0.15 ? 0 : 400 + Math.floor(rnd() * 3000), maquinas);
        etapas.push(e); selecao[e.id] = maquinas.slice(0, nMaq);
      }
      const ctx = CTX({ diasProdutivos: dias });
      const produto = { id: "P", nome: "P", referencia: "", valorUnitario: 1, ativo: true, prioridade: "media", roteiro: etapas.map((e) => ({ id: e.id, operacao: e.operacao, metas: e.metas, maquinasIds: e.maquinasIds })) } as unknown as Produto;
      const legado = calcularCapacidadeMaximaProduto("P", selecao, [produto], periodos, horasMaquinaSemana(ctx));
      // legado ignora etapa sem tempo/peça (meta 0) e etapa sem máquina conta 0; a nova função reproduz a mesma regra
      const nova = Math.floor(capacidadeLinear(etapas.filter((e) => tempoPorPeca(e, ctx) > 0), ctx, selecao));
      expect(nova).toBe(legado.maxPecas);
    }
  });
  it("estrutura implícita do produto linear: sequência por ordem, próxima = ordem imediatamente maior, final = max(ordem) (regra legada preservada)", () => {
    const e = estruturaLinear("P", [{ id: "3", ordem: 3 }, { id: "0", ordem: 0 }, { id: "1", ordem: 1 }, { id: "2", ordem: 2 }]);
    expect(e.modelo).toBe("linear"); expect(e.rotas).toHaveLength(1); expect(e.poolComum).toBeNull();
    expect(todasAsEtapas(e)).toEqual(["0", "1", "2", "3"]); expect(ehEtapaFinal(e, "3")).toBe(true);
    expect(etapasSeguintes(e, "1")).toEqual(["2"]); expect(etapasAnteriores(e, "2")).toEqual(["1"]);
    expect(validarEstrutura(e, [])).toEqual([]);
  });
});
