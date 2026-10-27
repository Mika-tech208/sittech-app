// NO-OP do recálculo oficial: o plano resultante é SEMANTICAMENTE igual ao que já está gravado na região afetada?
//
// "Igual" = para cada (data, período, funcionário) da região (períodos com início >= corte): mesma máquina, produto, etapa, operação, peças (tolerância de arredondamento
// do numeric do banco), peças adicionais + tipo, motivo de "sem posto", exceção de revezamento (+ motivo) e a origem (auto/manual — a decisão de uma pessoa conta).
// NÃO entram: timestamps técnicos (criado_em/atualizado_em), versao do dia, ids. Funções puras (sem IO).

import type { AlertaEscala, AlocacaoEscala } from "@/features/escala/types";

const EPS_PECAS = 1e-6;
const nulo = (v: string | null | undefined) => v ?? null;
const num = (v: number | undefined) => Number(v ?? 0);

type LinhaComparavel = Pick<AlocacaoEscala, "data" | "periodoId" | "funcionarioId" | "maquinaId" | "produtoId" | "etapaId" | "operacaoId" | "pecas" | "pecasAdicional" | "tipoAdicional" | "motivoSemPosto" | "excecaoRevezamento" | "motivoExcecao"> & { origem?: "auto" | "manual" };

const chave = (a: LinhaComparavel) => `${a.data}|${a.periodoId}|${a.funcionarioId}`;

export function linhasIguais(a: LinhaComparavel, b: LinhaComparavel): boolean {
  return (
    nulo(a.maquinaId) === nulo(b.maquinaId) && nulo(a.produtoId) === nulo(b.produtoId) && nulo(a.etapaId) === nulo(b.etapaId) && nulo(a.operacaoId) === nulo(b.operacaoId) &&
    Math.abs(num(a.pecas) - num(b.pecas)) <= EPS_PECAS && Math.abs(num(a.pecasAdicional) - num(b.pecasAdicional)) <= EPS_PECAS &&
    (num(a.pecasAdicional) > 0 ? nulo(a.tipoAdicional) === nulo(b.tipoAdicional) : true) &&
    nulo(a.motivoSemPosto) === nulo(b.motivoSemPosto) && Boolean(a.excecaoRevezamento) === Boolean(b.excecaoRevezamento) && nulo(a.motivoExcecao) === nulo(b.motivoExcecao) &&
    (a.origem ?? "auto") === (b.origem ?? "auto")
  );
}

// Conjuntos de linhas iguais (mesmas chaves, mesmo conteúdo). Ordem irrelevante.
export function planosIguais(atual: LinhaComparavel[], novo: LinhaComparavel[]): boolean {
  if (atual.length !== novo.length) return false;
  const porChave = new Map(atual.map((l) => [chave(l), l]));
  if (porChave.size !== atual.length) return false; // chave duplicada no gravado: nunca tratar como igual
  return novo.every((n) => {
    const a = porChave.get(chave(n));
    return a !== undefined && linhasIguais(a, n);
  });
}

// Assinatura dos alertas do recálculo (o que a tela mostra como "alertas do último recálculo"): um recálculo cujo plano não mudou mas cujos ALERTAS mudaram
// (ex.: nova seleção de máquina inválida) NÃO é no-op — senão a tela ficaria com alertas velhos. FNV-1a de 64 bits (2×32) sobre o JSON canônico ordenado.
export function assinaturaAlertas(alertas: AlertaEscala[]): string {
  const itens = alertas.map((a) => JSON.stringify(Object.fromEntries(Object.entries(a as unknown as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1))))).sort();
  const texto = itens.join("\n");
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}:${itens.length}`;
}
