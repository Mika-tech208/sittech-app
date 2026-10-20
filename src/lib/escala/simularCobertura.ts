// Simulação de cobertura da equipe para a Previsão Semanal — SOMENTE LEITURA.
//
// Usa EXATAMENTE as mesmas funções que geram a Escala (montarEntradaEscala + gerarEscala);
// não existe fórmula paralela. O diagnóstico (cobertura.ts) só conta o que o motor produziu
// e a sugestão (sugestaoAdicional.ts) roda o motor de novo. Nada é gravado.

import { analisarCobertura, calcularCobertura, comMaquinasAdicionadas, recursosCompativeisVerificados, type CoberturaSemana, type RecursoSugerido, type RecursosVerificados } from "@/features/escala/cobertura";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { sugerirAdicional, type SugestaoProduto } from "@/features/escala/sugestaoAdicional";
import { chavePool, type EntradaEscala } from "@/features/escala/types";
import type { EstadoBruto } from "./estado";
import { montarEntradaEscala } from "./montarEntrada";

export interface EtapaSemMaquina {
  produtoId: string;
  etapaId: string;
  compativeis: string[]; // recursos do roteiro que poderiam ser selecionados para fechar a etapa
}

export interface AdicionalProduto {
  produtoId: string;
  previsto: number;
  adicionalProgramado: number; // o que está gravado/informado
  adicionalAbsorvido: number; // o que a capacidade ociosa realmente absorve (mínimo entre as etapas = produto acabado)
  porEtapa: { etapaId: string; absorvido: number }[];
}

export type SugestaoProdutoDetalhada = SugestaoProduto & {
  // recursos do roteiro compatíveis com a etapa LIMITANTE e ainda não selecionados: é o que destrava mais adicional
  recursosEtapaLimitante: string[];
};

export interface RecomendacaoMaquina {
  maquinas: string[]; // alternativas equivalentes (qualquer uma dá o mesmo efeito)
  poolsAfetados: { produtoId: string; etapaId: string }[]; // etapas de produtos JÁ PREVISTOS onde seria selecionada
  adicionalPorProduto: { produtoId: string; pecas: number }[]; // carga adicional do cenário (produto acabado)
  pecasAdicionais: number;
  coberturaDe: number; // cobertura hoje (como programado)
  coberturaPara: number; // cobertura estimada: máquina + carga adicional, verificada pelo motor
  ganhoHoras: number; // horas-pessoa que deixam de ficar sem posto
  todas?: boolean; // cenário com todas as máquinas recomendadas juntas
}

export interface SimulacaoCobertura {
  semanaInicio: string;
  primeiroPeriodoAnalisado: { data: string; periodoId: string } | null;
  periodosAnalisados: number;
  /** como está programado (previsto + adicional atual) */
  atual: CoberturaSemana;
  /** só o previsto, sem nenhum adicional — a referência para "antes" */
  somentePrevisto: CoberturaSemana;
  recursosCompativeis: RecursoSugerido[];
  recursosCombinado: RecursosVerificados["combinado"];
  /** máquina + carga adicional, sempre em conjunto (a máquina sozinha só antecipa o trabalho) */
  recomendacoes: RecomendacaoMaquina[];
  etapasSemMaquina: EtapaSemMaquina[];
  adicional: AdicionalProduto[];
  sugestao: null | {
    porProduto: SugestaoProdutoDetalhada[];
    totalPecas: number;
    valorPotencial: number; // indicador separado
    iteracoes: number;
    coberturaApos: CoberturaSemana;
    recursosRestantes: RecursoSugerido[];
    recursosRestantesCombinado: RecursosVerificados["combinado"];
  };
  nomes: { maquinas: Record<string, string>; produtos: Record<string, string>; etapas: Record<string, string> };
}

function semAdicional(e: EntradaEscala): EntradaEscala {
  return { ...e, pools: e.pools.map((p) => ({ ...p, adicionalMax: 0 })) };
}

export interface ItemRascunho {
  produto_id?: string;
  quantidade?: number;
  quantidade_adicional?: number;
  valor_unitario?: number;
  maquinas_por_etapa?: Record<string, string[]>;
}

export class RascunhoInvalidoError extends Error {}

