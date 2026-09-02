"use client";

// Camada mínima de acesso ao Supabase para faturamento mensal
// (faturamentos, receitas) — últimos dados autorizados na etapa
// Financeiro, além de tudo que já foi migrado antes. O frontend continua
// recebendo Faturamento/Receita no formato atual — `numFuncionarios`/
// `custoFuncionariosTotal`/`custoFixoTotal` seguem como STRING (like
// `diasUteis` em cadastros-base) porque são ligados direto a
// `<input value=...>` controlados na tela de Faturamento mensal; viram
// number só na hora de gravar. São sempre um SNAPSHOT digitado/copiado
// pelo usuário (ver `preencherComDadosAtuais` em SittechApp.tsx) — esta
// camada nunca recalcula nem sobrescreve esses valores sozinha.
//
// Sem RPC: nada referencia faturamentos.id com RESTRICT (só o CASCADE de
// receitas.faturamento_id), então criar o mês e gravar campos/receita
// nunca é bloqueado por integridade referencial — mesmo raciocínio já
// usado em previsões. Após qualquer escrita, a lista inteira é recarregada
// (poucas dezenas de linhas — 20 meses / ~70 receitas hoje) em vez de só
// remendar o estado local, porque mover uma receita de mês pode afetar
// dois meses ao mesmo tempo (origem e destino).

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { Faturamento, Receita } from "@/types/domain";

interface ReceitaRow {
  id: string;
  data: string;
  descricao: string;
  valor: number;
}

interface FaturamentoRow {
  id: string;
  mes: string;
  num_funcionarios: number;
  custo_funcionarios_total: number;
  custo_fixo_total: number;
  receitas: ReceitaRow[] | null;
}

const FATURAMENTO_SELECT = "id, mes, num_funcionarios, custo_funcionarios_total, custo_fixo_total, receitas(id, data, descricao, valor)";

function linhaParaFaturamento(f: FaturamentoRow): Faturamento {
  return {
    mes: String(f.mes).slice(0, 7),
    receitas: (f.receitas || []).map((r): Receita => ({ id: r.id, data: r.data, descricao: r.descricao, valor: Number(r.valor) })),
    numFuncionarios: String(f.num_funcionarios),
    custoFuncionariosTotal: String(f.custo_funcionarios_total),
    custoFixoTotal: String(f.custo_fixo_total),
  };
}

async function garantirFaturamentoId(mes: string): Promise<string | null> {
  const mesDate = `${mes}-01`;
  const { data: existente, error: selErro } = await supabase.from("faturamentos").select("id").eq("mes", mesDate).maybeSingle();
  if (selErro) return null;
  if (existente) return existente.id;
  const { data: criado, error: insErro } = await supabase.from("faturamentos").insert({ mes: mesDate }).select("id").single();
  if (insErro || !criado) return null;
  return criado.id;
}

export function useFaturamentos(pronto: boolean) {
  const [faturamentos, setFaturamentos] = useState<Faturamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregarTudo = useCallback(async (): Promise<boolean> => {
    const { data, error } = await supabase.from("faturamentos").select(FATURAMENTO_SELECT).order("mes");
    if (error) return false;
    setFaturamentos(((data || []) as unknown as FaturamentoRow[]).map(linhaParaFaturamento));
    return true;
  }, []);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      const ok = await carregarTudo();
      if (!montado) return;
      if (!ok) setErro("Não foi possível carregar o faturamento.");
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [pronto, carregarTudo]);

  // Cria o mês se ainda não existir e grava só os campos que vierem em
  // `campos` (mesmo comportamento do updateFatCampos atual) — nunca
  // recalcula nada, só converte a string digitada pra number na gravação.
  const atualizarCamposMes = useCallback(async (
    mes: string,
    campos: Partial<{ numFuncionarios: string; custoFuncionariosTotal: string; custoFixoTotal: string }>
  ): Promise<boolean> => {
    const faturamentoId = await garantirFaturamentoId(mes);
    if (!faturamentoId) { setErro("Não foi possível salvar o faturamento desse mês."); return false; }
    const patch: Record<string, number> = {};
    if (campos.numFuncionarios !== undefined) patch.num_funcionarios = Number(String(campos.numFuncionarios).replace(",", ".")) || 0;
    if (campos.custoFuncionariosTotal !== undefined) patch.custo_funcionarios_total = Number(String(campos.custoFuncionariosTotal).replace(",", ".")) || 0;
    if (campos.custoFixoTotal !== undefined) patch.custo_fixo_total = Number(String(campos.custoFixoTotal).replace(",", ".")) || 0;
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from("faturamentos").update(patch).eq("id", faturamentoId);
      if (error) { setErro("Não foi possível salvar o faturamento desse mês."); return false; }
    }
    const ok = await carregarTudo();
    if (!ok) setErro("Faturamento salvo, mas não foi possível recarregar os dados atualizados.");
    return true;
  }, [carregarTudo]);

  // Cria (sem id) ou edita (com id) uma receita — editar pode mudar o mês
  // (a receita "muda de faturamento" trocando faturamento_id), preservando
  // o id da receita, igual ao comportamento atual (submitReceita sempre
  // reaproveita editingReceitaId).
  const salvarReceita = useCallback(async (payload: { id?: string; data: string; descricao: string; valor: number }): Promise<boolean> => {
    const mes = payload.data.slice(0, 7);
    const faturamentoId = await garantirFaturamentoId(mes);
    if (!faturamentoId) { setErro("Não foi possível salvar o lançamento."); return false; }
    if (payload.id) {
      const { error } = await supabase
        .from("receitas")
        .update({ faturamento_id: faturamentoId, data: payload.data, descricao: payload.descricao, valor: payload.valor })
        .eq("id", payload.id);
      if (error) { setErro("Não foi possível salvar o lançamento."); return false; }
    } else {
      const { error } = await supabase
        .from("receitas")
        .insert({ faturamento_id: faturamentoId, data: payload.data, descricao: payload.descricao, valor: payload.valor });
      if (error) { setErro("Não foi possível criar o lançamento."); return false; }
    }
    const ok = await carregarTudo();
    if (!ok) setErro("Lançamento salvo, mas não foi possível recarregar os dados atualizados.");
    return true;
  }, [carregarTudo]);

  const removerReceita = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await supabase.from("receitas").delete().eq("id", id);
    if (error) { setErro("Não foi possível excluir o lançamento."); return false; }
    const ok = await carregarTudo();
    if (!ok) setErro("Lançamento excluído, mas não foi possível recarregar os dados atualizados.");
    return true;
  }, [carregarTudo]);

  return { faturamentos, loading, erro, atualizarCamposMes, salvarReceita, removerReceita };
}

export type FaturamentosHook = ReturnType<typeof useFaturamentos>;
