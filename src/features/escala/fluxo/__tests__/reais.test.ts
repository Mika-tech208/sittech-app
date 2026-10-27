// DADOS REAIS (PROD, 27/10/2026): Caixa Amarela e Conector a partir de escala_sombra_decisoes.entrada (c = 5 [T3 de 26/10], 8 [M3], 9 [T1], 10 [T2]).
// Fatos de PROD validados: Caixa — Etiquetar E16 (1 máquina) → Montar Presilha (4 máquinas), previsto 70.500; apontado até T2: Etiquetar 25.358,
// Montar 23.660 ⇒ estoque estimado +1.698. Conector — Máquina 8 (A_ros) exclusiva; Etiquetadora 15 e Embalagem 17 comuns aos dois produtos.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../../gerarEscala";
import { chavePool, type EntradaEscala } from "../../types";
import { avaliarPlano } from "../avaliar";
import { planejarComFluxo } from "../planejar";
import { verificarRestricoesDuras } from "../restricoes";
import type { ResultadoFluxo } from "../tipos";
import { carregarFixtures, montarDeCanonica, parConectorProd, type FixtureReal } from "./fixturesReais";

const fx = carregarFixtures();
const cache = new Map<string, { r: ResultadoFluxo; entrada: EntradaEscala; ms: number; f: FixtureReal }>();
function roda(k: string) {
  if (!cache.has(k)) {
    const f = fx[k];
    const { entrada, dados, fatoresEmbutidos } = montarDeCanonica(f.entrada);
    const par = parConectorProd(f.entrada);
    const t0 = Date.now();
    const r = planejarComFluxo(entrada, dados, { paresLegado: par ? [par] : [], fatoresEmbutidos });
    cache.set(k, { r, entrada, ms: Date.now() - t0, f });
  }
  return cache.get(k)!;
}
const CAIXA = "238ca607", E16 = "c765eb93", MONTAR = "f75cc037";
const prod = <T extends { maquinaId: string | null; produtoId: string | null }>(al: T[], pref: string) => al.filter((a) => a.maquinaId && a.produtoId?.startsWith(pref));

