// PLANEJADO × REAL — divergências (espelho da RPC). O resultado é derivado; o planejado em si nunca é alterado.
import type { Catalogo, Divergencia, LinhaApontamento } from "./tipos";
import { operacaoDaLinha } from "./linhas";

export function divergencias(l: LinhaApontamento, cat: Catalogo): Divergencia[] {
  const p = l.planejado;
  if (!p || l.origem !== "PROGRAMADO") return [];
  const d: Divergencia[] = [];
  if (l.real.maquinaId !== p.maquinaId) d.push("MAQUINA");
  if (l.naoProduziu) return d;                       // sem produção: não há operador/produto/operação reais
  if (l.real.funcionarioId !== p.funcionarioId) d.push("OPERADOR");
  if (l.real.produtoId !== p.produtoId) d.push("PRODUTO");
  if (operacaoDaLinha(cat, l)?.id !== p.operacaoId) d.push("OPERACAO");
  return d;
}

export const ROTULO_DIVERGENCIA: Record<Divergencia, string> = { MAQUINA: "máquina alterada", OPERADOR: "operador alterado", PRODUTO: "produto alterado", OPERACAO: "operação alterada" };

/** Selo "ALTERADO DO PLANEJADO": operador, máquina ou produto diferentes do plano (a operação é consequência desses; sozinha não aciona o selo). Sem confirmação extra. */
export const alteradoDoPlanejado = (l: LinhaApontamento, cat: Catalogo): boolean => divergencias(l, cat).some((d) => d !== "OPERACAO");
export const ROTULO_SELO_ALTERADO = "ALTERADO DO PLANEJADO";
