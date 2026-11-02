// CAPACIDADE do produto único considerando as ROTAS (PURO). A função de hoje (calcularCapacidadeMaximaProduto) é o mínimo de TODAS as etapas em série: para o produto canônico
// isso zeraria a capacidade sempre que uma rota inteira não tivesse máquina (ex.: Máquina 8 não selecionada) e trataria a M8 como etapa em série com Rosquear/Parafusar.
// Aqui: capacidade da rota = mínimo das suas etapas exclusivas (0 se faltar máquina); entrada do trecho comum = SOMA das rotas (alimentam o mesmo estoque);
// trecho comum = mínimo das suas etapas (recurso único); capacidade do produto = mínimo(entrada, trecho comum). Mesma unidade/fórmula por etapa (horas × máquinas ÷ tempo por peça).
import { calcularViabilidadeItem, tempoPorPecaEtapa } from "@/features/capacidade/calculations";
import type { ViabilidadeItem } from "@/features/capacidade/types";
import { calcularFuncionariosNecessarios } from "@/features/capacidade/calculations";
import type { PeriodoComDuracao, PrevisaoItem, Produto } from "@/types/domain";
import type { ModeloCanonico, RotaCanonica } from "./tipos";

export interface CapacidadeRota { rota: RotaCanonica; maxPecas: number; disponivel: boolean; gargalo: string | null }
export interface CapacidadeProdutoUnico {
  maxPecas: number;
  gargalo: string | null;
  porRota: CapacidadeRota[];
  /** soma das rotas disponíveis (peças/semana que podem chegar à entrada da Etiquetadora) */
  entradaComum: number;
  /** capacidade do trecho comum (recurso único) */
  trechoComum: { maxPecas: number; gargalo: string | null };
}

export function capacidadeProdutoUnico(
  produto: Pick<Produto, "roteiro">,
  maquinasPorEtapa: Record<string, string[]> | undefined,
  modelo: ModeloCanonico,
  periodosComDuracao: PeriodoComDuracao[],
  horasPorMaquinaSemana: number,
): CapacidadeProdutoUnico {
  const porId = new Map(produto.roteiro.map((e) => [e.id, e]));
  const maxEtapa = (id: string): { max: number; op: string } | null => {
    const e = porId.get(id);
    if (!e) return null;
    const t = tempoPorPecaEtapa(e, periodosComDuracao);
    if (t <= 0) return null; // etapa sem meta: não limita (mesma regra de hoje)
    return { max: (((maquinasPorEtapa || {})[id] || []).length * horasPorMaquinaSemana) / t, op: e.operacao };
  };
  const minimo = (ids: string[]): { max: number; gargalo: string | null } => {
    let max = Infinity, gargalo: string | null = null;
    ids.forEach((id) => { const r = maxEtapa(id); if (r && r.max < max) { max = r.max; gargalo = r.op; } });
    return { max: max === Infinity ? 0 : max, gargalo };
  };
  const porRota: CapacidadeRota[] = [...modelo.rotas].sort((a, b) => a.ordem - b.ordem).filter((r) => r.ativa).map((rota) => {
    const m = minimo(modelo.etapas.filter((e) => e.rotaId === rota.id).map((e) => e.etapaId));
    return { rota, maxPecas: Math.max(0, Math.floor(m.max)), disponivel: m.max > 0, gargalo: m.gargalo };
  });
  const entradaComum = porRota.reduce((s, r) => s + r.maxPecas, 0);
  const comum = minimo(modelo.etapas.filter((e) => e.rotaId === null).map((e) => e.etapaId));
  const trecho = { maxPecas: Math.max(0, Math.floor(comum.max)), gargalo: comum.gargalo };
  const max = Math.min(entradaComum, trecho.maxPecas);
  const gargalo = entradaComum < trecho.maxPecas ? (porRota.filter((r) => r.disponivel).length > 1 ? "Rotas (soma)" : (porRota.find((r) => r.disponivel)?.gargalo ?? "Rotas")) : trecho.gargalo;
  return { maxPecas: max, gargalo, porRota, entradaComum, trechoComum: trecho };
}

/** Viabilidade do item da Previsão: produto canônico => considera rotas; qualquer outro => EXATAMENTE a função de hoje. */
export function viabilidadeItemComRotas(
  it: Pick<PrevisaoItem, "produtoId" | "maquinasPorEtapa" | "quantidade">,
  produtos: Produto[],
  periodosComDuracao: PeriodoComDuracao[],
  horasPorMaquinaSemana: number,
  modelos: ModeloCanonico[],
): ViabilidadeItem {
  const modelo = modelos.find((m) => m.produtoCanonicoId === it.produtoId);
  const produto = produtos.find((p) => p.id === it.produtoId);
  if (!modelo || !produto) return calcularViabilidadeItem(it, produtos, periodosComDuracao, horasPorMaquinaSemana);
  const c = capacidadeProdutoUnico(produto, it.maquinasPorEtapa, modelo, periodosComDuracao, horasPorMaquinaSemana);
  return { atingivel: c.maxPecas >= it.quantidade, maxPecas: c.maxPecas, gargalo: c.maxPecas < it.quantidade ? c.gargalo : null, funcionariosNecessarios: calcularFuncionariosNecessarios(it) };
}
