// CONTRATO: o motor NÃO usa produtividade individual de funcionário. Produtividade esperada, receita/h, lucro/h, valor marginal e custo de oportunidade existem só em
// produto × operação × máquina/posto. A PESSOA é escolhida depois, só por disponibilidade, elegibilidade, revezamento por bloco, hard constraints, churn, exposição e id (desempate.ts).
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { planejarComFluxo } from "../planejar";
import { avaliarPlano } from "../avaliar";
import { analisarCapacidade } from "../capacidade";
import { prepararFluxo } from "../estado";
import { produtividadeEsperada } from "../../produtividade";
import { equipe, montar, pool, ap } from "./helpersFluxo";
import type { AlocacaoEscala } from "../../types";

const RAIZ = path.resolve(__dirname, "../..");
// Arquivos de CÁLCULO em que `funcionarioId` / `funcionario_id` é PROIBIDO (comentários não contam).
// EXCEÇÕES: nenhuma. (aderencia.ts só cita o termo em comentário para explicar que aderência por pessoa não é medível; a justificativa por pessoa é montada no script/relatório,
// nunca em capacidade.ts. `desempate.ts` trata da ESCOLHA da pessoa e fica de fora por definição; ver docs/escala-fluxo-atingibilidade.md.)
const PROIBIDO = [
  "produtividade.ts", "fluxo/produtividade.ts", "desempenho.ts", "fluxo/financeiro.ts", "fluxo/capacidade.ts", "fluxo/economiaProduto.ts", "fluxo/atingibilidade.ts", "fluxo/aderencia.ts",
  "fluxo/demandaFutura.ts", "fluxo/proximaSemana.ts", "fluxo/pessoaParada.ts",
];
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

describe("contrato estrutural: nenhum identificador de funcionário nos cálculos econômicos/produtividade", () => {
  PROIBIDO.forEach((arq) => {
    it(`${arq} não usa funcionarioId/funcionario_id`, () => {
      const texto = semComentarios(fs.readFileSync(path.join(RAIZ, arq), "utf8"));
      expect(texto.match(/funcionario_?[iI]d/g) ?? []).toEqual([]);
    });
  });
});

describe("contrato comportamental: permutar as pessoas do plano não muda valor, capacidade nem produtividade", () => {
  const DIAS = ["2026-10-26", "2026-10-27"];
  const pools = [
    pool({ produto: "A", etapa: "A1", op: "opA1", ordem: 1, q: 90000, maquinas: ["a1"], mu: 1200, valor: 0.2 }),
    pool({ produto: "A", etapa: "A2", op: "opA2", ordem: 2, q: 90000, maquinas: ["a2", "a3"], mu: 800, valor: 0.2 }),
    pool({ produto: "B", etapa: "B1", op: "opB", ordem: 1, q: 90000, maquinas: ["b1", "b2"], mu: 700, valor: 0.18 }),
  ];
  const m = montar({ pools, funcionarios: equipe(5), c: 1, extra: { revezamentoDuro: false }, dias: DIAS });
  const opcoes = { objetivo: "lucro_hora" as const, atingibilidadeModo: "sombra" as const, economiaSlots: 99 };
  const r = planejarComFluxo(m.entrada, m.dados, opcoes);
  const plano = r.resultado.alocacoes;
  // permuta CICLICAMENTE as pessoas dentro de cada período
  const permutar = (l: AlocacaoEscala[]): AlocacaoEscala[] => {
    const porSlot = new Map<string, string[]>();
    l.forEach((a) => (porSlot.get(`${a.data}|${a.periodoId}`) ?? porSlot.set(`${a.data}|${a.periodoId}`, []).get(`${a.data}|${a.periodoId}`)!).push(a.funcionarioId));
    return l.map((a) => { const ids = porSlot.get(`${a.data}|${a.periodoId}`)!; return { ...a, funcionarioId: ids[(ids.indexOf(a.funcionarioId) + 1) % ids.length] }; });
  };
  it("lucro/receita projetados, métricas financeiras e atingibilidade idênticos", () => {
    const a = avaliarPlano(m.entrada, m.dados, plano, opcoes);
    const b = avaliarPlano(m.entrada, m.dados, permutar(plano), opcoes);
    expect(JSON.stringify(b.financeiro)).toBe(JSON.stringify(a.financeiro));
    expect(JSON.stringify(b.atingibilidade)).toBe(JSON.stringify(a.atingibilidade));
    expect(b.totais).toEqual(a.totais);
  });
  it("capacidade por etapa, valor marginal e custo de oportunidade idênticos (a decisão é do POSTO)", () => {
    const ctx = prepararFluxo(m.entrada, m.dados, opcoes);
    const a = analisarCapacidade(ctx, plano);
    const b = analisarCapacidade(ctx, permutar(plano));
    expect(JSON.stringify(b.capacidade)).toBe(JSON.stringify(a.capacidade));
    expect(JSON.stringify(b.decisoes)).toBe(JSON.stringify(a.decisoes));
    a.decisoes.forEach((d) => expect(Object.keys(d)).not.toContain("funcionarioId"));
  });
  it("produtividade esperada idêntica ao permutar o funcionarioId dos apontamentos", () => {
    const hist = Array.from({ length: 12 }, (_, i) => ap({ data: "2026-10-26", periodoId: "m1", maquinaId: "a1", produtoId: "A", etapaId: "A1", operacaoId: "opA1", funcionarioId: `f${i % 3}`, boas: 900 + i * 10, meta: 1200, lancadoEmMs: 1_000 + i }));
    const perm = hist.map((h, i) => ({ ...h, funcionarioId: `f${(i + 1) % 3}` }));
    const agora = Date.parse("2026-10-27T12:00:00-03:00");
    const x = produtividadeEsperada(hist as never, "A", "A1", "a1", agora, { operacaoId: "opA1" });
    const y = produtividadeEsperada(perm as never, "A", "A1", "a1", agora, { operacaoId: "opA1" });
    expect(y).toEqual(x);
    const z = produtividadeEsperada(hist.map((h) => ({ ...h, funcionarioId: null })) as never, "A", "A1", "a1", agora, { operacaoId: "opA1" });
    expect(z).toEqual(x);
  });
});
