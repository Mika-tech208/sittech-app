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

// Conector 3/4: dois produtos legados (Convencional: 4 etapas, última = Embalar; Automática: 3 etapas, última ainda sem apontamento) vinculados a UM produto único (5 etapas, última = Embalar).
// Números reais de PROD da semana 09–15/11 (14/11/2026). O vínculo vem de `produto_legado_mapa`: `produto_card_id` = canônico.
const linha = (produto: string, card: string, ordem: number, op: string, boas: number, ultima: number, opUltima: string) => ({
  produto_id: produto, produto_card_id: card, etapa_id: `${produto}-e${ordem}`, operacao_id: op, quantidade_boa: boas, n_apontamentos: 1,
  etapa_ordem: ordem, etapa_operacao_id: op, ultima_ordem: ultima, n_na_ultima_ordem: 1, ultima_operacao_id: opUltima,
});
const UNICO = "unico", CONV = "conv", AUTO = "auto";
const rUnico = linha(UNICO, UNICO, 4, "embalar", 78750, 4, "embalar");
const rUnicoMeio = linha(UNICO, UNICO, 2, "etiquetar", 90000, 4, "embalar"); // intermediária do único: nunca conta
const rConvFinal = linha(CONV, UNICO, 3, "embalar", 2500, 3, "embalar"); // as 2.500 peças do legado (Embalar = última do roteiro legado)
const rConvMeio = linha(CONV, UNICO, 2, "etiquetar", 73634, 3, "embalar"); // intermediária do legado: nunca conta
const rAutoMeio = linha(AUTO, UNICO, 0, "rosquear_parafusar", 25306, 2, "embalar"); // Automática ainda não chegou à última etapa: 0
const payloadConector = (apontado: ReturnType<typeof linha>[], extra: PayloadMetasTv["produtos"] = []): PayloadMetasTv => ({
  agora: "2026-11-14T15:30:00Z", semana_inicio: "2026-11-09", semana_fim: "2026-11-15", existe: true,
  produtos: [{ produto_id: UNICO, nome: "Conector 3/4\" (Produto Único)", meta: 93300, encerrado: false }, ...extra], apontado,
});

describe("Conector 3/4: um item físico = um card (legado + único, sem duplicar)", () => {
  const todas = [rUnico, rUnicoMeio, rConvFinal, rConvMeio, rAutoMeio];
  const m = montarModeloTv(payloadConector(todas));
  it("aparece UM card só, sem o sufixo técnico, com a meta do produto único", () => {
    expect(m.cards).toHaveLength(1);
    expect(m.cards[0]).toMatchObject({ produtoId: UNICO, nome: "Conector 3/4\"", meta: 93300 });
    expect(m.semMeta).toEqual([]); // o legado foi absorvido: não sobra linha "sem meta"
  });
  it("produzido = único (78.750) + 2.500 legados da última etapa do roteiro LEGADO", () => {
    expect(m.cards[0].produzido).toBe(81250);
    expect(m.cards[0].faltam).toBe(93300 - 81250);
  });
  it("não duplica: intermediárias (única, legada, automática) nunca entram; legado sem a linha final soma 0", () => {
    expect(montarModeloTv(payloadConector([rUnico, rUnicoMeio, rConvMeio, rAutoMeio])).cards[0].produzido).toBe(78750);
    expect(montarModeloTv(payloadConector([rConvFinal])).cards[0].produzido).toBe(2500);
  });
  it("soma uma única vez: refazer o cálculo (ou inverter a ordem das linhas) dá o mesmo valor, e o resumo da semana conta 81.250 (não 83.750)", () => {
    const inv = montarModeloTv(payloadConector([...todas].reverse()));
    expect(inv.cards[0].produzido).toBe(81250);
    expect(montarModeloTv(payloadConector(todas)).cards[0].produzido).toBe(81250);
    expect(m.resumo).toMatchObject({ produzido: 81250, meta: 93300 });
  });
  it("sem apontamento legado a soma deixa de ter efeito (só o único)", () => {
    expect(montarModeloTv(payloadConector([rUnico, rUnicoMeio])).cards[0].produzido).toBe(78750);
  });
  it("produto sem vínculo (card = ele mesmo) continua isolado; produto que não é do vínculo não é somado ao Conector", () => {
    const outro = { ...ap("pino", 1, 5000), produto_card_id: "pino" };
    const r = montarModeloTv(payloadConector([rUnico, rConvFinal, outro], [{ produto_id: "pino", nome: "Pino", meta: 10000, encerrado: false }]));
    expect(r.cards.find((c) => c.produtoId === "pino")!.produzido).toBe(5000);
    expect(r.cards.find((c) => c.produtoId === UNICO)!.produzido).toBe(81250);
  });
  it("encerrado do card: só produzido nos dois lados do resumo (saldo cancelado não derruba o percentual)", () => {
    const enc = payloadConector([rUnico, rConvFinal]);
    enc.produtos = [{ produto_id: UNICO, nome: "Conector 3/4\" (Produto Único)", meta: 93300, encerrado: true }];
    const r = montarModeloTv(enc);
    expect(r.cards).toEqual([]);
    expect(r.encerrados).toEqual([{ produtoId: UNICO, nome: "Conector 3/4\"", produzido: 81250 }]);
    expect(r.resumo).toMatchObject({ produzido: 81250, meta: 81250, percentual: 100 });
  });
});

describe("RPC: a regra usa só o vínculo oficial, nunca nome de produto", () => {
  const sql = readFileSync("supabase/migrations/20261121110000_tv_metas_producao.sql", "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  it("usa produto_legado_mapa e expõe produto_card_id; nenhum nome de produto no SQL", () => {
    expect(sql).toMatch(/produto_legado_mapa/);
    expect(sql).toMatch(/produto_card_id/);
    expect(sql).not.toMatch(/conector|3\/4|automatica|convencional/i);
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
