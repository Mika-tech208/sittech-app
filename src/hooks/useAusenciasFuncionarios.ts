"use client";

// Consulta + escrita de ausencias_funcionarios — "Faltas e Ausências" V1.
// Mesmo padrão de useApontamentosRealizados.ts: funcionarioNome fica null
// aqui de propósito (não embeda funcionarios(nome), que fica atrás da
// permissão 'funcionarios'/'custo_hora') — quem chama resolve o nome via
// useFuncionariosElegibilidade, igual já é feito em
// ApontamentosRealizadosPage.tsx.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { TipoAusencia } from "@/features/ausencias/calculations";
import type { ResultadoDiaLote } from "@/features/ausencias/lote";
import { dispararProcessamentoEscala } from "@/lib/escala/disparar";

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
  // Atraso em aberto: o funcionário ainda não chegou (horarioFim = null, duração provisória 0 no banco).
  emAberto: boolean;
  encerradaEm: string | null;
  chegadaManual: boolean | null; // true = horário informado à mão; false = "chegou agora"; null = aberto ou fechamento automático
  encerramentoAutomatico: boolean; // fechado às 17:00 do dia porque ninguém registrou a chegada
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
  em_aberto: boolean;
  encerrada_em: string | null;
  chegada_manual: boolean | null;
  encerramento_automatico: boolean;
}

