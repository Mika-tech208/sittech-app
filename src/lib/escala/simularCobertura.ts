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

  const { cobertura: atual, candidatos } = analisarCobertura(entrada, resultado);

  const haAdicional = entrada.pools.some((p) => (p.adicionalMax ?? 0) > 0);
  const baseEntrada = semAdicional(entrada);
  const somentePrevisto = haAdicional ? analisarCobertura(baseEntrada, gerarEscala(baseEntrada)).cobertura : atual;

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
  if (opcoes.sugerir) {
    const s = sugerirAdicional(baseEntrada, { produtosIncompletos: incompletos });
    const rS = gerarEscala(s.entradaComSugestao);
    const { cobertura: coberturaApos, candidatos: candidatosApos } = analisarCobertura(s.entradaComSugestao, rS);
    const restantes = recursosCompativeisVerificados(s.entradaComSugestao, coberturaApos, candidatosApos);
    // efeito real de cada recurso compatível: refaz a sugestão de carga COM a máquina (mesmo motor)
    const produtosSemMaquina = (e: typeof entrada) => new Set((e.poolsSemMaquina ?? []).map((p) => p.produtoId));
    const comCarga = (adicoes: Map<string, Set<string>>) => {
      const nova = comMaquinasAdicionadas(baseEntrada, adicoes);
      const sN = sugerirAdicional(nova, { produtosIncompletos: produtosSemMaquina(nova) });
      const cob = calcularCobertura(sN.entradaComSugestao, gerarEscala(sN.entradaComSugestao));
      return { pecas: sN.totalPecas, coberturaApos: cob.percentual, ganhoMinutosVsSugestao: coberturaApos.minutosSemPosto - cob.minutosSemPosto };
    };
    verificados.itens.slice(0, 6).forEach((r) => {
      r.comCargaAdicional = comCarga(new Map(r.poolsAfetados.map((p) => [chavePool(p.produtoId, p.etapaId), new Set([r.maquinaId])])));
    });
    if (verificados.combinado) {
      const adicoes = new Map<string, Set<string>>();
      verificados.itens.forEach((r) => r.poolsAfetados.forEach((p) => {
        const k = chavePool(p.produtoId, p.etapaId);
        adicoes.set(k, new Set([...(adicoes.get(k) ?? []), r.maquinaId]));
      }));
      verificados.combinado.comCargaAdicional = comCarga(adicoes);
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

  const etapas: Record<string, string> = {};
  estado.etapas.forEach((e) => {
    etapas[e.id] = estado.nomesOperacao[e.operacaoId] ?? "Etapa";
  });

  return {
    semanaInicio: estado.semanaInicio,
    primeiroPeriodoAnalisado: analisados[0] ? { data: analisados[0].data, periodoId: analisados[0].periodoId } : null,
    periodosAnalisados: analisados.length,
    atual,
    somentePrevisto,
    recursosCompativeis: verificados.itens,
    recursosCombinado: verificados.combinado,
    etapasSemMaquina,
    adicional,
    sugestao,
    nomes: { maquinas: estado.nomesMaquinas ?? {}, produtos: estado.nomesProdutos ?? {}, etapas },
  };
}
