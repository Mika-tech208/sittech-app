// f de desempenho embutido nas metas (integração): mesma regra da sombra, aplicado UMA vez, pools fundidos com f conjunto.
import { describe, it, expect } from "vitest";
import { fatorDesempenho } from "../../desempenho";
import { avaliarPlano } from "../avaliar";
import { embutirFatores, fatoresDeDesempenho, ultimoSlotFechado } from "../fatores";
import { construirGrafo } from "../grafo";
import { planejarComFluxo } from "../planejar";
import type { ParLegado } from "../tipos";
import { ap, apontarPlano, checarFluxo, equipe, montar, pool } from "./helpersFluxo";

const par: ParLegado = {
  id: "conector", produtoConvencionalId: "CONV", produtoAutomaticaId: "AUTO",
  etapasComuns: [{ rotulo: "Etiquetar", etapaConvencionalId: "C-etq", etapaAutomaticaId: "A-etq" }, { rotulo: "Embalar", etapaConvencionalId: "C-emb", etapaAutomaticaId: "A-emb" }],
};
const poolsC = [
  pool({ produto: "CONV", etapa: "C-ros", op: "op-ros", ordem: 0, q: 8000, maquinas: ["r1", "r2"], mu: 400 }),
  pool({ produto: "CONV", etapa: "C-etq", op: "op-etq", ordem: 1, q: 8000, maquinas: ["k1"], mu: 700 }),
  pool({ produto: "CONV", etapa: "C-emb", op: "op-emb", ordem: 2, q: 8000, maquinas: ["k2"], mu: 1000 }),
  pool({ produto: "AUTO", etapa: "A-ros", op: "op-aut", ordem: 0, q: 4000, maquinas: ["x8"], mu: 300 }),
  pool({ produto: "AUTO", etapa: "A-etq", op: "op-etq", ordem: 1, q: 4000, maquinas: ["k1"], mu: 700 }),
  pool({ produto: "AUTO", etapa: "A-emb", op: "op-emb", ordem: 2, q: 4000, maquinas: ["k2"], mu: 1000 }),
];

