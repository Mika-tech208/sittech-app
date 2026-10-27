"use client";

// Camada mínima de acesso ao Supabase para funcionários + seus custos
// extras (funcionario_custos) — únicos dados autorizados nesta etapa,
// além dos 4 cadastros-base já migrados em useCadastrosBase.
//
// O frontend continua trabalhando com o formato atual (Funcionario com
// `operacao` como nome em string, `custos` como array embutido) — a
// conversão UUID/FK (operacao_id <-> nome) acontece só aqui, nunca nas
// fórmulas de src/features/custo-hora/calculations.ts.
//
// `pronto` deve refletir: sessão autenticada E cadastros-base já
// carregados (nesta ordem) — não só autenticação, para não competir com
// o fetch de categorias/operações/períodos por prioridade, e porque o
// formulário de funcionário depende da lista de operações já estar
// disponível antes de deixar o usuário salvar.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { Funcionario, FuncionarioCusto } from "@/types/domain";
import { FUNCIONARIOS_SELECT, mapearFuncionario, type FuncionarioRow } from "@/lib/custo/custoHoraDados";   // mesma fonte do servidor (custo/hora)

interface FuncionarioCustoInput {
  descricao: string;
  valor: number;
}

interface FuncionarioPayload {
  nome: string;
  operacao: string;
  salarioBase: number;
  custos: FuncionarioCustoInput[];
  ativo?: boolean;
}

async function resolverOperacaoId(nome: string): Promise<string | null> {
  const { data, error } = await supabase.from("operacoes").select("id").eq("nome", nome).maybeSingle();
  if (error || !data) return null;
  return data.id;
}

async function buscarFuncionarios(): Promise<{ lista: Funcionario[] | null }> {
  const { data, error } = await supabase
    .from("funcionarios")
    .select(FUNCIONARIOS_SELECT)
    .order("created_at");
  if (error) return { lista: null };
  return {
    lista: ((data || []) as unknown as FuncionarioRow[]).map(mapearFuncionario),
  };
}

export function useFuncionarios(pronto: boolean) {
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      const r = await buscarFuncionarios();
      if (!montado) return;
      if (!r.lista) setErro("Não foi possível carregar os funcionários.");
      else setFuncionarios(r.lista);
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [pronto]);

  // depois de excluir/unificar no backend: relê a lista (a exclusão nunca é feita pelo navegador)
  const recarregarFuncionarios = useCallback(async () => {
    const r = await buscarFuncionarios();
    if (!r.lista) setErro("Não foi possível recarregar os funcionários.");
    else setFuncionarios(r.lista);
  }, []);

  const criarFuncionario = useCallback(async (payload: FuncionarioPayload): Promise<Funcionario | null> => {
    const operacaoId = await resolverOperacaoId(payload.operacao);
    if (!operacaoId) {
      setErro("Não foi possível salvar o funcionário: operação não encontrada.");
      return null;
    }
    const { data: funcRow, error } = await supabase
      .from("funcionarios")
      .insert({ nome: payload.nome, operacao_id: operacaoId, salario_base: payload.salarioBase, ativo: payload.ativo ?? true })
      .select("id, nome, salario_base, ativo, created_at")
      .single();
    if (error || !funcRow) {
      setErro("Não foi possível criar o funcionário.");
      return null;
    }
    let custosSalvos: FuncionarioCusto[] = [];
    if (payload.custos.length > 0) {
      const { data: custosRows, error: custoErro } = await supabase
        .from("funcionario_custos")
        .insert(payload.custos.map((c) => ({ funcionario_id: funcRow.id, descricao: c.descricao, valor: c.valor })))
        .select("id, descricao, valor");
      if (custoErro) setErro("Funcionário criado, mas não foi possível salvar os custos extras.");
      else custosSalvos = (custosRows || []).map((c) => ({ id: c.id, descricao: c.descricao, valor: Number(c.valor) }));
    }
    const novo: Funcionario = {
      id: funcRow.id, nome: funcRow.nome, criadoEm: funcRow.created_at, operacao: payload.operacao,
      salarioBase: Number(funcRow.salario_base), ativo: funcRow.ativo, custos: custosSalvos,
    };
    setFuncionarios((prev) => [...prev, novo]);
    return novo;
  }, []);

  // custos sempre substituídos por inteiro (apaga e recria) — mesmo
  // comportamento do formulário atual, que sempre envia a lista completa.
  const atualizarFuncionario = useCallback(async (id: string, payload: FuncionarioPayload): Promise<boolean> => {
    // cadastro de funcionário INATIVO é somente leitura (salvar apagaria e recriaria os custos extras): só reativar
    const atual = funcionarios.find((f) => f.id === id);
    if (atual && !atual.ativo) {
      setErro("Funcionário inativo: o cadastro é somente leitura. Reative o funcionário para editar.");
      return false;
    }
    const operacaoId = await resolverOperacaoId(payload.operacao);
    if (!operacaoId) {
      setErro("Não foi possível salvar o funcionário: operação não encontrada.");
      return false;
    }
    const { error } = await supabase
      .from("funcionarios")
      .update({ nome: payload.nome, operacao_id: operacaoId, salario_base: payload.salarioBase })
      .eq("id", id);
    if (error) {
      setErro("Não foi possível salvar o funcionário.");
      return false;
    }
    const { error: delErro } = await supabase.from("funcionario_custos").delete().eq("funcionario_id", id);
    if (delErro) setErro("Funcionário salvo, mas não foi possível atualizar os custos extras.");
    let custosSalvos: FuncionarioCusto[] = [];
    if (payload.custos.length > 0) {
      const { data: custosRows, error: custoErro } = await supabase
        .from("funcionario_custos")
        .insert(payload.custos.map((c) => ({ funcionario_id: id, descricao: c.descricao, valor: c.valor })))
        .select("id, descricao, valor");
      if (custoErro) setErro("Funcionário salvo, mas não foi possível atualizar os custos extras.");
      else custosSalvos = (custosRows || []).map((c) => ({ id: c.id, descricao: c.descricao, valor: Number(c.valor) }));
    }
    setFuncionarios((prev) => prev.map((f) => (
      f.id === id ? { ...f, nome: payload.nome, operacao: payload.operacao, salarioBase: payload.salarioBase, custos: custosSalvos } : f
    )));
    return true;
  }, [funcionarios]);

  const duplicarFuncionario = useCallback((f: Funcionario) => {
    return criarFuncionario({
      nome: f.nome + " (cópia)", operacao: f.operacao, salarioBase: f.salarioBase, ativo: true, // a cópia nasce ativa: ativar/desativar só pelas ações de administrador
      custos: f.custos.map((c) => ({ descricao: c.descricao, valor: c.valor })),
    });
  }, [criarFuncionario]);

  return {
    funcionarios, loading, erro,
    criarFuncionario, atualizarFuncionario, duplicarFuncionario, recarregarFuncionarios,
  };
}

export type FuncionariosHook = ReturnType<typeof useFuncionarios>;