// Itens da Previsão EM EDIÇÃO (modo simulação ou carga adicional digitada e ainda não salva) no lugar
// dos itens salvos — só para simular; nunca grava. Campo ausente cai no valor salvo do produto.
export function aplicarRascunhoItens(estado: EstadoBruto, itens: ItemRascunho[]): EstadoBruto {
  const salvos = new Map(estado.itens.map((i) => [i.produtoId, i]));
  const novos: EstadoBruto["itens"] = [];
  for (const it of itens) {
    if (typeof it.produto_id !== "string") continue;
    const salvo = salvos.get(it.produto_id);
    // REGRA DURA: carga adicional só em itens JÁ PREVISTOS na semana — nunca cria item novo
    if (!salvo) throw new RascunhoInvalidoError("Produto fora da Previsão desta semana: a carga adicional só pode aumentar itens já previstos.");
    const adicional = Number(it.quantidade_adicional ?? 0);
    const quantidade = Number(it.quantidade ?? salvo?.quantidade ?? 0);
    if (!Number.isFinite(adicional) || adicional < 0) throw new RascunhoInvalidoError("Quantidade adicional inválida.");
    if (!Number.isFinite(quantidade) || quantidade < 0) throw new RascunhoInvalidoError("Quantidade inválida.");
    novos.push({
      produtoId: it.produto_id,
      quantidade,
      quantidadeAdicional: adicional,
      valorUnitario: Number(it.valor_unitario ?? salvo?.valorUnitario ?? 0),
      maquinasPorEtapa: it.maquinas_por_etapa ?? salvo?.maquinasPorEtapa ?? {},
    });
  }
  return { ...estado, itens: novos };
}

// O MESMO caminho que gera a Escala: estado -> entrada do motor -> motor. Sem gravar nada.
export function simularSemana(estado: EstadoBruto, agoraMs: number) {
  const montada = montarEntradaEscala(estado, agoraMs);
  return { montada, entrada: montada.entrada, resultado: gerarEscala(montada.entrada) };
}

