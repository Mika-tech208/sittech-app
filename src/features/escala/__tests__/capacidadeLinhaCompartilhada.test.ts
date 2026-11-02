// A1 (revisão independente 02/11): a capacidade de UMA máquina física compartilhada não pode ser creditada por inteiro a cada produto na projeção do período em andamento
// (antes: máquina de 400, linha 200+100 ⇒ Conv 400 e Aut 400 ⇒ WIP "lo" superestimado ⇒ risco de downstream sem material).
import { describe, it, expect } from "vitest";
import { montarProblemaCorte } from "../fluxo/planoCorte";
import { capacidadeDaLinha } from "../fluxo/avaliar";
import { prepararFluxo } from "../fluxo/estado";
import { expandirPorProduto } from "../distribuicao";
import { chavePool, type AlocacaoEscala } from "../types";
import { entrada, equipe, pool } from "./helpers";

const DIA = "2026-10-19";
const conv = pool({ produto: "pConv", etapa: "eConvEtiq", op: "opEtiq", q: 1000, maquinas: ["mqEtiq"], mu: 400 });
const aut = pool({ produto: "pAut", etapa: "eAutEtiq", op: "opEtiq", q: 600, maquinas: ["mqEtiq"], mu: 400 });
const base = { data: DIA, funcionarioId: "f01", maquinaId: "mqEtiq", operacaoId: "opEtiq", pecasAdicional: 0, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null } as const;
const linha = (dist: boolean): AlocacaoEscala => ({ ...base, periodoId: "m1", produtoId: "pConv", etapaId: "eConvEtiq", pecas: 300, ...(dist ? { distribuicao: [{ produtoId: "pConv", etapaId: "eConvEtiq", pecas: 200 }, { produtoId: "pAut", etapaId: "eAutEtiq", pecas: 100 }] } : {}) });

function caps(dist: boolean) {
  const e = entrada({ pools: [conv, aut], funcionarios: equipe(2), aPartirDe: 1, congeladas: [linha(dist)] }, [DIA]);
  const agora = e.slots[0].inicioMs + 10 * 60_000; // M1 em andamento, nada apontado
  const m = montarProblemaCorte(e, { apontamentos: [], agoraMs: agora, planoVigente: [linha(dist)] }, { fluxoMesmoPeriodo: false }, {}, [linha(dist)]);
  const no = (pid: string, eid: string) => m.ctx.grafo.noDoPool[chavePool(pid, eid)];
  return { conv: m.ctx.capsFixas[no("pConv", "eConvEtiq")].base[0], aut: m.ctx.capsFixas[no("pAut", "eAutEtiq")].base[0] };
}

describe("capacidade de linha compartilhada no período em andamento (A1)", () => {
  it("com distribuição 200+100 numa máquina de 400: Conv ≤ 200, Aut ≤ 100 e a soma ≤ 400 (antes: 400 + 400)", () => {
    const c = caps(true);
    expect(c.conv).toBeLessThanOrEqual(200 + 1e-9);
    expect(c.aut).toBeLessThanOrEqual(100 + 1e-9);
    expect(c.conv + c.aut).toBeLessThanOrEqual(400);
    expect(c.conv).toBeGreaterThan(0);
    expect(c.aut).toBeGreaterThan(0);
  });
  it("SEM distribuição o comportamento é o anterior: a meta cheia do pool (400) é creditada ao produto da linha (identidade)", () => {
    const c = caps(false);
    expect(c.conv).toBe(400);
    expect(c.aut).toBe(0);
  });
  it("capacidadeDaLinha (avaliar.ts) segue a mesma regra nas linhas expandidas e é idêntica nas demais", () => {
    const e = entrada({ pools: [conv, aut], funcionarios: equipe(2), aPartirDe: 1, congeladas: [] }, [DIA]);
    const ctx = prepararFluxo(e, { apontamentos: [], agoraMs: e.slots[0].inicioMs, planoVigente: [] }, { fluxoMesmoPeriodo: false });
    const [c1, c2] = expandirPorProduto([linha(true)]).map((l) => capacidadeDaLinha(ctx, l)!.valor);
    expect(c1 + c2).toBeLessThanOrEqual(400);
    expect(capacidadeDaLinha(ctx, linha(false))!.valor).toBe(400);
  });
});