const SELECT = `
  id, funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos,
  periodos_snapshot, observacao, criado_por, criado_em, atualizado_em,
  em_aberto, encerrada_em, chegada_manual, encerramento_automatico
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
    emAberto: Boolean(r.em_aberto),
    encerradaEm: r.encerrada_em ?? null,
    chegadaManual: r.chegada_manual ?? null,
    encerramentoAutomatico: Boolean(r.encerramento_automatico),
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

export interface RegistrarLotePayload {
  funcionarioId: string;
  datas: string[];
  tipo: TipoAusencia;
  horarioInicio: string | null;
  horarioFim: string | null;
  duracaoMinutos: number;
  observacao: string;
  loteKey: string;
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

export interface AbrirAtrasoPayload {
  funcionarioId: string;
  data: string; // hoje (America/Sao_Paulo); o banco recusa outro dia
  horarioInicio: string | null; // null = início da manhã da jornada oficial (07:12); "13:00" para atraso após o almoço
  observacao: string;
  idempotencyKey: string;
}

export function useAusenciasFuncionarios(pronto: boolean) {
  const [ausencias, setAusencias] = useState<AusenciaFuncionario[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ultimosFiltros = useRef<FiltrosAusencias>({});

  const buscar = useCallback(async (filtros: FiltrosAusencias): Promise<AusenciaFuncionario[] | undefined> => {
    ultimosFiltros.current = filtros;
    setLoading(true);
    setErro(null);
    // Fecha (fim da jornada) os atrasos em aberto que já venceram — dia anterior esquecido ou depois das 17:00 —, antes de listar.
    // Best-effort: o fechamento oficial é o do servidor (/api/escala/drenar), isto só evita mostrar "em aberto" velho.
    await supabase.rpc("fechar_atrasos_vencidos");
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
    void dispararProcessamentoEscala(); // Escala: recalcula os períodos futuros (best-effort)
    return null;
  }, []);

  // Lote: um registro por dia, gravado pela RPC (chave por dia derivada da
  // chave do lote — retry/clique duplo não duplica). `erro` só vem preenchido
  // em falha total (ex.: sem permissão); conflitos por dia vêm em `resultados`.
  const registrarLote = useCallback(async (payload: RegistrarLotePayload): Promise<{ erro: string | null; resultados: ResultadoDiaLote[] }> => {
    const { data, error } = await supabase.rpc("registrar_ausencias_funcionario_lote", {
      p_funcionario_id: payload.funcionarioId,
      p_datas: payload.datas,
      p_tipo: payload.tipo,
      p_horario_inicio: payload.horarioInicio,
      p_horario_fim: payload.horarioFim,
      p_duracao_minutos: payload.duracaoMinutos,
      p_observacao: payload.observacao.trim() || null,
      p_lote_key: payload.loteKey,
    });
    if (error || !Array.isArray(data)) {
      return { erro: error?.message || "Não foi possível registrar as ausências.", resultados: [] };
    }
    // recarrega pelo filtro vigente: os dias criados entram na lista/resumo
    await buscar(ultimosFiltros.current);
    void dispararProcessamentoEscala(); // Escala: recalcula os períodos futuros (best-effort)
    return { erro: null, resultados: data as ResultadoDiaLote[] };
  }, [buscar]);

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
    void dispararProcessamentoEscala(); // Escala: recalcula os períodos futuros (best-effort)
    return null;
  }, []);

  // Atraso em aberto: "Funcionário ainda não chegou". Retorna null em sucesso ou a mensagem da RPC.
  const abrirAtraso = useCallback(async (payload: AbrirAtrasoPayload): Promise<string | null> => {
    const { data, error } = await supabase.rpc("abrir_atraso_funcionario", {
      p_funcionario_id: payload.funcionarioId,
      p_data: payload.data,
      p_horario_inicio: payload.horarioInicio,
      p_observacao: payload.observacao.trim() || null,
      p_idempotency_key: payload.idempotencyKey,
    });
    if (error || !data) {
      const msg = error?.message || "Não foi possível registrar o atraso.";
      setErro(msg);
      return msg;
    }
    setAusencias((prev) => [linhaParaAusencia(data as AusenciaRow), ...prev.filter((a) => a.id !== (data as AusenciaRow).id)]);
    void dispararProcessamentoEscala();
    return null;
  }, []);

  // "FUNCIONÁRIO CHEGOU" (horarioChegada = null: hora do SERVIDOR em America/Sao_Paulo) ou "INFORMAR HORÁRIO DE CHEGADA" (HH:MM, mesmo dia).
  const encerrarAtraso = useCallback(async (id: string, horarioChegada: string | null): Promise<string | null> => {
    const { data, error } = await supabase.rpc("encerrar_atraso_funcionario", { p_ausencia_id: id, p_horario_chegada: horarioChegada });
    if (error || !data) {
      const msg = error?.message || "Não foi possível registrar a chegada.";
      setErro(msg);
      return msg;
    }
    const atualizada = linhaParaAusencia(data as AusenciaRow);
    setAusencias((prev) => prev.map((a) => (a.id === atualizada.id ? { ...atualizada, funcionarioNome: a.funcionarioNome } : a)));
    void dispararProcessamentoEscala();
    return null;
  }, []);

  // Correção do horário INICIAL de um atraso ainda em aberto (motivo obrigatório; antes/depois ficam no histórico).
  const corrigirInicioAberto = useCallback(async (id: string, horarioInicio: string, motivo: string): Promise<string | null> => {
    const { data, error } = await supabase.rpc("corrigir_inicio_atraso_aberto", { p_ausencia_id: id, p_horario_inicio: horarioInicio, p_motivo: motivo.trim() });
    if (error || !data) {
      const msg = error?.message || "Não foi possível corrigir o horário inicial.";
      setErro(msg);
      return msg;
    }
    const atualizada = linhaParaAusencia(data as AusenciaRow);
    setAusencias((prev) => prev.map((a) => (a.id === atualizada.id ? { ...atualizada, funcionarioNome: a.funcionarioNome } : a)));
    void dispararProcessamentoEscala();
    return null;
  }, []);

  return { ausencias, loading, erro, limite: LIMITE_RESULTADOS, buscar, registrar, registrarLote, editar, abrirAtraso, encerrarAtraso, corrigirInicioAberto };
}

export type AusenciasFuncionariosHook = ReturnType<typeof useAusenciasFuncionarios>;
