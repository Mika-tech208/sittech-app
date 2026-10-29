// PRÓXIMA SEMANA (PURO): monta a entrada da semana seguinte com demanda esperada e WIP de ABERTURA vindo da simulação da semana atual, e mede o resultado esperado.
// VALOR FUTURO de um plano = R$(próxima semana | WIP de abertura do plano) − R$(próxima semana | WIP de abertura do plano-base), limitado pela demanda futura
// (as pools só têm quantidade = demanda esperada: peça que a próxima semana não consome não vale nada) e pela capacidade da próxima semana (mesmo motor, mesmo avaliador).
import { avaliarPlano } from "./avaliar";
import { planejarComFluxo } from "./planejar";
import type { CtxFluxo } from "./estado";
import type { ContagemFisicaPar, DadosProducaoReal, OpcoesFluxo } from "./tipos";
import type { AlocacaoEscala, EntradaEscala, SlotEscala } from "../types";

/** Slots da próxima semana a partir dos `diasAtivos` (YYYY-MM-DD) usando os períodos de um dia-modelo (mesmos horários). Dia inativo (feriado) não gera slot. */
export function slotsProximaSemana(diaModelo: SlotEscala[], diasAtivos: string[]): SlotEscala[] {
  const dia0 = diaModelo[0].data;
  const out: SlotEscala[] = [];
  [...diasAtivos].sort().forEach((d) => {
    const deltaDias = Math.round((Date.parse(d + "T12:00:00Z") - Date.parse(dia0 + "T12:00:00Z")) / 86400000);
    diaModelo.forEach((s) => out.push({ ...s, data: d, indice: out.length, inicioMs: s.inicioMs + deltaDias * 86400000, fimMs: s.fimMs + deltaDias * 86400000 }));
  });
  return out;
}

/** Entrada da próxima semana: mesmas pools/máquinas/equipe (⚠ a Previsão seguinte não escolhe máquinas ainda), Q = demanda esperada, nada congelado. Produto sem demanda sai. */
export function montarEntradaProximaSemana(atual: EntradaEscala, slots: SlotEscala[], demanda: Record<string, number>): EntradaEscala {
  const pools = atual.pools.filter((p) => (demanda[p.produtoId] ?? 0) > 0).map((p) => ({ ...p, quantidade: demanda[p.produtoId] }));
  return {
    ...atual, slots, aPartirDe: 0, pools, ausencias: [], indisponibilidades: [], congeladas: [], trocasManuais: [], historicoEquidade: undefined,
    wip: undefined, remPorPool: undefined, exposicaoExecutada: undefined, adicionalRealizado: undefined, ordemPostos: undefined, bonusContinuidade: undefined, poolsSemMaquina: [],
  };
}

/** WIP final da semana atual (por aresta, chave "produto|etapaOrigem") → contagens físicas de abertura da próxima semana (ISO ms = instante da virada). */
export function contagensDeAbertura(ctx: CtxFluxo, wipFinal: Record<string, number>, contadoEmMs: number, rotulo: string): ContagemFisicaPar[] {
  return Object.values(ctx.grafo.arestas).flatMap((ar) => {
    const saldo = Math.max(0, Math.round(wipFinal[ar.chavePar] ?? 0));
    return saldo > 0 ? [{ produtoId: ar.produtoId, etapaOrigemId: ar.etapaOrigemId, etapaSeguinteId: ar.etapaSeguinteId, saldo, contadoEmMs, informadoPor: "simulação", observacao: rotulo }] : [];
  });
}

export interface ResultadoSemanaSeguinte {
  receita: number; lucro: number; pecasFinais: number; wipFim: number; metasPerdidas: number;
  finalPorProduto: Record<string, number>;
  /** produção planejada por nó (soma da semana) — "o que preciso produzir" */
  producaoPorChavePool: Record<string, number>;
  plano: AlocacaoEscala[];
  diagnosticoWipAbertura: { chave: string; saldo: number; origem: string; confianca: string }[];
}

export function avaliarSemanaSeguinte(
  entrada: EntradaEscala, dados: Omit<DadosProducaoReal, "planoVigente" | "apontamentos" | "agoraMs">, opcoesPlanejar: Partial<OpcoesFluxo>, opcoesMedirRec: Partial<OpcoesFluxo>, opcoesMedirLucro: Partial<OpcoesFluxo>,
  contagens: ContagemFisicaPar[], agoraMs: number, planoReferencia?: AlocacaoEscala[]
): ResultadoSemanaSeguinte {
  const d: DadosProducaoReal = { ...dados, apontamentos: [], agoraMs, fechamentoMinutos: 10, planoVigente: [], contagensFisicas: contagens };
  // MONOTONIA: mais WIP de abertura nunca pode valer menos. O replanejamento do motor é heurístico (pode piorar por ruído); por isso, se há um plano de referência
  // (o da abertura-base), ele também é avaliado com o novo WIP e vale o MELHOR dos dois (nunca pior que manter o plano de referência).
  let alocs = planejarComFluxo(entrada, d, opcoesPlanejar).resultado.alocacoes;
  let R = avaliarPlano(entrada, d, alocs, opcoesMedirRec);
  if (planoReferencia) {
    const Rref = avaliarPlano(entrada, d, planoReferencia, opcoesMedirRec);
    if (Rref.financeiro!.total.rsProjetadoFechamento > R.financeiro!.total.rsProjetadoFechamento) { alocs = planoReferencia; R = Rref; }
  }
  const L = avaliarPlano(entrada, d, alocs, opcoesMedirLucro);
  const r = { resultado: { alocacoes: alocs } };
  const prod: Record<string, number> = {};
  r.resultado.alocacoes.forEach((a) => { if (a.maquinaId && a.produtoId && a.etapaId) { const k = `${a.produtoId}|${a.etapaId}`; prod[k] = (prod[k] ?? 0) + (a.pecas ?? 0); } });
  const fin: Record<string, number> = {};
  R.financeiro!.produtos.forEach((p) => (fin[p.produtoId] = p.finalProjetado));
  return {
    receita: R.financeiro!.total.rsProjetadoFechamento, lucro: L.financeiro!.total.rsProjetadoFechamento, pecasFinais: R.totais.finalEntregueLo, wipFim: R.totais.wipFinalLo,
    metasPerdidas: R.atingibilidade?.atingiveisPerdidas ?? 0, finalPorProduto: fin, producaoPorChavePool: prod, plano: r.resultado.alocacoes, diagnosticoWipAbertura: [],
  };
}

/** TETO DE ANTECIPAÇÃO por aresta: quantidade que a próxima semana consegue consumir naquele par (demanda do produto convertida ao par, limitada pela capacidade do destino),
 *  menos o que já existe de WIP no par. Nunca negativo. `capacidadeDestino` e `demandaNoPar` são em peças da semana seguinte. */
export function tetoDeAntecipacao(demandaNoPar: number, capacidadeDestino: number, wipBase: number): number {
  return Math.max(0, Math.min(demandaNoPar, capacidadeDestino) - Math.max(0, wipBase));
}