export function simularCobertura(estado: EstadoBruto, agoraMs: number, opcoes: { sugerir: boolean } = { sugerir: false }): SimulacaoCobertura {
  const { montada, entrada, resultado } = simularSemana(estado, agoraMs);
  const analisados = entrada.slots.slice(entrada.aPartirDe);
  // Só produtos JÁ PREVISTOS na semana podem aparecer em qualquer recomendação.
  const previstos = new Set(estado.itens.map((i) => i.produtoId));

  const { cobertura: atual, candidatos } = analisarCobertura(entrada, resultado, previstos);

  const haAdicional = entrada.pools.some((p) => (p.adicionalMax ?? 0) > 0);
  const baseEntrada = semAdicional(entrada);
  const somentePrevisto = haAdicional ? analisarCobertura(baseEntrada, gerarEscala(baseEntrada), previstos).cobertura : atual;

  const verificados = recursosCompativeisVerificados(entrada, atual, candidatos);

  const incompletos = new Set<string>();
  const etapasSemMaquina: EtapaSemMaquina[] = [];
  montada.avisos.forEach((a) => {
    if (a.tipo !== "etapa_sem_maquina" || !a.produtoId || !a.etapaId) return;
    incompletos.add(a.produtoId);
    etapasSemMaquina.push({ produtoId: a.produtoId, etapaId: a.etapaId, compativeis: [...(estado.etapas.find((e) => e.id === a.etapaId)?.maquinasCompativeis ?? [])].sort() });
  });

  const adicional: AdicionalProduto[] = [];
  const porProduto = new Map<string, typeof entrada.pools>();
  entrada.pools.forEach((p) => {
    if (!porProduto.has(p.produtoId)) porProduto.set(p.produtoId, []);
    porProduto.get(p.produtoId)!.push(p);
  });
  [...porProduto.keys()].sort().forEach((produtoId) => {
    const pools = porProduto.get(produtoId)!;
    const porEtapa = pools.map((p) => ({ etapaId: p.etapaId, absorvido: resultado.adicionalProduzido[chavePool(p.produtoId, p.etapaId)] ?? 0 }));
    adicional.push({
      produtoId,
      previsto: Math.max(...pools.map((p) => p.quantidade)),
      adicionalProgramado: Math.max(...pools.map((p) => p.adicionalMax ?? 0)),
      adicionalAbsorvido: Math.min(...porEtapa.map((e) => e.absorvido)),
      porEtapa,
    });
  });

  let sugestao: SimulacaoCobertura["sugestao"] = null;
  let recomendacoesFinal: RecomendacaoMaquina[] = [];
  if (opcoes.sugerir) {
    const s = sugerirAdicional(baseEntrada, { produtosIncompletos: incompletos, produtosPermitidos: previstos });
    const rS = gerarEscala(s.entradaComSugestao);
    const { cobertura: coberturaApos, candidatos: candidatosApos } = analisarCobertura(s.entradaComSugestao, rS, previstos);
    const restantes = recursosCompativeisVerificados(s.entradaComSugestao, coberturaApos, candidatosApos);
    // Recomendação CONJUNTA: uma máquina nova sozinha só antecipa o trabalho previsto (a carga é finita);
    // o efeito real vem junto com a carga adicional que ela destrava. Cada cenário refaz a sugestão de carga
    // COM a máquina, no mesmo motor, só com produtos já previstos.
    const produtosSemMaquina = (e: typeof entrada) => new Set((e.poolsSemMaquina ?? []).map((p) => p.produtoId));
    const cenario = (adicoes: Map<string, Set<string>>) => {
      const nova = comMaquinasAdicionadas(baseEntrada, adicoes);
      const sN = sugerirAdicional(nova, { produtosIncompletos: produtosSemMaquina(nova), produtosPermitidos: previstos });
      const cob = calcularCobertura(sN.entradaComSugestao, gerarEscala(sN.entradaComSugestao));
      return { sN, cob };
    };
    const adicoesDe = (c: { maquinaId: string; pools: string[] }) => new Map(c.pools.map((k) => [k, new Set([c.maquinaId])]));
    const cenarios = new Map(candidatos.slice(0, 10).map((c) => [c.maquinaId, { c, ...cenario(adicoesDe(c)) }]));

    verificados.itens.forEach((r) => {
      const x = cenarios.get(r.maquinaId);
      if (x) r.comCargaAdicional = { pecas: x.sN.totalPecas, coberturaApos: x.cob.percentual, ganhoMinutosVsSugestao: coberturaApos.minutosSemPosto - x.cob.minutosSemPosto };
    });

    const piso = Math.max(atual.percentual, coberturaApos.percentual) + 0.5; // só recomenda o que supera (≥ 0,5 p.p.) o que já se consegue sem máquina nova
    const grupos = new Map<string, RecomendacaoMaquina>();
    const montar = (maquinas: string[], poolsKeys: string[], x: { sN: ReturnType<typeof sugerirAdicional>; cob: CoberturaSemana }, todas = false): RecomendacaoMaquina => ({
      maquinas,
      poolsAfetados: poolsKeys.map((k) => { const [produtoId, etapaId] = k.split("|"); return { produtoId, etapaId }; }),
      adicionalPorProduto: x.sN.porProduto.filter((p) => p.adicionalSugerido > 0).map((p) => ({ produtoId: p.produtoId, pecas: p.adicionalSugerido })),
      pecasAdicionais: x.sN.totalPecas,
      coberturaDe: atual.percentual,
      coberturaPara: x.cob.percentual,
      ganhoHoras: (atual.minutosSemPosto - x.cob.minutosSemPosto) / 60,
      ...(todas ? { todas: true } : {}),
    });
    cenarios.forEach((x) => {
      if (x.cob.percentual <= piso) return;
      const chave = `${[...x.c.pools].sort().join("+")}|${x.cob.percentual.toFixed(2)}|${Math.round(x.sN.totalPecas)}`;
      const ja = grupos.get(chave);
      if (ja) ja.maquinas.push(x.c.maquinaId);
      else grupos.set(chave, montar([x.c.maquinaId], x.c.pools, x));
    });
    const recomendacoes = [...grupos.values()].map((g) => ({ ...g, maquinas: [...g.maquinas].sort() })).sort((a, b) => b.coberturaPara - a.coberturaPara || (a.maquinas[0] < b.maquinas[0] ? -1 : 1)).slice(0, 4);
    const uteis = [...cenarios.values()].filter((x) => x.cob.percentual > piso);
    if (uteis.length > 1) {
      const adicoes = new Map<string, Set<string>>();
      uteis.forEach((x) => x.c.pools.forEach((k) => adicoes.set(k, new Set([...(adicoes.get(k) ?? []), x.c.maquinaId]))));
      const todos = cenario(adicoes);
      if (todos.cob.percentual > piso) recomendacoes.push(montar(uteis.map((x) => x.c.maquinaId).sort(), [...adicoes.keys()].sort(), todos, true));
    }
    recomendacoesFinal = recomendacoes;
    if (verificados.combinado) {
      const adicoes = new Map<string, Set<string>>();
      verificados.itens.forEach((r) => r.poolsAfetados.forEach((p) => {
        const k = chavePool(p.produtoId, p.etapaId);
        adicoes.set(k, new Set([...(adicoes.get(k) ?? []), r.maquinaId]));
      }));
      const x = cenario(adicoes);
      verificados.combinado.comCargaAdicional = { pecas: x.sN.totalPecas, coberturaApos: x.cob.percentual, ganhoMinutosVsSugestao: coberturaApos.minutosSemPosto - x.cob.minutosSemPosto };
    }
    const detalhadas: SugestaoProdutoDetalhada[] = s.porProduto.map((p) => {
      const pool = baseEntrada.pools.find((x) => x.produtoId === p.produtoId && x.etapaId === p.etapaLimitanteId);
      return { ...p, recursosEtapaLimitante: pool ? (pool.maquinasCompativeisIds ?? []).filter((m) => !pool.maquinasIds.includes(m)) : [] };
    });
    sugestao = {
      porProduto: detalhadas,
      totalPecas: s.totalPecas,
      valorPotencial: s.valorPotencial,
      iteracoes: s.iteracoes,
      coberturaApos,
      recursosRestantes: restantes.itens,
      recursosRestantesCombinado: restantes.combinado,
    };
  }

  const resultadoFinal = { sugestao, recomendacoes: recomendacoesFinal };
  const fora = produtosForaDaSemana({ adicional, etapasSemMaquina, recursosCompativeis: verificados.itens, ...resultadoFinal }, previstos);
  if (fora.length > 0) throw new Error(`INVARIANTE VIOLADA: produto(s) fora da Previsão da semana na recomendação: ${fora.join(", ")}`);

  // dicionários de rótulos: só produtos previstos (e suas etapas) — o catálogo inteiro não sai na resposta
  const etapas: Record<string, string> = {};
  estado.etapas.filter((e) => previstos.has(e.produtoId)).forEach((e) => {
    etapas[e.id] = estado.nomesOperacao[e.operacaoId] ?? "Etapa";
  });
  const nomesProdutos = Object.fromEntries(Object.entries(estado.nomesProdutos ?? {}).filter(([id]) => previstos.has(id)));

  return {
    semanaInicio: estado.semanaInicio,
    primeiroPeriodoAnalisado: analisados[0] ? { data: analisados[0].data, periodoId: analisados[0].periodoId } : null,
    periodosAnalisados: analisados.length,
    atual,
    somentePrevisto,
    recursosCompativeis: verificados.itens,
    recursosCombinado: verificados.combinado,
    recomendacoes: recomendacoesFinal,
    etapasSemMaquina,
    adicional,
    sugestao,
    nomes: { maquinas: estado.nomesMaquinas ?? {}, produtos: nomesProdutos, etapas },
  };
}

