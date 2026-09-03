"use client";

// Consulta de apontamentos_producao pra tela "Apontamentos realizados" —
// só leitura + filtros. Backend já suporta tudo isso direto (índices de
// funcionario_id/status adicionados na migration de lançamento
// retroativo/edição) — nenhuma RPC nova precisa existir só pra filtrar.
//
// NÃO embeda funcionarios(nome) — desde a migration de permissões por
// usuário/módulo (20260902190000), `funcionarios` fica atrás da permissão
// 'funcionarios'/'custo_hora', e um embed de FK ainda passa pela RLS da
// tabela referenciada. `funcionarioNome` fica null aqui de propósito; quem
// chama (ApontamentosRealizadosPage) resolve o nome via
// useFuncionariosElegibilidade (view sem essa restrição).

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";

export interface FiltrosApontamentos {
  dataInicial?: string;
  dataFinal?: string;
  periodoId?: string;
  maquinaId?: string;
  produtoId?: string;
  funcionarioId?: string;
  status?: "produzindo" | "sem_producao";
}

export interface ApontamentoRealizado {
  id: string;
  data: string;
  periodoId: string;
  periodoNome: string;
  maquinaId: string;
  maquinaNome: string;
  produtoId: string | null;
  produtoNome: string | null;
  funcionarioId: string | null;
  funcionarioNome: string | null;
  quantidadeProduzida: number;
  quantidadeRefugo: number;
  status: "produzindo" | "sem_producao";
  motivoSemProducao: string | null;
  descricaoSemProducao: string | null;
  observacao: string | null;
}

interface ApontamentoRow {
  id: string;
  data: string;
  periodo_id: string;
  maquina_id: string;
  produto_id: string | null;
  funcionario_id: string | null;
  quantidade_produzida: number;
  quantidade_refugo: number;
  status: "produzindo" | "sem_producao";
  motivo_sem_producao: string | null;
  descricao_sem_producao: string | null;
  observacao: string | null;
  maquinas: { nome: string } | null;
  produtos: { nome: string } | null;
  periodos: { nome: string } | null;
}

const SELECT = `
  id, data, periodo_id, maquina_id, produto_id, funcionario_id,
  quantidade_produzida, quantidade_refugo, status, motivo_sem_producao, descricao_sem_producao, observacao,
  maquinas(nome), produtos(nome), periodos(nome)
`;

function linhaParaApontamento(r: ApontamentoRow): ApontamentoRealizado {
  return {
    id: r.id,
    data: r.data,
    periodoId: r.periodo_id,
    periodoNome: r.periodos?.nome || r.periodo_id.toUpperCase(),
    maquinaId: r.maquina_id,
    maquinaNome: r.maquinas?.nome || "",
    produtoId: r.produto_id,
    produtoNome: r.produtos?.nome || null,
    funcionarioId: r.funcionario_id,
    funcionarioNome: null,
    quantidadeProduzida: Number(r.quantidade_produzida),
    quantidadeRefugo: Number(r.quantidade_refugo),
    status: r.status,
    motivoSemProducao: r.motivo_sem_producao,
    descricaoSemProducao: r.descricao_sem_producao,
    observacao: r.observacao,
  };
}

// Limite simples pra não virar ERP — mostra os 100 mais recentes que
// baterem com o filtro. Sem paginação nesta etapa, de propósito.
const LIMITE_RESULTADOS = 100;

export function useApontamentosRealizados(pronto: boolean) {
  const [apontamentos, setApontamentos] = useState<ApontamentoRealizado[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [buscou, setBuscou] = useState(false);

  const buscar = useCallback(async (filtros: FiltrosApontamentos) => {
    setLoading(true);
    setErro(null);
    let query = supabase
      .from("apontamentos_producao")
      .select(SELECT)
      .order("data", { ascending: false })
      .order("hora_lancamento", { ascending: false })
      .limit(LIMITE_RESULTADOS);

    if (filtros.dataInicial) query = query.gte("data", filtros.dataInicial);
    if (filtros.dataFinal) query = query.lte("data", filtros.dataFinal);
    if (filtros.periodoId) query = query.eq("periodo_id", filtros.periodoId);
    if (filtros.maquinaId) query = query.eq("maquina_id", filtros.maquinaId);
    if (filtros.produtoId) query = query.eq("produto_id", filtros.produtoId);
    if (filtros.funcionarioId) query = query.eq("funcionario_id", filtros.funcionarioId);
    if (filtros.status) query = query.eq("status", filtros.status);

    const { data, error } = await query.returns<ApontamentoRow[]>();
    setBuscou(true);
    if (error) {
      setErro("Não foi possível buscar os apontamentos.");
      setLoading(false);
      return;
    }
    setApontamentos((data || []).map(linhaParaApontamento));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!pronto) return;
    buscar({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto]);

  // Atualiza uma linha localmente depois de uma edição bem-sucedida — sem
  // refazer a busca inteira.
  function atualizarApontamentoLocal(id: string, patch: Partial<ApontamentoRealizado>) {
    setApontamentos((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  return { apontamentos, loading, erro, buscou, limite: LIMITE_RESULTADOS, buscar, atualizarApontamentoLocal };
}

export type ApontamentosRealizadosHook = ReturnType<typeof useApontamentosRealizados>;
