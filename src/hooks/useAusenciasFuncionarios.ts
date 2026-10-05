"use client";

// Consulta + escrita de ausencias_funcionarios — "Faltas e Ausências" V1.
// Mesmo padrão de useApontamentosRealizados.ts: funcionarioNome fica null
// aqui de propósito (não embeda funcionarios(nome), que fica atrás da
// permissão 'funcionarios'/'custo_hora') — quem chama resolve o nome via
// useFuncionariosElegibilidade, igual já é feito em
// ApontamentosRealizadosPage.tsx.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { TipoAusencia } from "@/features/ausencias/calculations";

export interface FiltrosAusencias {
  dataInicial?: string;
  dataFinal?: string;
  funcionarioId?: string;
  tipo?: TipoAusencia;
}

export interface PeriodoSnapshot {
  id: string;
  nome: string;
  inicio: string;
  fim: string;
}

export interface AusenciaFuncionario {
  id: string;
  funcionarioId: string;
  funcionarioNome: string | null;
  data: string;
  tipo: TipoAusencia;
  horarioInicio: string | null;
  horarioFim: string | null;
  duracaoMinutos: number;
  periodosSnapshot: PeriodoSnapshot[];
  observacao: string | null;
  criadoPor: string;
  criadoEm: string;
  atualizadoEm: string;
}

interface AusenciaRow {
  id: string;
  funcionario_id: string;
  data: string;
  tipo: TipoAusencia;
  horario_inicio: string | null;
  horario_fim: string | null;
  duracao_minutos: number;
  periodos_snapshot: PeriodoSnapshot[];
  observacao: string | null;
  criado_por: string;
  criado_em: string;
  atualizado_em: string;
}

const SELECT = `
  id, funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos,
  periodos_snapshot, observacao, criado_por, criado_em, atualizado_em
`;

function linhaParaAusencia(r: AusenciaRow): AusenciaFuncionario {
  return {
    id: r.id,
    funcionarioId: r.funcionario_id,
    funcionarioNome: null,
    data: r.data,
    tipo: r.tipo,
    horarioInicio: r.horario_inicio,
    horarioFim: r.horario_fim,
    duracaoMinutos: Number(r.duracao_minutos),
    periodosSnapshot: r.periodos_snapshot || [],
    observacao: r.observacao,
    criadoPor: r.criado_por,
    criadoEm: r.criado_em,
    atualizadoEm: r.atualizado_em,
  };
}

const LIMITE_RESULTADOS = 300;

export interface RegistrarAusenciaPayload {
  funcionarioId: string;
  data: string;
  tipo: TipoAusencia;
  horarioInicio: string | null;
  horarioFim: string | null;
  duracaoMinutos: number;
  observacao: string;
  idempotencyKey: string;
}

export interface EditarAusenciaPayload {
  id: string;
  tipo: TipoAusencia;
  horarioInicio: string | null;
  horarioFim: string | null;
  duracaoMinutos: number;
  observacao: string;
  motivo: string;
}

export function useAusenciasFuncionarios(pronto: boolean) {
  const [ausencias, setAusencias] = useState<AusenciaFuncionario[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = useCallback(async (filtros: FiltrosAusencias): Promise<AusenciaFuncionario[] | undefined> => {
    setLoading(true);
    setErro(null);
    let query = supabase
      .from("ausencias_funcionarios")
      .select(SELECT)
      .order("data", { ascending: false })
      .order("criado_em", { ascending: false })
      .limit(LIMITE_RESULTADOS);

    if (filtros.dataInicial) query = query.gte("data", filtros.dataInicial);
    if (filtros.dataFinal) query = query.lte("data", filtros.dataFinal);
    if (filtros.funcionarioId) query = query.eq("funcionario_id", filtros.funcionarioId);
    if (filtros.tipo) query = query.eq("tipo", filtros.tipo);

    const { data, error } = await query.returns<AusenciaRow[]>();
    if (error) {
      setErro("Não foi possível buscar as ausências.");
      setLoading(false);
      return undefined;
    }
    const mapeadas = (data || []).map(linhaParaAusencia);
    setAusencias(mapeadas);
    setLoading(false);
    return mapeadas;
  }, []);

  useEffect(() => {
    if (!pronto) return;
    buscar({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto]);

  // Retorna null em sucesso, ou a mensagem de erro (já pronta pra mostrar
  // à supervisora — inclui o motivo de conflito/sobreposição vindo direto
  // da RPC) em falha.
  const registrar = useCallback(async (payload: RegistrarAusenciaPayload): Promise<string | null> => {
    const { data, error } = await supabase.rpc("registrar_ausencia_funcionario", {
      p_funcionario_id: payload.funcionarioId,
      p_data: payload.data,
      p_tipo: payload.tipo,
      p_horario_inicio: payload.horarioInicio,
      p_horario_fim: payload.horarioFim,
      p_duracao_minutos: payload.duracaoMinutos,
      p_observacao: payload.observacao.trim() || null,
      p_idempotency_key: payload.idempotencyKey,
    });
    if (error || !data) {
      const msg = error?.message || "Não foi possível registrar a ausência.";
      setErro(msg);
      return msg;
    }
    setAusencias((prev) => [linhaParaAusencia(data as AusenciaRow), ...prev]);
    return null;
  }, []);

  const editar = useCallback(async (payload: EditarAusenciaPayload): Promise<string | null> => {
    const { data, error } = await supabase.rpc("editar_ausencia_funcionario", {
      p_ausencia_id: payload.id,
      p_tipo: payload.tipo,
      p_horario_inicio: payload.horarioInicio,
      p_horario_fim: payload.horarioFim,
      p_duracao_minutos: payload.duracaoMinutos,
      p_observacao: payload.observacao.trim() || null,
      p_motivo: payload.motivo.trim(),
    });
    if (error || !data) {
      const msg = error?.message || "Não foi possível salvar a alteração.";
      setErro(msg);
      return msg;
    }
    const atualizada = linhaParaAusencia(data as AusenciaRow);
    setAusencias((prev) => prev.map((a) => (a.id === atualizada.id ? { ...atualizada, funcionarioNome: a.funcionarioNome } : a)));
    return null;
  }, []);

  return { ausencias, loading, erro, limite: LIMITE_RESULTADOS, buscar, registrar, editar };
}

export type AusenciasFuncionariosHook = ReturnType<typeof useAusenciasFuncionarios>;
