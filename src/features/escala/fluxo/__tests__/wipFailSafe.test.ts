// FAIL-SAFE de estoque inicial DESCONHECIDO, modo piso (docs/escala-fluxo-contagem-fisica.md §1.1). Contagem física: contagemFisica.test.ts.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../../gerarEscala";
import { estadoDaProducao } from "../estado";
import { avaliarPlano } from "../avaliar";
import { planejarComFluxo } from "../planejar";
import { apontarPlano, checarFluxo, equipe, montar, pool, jsonSerializavel } from "./helpersFluxo";

const dois = () => [
  pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 6000, maquinas: ["a1"], mu: 500 }),
  pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 6000, maquinas: ["b1", "b2", "b3"], mu: 200 }),
];
// P1 produziu pouco, P2 (a jusante) produziu MAIS do que P1 entregou ⇒ saldo bruto negativo = estoque inicial desconhecido
const apontarNegativo = (m: ReturnType<typeof montar>, pools: ReturnType<typeof dois>) =>
  apontarPlano(m.planoCompleto, pools, 1, m.entrada.slots, (a) => (a.etapaId === "P1" ? 100 : 200));

function cenario(opcoes = {}, extraDados: Record<string, unknown> = {}) {
  const pools = dois();
  const funcionarios = equipe(4);
  const m0 = montar({ pools, funcionarios, c: 1 });
  const apontamentos = apontarNegativo(m0, pools);
  const m = montar({ pools, funcionarios, c: 1, apontamentos });
  return { pools, m, dados: { ...m.dados, ...extraDados }, opcoes };
}
const par = (e: ReturnType<typeof estadoDaProducao>) => e.pares.find((p) => p.etapaOrigemId === "P1")!;

describe("fail-safe: par sem saldo confirmado, confiança baixa e bruto.lo < 0", () => {
  it("marca o par como desconhecido, com diagnóstico WIP_INICIAL_DESCONHECIDO (aviso, par, bruto e motivo)", () => {
    const { m, dados } = cenario();
    const e = estadoDaProducao(m.entrada, dados);
    const p = par(e);
    expect(p.bruto.lo).toBeLessThan(0);
    expect(p.confianca).toBe("baixa");
    expect(p.desconhecido).toBe(true);
    expect(p.wip.lo).toBe(0); // o piso 0 continua sendo o WIP derivado; o que muda é o que ele significa
    const d = e.diagnosticos.find((x) => x.codigo === "WIP_INICIAL_DESCONHECIDO")!;
    expect(d.severidade).toBe("aviso");
    expect(d.produtoId).toBe("P");
    expect(d.detalhes?.brutoLo).toBe(p.bruto.lo);
    expect(String(d.detalhes?.motivo)).toContain("bruto.lo < 0");
  });
  it("com failSafeWipDesconhecido=false não marca nada (comportamento anterior)", () => {
    const { m, dados } = cenario();
    const e = estadoDaProducao(m.entrada, dados, { failSafeWipDesconhecido: false });
    expect(par(e).desconhecido).toBeUndefined();
    expect(e.diagnosticos.some((x) => x.codigo === "WIP_INICIAL_DESCONHECIDO")).toBe(false);
  });
  it("PISO: os postos do elo seguinte que o plano BASE usa por período são mantidos (o WIP 0 derivado não retira o downstream); o plano nunca fica pior que o base/vigente", () => {
    const { m, dados } = cenario();
    const base = gerarEscala(m.entrada).alocacoes;
    const fut = (l: typeof base) => l.filter((a) => (m.entrada.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? -1) >= m.entrada.aPartirDe);
    const por = (l: typeof base) => { const o = new Map<string, number>(); fut(l).filter((a) => a.maquinaId && a.etapaId === "P2").forEach((a) => o.set(a.periodoId + a.data, (o.get(a.periodoId + a.data) ?? 0) + 1)); return o; };
    const r = planejarComFluxo(m.entrada, dados, {});
    const pb = por(base), pf = por(r.resultado.alocacoes);
    pb.forEach((n, k) => expect(pf.get(k) ?? 0).toBeGreaterThanOrEqual(n));
    expect(checarFluxo({ r, entrada: m.entrada })).toEqual([]);
    expect(jsonSerializavel(r.diagnostico)).toBe(true);
  });
  it("a física do simulador NÃO muda: avaliarPlano com e sem fail-safe dá o mesmo resultado", () => {
    const { m, dados } = cenario();
    const base = [...m.entrada.congeladas, ...gerarEscala(m.entrada).alocacoes];
    expect(JSON.stringify(avaliarPlano(m.entrada, dados, base, {}).totais)).toBe(JSON.stringify(avaliarPlano(m.entrada, dados, base, { failSafeWipDesconhecido: false }).totais));
  });
  it("failSafeWipDesconhecido=false: nenhum par é marcado e não há diagnóstico do fail-safe (comportamento anterior); ligado, só o par marcado é afetado", () => {
    const { m, dados } = cenario();
    const off = planejarComFluxo(m.entrada, dados, { failSafeWipDesconhecido: false });
    const on = planejarComFluxo(m.entrada, dados, {});
    expect(off.diagnostico.estado.pares.some((p) => p.desconhecido)).toBe(false);
    expect(off.diagnostico.diagnosticos.some((x) => x.codigo === "WIP_INICIAL_DESCONHECIDO")).toBe(false);
    expect(on.diagnostico.estado.pares.filter((p) => p.desconhecido)).toHaveLength(1);
  });
  it("o teto de utilidade do UPSTREAM segue o mesmo de antes (Allowed_k inalterado pelo fail-safe)", () => {
    const { m, dados } = cenario();
    const on = estadoDaProducao(m.entrada, dados).demanda.find((d) => d.etapaId === "P1")!;
    const off = estadoDaProducao(m.entrada, dados, { failSafeWipDesconhecido: false }).demanda.find((d) => d.etapaId === "P1")!;
    expect(on.tetoUtilidade).toBe(off.tetoUtilidade);
    expect(on.demandaFluxo).toBe(off.demandaFluxo);
  });
  it("par com bruto positivo e confiança média (tipo Caixa Amarela) NÃO muda", () => {
    const pools = dois();
    const m0 = montar({ pools, funcionarios: equipe(4), c: 1 });
    const ok = apontarPlano(m0.planoCompleto, pools, 1, m0.entrada.slots, (a) => (a.etapaId === "P1" ? 400 : 100));
    const m = montar({ pools, funcionarios: equipe(4), c: 1, apontamentos: ok });
    const a = estadoDaProducao(m.entrada, m.dados);
    const b = estadoDaProducao(m.entrada, m.dados, { failSafeWipDesconhecido: false });
    expect(par(a).bruto.lo).toBeGreaterThan(0);
    expect(par(a).confianca).toBe("media");
    expect(par(a).desconhecido).toBeUndefined();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const ra = planejarComFluxo(m.entrada, m.dados, {});
    const rb = planejarComFluxo(m.entrada, m.dados, { failSafeWipDesconhecido: false });
    expect(JSON.stringify(ra.resultado.alocacoes)).toBe(JSON.stringify(rb.resultado.alocacoes));
  });
  it("determinismo: duas execuções dão o mesmo JSON", () => {
    const { m, dados } = cenario();
    expect(JSON.stringify(planejarComFluxo(m.entrada, dados, {}))).toBe(JSON.stringify(planejarComFluxo(m.entrada, dados, {})));
  });
});
