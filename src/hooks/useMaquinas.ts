"use client";

// Camada mínima de acesso ao Supabase para máquinas — único dado
// autorizado nesta etapa, além dos cadastros-base e funcionários já
// migrados. O frontend continua recebendo Maquina no formato atual
// (operacao como nome em string) — a conversão operacao_id <-> nome
// acontece só aqui, nunca em capacidade/calculations.ts nem em
// produtos/calculations.ts.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { Maquina } from "@/types/domain";

interface MaquinaPayload {
  nome: string;
  operacao: string;
}

interface MaquinaRow {
  id: string;
  nome: string;
  ativo: boolean;
  operacoes: { nome: string } | null;
}

async function resolverOperacaoId(nome: string): Promise<string | null> {
  const { data, error } = await supabase.from("operacoes").select("id").eq("nome", nome).maybeSingle();
  if (error || !data) return null;
  return data.id;
}

export function useMaquinas(pronto: boolean) {
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      const { data, error } = await supabase
        .from("maquinas")
        .select("id, nome, ativo, operacoes(nome)")
        .order("created_at");
      if (!montado) return;
      if (error) {
        setErro("Não foi possível carregar as máquinas.");
        setLoading(false);
        return;
      }
      setMaquinas(
        ((data || []) as unknown as MaquinaRow[]).map((m) => ({
          id: m.id, nome: m.nome, operacao: m.operacoes?.nome || "", ativo: m.ativo,
        }))
      );
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [pronto]);

  const criarMaquina = useCallback(async (payload: MaquinaPayload): Promise<Maquina | null> => {
    const operacaoId = await resolverOperacaoId(payload.operacao);
    if (!operacaoId) {
      setErro("Não foi possível salvar a máquina: operação não encontrada.");
      return null;
    }
    const { data, error } = await supabase
      .from("maquinas")
      .insert({ nome: payload.nome, operacao_id: operacaoId, ativo: true })
      .select("id, nome, ativo")
      .single();
    if (error || !data) {
      setErro("Não foi possível criar a máquina.");
      return null;
    }
    const nova: Maquina = { id: data.id, nome: data.nome, operacao: payload.operacao, ativo: data.ativo };
    setMaquinas((prev) => [...prev, nova]);
    return nova;
  }, []);

  // Preserva id e ativo — a edição nunca troca a identidade nem mexe no
  // estado ativo/pausada (mesma regra do CRUD anterior, agora no Supabase).
  const atualizarMaquina = useCallback(async (id: string, payload: MaquinaPayload): Promise<boolean> => {
    const operacaoId = await resolverOperacaoId(payload.operacao);
    if (!operacaoId) {
      setErro("Não foi possível salvar a máquina: operação não encontrada.");
      return false;
    }
    const { error } = await supabase.from("maquinas").update({ nome: payload.nome, operacao_id: operacaoId }).eq("id", id);
    if (error) {
      setErro("Não foi possível salvar a máquina.");
      return false;
    }
    setMaquinas((prev) => prev.map((m) => (m.id === id ? { ...m, nome: payload.nome, operacao: payload.operacao } : m)));
    return true;
  }, []);

  const alternarMaquinaAtiva = useCallback(async (id: string) => {
    const atual = maquinas.find((m) => m.id === id);
    if (!atual) return;
    const novoAtivo = !atual.ativo;
    setMaquinas((prev) => prev.map((m) => (m.id === id ? { ...m, ativo: novoAtivo } : m)));
    const { error } = await supabase.from("maquinas").update({ ativo: novoAtivo }).eq("id", id);
    if (error) setErro("Não foi possível atualizar a máquina.");
  }, [maquinas]);

  // Exclusão respeita a FK RESTRICT do banco (roteiro de produto e
  // previsões referenciam maquina_id) — se estiver em uso, o Postgres
  // recusa (23503) e isso vira um erro claro pro usuário, sem apagar
  // referência nem forçar nada. Não otimista de propósito: só some da
  // lista se realmente excluiu.
  const removerMaquina = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await supabase.from("maquinas").delete().eq("id", id);
    if (error) {
      if (error.code === "23503") {
        setErro("Essa máquina está sendo usada em algum produto ou previsão e não pode ser excluída — pause ela em vez de excluir.");
      } else {
        setErro("Não foi possível excluir a máquina.");
      }
      return false;
    }
    setMaquinas((prev) => prev.filter((m) => m.id !== id));
    return true;
  }, []);

  return {
    maquinas, loading, erro,
    criarMaquina, atualizarMaquina, alternarMaquinaAtiva, removerMaquina,
  };
}

export type MaquinasHook = ReturnType<typeof useMaquinas>;
