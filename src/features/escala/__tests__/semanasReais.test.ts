import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import { checarInvariantes, entrada, equipe } from "./helpers";
import type { PoolEscala } from "../types";
import fixture from "../__fixtures__/semanas_reais.json";

const DIAS = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
const semanas = fixture.semanas as { semanaInicio: string; pools: PoolEscala[] }[];

function rodar(pools: PoolEscala[], n: number) {
  const e = entrada({ pools, funcionarios: equipe(n) }, DIAS);
  const t0 = Date.now();
  const r = gerarEscala(e);
  const ms = Date.now() - t0;
  const total = r.alocacoes.length;
  const comPosto = r.alocacoes.filter((a) => a.maquinaId).length;
  const demanda = pools.reduce((s, p) => s + p.quantidade, 0);
  const naoAtendida = Object.values(r.pecasRestantes).reduce((s, v) => s + v, 0);
  return { e, r, ms, total, comPosto, pct: comPosto / total, excecoes: r.alocacoes.filter((a) => a.excecaoRevezamento).length, demanda, naoAtendida };
}

describe("cenários reais (5 últimas semanas de PROD, anonimizadas)", () => {
  semanas.forEach((s) => {
    [14, 16, 18].forEach((n) => {
      it(`${s.semanaInicio} com ${n} funcionários: invariantes, sem excedente e desempenho`, () => {
        const x = rodar(s.pools, n);
        expect(checarInvariantes(x.e, x.r)).toEqual([]);
        expect(x.total).toBe(n * 30);
        expect(x.ms).toBeLessThan(500);
        // nunca produz mais do que o previsto
        expect(x.naoAtendida).toBeLessThanOrEqual(x.demanda + 1e-6);
      });
    });

    it(`${s.semanaInicio}: mais funcionários não reduz materialmente as pessoas-período alocadas e nunca aumenta a demanda não atendida`, () => {
      const r14 = rodar(s.pools, 14);
      const r16 = rodar(s.pools, 16);
      const r18 = rodar(s.pools, 18);
      // tolerância de 2%: com mais gente a demanda esgota antes, e a última fração de peças muda a contagem de slots
      expect(r16.comPosto).toBeGreaterThanOrEqual(Math.floor(r14.comPosto * 0.98));
      expect(r18.comPosto).toBeGreaterThanOrEqual(Math.floor(r16.comPosto * 0.98));
      expect(r16.naoAtendida).toBeLessThanOrEqual(r14.naoAtendida + 1e-6);
      expect(r18.naoAtendida).toBeLessThanOrEqual(r16.naoAtendida + 1e-6);
    });

    it(`${s.semanaInicio}: com 14 funcionários (presença real média) quase todos têm posto`, () => {
      expect(rodar(s.pools, 14).pct).toBeGreaterThan(0.85);
    });
  });
});