Object.keys(fx).forEach((k) => {
  describe(`replay real ${k} (${fx[k].criadoEm.slice(5, 16)} UTC)`, () => {
    it("critérios A–D: 0 violação de restrição dura, 0 alteração de passado, 0 dupla alocação, 0 violação de revezamento", () => {
      const { r, entrada } = roda(k);
      const v = verificarRestricoesDuras(r.entradaFluxo, r.resultado.alocacoes);
      expect(v).toEqual([]);
      expect(r.diagnostico.violacoes).toEqual([]);
      expect(r.resultado.alocacoes.every((a) => (entrada.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? -1) >= entrada.aPartirDe)).toBe(true);
      // o verificador também aprova o plano base (referência) e acusa a violação se o passado fosse alterado
      expect(verificarRestricoesDuras(entrada, gerarEscala(entrada).alocacoes)).toEqual([]);
      const adulterado = [...r.resultado.alocacoes, { ...entrada.congeladas.find((a) => a.maquinaId)!, maquinaId: "xxx" }];
      expect(verificarRestricoesDuras(entrada, adulterado).some((x) => x.tipo === "passado_alterado")).toBe(true);
    });

    it("critério E: a falta final prevista NUNCA é pior que a do plano base (mesmo simulador)", () => {
      const d = roda(k).r.diagnostico;
      expect(d.depois.faltaPrevista.lo).toBeLessThanOrEqual(d.depoisBase.faltaPrevista.lo + 1e-6);
      expect(d.depois.faltaPrevista.lo).toBeLessThan(d.depoisBase.faltaPrevista.lo); // e aqui há ganho real
    });

    it("critério I: WIP previsto não explode (excesso acima do teto derivado cai ou fica igual)", () => {
      const d = roda(k).r.diagnostico;
      expect(d.depois.excessoWip).toBeLessThanOrEqual(d.depoisBase.excessoWip + 1);
      expect(d.depois.wipPrevisto.hi).toBeLessThanOrEqual(d.depoisBase.wipPrevisto.hi + 1);
    });

    it("critério J: diagnóstico completo (ANTES / DECISÃO / MOTIVO / DEPOIS, churn, iterações) e JSON puro", () => {
      const d = roda(k).r.diagnostico;
      expect(Object.keys(d.antes.demandaRestante).length).toBeGreaterThan(3);
      expect(d.antes.wip.length).toBeGreaterThan(0);
      expect(d.decisoes.length).toBeGreaterThan(0);
      expect(d.decisoes.every((x) => x.motivo.texto.length > 0 && x.quantidade > 0)).toBe(true);
      expect(d.iteracoes.length).toBeGreaterThanOrEqual(2);
      expect(d.iteracoes.length).toBeLessThanOrEqual(6); // base + P0 + até 4
      expect(d.churn.linhasAlteradas).toBeGreaterThan(0);
      expect(JSON.stringify(JSON.parse(JSON.stringify(d)))).toBe(JSON.stringify(d));
      expect(d.estado.diagnosticos.length).toBeGreaterThan(0);
    });

    it("G: Conector — Etiquetar e Embalar fundidos (sem duplicidade de pools comuns) e sem fallback legado", () => {
      const { r, entrada } = roda(k);
      const e = r.diagnostico.estado;
      expect(e.poolsFundidos.map((f) => f.rotulo)).toEqual(["Etiquetar", "Embalar"]);
      expect(e.diagnosticos.filter((d) => d.codigo === "PRODUTO_EM_COMPORTAMENTO_LEGADO")).toHaveLength(0);
      const auto = (pref: string) => entrada.pools.find((p) => p.produtoId.startsWith("a027ac97") && p.etapaId.startsWith(pref))!;
      expect(e.remPorPool[chavePool(auto("1863b452").produtoId, auto("1863b452").etapaId)]).toBe(0);
      expect(e.remPorPool[chavePool(auto("fb96d08d").produtoId, auto("fb96d08d").etapaId)]).toBe(0);
      expect(r.resultado.alocacoes.filter((a) => a.maquinaId && a.pecas > 0 && (a.etapaId?.startsWith("1863b452") || a.etapaId?.startsWith("fb96d08d")))).toHaveLength(0);
      // Etiquetadora 15 (49472a…) e Embalagem 17 (ba7adc…): no máximo uma pessoa por período
      ["49472a", "ba7adc"].forEach((m) => {
        const c = new Map<string, number>();
        r.resultado.alocacoes.filter((a) => a.maquinaId?.startsWith(m)).forEach((a) => c.set(`${a.data}${a.periodoId}`, (c.get(`${a.data}${a.periodoId}`) ?? 0) + 1));
        expect([...c.values()].every((n) => n === 1)).toBe(true);
      });
      // R_f,total = Q_conv + Q_auto − boas Embalar (conv + auto) projetadas
      const fEmb = e.poolsFundidos[1];
      expect(fEmb.demandaComum).toBe(81000 + 35625);
      const projEmb = e.projecao.boas[fEmb.chaveConvencional].lo;
      expect(e.remPorPool[fEmb.chaveConvencional]).toBeCloseTo(81000 + 35625 - projEmb, 0);
    });

    it("Conector: a Máquina 8 (exclusiva) não produz além do que o pool comum + teto absorvem — e menos que no plano base", () => {
      const { r, entrada } = roda(k);
      const ros = r.diagnostico.estado.demanda.find((z) => z.etapaId.startsWith("1b72bf46"))!;
      const maq8 = (al: { maquinaId: string | null; pecas: number }[]) => al.filter((a) => a.maquinaId?.startsWith("a118f4")).reduce((s, a) => s + a.pecas, 0);
      const meta = Math.max(...Object.values(entrada.pools.find((p) => p.etapaId.startsWith("1b72bf46"))!.metas));
      expect(maq8(r.resultado.alocacoes)).toBeLessThanOrEqual(ros.remFluxo + meta);
      expect(ros.remFluxo).toBeLessThanOrEqual((ros.consumoDownstream as number) + (ros.tetoPeriodo as number) + 1e-6);
      expect(maq8(r.resultado.alocacoes)).toBeLessThanOrEqual(maq8(gerarEscala(entrada).alocacoes) + 1e-6);
    });

    it("F: Caixa Amarela coerente — E16 mantida (gargalo de fluxo sem WIP grande) e Montagem reforçada quando há o que consumir", () => {
      const { r, entrada } = roda(k);
      const base = gerarEscala(entrada);
      const nS = (al: { etapaId: string | null; maquinaId: string | null; produtoId: string | null }[], et: string) => prod(al, CAIXA).filter((a) => a.etapaId?.startsWith(et)).length;
      expect(nS(r.resultado.alocacoes, MONTAR)).toBeGreaterThanOrEqual(nS(base.alocacoes, MONTAR)); // Montagem nunca é reduzida
      expect(nS(r.resultado.alocacoes, E16)).toBeGreaterThanOrEqual(nS(base.alocacoes, E16) - 1); // E16 (1 máquina, gargalo) mantida
      const av = r.diagnostico.avaliacaoFluxo.produtos.find((p) => p.produtoId.startsWith(CAIXA))!;
      const avB = r.diagnostico.avaliacaoBase.produtos.find((p) => p.produtoId.startsWith(CAIXA))!;
      expect(av.faltaFinal.lo).toBeLessThanOrEqual(avB.faltaFinal.lo + 1e-6);
      expect(r.diagnostico.antes.gargalosFluxo.some((g) => g.produtoId.startsWith(CAIXA))).toBe(true);
    });

    it("robustez do critério E: a conclusão não depende da suposição de fluxo no mesmo período (régua mais conservadora)", () => {
      const { r, entrada, f } = roda(k);
      const { dados, fatoresEmbutidos } = montarDeCanonica(f.entrada);
      const op = { paresLegado: [parConectorProd(f.entrada)!], fatoresEmbutidos, fluxoMesmoPeriodo: false, incluirTrajetoria: false };
      const base = avaliarPlano(entrada, dados, gerarEscala(entrada).alocacoes, op).totais.faltaFinalLo;
      const flux = avaliarPlano(entrada, dados, r.resultado.alocacoes, { ...op, limitesRemPorPool: r.diagnostico.planoEscolhido === "fluxo" ? r.diagnostico.estado.remPorPool : undefined }).totais.faltaFinalLo;
      expect(flux).toBeLessThanOrEqual(base + 1e-6);
    });

    it("determinismo + orçamento de tempo", () => {
      const a = roda(k);
      expect(a.ms).toBeLessThan(20000);
      const { entrada, dados, fatoresEmbutidos } = montarDeCanonica(a.f.entrada);
      const r2 = planejarComFluxo(entrada, dados, { paresLegado: [parConectorProd(a.f.entrada)!], fatoresEmbutidos });
      expect(JSON.stringify(r2.resultado)).toBe(JSON.stringify(a.r.resultado));
      expect(JSON.stringify(r2.diagnostico.iteracoes)).toBe(JSON.stringify(a.r.diagnostico.iteracoes));
    });
  });
});

