import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import { chavePool, type AlocacaoEscala, type EntradaEscala, type PoolEscala, type ResultadoEscala } from "../types";
import { cenariosGolden } from "./cenariosGolden";
import { checarInvariantes, entrada, equipe, pool } from "./helpers";

const D1 = "2026-10-19";

// postos do PREVISTO de um resultado, por período: (máquina, produto, etapa, peças) — sem olhar quem os ocupa
function postosPrevistos(r: ResultadoEscala): Map<string, string[]> {
  const m = new Map<string, string[]>();
  r.alocacoes.forEach((a) => {
    if (!a.maquinaId || (a.pecasAdicional ?? 0) > 0) return;
    const k = `${a.data}|${a.periodoId}`;
    m.set(k, [...(m.get(k) ?? []), `${a.maquinaId}|${a.produtoId}|${a.etapaId}|${a.pecas}`]);
  });
  m.forEach((v, k) => m.set(k, v.sort()));
  return m;
}

function somaPor(r: ResultadoEscala, campo: "pecas" | "pecasAdicional"): Map<string, number> {
  const m = new Map<string, number>();
  r.alocacoes.forEach((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId) return;
    const k = chavePool(a.produtoId, a.etapaId);
    m.set(k, (m.get(k) ?? 0) + (campo === "pecas" ? a.pecas : a.pecasAdicional ?? 0));
  });
  return m;
}

function comAdicional(e: EntradaEscala, adicional: (p: PoolEscala, i: number) => number): EntradaEscala {
  return { ...e, pools: e.pools.map((p, i) => ({ ...p, adicionalMax: adicional(p, i) })) };
}

// Garantias que valem para QUALQUER cenário com adicional (comparadas com o mesmo cenário sem adicional)
function conferirInvariantes(base: EntradaEscala, adic: EntradaEscala): string[] {
  const erros: string[] = [];
  const r0 = gerarEscala(base);
  const r1 = gerarEscala(adic);

  erros.push(...checarInvariantes(adic, r1).map((x) => `invariante: ${x}`));

  // 1) o previsto NÃO é deslocado: mesmos postos (máquina/produto/etapa/peças) em todo período
  const p0 = postosPrevistos(r0);
  const p1 = postosPrevistos(r1);
  if (JSON.stringify([...p0.entries()].sort()) !== JSON.stringify([...p1.entries()].sort())) erros.push("postos do previsto mudaram");

  // 2) crédito do previsto e demanda não atendida preservados
  if (JSON.stringify([...somaPor(r0, "pecas").entries()].sort()) !== JSON.stringify([...somaPor(r1, "pecas").entries()].sort())) erros.push("crédito do previsto mudou");
  if (JSON.stringify(r0.pecasRestantes) !== JSON.stringify(r1.pecasRestantes)) erros.push("peças restantes do previsto mudaram");
  const gargalos = (r: ResultadoEscala) => JSON.stringify(r.alertas.filter((a) => a.tipo === "gargalo_sem_operador" || a.tipo === "demanda_nao_atendida"));
  if (gargalos(r0) !== gargalos(r1)) erros.push("alertas de gargalo/demanda do previsto mudaram");

  // 3) o adicional só ocupa quem ficaria sem posto: nº de pessoas no previsto igual; sem posto só diminui
  const porSlot = (r: ResultadoEscala) => {
    const m = new Map<string, { prev: number; adic: number; ocio: number }>();
    r.alocacoes.forEach((a) => {
      const k = `${a.data}|${a.periodoId}`;
      const x = m.get(k) ?? { prev: 0, adic: 0, ocio: 0 };
      if (!a.maquinaId) x.ocio++;
      else if ((a.pecasAdicional ?? 0) > 0) x.adic++;
      else x.prev++;
      m.set(k, x);
    });
    return m;
  };
  const s0 = porSlot(r0);
  const s1 = porSlot(r1);
  s0.forEach((x0, k) => {
    const x1 = s1.get(k)!;
    if (x1.prev !== x0.prev) erros.push(`pessoas no previsto mudaram em ${k}`);
    if (x1.prev + x1.adic + x1.ocio !== x0.prev + x0.ocio) erros.push(`total de pessoas mudou em ${k}`);
    if (x1.ocio > x0.ocio) erros.push(`ociosidade aumentou em ${k}`);
    if (x1.adic !== x0.ocio - x1.ocio) erros.push(`adicional não ocupou exatamente quem estava ocioso em ${k}`);
  });

  // 4) adicional só em máquina livre (nenhuma máquina usada pelo previsto) — a unicidade já é checada em checarInvariantes
  // 5) nunca acima do teto por pool
  const teto = new Map(adic.pools.map((p) => [chavePool(p.produtoId, p.etapaId), p.adicionalMax ?? 0]));
  somaPor(r1, "pecasAdicional").forEach((v, k) => {
    if (v > (teto.get(k) ?? 0) + 1e-6) erros.push(`adicional acima do teto em ${k}: ${v} > ${teto.get(k)}`);
  });
  r1.alocacoes.forEach((a) => {
    if ((a.pecasAdicional ?? 0) > 0 && a.pecas !== 0) erros.push("posto de adicional com crédito de previsto");
    if (!a.maquinaId && (a.pecasAdicional ?? 0) !== 0) erros.push("sem posto com adicional");
  });
  return erros;
}

