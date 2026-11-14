// TV DE METAS DE PRODUÇÃO — lógica PURA (sem banco, sem relógio, sem nenhum dado financeiro).
//
// Entrada: o payload da RPC `tv_metas_producao` (produtos com meta + produção boa agrupada por etapa). Saída: os cards, o resumo da semana e as seções
// do painel. Regras do pedido de 14/11/2026:
//   • Meta é MÍNIMO, não teto: 100% não significa parar — o percentual real continua (120%) e o excedente aparece ("+10.000 acima da meta").
//   • Produzido = peças boas da ÚLTIMA etapa do roteiro (mesma regra da Previsão: `calcularApontadoReal`); operação intermediária nunca é produto final.
//   • Produto ENCERRADO na semana não é falta: aparece à parte, só com o produzido.
//   • Produto sem meta e sem produção não aparece; com produção e sem meta fica numa linha discreta ("sem meta na semana").
//   • Ordem: ativos abaixo da meta (menor % primeiro) → meta atingida → encerrados.
//   • Resumo da semana = soma SIMPLES de peças (não é capacidade fabril). Segue a Previsão: produto encerrado entra com o que produziu nos dois lados.
import { calcularApontadoReal, type LinhaApontadoEtapa } from "@/features/previsao/apontadoReal";

export interface ProdutoMetaPayload { produto_id: string; nome: string; meta: number | string | null; encerrado: boolean }
export interface ApontadoPayload {
  produto_id: string;
  /** card em que a produção aparece: o produto canônico do vínculo legado→canônico (`produto_legado_mapa`) ou o próprio produto. Ausente = o próprio produto. */
  produto_card_id?: string | null;
  etapa_id: string | null; operacao_id: string | null; quantidade_boa: number | string; n_apontamentos: number | string;
  etapa_ordem: number | null; etapa_operacao_id: string | null; ultima_ordem: number | null; n_na_ultima_ordem: number | null; ultima_operacao_id: string | null;
}
export interface PayloadMetasTv {
  agora: string; hoje?: string; semana_inicio: string; semana_fim: string; existe: boolean;
  produtos: ProdutoMetaPayload[]; apontado: ApontadoPayload[];
}

export type EstadoCard = "abaixo" | "atingida" | "acima";
export interface CardMeta {
  produtoId: string; nome: string; meta: number; produzido: number;
  percentual: number; // 0–∞ (sem teto), ex.: 123,4
  estado: EstadoCard;
  faltam: number; // 0 quando atingida
  excedente: number; // 0 quando abaixo ou exatamente na meta
}
export interface LinhaEncerrado { produtoId: string; nome: string; produzido: number }
export interface LinhaSemMeta { produtoId: string; nome: string; produzido: number }
export interface ResumoSemanaTv { produzido: number; meta: number; percentual: number | null }
export interface ModeloTv {
  existe: boolean; semanaInicio: string; semanaFim: string;
  cards: CardMeta[]; encerrados: LinhaEncerrado[]; semMeta: LinhaSemMeta[]; resumo: ResumoSemanaTv;
}

/** O sufixo técnico do produto canônico não é nome de produto para a fábrica: "Conector 3/4\" (Produto Único)" aparece como "Conector 3/4\"". */
export const nomeParaTv = (nome: string): string => nome.replace(/\s*\(produto [úu]nico\)\s*$/i, "").trim();

const num = (v: unknown): number => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };

