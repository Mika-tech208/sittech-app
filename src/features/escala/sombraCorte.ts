// ORQUESTRAÇÃO DE UM CORTE TEMPORAL (Fase 4c) — função PURA: (visão do mundo, corte) -> decisão sombra. Nada de banco, relógio ou escrita:
// a 4d só liga isto ao fechamento de período / worker / snapshot definitivo.
//
// NÃO USA INFORMAÇÃO FUTURA: só entram apontamentos de períodos ≤ c lançados até o corte, ausências registradas até o corte e
// indisponibilidades iniciadas até o corte (uma liberação posterior ao corte é desconhecida => continua indisponível).

import { desempenhoPorEtapa, type DesempenhoEtapa } from "./desempenho";
import { classificarSituacao, compararPreenchimento, coberturaFutura, faltaProjetada, postosVaziosPorRevezamento, projetarProducao, resumirRecuperacao, restanteAcabado, somarProducao, toleranciaFalta, type FaltaProjetada, type ResumoPreenchimento, type ResumoRecuperacao, type Situacao } from "./execucao";
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
  preenchimento: ResumoPreenchimento; // "se pudesse escrever agora": o que preencheria/esvaziaria no futuro alterável
  wip: DecisaoWip | null; // null = WIP desligado
  hashDecisao: string;
}

export interface PareWip {
  produtoId: string;
  etapaId: string;
  teto: number; // adicional por etapa programado na Previsão
  realizado: number; // adicional já realizado (Produção Real acima do previsto da etapa)
  planejadoOficialFuturo: number; // adicional/WIP que a Escala oficial ainda planeja a partir do 1º período alterável
  planejadoSombraFuturo: number;
  limite: number | null; // limite de estoque entre esta etapa e a seguinte (null = última etapa)
  confirmado: number; // estoque confirmado que ocupa o limite
  espacoRestante: number | null; // limite − confirmado − estoque que o plano já deixa aguardando a etapa seguinte
}
export interface DecisaoWip { limites: Record<string, number>; pares: PareWip[] }

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
  // WIP/adicional: MESMA regra da Escala oficial — teto programado na Previsão, limites de estoque, estoque confirmado (da entrada do corte).
  // O realizado acima do previsto da etapa já consumiu teto e já ocupa o limite (como o adicional congelado).
  const adicionalRealizado: Record<string, number> = {};
  if (ent.wip) ent.pools.forEach((pool) => { const k = chavePool(pool.produtoId, pool.etapaId); const extra = Math.max(0, (boas[k] ?? 0) - pool.quantidade); if (extra > 0) adicionalRealizado[k] = extra; });
  const poolsSom = ent.pools.map((pool) => {
    const k = chavePool(pool.produtoId, pool.etapaId);
    return { ...pool, quantidade: restante[k] ?? 0, metas: Object.fromEntries(Object.entries(pool.metas).map(([pid, m]) => [pid, m * (fator[k] ?? 1)])) };
  });
  const entSom: EntradaEscala = { ...ent, pools: poolsSom, ...(ent.wip ? { adicionalRealizado } : {}) };
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
  const primeiroAlt = horizonte.horizonte.primeiroAlteravel;
  const oficialAlt = primeiroAlt === null ? [] : p.planoOficial.filter((a) => idx(a) >= primeiroAlt);
  const preenchimento = compararPreenchimento(oficialAlt, horizonte.alteravel);
  let wipDec: DecisaoWip | null = null;
  if (ent.wip) {
    const porProduto = new Map<string, typeof ent.pools>();
    [...ent.pools].sort((a, b) => a.ordemEtapa - b.ordemEtapa).forEach((pl) => porProduto.set(pl.produtoId, [...(porProduto.get(pl.produtoId) ?? []), pl]));
    const somaAdic = (rows: AlocacaoEscala[], k: string) => rows.filter((a) => a.maquinaId && a.produtoId && a.etapaId && chavePool(a.produtoId, a.etapaId) === k).reduce((s, a) => s + (a.pecasAdicional ?? 0), 0);
    const pares: PareWip[] = [];
    porProduto.forEach((etapas) => etapas.forEach((pl, i) => {
      const k = chavePool(pl.produtoId, pl.etapaId);
      const seg = etapas[i + 1];
      const lim = ent.wip!.limites[k] ?? null;
      const conf = ent.wip!.estoqueConfirmado?.[k] ?? 0;
      const acumO = somaAdic(oficialFuturo, k) + (adicionalRealizado[k] ?? 0), acumSeg = seg ? somaAdic(oficialFuturo, chavePool(seg.produtoId, seg.etapaId)) + (adicionalRealizado[chavePool(seg.produtoId, seg.etapaId)] ?? 0) : 0;
      pares.push({ produtoId: pl.produtoId, etapaId: pl.etapaId, teto: pl.adicionalMax ?? 0, realizado: adicionalRealizado[k] ?? 0, planejadoOficialFuturo: somaAdic(oficialAlt, k), planejadoSombraFuturo: somaAdic(horizonte.alteravel, k), limite: lim, confirmado: conf, espacoRestante: lim === null ? null : Math.max(0, lim - conf - Math.max(0, acumO - acumSeg)) });
    }));
    wipDec = { limites: ent.wip.limites, pares: pares.filter((x) => x.teto > 0 || x.planejadoOficialFuturo > 0 || x.planejadoSombraFuturo > 0 || x.realizado > 0 || x.confirmado > 0) };
  }
  const alertasRot = (horizonte.resultado?.alertas ?? []).filter((a) => a.tipo === "rotacao_sem_solucao").reduce((s, a) => s + (a.quantidade ?? 0), 0);
  const decisao: Omit<DecisaoCorte, "hashDecisao"> = {
    c: p.c, corteMs: p.corteMs, situacao, restantePorPool: restante, restanteAcabado: resAcab, desempenho, exposicoes: ex.exposicoes, incertezas: ex.incertezas,
    visao: { apontamentosUsados: v.apontamentos.length, ausenciasUsadas: v.ausencias.length, indisponibilidadesUsadas: v.indisponibilidades.length },
    horizonte, faltaOficial, faltaSombra, recuperacao: resumirRecuperacao(faltaOficial.total, faltaSombra.total, oficialFuturo, sombraFuturo),
    cobertura: { oficial: coberturaFutura(oficialFuturo), sombra: coberturaFutura(sombraFuturo) },
    preenchimento, wip: wipDec,
    postosVazios: { revezamentoNoAlteravel: Math.max(alertasRot, postosVaziosPorRevezamento(horizonte.alteravel)), revezamentoNoComprometido: av.postosVazios.filter((x) => x.causa === "revezamento").length, inviavelNoComprometido: av.postosVazios.filter((x) => x.causa === "inviavel").length },
  };
  return { ...decisao, hashDecisao: hashCanonico({ plano: hashAlocacoes([...horizonte.comprometidas, ...horizonte.alteravel]), situacao, faltaOficial: Math.round(faltaOficial.total), faltaSombra: Math.round(faltaSombra.total) }) };
}