describe("fatoresDeDesempenho / embutirFatores", () => {
  const m0 = montar({ pools: poolsC, funcionarios: equipe(8), c: 3 });
  // todo o realizado a 80% da meta (convencional) — só o convencional é apontado, como em PROD
  const apts = () => [0, 1, 2, 3].flatMap((i) => [["r1", "C-ros"], ["k1", "C-etq"], ["k2", "C-emb"]].map(([maq, etapa]) => {
    const s = m0.entrada.slots[i], meta = poolsC.find((p) => p.etapaId === etapa)!.metas[s.periodoId];
    return ap({ data: s.data, periodoId: s.periodoId, maquinaId: maq, produtoId: "CONV", etapaId: etapa, boas: meta * 0.8, meta });
  }));

  it("mesma regra da sombra (n/(n+6) sobre obs = Σ boas/Σ meta) e só devolve f ≠ 1", () => {
    const m = montar({ pools: poolsC, funcionarios: equipe(8), c: 3, apontamentos: apts() });
    const f = fatoresDeDesempenho(m.entrada, m.dados.apontamentos, m.dados.agoraMs);
    const linhas = m.dados.apontamentos.filter((a) => a.etapaId === "C-ros");
    expect(linhas.length).toBeGreaterThanOrEqual(3);
    expect(f["CONV|C-ros"]).toBeCloseTo(fatorDesempenho(linhas.length, linhas.reduce((s, a) => s + a.boas, 0), linhas.reduce((s, a) => s + a.meta, 0)), 10);
    expect(f["CONV|C-ros"]).toBeLessThan(1);
    expect(f["AUTO|A-ros"]).toBeUndefined(); // sem amostras ⇒ f = 1 ⇒ ausente
  });
  it("sem período fechado (início da semana) ou sem realizado: sem f", () => {
    const m = montar({ pools: poolsC, funcionarios: equipe(8), c: 0, aposFimMin: -200 });
    expect(ultimoSlotFechado(m.entrada, m.dados.agoraMs)).toBe(-1);
    expect(fatoresDeDesempenho(m.entrada, [], m.dados.agoraMs)).toEqual({});
  });
  it("embutir multiplica as metas UMA vez, não muta a entrada e devolve a mesma entrada sem f", () => {
    const m = montar({ pools: poolsC, funcionarios: equipe(8), c: 3 });
    expect(embutirFatores(m.entrada, {})).toBe(m.entrada);
    const antes = JSON.stringify(m.entrada);
    const e2 = embutirFatores(m.entrada, { "CONV|C-etq": 0.8 });
    expect(JSON.stringify(m.entrada)).toBe(antes);
    const p0 = m.entrada.pools.find((p) => p.etapaId === "C-etq")!, p1 = e2.pools.find((p) => p.etapaId === "C-etq")!;
    Object.keys(p0.metas).forEach((k) => expect(p1.metas[k]).toBeCloseTo(p0.metas[k] * 0.8, 10));
    expect(e2.pools.find((p) => p.etapaId === "C-emb")).toBe(m.entrada.pools.find((p) => p.etapaId === "C-emb")); // pools sem f: mesma referência
  });
  it("pools FUNDIDOS (Conector) recebem o MESMO f, do realizado conjunto (a fábrica aponta tudo no convencional)", () => {
    const m = montar({ pools: poolsC, funcionarios: equipe(8), c: 3, apontamentos: apts() });
    const f = fatoresDeDesempenho(m.entrada, m.dados.apontamentos, m.dados.agoraMs, [par]);
    expect(f["CONV|C-etq"]).toBeDefined();
    expect(f["AUTO|A-etq"]).toBeCloseTo(f["CONV|C-etq"], 12);
    expect(f["AUTO|A-emb"]).toBeCloseTo(f["CONV|C-emb"], 12);
    // com metas × f embutidas e fatoresEmbutidos informado, a fusão continua válida (sem fatoresEmbutidos seria 'incompatível' se os f diferissem)
    const g = construirGrafo(embutirFatores(m.entrada, f).pools, { paresLegado: [par], fatoresEmbutidos: f });
    expect(g.fusoes).toHaveLength(2);
  });
  it("com f embutido o plano de fluxo é válido, nunca pior que o vigente/base, e o f não é aplicado duas vezes (capacidade = meta × f, uma vez)", () => {
    const m = montar({ pools: poolsC, funcionarios: equipe(8), c: 3, apontamentos: apts() });
    const f = fatoresDeDesempenho(m.entrada, m.dados.apontamentos, m.dados.agoraMs, [par]);
    const entrada = embutirFatores(m.entrada, f);
    const r = planejarComFluxo(entrada, m.dados, { paresLegado: [par], fatoresEmbutidos: f });
    expect(checarFluxo({ r, entrada })).toEqual([]);
    expect(r.diagnostico.estado.poolsFundidos).toHaveLength(2);
    // linhas do plano trazem peças já × f (o motor enxerga a meta efetiva): nenhuma linha acima da meta efetiva
    const meta = (p: string, e: string, per: string) => entrada.pools.find((x) => x.produtoId === p && x.etapaId === e)!.metas[per];
    if (r.diagnostico.planoEscolhido !== "vigente") expect(r.resultado.alocacoes.filter((a) => a.maquinaId && a.pecas > 0).every((a) => a.pecas <= meta(a.produtoId as string, a.etapaId as string, a.periodoId) + 1e-6)).toBe(true);
    else expect(r.resultado.alocacoes.map((a) => a.pecas)).toEqual(m.dados.planoVigente.filter((a) => (m.entrada.slots.findIndex((s) => s.data === a.data && s.periodoId === a.periodoId)) >= entrada.aPartirDe).map((a) => a.pecas)); // vigente mantido: peças gravadas intactas
    // avaliar o MESMO plano com f embutido na entrada e peças gravadas nominais ou × f dá o mesmo resultado (a avaliação usa as metas, não as peças)
    const gravadoNominal = m.dados.planoVigente.map((a) => ({ ...a }));
    const gravadoComF = m.dados.planoVigente.map((a) => ({ ...a, pecas: a.pecas * (f[`${a.produtoId}|${a.etapaId}`] ?? 1) }));
    const a1 = avaliarPlano(entrada, m.dados, gravadoNominal, { fatoresEmbutidos: f, paresLegado: [par] });
    const a2 = avaliarPlano(entrada, m.dados, gravadoComF, { fatoresEmbutidos: f, paresLegado: [par] });
    expect(a2.totais.faltaFinalLo).toBeCloseTo(a1.totais.faltaFinalLo, 6);
    // f menor ⇒ capacidade menor ⇒ falta prevista do mesmo plano MAIOR que com metas nominais
    const nominal = avaliarPlano(m.entrada, m.dados, gravadoNominal, { paresLegado: [par] });
    expect(a1.totais.faltaFinalLo).toBeGreaterThan(nominal.totais.faltaFinalLo);
  });
});

describe("apontamento sem meta ou sem produção não vira f", () => {
  it("linhas sem_producao e meta 0 não contam amostra", () => {
    const m = montar({ pools: poolsC, funcionarios: equipe(8), c: 3 });
    const base = apontarPlano(m.planoCompleto, poolsC, 3, m.entrada.slots, () => null);
    expect(fatoresDeDesempenho(m.entrada, base, m.dados.agoraMs + 60 * 60_000)).toEqual({});
    const s = m.entrada.slots[1];
    const zero = [1, 2, 3, 4].map(() => ap({ data: s.data, periodoId: s.periodoId, maquinaId: "r1", produtoId: "CONV", etapaId: "C-ros", boas: 100, meta: 0, lancadoEmMs: 1 }));
    expect(fatoresDeDesempenho(m.entrada, zero, m.dados.agoraMs)).toEqual({});
  });
});