export function montarModeloTv(p: PayloadMetasTv): ModeloTv {
  const linhas: LinhaApontadoEtapa[] = (p.apontado ?? []).map((r) => ({
    produtoId: r.produto_id, etapaId: r.etapa_id, operacaoId: r.operacao_id, quantidadeBoa: num(r.quantidade_boa), nApontamentos: num(r.n_apontamentos),
    etapaOrdem: r.etapa_ordem, etapaOperacaoId: r.etapa_operacao_id, ultimaOrdem: r.ultima_ordem, nNaUltimaOrdem: num(r.n_na_ultima_ordem), ultimaOperacaoId: r.ultima_operacao_id,
  }));
  // 1) cada PRODUTO é calculado com o roteiro DELE (a última etapa do legado não é a do canônico); 2) depois a produção é somada por CARD (um item físico = um card), uma única vez:
  // cada linha de apontado pertence a um único produto, que pertence a um único card — não há como contar a mesma peça duas vezes.
  const apontado = calcularApontadoReal(linhas);
  const cardDoProduto = new Map<string, string>();
  for (const r of p.apontado ?? []) cardDoProduto.set(r.produto_id, r.produto_card_id ?? r.produto_id);
  const produzidoPorCard = new Map<string, number>();
  for (const [produtoId, ap] of apontado) {
    const card = cardDoProduto.get(produtoId) ?? produtoId;
    produzidoPorCard.set(card, (produzidoPorCard.get(card) ?? 0) + ap.apontadoReal);
  }
  const produzidoDe = (id: string) => produzidoPorCard.get(id) ?? 0;

  const cards: CardMeta[] = [];
  const encerrados: LinhaEncerrado[] = [];
  const semMeta: LinhaSemMeta[] = [];
  let somaProduzido = 0;
  let somaMeta = 0;

  for (const prod of p.produtos ?? []) {
    const produzido = produzidoDe(prod.produto_id);
    const meta = prod.meta === null || prod.meta === undefined ? null : num(prod.meta);
    if (prod.encerrado) {
      if (produzido > 0) {
        encerrados.push({ produtoId: prod.produto_id, nome: nomeParaTv(prod.nome), produzido });
        somaProduzido += produzido; somaMeta += produzido; // encerrado: o produzido conta como cumprido e o saldo cancelado sai (mesma regra da Previsão)
      }
      continue;
    }
    if (meta === null || meta <= 0) {
      if (produzido > 0) semMeta.push({ produtoId: prod.produto_id, nome: nomeParaTv(prod.nome), produzido });
      continue;
    }
    const percentual = (produzido / meta) * 100;
    const estado: EstadoCard = produzido < meta ? "abaixo" : produzido === meta ? "atingida" : "acima";
    cards.push({ produtoId: prod.produto_id, nome: nomeParaTv(prod.nome), meta, produzido, percentual, estado, faltam: Math.max(meta - produzido, 0), excedente: Math.max(produzido - meta, 0) });
    somaProduzido += produzido; somaMeta += meta;
  }

  // abaixo da meta primeiro (menor % → maior), depois meta atingida/acima (menor % primeiro: os mais próximos da meta antes); nome desempata
  const grupo = (c: CardMeta) => (c.estado === "abaixo" ? 0 : 1);
  cards.sort((a, b) => grupo(a) - grupo(b) || a.percentual - b.percentual || a.nome.localeCompare(b.nome, "pt-BR"));
  encerrados.sort((a, b) => b.produzido - a.produzido);
  semMeta.sort((a, b) => b.produzido - a.produzido);

  return {
    existe: p.existe, semanaInicio: p.semana_inicio, semanaFim: p.semana_fim, cards, encerrados, semMeta,
    resumo: { produzido: somaProduzido, meta: somaMeta, percentual: somaMeta > 0 ? (somaProduzido / somaMeta) * 100 : null },
  };
}

/** Os N produtos ativos mais atrasados (só os abaixo da meta), já na ordem do modelo. */
export const prioridades = (cards: CardMeta[], n = 3): CardMeta[] => cards.filter((c) => c.estado === "abaixo").slice(0, n);

/** Divide em páginas de `porPagina` cards sem deixar a última página com 1 card solto quando dá para equilibrar. */
export function paginar<T>(itens: T[], porPagina: number): T[][] {
  if (itens.length === 0) return [[]];
  const paginas = Math.ceil(itens.length / porPagina);
  const tam = Math.ceil(itens.length / paginas);
  const saida: T[][] = [];
  for (let i = 0; i < itens.length; i += tam) saida.push(itens.slice(i, i + tam));
  return saida;
}

// ---- formatação (pt-BR, sem moeda) ----
const fmtInt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtPct1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const formatPecas = (n: number): string => fmtInt.format(Math.round(n));
// 1 casa decimal até 199,9%; a partir de 200% sem casas (leitura à distância: "307%")
export const formatPercentual = (pct: number): string => `${pct >= 200 ? fmtInt.format(Math.round(pct)) : fmtPct1.format(pct)}%`;
export const formatDiaMes = (iso: string): string => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };

/** Posição da barra: escala 0–125% (a marca de 100% fica em 80% da trilha, alinhada entre todos os cards). */
export const ESCALA_MAX_PCT = 125;
export const larguraBarraPct = (percentual: number): number => Math.min(Math.max(percentual, 0), ESCALA_MAX_PCT) / ESCALA_MAX_PCT * 100;
export const posicaoMarcaMeta = (): number => (100 / ESCALA_MAX_PCT) * 100;
