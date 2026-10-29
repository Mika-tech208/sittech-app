// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fixture from "../__fixtures__/prod-2026-10-29.json";
import { economiaProduto, economiaProdutoCom, prepararBaseEconomia, margemDoProduto, VERSAO_ECONOMIA_PRODUTO, type ContextoEconomia } from "@/features/economia/economiaProduto";
import { calcularCustoHoraEOperacoes, calcularMargemProduto } from "@/features/custo-hora/calculations";
import { calcularHorasPorDia, calcularPeriodosComDuracao, filtrarPeriodosValidos } from "@/lib/calculations/periodos";
import type { Funcionario, Produto } from "@/types/domain";

// Dados REAIS de PROD (SELECT em 29/10/2026; funcionários agregados por operação, sem dados individuais).
type Fx = typeof fixture;
const funcionarios: Funcionario[] = (fixture as Fx).funcionarios.map((f, i) => ({
  id: `f${i}`, nome: `f${i}`, operacao: f.operacao, ativo: f.ativo, salarioBase: Number(f.salarioBase),
  custos: f.custos.map((c, j) => ({ id: `c${i}-${j}`, descricao: "x", valor: Number(c.valor) })),
}));
const produtos: Produto[] = (fixture as Fx).produtos.map((p) => ({
  id: p.id, nome: p.nome, referencia: "", valorUnitario: Number(p.valorUnitario), ativo: p.ativo, prioridade: "media",
  roteiro: p.roteiro.map((e, i) => ({ id: `${p.id}-${i}`, operacao: e.operacao, metas: e.metas as never, maquinasIds: [] })),
}));
const ctx: ContextoEconomia = {
  produtos, funcionarios, periodos: (fixture as Fx).periodos,
  fixedCosts: (fixture as Fx).fixedCosts.map((f, i) => ({ id: `x${i}`, descricao: f.descricao, categoria: f.categoria, valor: Number(f.valor), ativo: f.ativo })),
  diasUteis: (fixture as Fx).diasUteis,
};
const porNome = (n: string) => produtos.find((p) => p.nome.trim() === n)!;

// Valores EXIBIDOS na tela Produtos (informados pelo usuário em 28–29/10): valor, custo, margem %, lucro/h.
const TELA: Record<string, { valor: string; custo: string; margem: number; lucroHora: number }> = {
  'Conector 3/4" - Maquina Automatica': { valor: "0.18", custo: "0.06", margem: 65, lucroHora: 60.17 },
  Pino: { valor: "0.07", custo: "0.03", margem: 63, lucroHora: 54.81 },
  "Caixa Amarela 4x2": { valor: "0.22", custo: "0.09", margem: 58, lucroHora: 44.13 },
  "Plug Macho": { valor: "0.10", custo: "0.04", margem: 57, lucroHora: 43.04 },
  'Conector 3/4"': { valor: "0.18", custo: "0.08", margem: 54, lucroHora: 37.31 },
};

