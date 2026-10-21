// ORQUESTRAÇÃO DE UM CORTE TEMPORAL (Fase 4c) — função PURA: (visão do mundo, corte) -> decisão sombra. Nada de banco, relógio ou escrita:
// a 4d só liga isto ao fechamento de período / worker / snapshot definitivo.
//
// NÃO USA INFORMAÇÃO FUTURA: só entram apontamentos de períodos ≤ c lançados até o corte, ausências registradas até o corte e
// indisponibilidades iniciadas até o corte (uma liberação posterior ao corte é desconhecida => continua indisponível).

import { desempenhoPorEtapa, type DesempenhoEtapa } from "./desempenho";
import { classificarSituacao, coberturaFutura, faltaProjetada, postosVaziosPorRevezamento, projetarProducao, resumirRecuperacao, restanteAcabado, somarProducao, toleranciaFalta, type FaltaProjetada, type ResumoRecuperacao, type Situacao } from "./execucao";
import { hashCanonico } from "./hashCanonico";
import { hashAlocacoes, horizonteAposPeriodo, replanejarComHorizonte, type ResultadoSombraHorizonte } from "./horizonte";
import { boasPorPool, linhasExecutadas, restantePorPool, visivelNoCorte, type ApontamentoReal, type ExposicaoPessoa, type IncertezaExposicao } from "./producaoReal";
import { chavePool, type AlocacaoEscala, type EntradaEscala, type IndisponibilidadeRecursoEscala, type JanelaAusenciaEscala } from "./types";

export interface AusenciaRegistrada extends JanelaAusenciaEscala { registradaEmMs?: number }
export interface ParametrosCorte {
  base: EntradaEscala; // slots, funcionários, pools com a quantidade PREVISTA da semana (sem ausências/indisponibilidades)
  ausencias: AusenciaRegistrada[];
  indisponibilidades: IndisponibilidadeRecursoEscala[];
  apontamentos: ApontamentoReal[]; // tudo que existe hoje; o corte enxerga só o seu passado
  planoOficial: AlocacaoEscala[]; // plano oficial vigente da semana (inclui o comprometido c+1)
  c: number; // período de referência (fechado/atual)
  corteMs: number;
  impossivelNaOrigem?: boolean; // situação A (atingibilidade de planejamento, calculada uma vez no início da semana)
  adicionalRestante?: Record<string, number>; // teto de adicional ainda disponível por pool (modo adicional/WIP); padrão 0
  toleranciaRelativa?: number;
  modoHorizonte?: "comprometido" | "antigo";
  // só para MEDIR o custo de cada regra (padrão: ambos ligados, que é a regra definitiva)
  revezamentoDuro?: boolean;
  repararCompromisso?: boolean;
}

export interface DecisaoCorte {
  c: number;
  corteMs: number;
  situacao: Situacao;
  restantePorPool: Record<string, number>;
  restanteAcabado: number;
  desempenho: Record<string, DesempenhoEtapa>;
  exposicoes: ExposicaoPessoa[];
  incertezas: IncertezaExposicao[];
  visao: { apontamentosUsados: number; ausenciasUsadas: number; indisponibilidadesUsadas: number };
  horizonte: ResultadoSombraHorizonte;
  faltaOficial: FaltaProjetada;
  faltaSombra: FaltaProjetada;
  recuperacao: ResumoRecuperacao;
  cobertura: { oficial: number; sombra: number };
  postosVazios: { revezamentoNoAlteravel: number; revezamentoNoComprometido: number; inviavelNoComprometido: number };
  hashDecisao: string;
}

// visão do mundo no corte (testável isoladamente)
export function visaoNoCorte(p: Pick<ParametrosCorte, "ausencias" | "indisponibilidades" | "apontamentos" | "base" | "c" | "corteMs">) {
  const ausencias = p.ausencias.filter((a) => a.registradaEmMs === undefined || a.registradaEmMs <= p.corteMs).map(({ registradaEmMs: _r, ...a }) => (void _r, a));
  const indisponibilidades = p.indisponibilidades.filter((i) => i.desdeMs <= p.corteMs).map((i) => (i.liberadaEmMs !== null && i.liberadaEmMs > p.corteMs ? { ...i, liberadaEmMs: null } : i));
  const apontamentos = visivelNoCorte(p.apontamentos, p.base.slots, p.c, p.corteMs);
  return { ausencias, indisponibilidades, apontamentos };
}

