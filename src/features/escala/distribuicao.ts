// DISTRIBUICAO_DA_QUANTIDADE_POR_PRODUTO (item 7, 02/11) — helpers PUROS.
//
// Modelo: ALOCACAO FISICA (pessoa + máquina única + operação, `AlocacaoEscala`) × DISTRIBUICAO (quantos peças de cada produto/etapa saem dessa máquina nesse período).
// Regras:
//  - a máquina e a pessoa nunca são duplicadas (a PK (data, periodo, funcionario) e o índice único (data, periodo, maquina) do banco continuam valendo);
//  - Σ distribuicao.pecas = pecas da linha; `produtoId/etapaId` da linha = item de MAIOR quantidade (empate: ordem do vetor);
//  - linha de um só produto NÃO precisa de distribuição (ausente = comportamento anterior); distribuição de 1 item idêntica à linha é "efetivamente ausente".
// Todo consumidor que ATRIBUI peças a um produto (WIP, demanda restante, cobertura, realizado, diagnóstico de cadeia) deve ler `expandirPorProduto` — nunca `produtoId/pecas` da linha crua de uma linha compartilhada.
import type { AlocacaoEscala, DistribuicaoQuantidade } from "./types";

const EPS = 1e-6;

/** Distribuição EFETIVA da linha: null quando é de um só produto (ausente, vazia ou idêntica à linha); senão cópia ordenada por produto|etapa. */
export function distribuicaoEfetiva(a: Pick<AlocacaoEscala, "produtoId" | "etapaId" | "pecas" | "distribuicao">): DistribuicaoQuantidade[] | null {
  const d = a.distribuicao;
  if (!d || d.length === 0) return null;
  if (d.length === 1 && d[0].produtoId === a.produtoId && d[0].etapaId === a.etapaId && Math.abs(d[0].pecas - a.pecas) <= EPS) return null;
  return [...d].map((x) => ({ produtoId: x.produtoId, etapaId: x.etapaId, pecas: x.pecas })).sort((x, y) => (`${x.produtoId}|${x.etapaId}` < `${y.produtoId}|${y.etapaId}` ? -1 : 1));
}

/** Texto canônico da distribuição efetiva ("" quando não há) — usado em comparação de planos e hash. */
export function chaveDistribuicao(a: Pick<AlocacaoEscala, "produtoId" | "etapaId" | "pecas" | "distribuicao">): string {
  const d = distribuicaoEfetiva(a);
  return d ? d.map((x) => `${x.produtoId}:${x.etapaId}:${Math.round(x.pecas * 1e6) / 1e6}`).join(",") : "";
}

/** Escolhe o item de maior quantidade (a "identidade" da linha para quem só lê produto/etapa). */
export function dominante(d: DistribuicaoQuantidade[]): DistribuicaoQuantidade {
  return d.reduce((a, b) => (b.pecas > a.pecas + EPS ? b : a));
}

export interface ProblemaDistribuicao { linha: string; problema: string }

/** Confere o contrato de UMA linha (mesmas regras do CHECK do banco). Devolve os problemas (vazio = íntegra). */
export function validarDistribuicao(a: AlocacaoEscala): string[] {
  const d = a.distribuicao;
  if (d === undefined || d === null) return [];
  const p: string[] = [];
  if (!a.maquinaId) {
    if (d.length > 0) p.push("linha sem posto não pode ter distribuição");
    return p;
  }
  if (d.length === 0) { p.push("distribuição vazia em linha com posto"); return p; }
  const vistos = new Set<string>();
  d.forEach((x) => {
    if (!(x.pecas > 0) || !Number.isFinite(x.pecas)) p.push(`quantidade inválida para ${x.produtoId}|${x.etapaId}`);
    const k = `${x.produtoId}|${x.etapaId}`;
    if (vistos.has(k)) p.push(`produto|etapa repetido ${k}`);
    vistos.add(k);
  });
  const soma = d.reduce((s, x) => s + x.pecas, 0);
  if (Math.abs(soma - a.pecas) > 1e-3) p.push(`soma da distribuição ${soma} ≠ pecas da linha ${a.pecas}`);
  const dom = dominante(d);
  if (dom.produtoId !== a.produtoId || dom.etapaId !== a.etapaId) {
    // empate de quantidade: aceita qualquer dos empatados
    const empatado = d.some((x) => Math.abs(x.pecas - dom.pecas) <= EPS && x.produtoId === a.produtoId && x.etapaId === a.etapaId);
    if (!empatado) p.push("produto/etapa da linha não é o de maior quantidade da distribuição");
  }
  return p;
}

/**
 * Visão POR PRODUTO: cada linha com distribuição de ≥ 2 itens vira N linhas (mesma pessoa/máquina/operação; produto, etapa e peças de cada item); as demais passam intactas
 * (mesma referência, sem cópia). Use SOMENTE para atribuir quantidade a produto; a visão tem chaves (data, período, pessoa) duplicadas — nunca grave nem compare planos com ela.
 * `pecasAdicional` fica na PRIMEIRA linha expandida (carga adicional não se reparte).
 */
export function expandirPorProduto(linhas: AlocacaoEscala[]): AlocacaoEscala[] {
  let algum = false;
  const out: AlocacaoEscala[] = [];
  for (const a of linhas) {
    const d = distribuicaoEfetiva(a);
    if (!d || !a.maquinaId) { out.push(a); continue; }
    algum = true;
    const { distribuicao: _d, ...resto } = a;
    void _d;
    d.forEach((x, i) => out.push({ ...resto, produtoId: x.produtoId, etapaId: x.etapaId, pecas: x.pecas, ...(i === 0 ? {} : { pecasAdicional: 0 }) }));
  }
  return algum ? out : linhas;
}

/** Quantidade planejada de um (produto, etapa) numa linha, respeitando a distribuição. */
export function pecasDoPool(a: AlocacaoEscala, produtoId: string, etapaId: string): number {
  const d = distribuicaoEfetiva(a);
  if (d) return d.filter((x) => x.produtoId === produtoId && x.etapaId === etapaId).reduce((s, x) => s + x.pecas, 0);
  return a.produtoId === produtoId && a.etapaId === etapaId ? a.pecas : 0;
}

/** Lê o jsonb `distribuicao` do banco ([{produto_id, etapa_id, pecas}]; aceita camelCase). Malformado/ausente/vazio => undefined (linha de um só produto; nunca lança). */
export function lerDistribuicao(v: unknown): DistribuicaoQuantidade[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const out: DistribuicaoQuantidade[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") return undefined;
    const o = x as Record<string, unknown>;
    const produtoId = o.produto_id ?? o.produtoId, etapaId = o.etapa_id ?? o.etapaId, pecas = Number(o.pecas);
    if (typeof produtoId !== "string" || typeof etapaId !== "string" || !Number.isFinite(pecas)) return undefined;
    out.push({ produtoId, etapaId, pecas });
  }
  return out;
}