describe("economiaProduto reproduz a tela Produtos (PROD 29/10)", () => {
  const base = prepararBaseEconomia(ctx);

  it("custo/hora da empresa = 31,922 (mão de obra 21,578 + rateio de fixos 10,344)", () => {
    expect(base.custoHora.custoHoraEmpresa).toBeCloseTo(31.922, 3);
    expect(base.custoHora.rateioPorHora).toBeCloseTo(10.3442, 3);
    expect(base.custoHora.totalFixo).toBe(29755);
    expect(base.custoHora.totalCustoFuncionariosAtivos).toBeCloseTo(62068.75, 1);
    expect(base.custoHora.horasProdutivasFuncionario).toBeCloseTo(191.7667, 3);
  });

  for (const [nome, esperado] of Object.entries(TELA)) {
    it(`${nome}: valor, custo, margem % e lucro/hora idênticos aos da tela`, () => {
      const e = economiaProdutoCom(porNome(nome), base)!;
      expect(e.valorRecebido.toFixed(2)).toBe(esperado.valor);
      expect(e.custoProducao!.toFixed(2)).toBe(esperado.custo);
      expect(Math.round(e.margem!.pct)).toBe(esperado.margem); // tela: margemPct.toFixed(0)
      expect(e.lucroHora!.toFixed(2)).toBe(esperado.lucroHora.toFixed(2)); // tela: formatBRL(lucroHora)
      expect(e.versao).toBe(VERSAO_ECONOMIA_PRODUTO);
    });
  }

  it("Conector 1.1/4\": segue a mesma regra (custo 0,28 / margem 24% / lucro/h 10,22)", () => {
    const e = economiaProdutoCom(porNome('Conector 1.1/4"'), base)!;
    expect(e.custoProducao!.toFixed(2)).toBe("0.28");
    expect(Math.round(e.margem!.pct)).toBe(24);
    expect(e.lucroHora!.toFixed(2)).toBe("10.22");
  });

  it("GOLDEN: para TODOS os produtos com roteiro, o módulo é bit a bit igual a calcularMargemProduto (a função da tela)", () => {
    const periodosComDuracao = calcularPeriodosComDuracao(ctx.periodos);
    const horas = calcularHorasPorDia(filtrarPeriodosValidos(periodosComDuracao));
    const { custoHoraPorOperacao, custoHoraEmpresa } = calcularCustoHoraEOperacoes(ctx.funcionarios, ctx.fixedCosts, horas, ctx.diasUteis);
    let n = 0;
    for (const p of produtos.filter((x) => x.roteiro.length > 0)) {
      const ref = calcularMargemProduto(p, custoHoraPorOperacao, custoHoraEmpresa, periodosComDuracao);
      const e = economiaProduto(p.id, ctx)!;
      expect(e.custoProducao).toBe(ref.custo);
      expect(e.margem!.rs).toBe(ref.margemRS);
      expect(e.margem!.pct).toBe(ref.margemPct);
      expect(e.lucroHora).toBe(ref.lucroHora);
      expect(margemDoProduto(p, { custoHoraPorOperacao, custoHoraEmpresa, periodosComDuracao })).toEqual(ref);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(6);
  });

  it("produto sem roteiro: não calculável (tela mostra '—'), nunca 0 inventado", () => {
    const sem = produtos.find((p) => p.roteiro.length === 0);
    if (!sem) return; // PROD de hoje: se todos têm roteiro, o caso é coberto abaixo
    const e = economiaProdutoCom(sem, base);
    expect(e.calculavel).toBe(false);
    expect(e.custoProducao).toBeNull();
    expect(e.lucroHora).toBeNull();
  });
  it("produto sem roteiro (sintético): não calculável", () => {
    const e = economiaProdutoCom({ ...produtos[0], roteiro: [] }, base);
    expect(e.calculavel).toBe(false);
    expect(e.avisos).toContain("sem_roteiro");
  });
});

describe("PROVA: por que o lucro/hora varia e o que é constante", () => {
  const base = prepararBaseEconomia(ctx);
  it("só a operação 'Produção' tem funcionários ativos: NENHUMA etapa dos roteiros tem custo próprio (todas caem no custo/hora da empresa)", () => {
    expect(Object.keys(base.custoHora.custoHoraPorOperacao)).toEqual(["Produção"]);
    const usadas = new Set(produtos.flatMap((p) => p.roteiro.map((e) => e.operacao)));
    expect(usadas.has("Produção")).toBe(false);
  });
  it("custo/peça = custo/hora × Σ tempo/peça, com o MESMO custo/hora (31,92) em todos os produtos", () => {
    for (const p of produtos.filter((x) => x.roteiro.length > 0)) {
      const e = economiaProdutoCom(p, base);
      expect(e.usaFallbackEmpresa).toBe(true);
      expect(e.custoHoraAplicado!).toBeCloseTo(base.custoHora.custoHoraEmpresa, 9);
      expect(e.custoProducao!).toBeCloseTo(base.custoHora.custoHoraEmpresa * e.tempoTotalHoras!, 9);
    }
  });
  it("lucro/hora = receita/hora − custo/hora (constante): o ranking por lucro/hora É o ranking por receita/hora", () => {
    const lista = produtos.filter((x) => x.roteiro.length > 0 && x.ativo).map((p) => economiaProdutoCom(p, base));
    for (const e of lista) expect(e.lucroHora!).toBeCloseTo(e.receitaHora! - base.custoHora.custoHoraEmpresa, 9);
    const porLucro = [...lista].sort((a, b) => b.lucroHora! - a.lucroHora!).map((e) => e.produtoId);
    const porReceita = [...lista].sort((a, b) => b.receitaHora! - a.receitaHora!).map((e) => e.produtoId);
    expect(porLucro).toEqual(porReceita);
  });
  it("se existisse funcionário na operação da etapa, o custo/hora passaria a diferir por posto (e o ranking deixaria de coincidir)", () => {
    const comOperacao: Funcionario[] = [...funcionarios, { id: "novo", nome: "n", operacao: "Embalar", ativo: true, salarioBase: 9000, custos: [] }];
    const b2 = prepararBaseEconomia({ ...ctx, funcionarios: comOperacao });
    expect(b2.custoHora.custoHoraPorOperacao["Embalar"]).toBeDefined();
    const e = economiaProdutoCom(porNome('Conector 3/4"'), b2);
    expect(e.custoHoraAplicado!).not.toBeCloseTo(b2.custoHora.custoHoraEmpresa, 3);
  });
});

describe("PROVA DE FONTE: metas da tela == metas do motor da Escala (mesma tabela/colunas, sem tabela paralela)", () => {
  const raiz = join(__dirname, "..", "..", "..", "..");
  const le = (rel: string) => readFileSync(join(raiz, rel), "utf8");
  it("Produtos (useProdutos) lê roteiro_etapas.meta_m1..meta_t3; o motor (supabaseIO) lê as mesmas colunas e montarEntrada copia para pool.metas", () => {
    const hook = le("src/hooks/useProdutos.ts");
    const io = le("src/lib/escala/supabaseIO.ts");
    const mont = le("src/lib/escala/montarEntrada.ts");
    expect(hook).toContain("roteiro_etapas(");
    expect(hook).toContain("meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3");
    expect(io).toContain('const META_COLS = "meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3"');
    expect(io).toContain('.from("roteiro_etapas").select(`id, produto_id, operacao_id, ordem, ${META_COLS}`)');
    expect(mont).toContain("metas: { ...etapa.metas }");
  });
});