// Todos os produtos citados em QUALQUER recomendação/diagnóstico que NÃO estão previstos na semana.
// Tem de ser sempre vazio: a carga adicional e as máquinas sugeridas só valem para produtos já previstos.
export function produtosForaDaSemana(
  sim: {
    adicional: { produtoId: string }[];
    etapasSemMaquina: { produtoId: string }[];
    recursosCompativeis: { poolsAfetados: { produtoId: string }[] }[];
    sugestao: null | { porProduto: { produtoId: string }[] };
    recomendacoes: { poolsAfetados: { produtoId: string }[]; adicionalPorProduto: { produtoId: string }[] }[];
  },
  previstos: Set<string>
): string[] {
  const citados = new Set<string>();
  sim.adicional.forEach((a) => citados.add(a.produtoId));
  sim.etapasSemMaquina.forEach((a) => citados.add(a.produtoId));
  sim.recursosCompativeis.forEach((r) => r.poolsAfetados.forEach((p) => citados.add(p.produtoId)));
  sim.sugestao?.porProduto.forEach((p) => citados.add(p.produtoId));
  sim.recomendacoes.forEach((r) => {
    r.poolsAfetados.forEach((p) => citados.add(p.produtoId));
    r.adicionalPorProduto.forEach((p) => citados.add(p.produtoId));
  });
  return [...citados].filter((p) => !previstos.has(p)).sort();
}
