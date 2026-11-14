import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { formatPercentual, formatPecas, larguraBarraPct, montarModeloTv, paginar, posicaoMarcaMeta, prioridades, type PayloadMetasTv } from "../metasTv";

// roteiro de 2 etapas por produto: etapa 1 (ordem 0, intermediária) e etapa 2 (ordem 1, FINAL)
const ap = (produto: string, etapaOrdem: number, boas: number) => ({
  produto_id: produto, etapa_id: `${produto}-e${etapaOrdem}`, operacao_id: `op${etapaOrdem}`, quantidade_boa: boas, n_apontamentos: 3,
  etapa_ordem: etapaOrdem, etapa_operacao_id: `op${etapaOrdem}`, ultima_ordem: 1, n_na_ultima_ordem: 1, ultima_operacao_id: "op1",
});
const base = (): PayloadMetasTv => ({
  agora: "2026-11-14T15:30:00Z", semana_inicio: "2026-11-09", semana_fim: "2026-11-15", existe: true,
  produtos: [
    { produto_id: "pino", nome: "Pino", meta: 108000, encerrado: false },
    { produto_id: "caixa", nome: "Caixa Amarela 4x4", meta: "51600", encerrado: false },
    { produto_id: "plug", nome: "Plug Macho ", meta: 33000, encerrado: false },
    { produto_id: "conector", nome: "Conector 3\"", meta: 500, encerrado: false },
    { produto_id: "c34", nome: "Conector 3/4\"", meta: null, encerrado: false },
    { produto_id: "vazio", nome: "Sem nada", meta: null, encerrado: false },
    { produto_id: "caixa42", nome: "Caixa Amarela 4x2", meta: 56400, encerrado: true },
  ],
  apontado: [
    ap("pino", 0, 999999), ap("pino", 1, 78953), // a etapa intermediária NUNCA conta
    ap("caixa", 1, 35550), ap("plug", 1, 33000), ap("conector", 1, 1535), ap("c34", 1, 2500), ap("caixa42", 1, 27930),
  ],
});

describe("montarModeloTv", () => {
  const m = montarModeloTv(base());
  it("produzido = última etapa; intermediária não soma como produto final", () => {
    expect(m.cards.find((c) => c.produtoId === "pino")!.produzido).toBe(78953);
  });
  it("meta é mínimo: 100% = atingida, acima mostra o percentual real e o excedente", () => {
    const plug = m.cards.find((c) => c.produtoId === "plug")!;
    expect(plug).toMatchObject({ estado: "atingida", percentual: 100, faltam: 0, excedente: 0 });
    const conector = m.cards.find((c) => c.produtoId === "conector")!;
    expect(conector).toMatchObject({ estado: "acima", excedente: 1035, faltam: 0 });
    expect(conector.percentual).toBeCloseTo(307, 5);
  });
  it("abaixo da meta: faltam = meta − produzido", () => {
    expect(m.cards.find((c) => c.produtoId === "caixa")).toMatchObject({ estado: "abaixo", faltam: 16050 });
  });
  it("ordem: abaixo da meta (menor % primeiro) → atingida/acima (mais perto da meta primeiro)", () => {
    expect(m.cards.map((c) => c.produtoId)).toEqual(["caixa", "pino", "plug", "conector"]);
  });
  it("encerrado fora dos cards, só com o produzido; sem meta e sem produção não aparece; sem meta com produção vira linha discreta", () => {
    expect(m.encerrados).toEqual([{ produtoId: "caixa42", nome: "Caixa Amarela 4x2", produzido: 27930 }]);
    expect(m.semMeta).toEqual([{ produtoId: "c34", nome: "Conector 3/4\"", produzido: 2500 }]);
    expect(m.cards.some((c) => c.produtoId === "vazio")).toBe(false);
  });
  it("resumo: soma simples de peças; encerrado entra com o produzido nos dois lados; sem meta fica de fora", () => {
    const produzido = 78953 + 35550 + 33000 + 1535 + 27930;
    const meta = 108000 + 51600 + 33000 + 500 + 27930;
    expect(m.resumo.produzido).toBe(produzido);
    expect(m.resumo.meta).toBe(meta);
    expect(m.resumo.percentual).toBeCloseTo((produzido / meta) * 100, 6);
  });
  it("prioridades = só os abaixo da meta, na ordem", () => {
    expect(prioridades(m.cards, 3).map((c) => c.produtoId)).toEqual(["caixa", "pino"]);
  });
  it("semana sem nenhuma meta: resumo sem percentual", () => {
    const vazio = montarModeloTv({ ...base(), produtos: [], apontado: [], existe: false });
    expect(vazio.cards).toEqual([]);
    expect(vazio.resumo.percentual).toBeNull();
  });
});

describe("apresentação", () => {
  it("formata pt-BR, sem moeda", () => {
    expect(formatPecas(108000)).toBe("108.000");
    expect(formatPercentual(73.1234)).toBe("73,1%");
    expect(formatPercentual(199.94)).toBe("199,9%");
    expect(formatPercentual(307.2)).toBe("307%");
    expect(formatPercentual(1234.5)).toBe("1.235%");
  });
  it("barra: a marca de 100% fica em 80% da trilha e o excedente passa dela, limitado à escala", () => {
    expect(posicaoMarcaMeta()).toBeCloseTo(80, 6);
    expect(larguraBarraPct(100)).toBeCloseTo(80, 6);
    expect(larguraBarraPct(50)).toBeCloseTo(40, 6);
    expect(larguraBarraPct(307)).toBe(100);
    expect(larguraBarraPct(-5)).toBe(0);
  });
  it("paginação equilibra (7 itens com 6 por página → 4+3, nunca 6+1)", () => {
    expect(paginar([1, 2, 3, 4, 5, 6, 7], 6).map((p) => p.length)).toEqual([4, 3]);
    expect(paginar([1, 2, 3], 6).map((p) => p.length)).toEqual([3]);
    expect(paginar([], 6)).toEqual([[]]);
  });
});

describe("HARD RULE: nenhum dado financeiro chega à TV", () => {
  const proibidos = /valor_unitario|preco|preço|custo|margem|lucro|faturamento|valorUnitario|r\$/i;
  it("a RPC não seleciona campo financeiro e o modelo da tela não carrega nenhum", () => {
    const sql = readFileSync("supabase/migrations/20261121110000_tv_metas_producao.sql", "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sql).not.toMatch(proibidos);
    expect(JSON.stringify(montarModeloTv(base()))).not.toMatch(proibidos);
  });
});

describe("TV PASSIVA: só lê (nunca controla a fábrica)", () => {
  const fontes = ["src/features/escala/tv/EscalaTvPage.tsx", "src/hooks/useMetasTv.ts", "src/features/escala/tv-metas/PainelMetasTv.tsx"]
    .map((f) => readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"));
  it("não dispara processamento/escala/recálculo, não escreve no banco e lê só a RPC de metas", () => {
    for (const src of fontes) {
      expect(src).not.toMatch(/dispararProcessamentoEscala|usePreChecagemEscala|escala_tv_snapshot|gerar|recalcul|\.insert\(|\.update\(|\.upsert\(|\.delete\(|fetch\(/);
    }
    expect(fontes[1]).toContain('rpc("tv_metas_producao"');
    expect((fontes[1].match(/\.rpc\(/g) ?? []).length).toBe(1);
  });
});