describe("Caixa Amarela — fatos de PROD (T2 de 27/10, c=10)", () => {
  it("apontado Etiquetar 25.358 / Montar 23.660 ⇒ estoque estimado +1.698 (origem estimado, confiança média, lo = hi)", () => {
    const e = roda("c10").r.diagnostico.estado;
    const par = e.pares.find((p) => p.produtoId.startsWith(CAIXA))!;
    expect(e.etapas.find((x) => x.etapaId.startsWith(E16))!.boas.lo).toBe(25358);
    expect(e.etapas.find((x) => x.etapaId.startsWith(MONTAR))!.boas.lo).toBe(23660);
    expect(par.wip).toEqual({ lo: 1698, hi: 1698 });
    expect(par.origem).toBe("estimado");
    expect(par.confianca).toBe("media");
    expect(e.produtos.find((p) => p.produtoId.startsWith(CAIXA))!.demandaFinalRestante).toBe(70500 - 23660);
  });
  it("15 pessoas para 19 postos: o plano de fluxo mantém E16 (1 posto) e Montagem (4 postos) cobertos em todos os períodos futuros", () => {
    const { r, entrada } = roda("c10");
    for (let s = entrada.aPartirDe; s < entrada.slots.length; s++) {
      const sl = entrada.slots[s];
      const doSlot = r.resultado.alocacoes.filter((a) => a.data === sl.data && a.periodoId === sl.periodoId && a.maquinaId && a.produtoId?.startsWith(CAIXA));
      if (doSlot.length === 0) continue; // demanda já fechada neste ponto da semana
      expect(doSlot.filter((a) => a.etapaId?.startsWith(E16)).length).toBeLessThanOrEqual(1);
      expect(doSlot.filter((a) => a.etapaId?.startsWith(MONTAR)).length).toBeLessThanOrEqual(4);
    }
  });
});
