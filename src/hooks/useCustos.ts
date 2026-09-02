"use client";

// Camada mínima de acesso ao Supabase para custos fixos e pontuais
// (fixed_costs, variable_entries) — únicos dados autorizados nesta parte
// da etapa Financeiro, além de tudo que já foi migrado antes. O frontend
// continua recebendo FixedCost/VariableEntry no formato atual (categoria
// como nome em string) — a conversão categoria_id <-> nome acontece só
// aqui, nunca em custo-hora/calculations.ts.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { FixedCost, VariableEntry } from "@/types/domain";

interface FixedCostPayload {
  descricao: string;
  categoria: string;
  valor: number;
}

interface VariableEntryPayload {
  mes: string; // "AAAA-MM"
  descricao: string;
  categoria: string;
  valor: number;
}

interface FixedCostRow {
  id: string;
  descricao: string;
  valor: number;
  ativo: boolean;
  categorias: { nome: string } | null;
}

interface VariableEntryRow {
  id: string;
  mes: string;
  descricao: string;
  valor: number;
  categorias: { nome: string } | null;
}

async function resolverCategoriaId(nome: string): Promise<string | null> {
  const { data, error } = await supabase.from("categorias").select("id").eq("nome", nome).maybeSingle();
  if (error || !data) return null;
  return data.id;
}

export function useCustos(pronto: boolean) {
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([]);
  const [variableEntries, setVariableEntries] = useState<VariableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      const [fixosRes, variaveisRes] = await Promise.all([
        supabase.from("fixed_costs").select("id, descricao, valor, ativo, categorias(nome)").order("created_at"),
        supabase.from("variable_entries").select("id, mes, descricao, valor, categorias(nome)").order("created_at"),
      ]);
      if (!montado) return;
      if (fixosRes.error || variaveisRes.error) {
        setErro("Não foi possível carregar os custos.");
        setLoading(false);
        return;
      }
      setFixedCosts(
        ((fixosRes.data || []) as unknown as FixedCostRow[]).map((f) => ({
          id: f.id, descricao: f.descricao, categoria: f.categorias?.nome || "", valor: Number(f.valor), ativo: f.ativo,
        }))
      );
      setVariableEntries(
        ((variaveisRes.data || []) as unknown as VariableEntryRow[]).map((e) => ({
          id: e.id, mes: String(e.mes).slice(0, 7), descricao: e.descricao, categoria: e.categorias?.nome || "", valor: Number(e.valor),
        }))
      );
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [pronto]);

  const criarFixedCost = useCallback(async (payload: FixedCostPayload): Promise<FixedCost | null> => {
    const categoriaId = await resolverCategoriaId(payload.categoria);
    if (!categoriaId) { setErro("Não foi possível salvar o custo fixo: categoria não encontrada."); return null; }
    const { data, error } = await supabase
      .from("fixed_costs")
      .insert({ descricao: payload.descricao, categoria_id: categoriaId, valor: payload.valor, ativo: true })
      .select("id, descricao, valor, ativo")
      .single();
    if (error || !data) { setErro("Não foi possível criar o custo fixo."); return null; }
    const novo: FixedCost = { id: data.id, descricao: data.descricao, categoria: payload.categoria, valor: Number(data.valor), ativo: data.ativo };
    setFixedCosts((prev) => [...prev, novo]);
    return novo;
  }, []);

  // Preserva id e ativo — a edição nunca troca a identidade nem mexe no
  // estado ativo/pausado.
  const atualizarFixedCost = useCallback(async (id: string, payload: FixedCostPayload): Promise<boolean> => {
    const categoriaId = await resolverCategoriaId(payload.categoria);
    if (!categoriaId) { setErro("Não foi possível salvar o custo fixo: categoria não encontrada."); return false; }
    const { error } = await supabase
      .from("fixed_costs")
      .update({ descricao: payload.descricao, categoria_id: categoriaId, valor: payload.valor })
      .eq("id", id);
    if (error) { setErro("Não foi possível salvar o custo fixo."); return false; }
    setFixedCosts((prev) => prev.map((f) => (f.id === id ? { ...f, descricao: payload.descricao, categoria: payload.categoria, valor: payload.valor } : f)));
    return true;
  }, []);

  const alternarFixedCostAtivo = useCallback(async (id: string) => {
    const atual = fixedCosts.find((f) => f.id === id);
    if (!atual) return;
    const novoAtivo = !atual.ativo;
    setFixedCosts((prev) => prev.map((f) => (f.id === id ? { ...f, ativo: novoAtivo } : f)));
    const { error } = await supabase.from("fixed_costs").update({ ativo: novoAtivo }).eq("id", id);
    if (error) setErro("Não foi possível atualizar o custo fixo.");
  }, [fixedCosts]);

  const removerFixedCost = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await supabase.from("fixed_costs").delete().eq("id", id);
    if (error) { setErro("Não foi possível excluir o custo fixo."); return false; }
    setFixedCosts((prev) => prev.filter((f) => f.id !== id));
    return true;
  }, []);

  const criarVariableEntry = useCallback(async (payload: VariableEntryPayload): Promise<VariableEntry | null> => {
    const categoriaId = await resolverCategoriaId(payload.categoria);
    if (!categoriaId) { setErro("Não foi possível salvar o custo pontual: categoria não encontrada."); return null; }
    const { data, error } = await supabase
      .from("variable_entries")
      .insert({ mes: `${payload.mes}-01`, descricao: payload.descricao, categoria_id: categoriaId, valor: payload.valor })
      .select("id, mes, descricao, valor")
      .single();
    if (error || !data) { setErro("Não foi possível criar o custo pontual."); return null; }
    const novo: VariableEntry = { id: data.id, mes: String(data.mes).slice(0, 7), descricao: data.descricao, categoria: payload.categoria, valor: Number(data.valor) };
    setVariableEntries((prev) => [...prev, novo]);
    return novo;
  }, []);

  const atualizarVariableEntry = useCallback(async (id: string, payload: VariableEntryPayload): Promise<boolean> => {
    const categoriaId = await resolverCategoriaId(payload.categoria);
    if (!categoriaId) { setErro("Não foi possível salvar o custo pontual: categoria não encontrada."); return false; }
    const { error } = await supabase
      .from("variable_entries")
      .update({ mes: `${payload.mes}-01`, descricao: payload.descricao, categoria_id: categoriaId, valor: payload.valor })
      .eq("id", id);
    if (error) { setErro("Não foi possível salvar o custo pontual."); return false; }
    setVariableEntries((prev) => prev.map((e) => (e.id === id ? { ...e, mes: payload.mes, descricao: payload.descricao, categoria: payload.categoria, valor: payload.valor } : e)));
    return true;
  }, []);

  const removerVariableEntry = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await supabase.from("variable_entries").delete().eq("id", id);
    if (error) { setErro("Não foi possível excluir o custo pontual."); return false; }
    setVariableEntries((prev) => prev.filter((e) => e.id !== id));
    return true;
  }, []);

  return {
    fixedCosts, variableEntries, loading, erro,
    criarFixedCost, atualizarFixedCost, alternarFixedCostAtivo, removerFixedCost,
    criarVariableEntry, atualizarVariableEntry, removerVariableEntry,
  };
}

export type CustosHook = ReturnType<typeof useCustos>;
