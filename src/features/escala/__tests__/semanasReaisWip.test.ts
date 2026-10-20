// Semanas reais (fixture anonimizada) com o adicional por etapa + WIP planejado ATIVO:
// invariantes do motor, previsto intacto, cobertura nunca menor e reprodutibilidade.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import { sugerirAdicionalWip } from "../sugestaoWip";
import { calcularLimitesWip } from "../wip";
import { checarInvariantes, entrada, equipe } from "./helpers";
import { verificarWip } from "./adicionalWipHelpers";
import type { EntradaEscala, PoolEscala, ResultadoEscala } from "../types";
import fixture from "../__fixtures__/semanas_reais.json";

const DIAS = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
const semanas = fixture.semanas as { semanaInicio: string; pools: PoolEscala[] }[];

function comWipPlanejado(pools: PoolEscala[], n: number): EntradaEscala {
  const e = entrada({ pools: pools.map((p) => ({ ...p, adicionalMax: 0 })), funcionarios: equipe(n) }, DIAS);
  return { ...e, wip: { limites: calcularLimitesWip(e.pools, e.slots, { wipDiasLimite: 1 }, null) } };
}
const postosPrevisto = (r: ResultadoEscala) =>
  r.alocacoes.filter((a) => a.maquinaId && !((a.pecasAdicional ?? 0) > 0)).map((a) => `${a.data}|${a.periodoId}|${a.maquinaId}|${a.produtoId}|${a.etapaId}|${a.pecas}`).sort();
const semPosto = (r: ResultadoEscala) => r.alocacoes.filter((a) => !a.maquinaId).length;

describe("semanas reais — adicional por etapa (WIP) ativo", () => {
  semanas.forEach((s) => {
    [14, 16, 18].forEach((n) => {
      it(`${s.semanaInicio} com ${n} funcionários: pipeline, limites, tipo e invariantes; previsto intacto; cobertura não piora`, () => {
        const base = comWipPlanejado(s.pools, n);
        const antes = gerarEscala(base);
        const { entradaComSugestao, sugestao } = sugerirAdicionalWip(base, {});
        const depois = gerarEscala(entradaComSugestao);
        expect(checarInvariantes(entradaComSugestao, depois)).toEqual([]);
        expect(verificarWip(entradaComSugestao, depois)).toEqual([]);
        // o PREVISTO (postos/máquinas/peças por período) não muda; ninguém fica sem posto a mais
        expect(postosPrevisto(depois)).toEqual(postosPrevisto(antes));
        expect(semPosto(depois)).toBeLessThanOrEqual(semPosto(antes));
        expect(sugestao.depois.percentual).toBeGreaterThanOrEqual(sugestao.antes.percentual - 1e-9);
        // reprodutível
        expect(JSON.stringify(gerarEscala(entradaComSugestao).alocacoes)).toBe(JSON.stringify(depois.alocacoes));
        // produto fora da Previsão nunca aparece na sugestão
        const previstos = new Set(s.pools.map((p) => p.produtoId));
        sugestao.itens.forEach((i) => expect(previstos.has(i.produtoId)).toBe(true));
      });
    });
  });
});