describe("carga adicional — o previsto nunca é deslocado", () => {
  it("semanas reais (14/16/18 pessoas) com adicional ilimitado: previsto idêntico, adicional só ocupa ociosos", () => {
    const reais = cenariosGolden().filter((c) => c.nome.startsWith("real ") && !/ausências|recursos|histórico/.test(c.nome));
    expect(reais.length).toBe(15);
    reais.forEach((c) => {
      const erros = conferirInvariantes(c.entrada, comAdicional(c.entrada, () => 1_000_000));
      expect(erros).toEqual([]);
    });
  });

  it("cenários com ausências, recursos indisponíveis e prefixo congelado também preservam o previsto", () => {
    cenariosGolden()
      .filter((c) => /ausências|recursos|congelado|sintético/.test(c.nome))
      .forEach((c) => {
        const erros = conferirInvariantes(c.entrada, comAdicional(c.entrada, () => 50_000));
        expect(erros).toEqual([]);
      });
  });

  it("o adicional realmente absorve ociosidade quando há máquina livre e carga permitida", () => {
    // 4 pessoas, 2 produtos: previsto esgota cedo e as máquinas ficam livres
    const base = entrada({ funcionarios: equipe(4), pools: [pool({ produto: "pA", op: "opA", q: 300, maquinas: ["mA"] }), pool({ produto: "pB", op: "opB", q: 300, maquinas: ["mB"] })] });
    const r0 = gerarEscala(base);
    const ocio0 = r0.alocacoes.filter((a) => !a.maquinaId).length;
    expect(ocio0).toBeGreaterThan(0);
    const adic = comAdicional(base, () => 100_000);
    const r1 = gerarEscala(adic);
    expect(r1.alocacoes.filter((a) => !a.maquinaId).length).toBeLessThan(ocio0);
    expect(Object.keys(r1.adicionalProduzido).length).toBeGreaterThan(0);
  });

  it("teto por pool é respeitado exatamente (250 peças => 250, em lotes parciais)", () => {
    const base = entrada({ funcionarios: equipe(3), pools: [pool({ produto: "pA", op: "opA", q: 100, maquinas: ["mA"], mu: 100 })] });
    const r = gerarEscala(comAdicional(base, () => 250));
    expect(r.adicionalProduzido["pA|pA-e1"]).toBeCloseTo(250, 9);
    const adic = r.alocacoes.filter((a) => (a.pecasAdicional ?? 0) > 0).map((a) => a.pecasAdicional);
    expect(adic.sort((a, b) => (b as number) - (a as number))).toEqual([100, 100, 50]);
  });

  it("o adicional nunca usa máquina fora da Previsão nem ocupa a mesma máquina do previsto no período", () => {
    const base = entrada({
      funcionarios: equipe(5),
      pools: [pool({ produto: "pA", op: "opA", q: 100000, maquinas: ["m1", "m2"] }), pool({ produto: "pB", op: "opB", q: 200, maquinas: ["m3"] })],
    });
    const adic = comAdicional(base, () => 100_000);
    const r = gerarEscala(adic);
    r.alocacoes.filter((a) => a.maquinaId).forEach((a) => expect(["m1", "m2", "m3"]).toContain(a.maquinaId));
    expect(checarInvariantes(adic, r)).toEqual([]); // inclui "máquina com 2 operadores"
  });

  it("prioridade do adicional: maior valor primeiro (depois continuidade/ordem)", () => {
    const base = entrada({
      funcionarios: equipe(1),
      pools: [pool({ produto: "pBarato", op: "opA", q: 100, maquinas: ["mA"], valor: 1 }), pool({ produto: "pCaro", op: "opB", q: 100, maquinas: ["mB"], valor: 50 })],
    });
    // previsto esgota no 1º período; no resto, a única pessoa ociosa vai para o adicional de MAIOR valor
    const r = gerarEscala(comAdicional(base, () => 100_000));
    const adic = r.alocacoes.filter((a) => (a.pecasAdicional ?? 0) > 0);
    expect(adic.length).toBeGreaterThan(0);
    expect(adic[0].produtoId).toBe("pCaro");
  });

  it("determinístico e independente da ordem dos arrays", () => {
    const e = comAdicional(cenariosGolden().find((c) => c.nome === "real 2026-10-19 N=16")!.entrada, () => 40_000);
    const inv = { ...e, funcionarios: [...e.funcionarios].reverse(), pools: [...e.pools].reverse() };
    expect(JSON.stringify(gerarEscala(e).alocacoes)).toBe(JSON.stringify(gerarEscala(e).alocacoes));
    expect(JSON.stringify(gerarEscala(e).alocacoes)).toBe(JSON.stringify(gerarEscala(inv).alocacoes));
  });

  it("regerar a partir de um prefixo congelado (com linhas de adicional) reproduz exatamente o sufixo", () => {
    const e = comAdicional(cenariosGolden().find((c) => c.nome === "real 2026-10-05 N=18")!.entrada, () => 30_000);
    const cheio = gerarEscala(e);
    [7, 13, 22].forEach((corte) => {
      const congeladas = cheio.alocacoes.filter((a) => (e.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? 0) < corte) as AlocacaoEscala[];
      const parcial = gerarEscala({ ...e, aPartirDe: corte, congeladas });
      const sufixo = cheio.alocacoes.filter((a) => (e.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? 0) >= corte);
      expect(JSON.stringify(parcial.alocacoes)).toBe(JSON.stringify(sufixo));
    });
  });
});