export function executarCorteSombra(p: ParametrosCorte): DecisaoCorte {
  const v = visaoNoCorte(p);
  const slots = p.base.slots;
  const ent: EntradaEscala = { ...p.base, revezamentoDuro: p.revezamentoDuro !== false, ausencias: v.ausencias, indisponibilidades: v.indisponibilidades };
  const idx = (a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? Number.POSITIVE_INFINITY;

  // passado executado (Produção Real) e exposição ergonômica
  const ex = linhasExecutadas(slots, p.c, ent.funcionarios.map((f) => f.id), v.apontamentos, p.planoOficial, ent.pools, v.ausencias);
  const boas = boasPorPool(v.apontamentos);
  const restante = restantePorPool(ent.pools, boas);
  const desempenho = desempenhoPorEtapa(ent.pools, v.apontamentos);
  const fator = Object.fromEntries(Object.entries(desempenho).map(([k, d]) => [k, d.f]));
  const resAcab = restanteAcabado(ent.pools, restante);
  const tol = toleranciaFalta(resAcab, p.toleranciaRelativa);

  // pools da sombra: restante REAL, metas × f, adicional restante
  const poolsSom = ent.pools.map((pool) => {
    const k = chavePool(pool.produtoId, pool.etapaId);
    return { ...pool, quantidade: restante[k] ?? 0, metas: Object.fromEntries(Object.entries(pool.metas).map(([pid, m]) => [pid, m * (fator[k] ?? 1)])), adicionalMax: p.adicionalRestante?.[k] ?? 0 };
  });
  const entSom: EntradaEscala = { ...ent, pools: poolsSom };
  const h0 = horizonteAposPeriodo(slots, p.c, p.modoHorizonte ?? "comprometido");
  const comprometidoOficial = h0.comprometido === null ? [] : p.planoOficial.filter((a) => idx(a) === h0.comprometido);
  const horizonte = replanejarComHorizonte(entSom, [...ex.linhas, ...comprometidoOficial], p.c, { modo: p.modoHorizonte ?? "comprometido", exposicaoAnterior: ex.exposicoes, repararRotacao: p.repararCompromisso !== false });

  // projeções: oficial (plano oficial futuro, original) × sombra (comprometido efetivo + alterável)
  const oficialFuturo = p.planoOficial.filter((a) => idx(a) >= p.c + 1);
  const predOficial = projetarProducao(oficialFuturo, fator);
  const predSombra = somarProducao(projetarProducao(horizonte.comprometidas, fator), projetarProducao(horizonte.alteravel, null));
  const faltaOficial = faltaProjetada(ent.pools, restante, predOficial);
  const faltaSombra = faltaProjetada(ent.pools, restante, predSombra);
  const situacao = classificarSituacao({ impossivelNaOrigem: !!p.impossivelNaOrigem, faltaOficial: faltaOficial.total, faltaSombra: faltaSombra.total, tolerancia: tol });
  const sombraFuturo = [...horizonte.comprometidas, ...horizonte.alteravel];
  const av = horizonte.avaliacaoCompromisso;
  const alertasRot = (horizonte.resultado?.alertas ?? []).filter((a) => a.tipo === "rotacao_sem_solucao").reduce((s, a) => s + (a.quantidade ?? 0), 0);
  const decisao: Omit<DecisaoCorte, "hashDecisao"> = {
    c: p.c, corteMs: p.corteMs, situacao, restantePorPool: restante, restanteAcabado: resAcab, desempenho, exposicoes: ex.exposicoes, incertezas: ex.incertezas,
    visao: { apontamentosUsados: v.apontamentos.length, ausenciasUsadas: v.ausencias.length, indisponibilidadesUsadas: v.indisponibilidades.length },
    horizonte, faltaOficial, faltaSombra, recuperacao: resumirRecuperacao(faltaOficial.total, faltaSombra.total, oficialFuturo, sombraFuturo),
    cobertura: { oficial: coberturaFutura(oficialFuturo), sombra: coberturaFutura(sombraFuturo) },
    postosVazios: { revezamentoNoAlteravel: Math.max(alertasRot, postosVaziosPorRevezamento(horizonte.alteravel)), revezamentoNoComprometido: av.postosVazios.filter((x) => x.causa === "revezamento").length, inviavelNoComprometido: av.postosVazios.filter((x) => x.causa === "inviavel").length },
  };
  return { ...decisao, hashDecisao: hashCanonico({ plano: hashAlocacoes([...horizonte.comprometidas, ...horizonte.alteravel]), situacao, faltaOficial: Math.round(faltaOficial.total), faltaSombra: Math.round(faltaSombra.total) }) };
}
