"use client";

// Paradas V1 — busca obter_indicadores_producao (contexto/denominadores) e
// obter_paradas_producao (migration 28, já com os snapshots do
// apontamento pai) pros filtros próprios da página /producao-real/paradas.
// Nenhuma agregação acontece aqui — isso é sempre
// src/features/producao-real/paradas/calculations.ts, reaproveitando o
// mesmo formato de linha (ApontamentoIndicador) que Indicadores V1 já usa.

import { useCallback, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { ApontamentoIndicador, FiltrosIndicadores, StatusApontamento } from "@/features/producao-real/indicadores/calculations";
import type { ParadaComContexto } from "@/features/producao-real/paradas/calculations";

interface ApontamentoIndicadorRow {
  apontamento_id: string;
  data: string;
  periodo_id: string;
  periodo_nome: string;
  status: StatusApontamento;
  motivo_sem_producao: string | null;
  produto_id: string | null;
  produto_nome: string | null;
  maquina_id: string;
  maquina_nome: string;
  operacao_id: string | null;
  operacao_nome: string | null;
  funcionario_id: string | null;
  funcionario_nome: string | null;
  etapa_id: string | null;
  etapa_ordem: number | null;
  is_ultima_etapa: boolean | null;
  quantidade_produzida: number;
  quantidade_refugo: number;
  meta_periodo_vigente: number | null;
  duracao_periodo_horas_vigente: number;
  minutos_parados: number;
  custo_hora_operacao_vigente: number | null;
  custo_operacional_periodo_vigente: number | null;
  custo_unitario_referencia_periodo_vigente: number | null;
  produto_valor_unitario: number | null;
  etapa_maquinas_elegiveis: number;
}

interface ParadaIndicadorRow {
  parada_id: string;
  apontamento_id: string;
  data: string;
  periodo_id: string;
  minutos: number;
  motivo_id: string;
  motivo_nome: string;
  motivo_categoria: string;
  origem: "manual" | "ocorrencia";
  produto_id: string | null;
  produto_nome: string | null;
  maquina_id: string;
  maquina_nome: string;
  operacao_id: string | null;
  operacao_nome: string | null;
  funcionario_id: string | null;
  funcionario_nome: string | null;
  custo_hora_operacao_vigente: number | null;
  meta_periodo_vigente: number | null;
  duracao_periodo_horas_vigente: number | null;
}

function linhaParaApontamento(r: ApontamentoIndicadorRow): ApontamentoIndicador {
  return {
    apontamentoId: r.apontamento_id,
    data: r.data,
    periodoId: r.periodo_id,
    periodoNome: r.periodo_nome,
    status: r.status,
    motivoSemProducao: r.motivo_sem_producao,
    produtoId: r.produto_id,
    produtoNome: r.produto_nome,
    maquinaId: r.maquina_id,
    maquinaNome: r.maquina_nome,
    operacaoId: r.operacao_id,
    operacaoNome: r.operacao_nome,
    funcionarioId: r.funcionario_id,
    funcionarioNome: r.funcionario_nome,
    etapaId: r.etapa_id,
    etapaOrdem: r.etapa_ordem,
    isUltimaEtapa: r.is_ultima_etapa,
    quantidadeProduzida: Number(r.quantidade_produzida),
    quantidadeRefugo: Number(r.quantidade_refugo),
    metaPeriodoVigente: r.meta_periodo_vigente === null ? null : Number(r.meta_periodo_vigente),
    duracaoPeriodoHorasVigente: Number(r.duracao_periodo_horas_vigente),
    minutosParados: Number(r.minutos_parados),
    custoHoraOperacaoVigente: r.custo_hora_operacao_vigente === null ? null : Number(r.custo_hora_operacao_vigente),
    custoOperacionalPeriodoVigente: r.custo_operacional_periodo_vigente === null ? null : Number(r.custo_operacional_periodo_vigente),
    custoUnitarioReferenciaPeriodoVigente: r.custo_unitario_referencia_periodo_vigente === null ? null : Number(r.custo_unitario_referencia_periodo_vigente),
    produtoValorUnitario: r.produto_valor_unitario === null ? null : Number(r.produto_valor_unitario),
    etapaMaquinasElegiveis: Number(r.etapa_maquinas_elegiveis),
  };
}

function linhaParaParada(r: ParadaIndicadorRow): ParadaComContexto {
  return {
    paradaId: r.parada_id,
    apontamentoId: r.apontamento_id,
    data: r.data,
    periodoId: r.periodo_id,
    minutos: Number(r.minutos),
    motivoId: r.motivo_id,
    motivoNome: r.motivo_nome,
    motivoCategoria: r.motivo_categoria,
    origem: r.origem,
    produtoId: r.produto_id,
    produtoNome: r.produto_nome,
    maquinaId: r.maquina_id,
    maquinaNome: r.maquina_nome,
    operacaoId: r.operacao_id,
    operacaoNome: r.operacao_nome,
    funcionarioId: r.funcionario_id,
    funcionarioNome: r.funcionario_nome,
    custoHoraOperacaoVigente: r.custo_hora_operacao_vigente === null ? null : Number(r.custo_hora_operacao_vigente),
    metaPeriodoVigente: r.meta_periodo_vigente === null ? null : Number(r.meta_periodo_vigente),
    duracaoPeriodoHorasVigente: r.duracao_periodo_horas_vigente === null ? null : Number(r.duracao_periodo_horas_vigente),
  };
}

export function useParadasProducao() {
  const [apontamentos, setApontamentos] = useState<ApontamentoIndicador[]>([]);
  const [paradas, setParadas] = useState<ParadaComContexto[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [buscou, setBuscou] = useState(false);

  const buscar = useCallback(async (filtros: FiltrosIndicadores) => {
    setLoading(true);
    setErro(null);

    const params = {
      p_data_inicial: filtros.dataInicial,
      p_data_final: filtros.dataFinal,
      p_produto_id: filtros.produtoId || null,
      p_maquina_id: filtros.maquinaId || null,
      p_operacao_id: filtros.operacaoId || null,
      p_funcionario_id: filtros.funcionarioId || null,
      p_periodo_id: filtros.periodoId || null,
    };

    const [apontamentosResp, paradasResp] = await Promise.all([
      supabase.rpc("obter_indicadores_producao", params),
      supabase.rpc("obter_paradas_producao", params),
    ]);

    setBuscou(true);
    if (apontamentosResp.error || paradasResp.error) {
      setErro("Não foi possível carregar os dados de paradas.");
      setApontamentos([]);
      setParadas([]);
      setLoading(false);
      return;
    }

    setApontamentos(((apontamentosResp.data || []) as ApontamentoIndicadorRow[]).map(linhaParaApontamento));
    setParadas(((paradasResp.data || []) as ParadaIndicadorRow[]).map(linhaParaParada));
    setLoading(false);
  }, []);

  return { apontamentos, paradas, loading, erro, buscou, buscar };
}

export type ParadasProducaoHook = ReturnType<typeof useParadasProducao>;