describe("carga adicional — 100 cenários aleatórios", () => {
  it("previsto preservado, adicional só em ociosos, tetos respeitados", () => {
    let seed = 777;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const falhas: string[] = [];
    for (let i = 0; i < 100; i++) {
      const nPools = 2 + Math.floor(rnd() * 6);
      const pools = Array.from({ length: nPools }, (_, k) =>
        pool({
          produto: `p${k}`,
          op: `op${Math.floor(rnd() * 4)}`,
          q: Math.round((100 + rnd() * 3000) / 50) * 50,
          maquinas: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => `m${Math.floor(rnd() * 8)}`),
          mu: 50 + Math.floor(rnd() * 100),
          valor: 1 + Math.floor(rnd() * 20),
        })
      );
      const funcs = equipe(2 + Math.floor(rnd() * 12));
      const dias = rnd() < 0.5 ? [D1] : [D1, "2026-10-20"];
      const base = entrada({ funcionarios: funcs, pools, ausencias: rnd() < 0.5 ? [{ funcionarioId: funcs[0].id, data: D1, inicioMin: null, fimMin: null }] : [] }, dias);
      const adic = comAdicional(base, () => (rnd() < 0.3 ? 0 : Math.round(rnd() * 5000)));
      const erros = conferirInvariantes(base, adic);
      if (erros.length) falhas.push(`cenário ${i}: ${erros.slice(0, 2).join("; ")}`);
    }
    expect(falhas).toEqual([]);
  });
});
