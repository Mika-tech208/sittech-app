"use client";

// Camada mínima de acesso ao Supabase para Previsão Semanal (previsoes,
// previsao_itens, previsao_item_maquinas, previsao_maquinas_indisponiveis)
// — únicos dados autorizados nesta etapa, além de cadastros-base,
// funcionários, máquinas e produtos já migrados. O frontend continua
// recebendo Previsao/PrevisaoItem no formato atual (`itens`/
// `itensRealizados` como dois arrays, `maquinasPorEtapa` agrupado por
// etapa) — a conversão banco <-> frontend (tipo discriminando
// previsto/realizado, linhas de junção) acontece só aqui. Nenhuma fórmula
// de capacidade/viabilidade (features/capacidade/calculations.ts,
// selectors.ts) foi tocada — continuam recebendo os mesmos tipos de
// sempre.
//
// Sem RPC: ao contrário de roteiro_etapas (que tinha RESTRICT vindo de
// previsao_item_maquinas.etapa_id), nada referencia previsao_itens.id
// além do próprio CASCADE de previsao_item_maquinas — apagar e recriar os
// itens de um tipo nunca é bloqueado por integridade referencial. O único
// risco residual é uma falha de rede no meio das chamadas REST
// sequenciais (mesma limitação já aceita em funcionario_custos e no
// roteiro de produtos antes da correção) — não uma perda de dado
// histórico, só um salvamento incompleto que o usuário vê pelo erro e
// pode tentar de novo.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { Previsao, PrevisaoItem } from "@/types/domain";

type TipoItem = "previsto" | "realizado";

interface PrevisaoItemRow {
  id: string;
  tipo: TipoItem;
  produto_id: string;
  produto_nome: string;
  valor_unitario: number;
  quantidade: number;
  previsao_item_maquinas: { etapa_id: string; maquina_id: string }[] | null;
}

interface PrevisaoRow {
  id: string;
  semana_inicio: string;
  previsao_itens: PrevisaoItemRow[] | null;
  previsao_maquinas_indisponiveis: { maquina_id: string }[] | null;
}

const PREVISAO_SELECT = `
  id, semana_inicio,
  previsao_itens(
    id, tipo, produto_id, produto_nome, valor_unitario, quantidade,
    previsao_item_maquinas(etapa_id, maquina_id)
  ),
  previsao_maquinas_indisponiveis(maquina_id)
`;

function agruparMaquinasPorEtapa(linhas: { etapa_id: string; maquina_id: string }[] | null): Record<string, string[]> {
  const mapa: Record<string, string[]> = {};
  (linhas || []).forEach((l) => {
    if (!mapa[l.etapa_id]) mapa[l.etapa_id] = [];
    mapa[l.etapa_id].push(l.maquina_id);
  });
  return mapa;
}

function linhaParaItem(i: PrevisaoItemRow): PrevisaoItem {
  return {
    id: i.id, produtoId: i.produto_id, produtoNome: i.produto_nome,
    valorUnitario: Number(i.valor_unitario), quantidade: Number(i.quantidade),
    maquinasPorEtapa: agruparMaquinasPorEtapa(i.previsao_item_maquinas),
  };
}

function linhaParaPrevisao(p: PrevisaoRow): Previsao {
  const linhas = p.previsao_itens || [];
  return {
    semanaInicio: p.semana_inicio,
    itens: linhas.filter((i) => i.tipo === "previsto").map(linhaParaItem),
    itensRealizados: linhas.filter((i) => i.tipo === "realizado").map(linhaParaItem),
    maquinasIndisponiveis: (p.previsao_maquinas_indisponiveis || []).map((m) => m.maquina_id),
  };
}

async function garantirPrevisaoId(semanaInicio: string): Promise<string | null> {
  const { data: existente, error: selErro } = await supabase
    .from("previsoes").select("id").eq("semana_inicio", semanaInicio).maybeSingle();
  if (selErro) return null;
  if (existente) return existente.id;
  const { data: criada, error: insErro } = await supabase
    .from("previsoes").insert({ semana_inicio: semanaInicio }).select("id").single();
  if (insErro || !criada) return null;
  return criada.id;
}

// Substitui todos os itens de um tipo (previsto ou realizado) da semana —
// mesmo comportamento do formulário atual, que sempre envia a lista
// completa. produto_id só é gravado com o id que já veio no item (sempre
// um produto real, escolhido no <select> a partir de `produtos` já
// migrado) — nunca resolvido/recalculado aqui. produto_nome/valor_unitario
// são gravados exatamente como vieram (snapshot do momento do
// lançamento), nunca relidos de `produtos`.
async function sincronizarItens(previsaoId: string, tipo: TipoItem, itens: PrevisaoItem[]): Promise<boolean> {
  const { error: delErro } = await supabase.from("previsao_itens").delete().eq("previsao_id", previsaoId).eq("tipo", tipo);
  if (delErro) return false;
  for (const it of itens) {
    const { data: novoItem, error: insErro } = await supabase
      .from("previsao_itens")
      .insert({
        previsao_id: previsaoId, tipo, produto_id: it.produtoId, produto_nome: it.produtoNome,
        valor_unitario: it.valorUnitario, quantidade: it.quantidade,
      })
      .select("id")
      .single();
    if (insErro || !novoItem) return false;
    // itens legados/realizados sem nenhuma seleção de máquina (maquinasPorEtapa
    // ausente ou vazio) simplesmente não geram nenhuma linha aqui — é a
    // semântica natural de uma junção vazia, não um valor especial.
    const linhasMaquinas = Object.entries(it.maquinasPorEtapa || {}).flatMap(([etapaId, maquinaIds]) =>
      (maquinaIds || []).map((maquinaId) => ({ item_id: novoItem.id, etapa_id: etapaId, maquina_id: maquinaId }))
    );
    if (linhasMaquinas.length > 0) {
      const { error: mErro } = await supabase.from("previsao_item_maquinas").insert(linhasMaquinas);
      if (mErro) return false;
    }
  }
  return true;
}

async function sincronizarMaquinasIndisponiveis(previsaoId: string, maquinaIds: string[]): Promise<boolean> {
  const { error: delErro } = await supabase.from("previsao_maquinas_indisponiveis").delete().eq("previsao_id", previsaoId);
  if (delErro) return false;
  if (maquinaIds.length === 0) return true;
  const { error: insErro } = await supabase
    .from("previsao_maquinas_indisponiveis")
    .insert(maquinaIds.map((id) => ({ previsao_id: previsaoId, maquina_id: id })));
  return !insErro;
}

export function usePrevisoes(pronto: boolean) {
  const [previsoes, setPrevisoes] = useState<Previsao[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      const { data, error } = await supabase.from("previsoes").select(PREVISAO_SELECT).order("semana_inicio");
      if (!montado) return;
      if (error) {
        setErro("Não foi possível carregar as previsões.");
        setLoading(false);
        return;
      }
      setPrevisoes(((data || []) as unknown as PrevisaoRow[]).map(linhaParaPrevisao));
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [pronto]);

  // Mesma assinatura do upsertSemana que já existia nas páginas — só troca
  // o destino (Supabase em vez do blob). `campos` só grava as partes que
  // vieram (itens / itensRealizados / maquinasIndisponiveis); as demais
  // ficam como já estavam no banco.
  const upsertSemana = useCallback(async (semanaInicio: string, campos: Partial<Previsao>): Promise<boolean> => {
    const previsaoId = await garantirPrevisaoId(semanaInicio);
    if (!previsaoId) {
      setErro("Não foi possível salvar a previsão dessa semana.");
      return false;
    }
    if (campos.itens !== undefined) {
      const ok = await sincronizarItens(previsaoId, "previsto", campos.itens);
      if (!ok) { setErro("Não foi possível salvar os itens previstos."); return false; }
    }
    if (campos.itensRealizados !== undefined) {
      const ok = await sincronizarItens(previsaoId, "realizado", campos.itensRealizados);
      if (!ok) { setErro("Não foi possível salvar os itens realizados."); return false; }
    }
    if (campos.maquinasIndisponiveis !== undefined) {
      const ok = await sincronizarMaquinasIndisponiveis(previsaoId, campos.maquinasIndisponiveis);
      if (!ok) { setErro("Não foi possível salvar as máquinas indisponíveis dessa semana."); return false; }
    }

    const { data, error } = await supabase.from("previsoes").select(PREVISAO_SELECT).eq("id", previsaoId).single();
    if (error || !data) {
      setErro("Previsão salva, mas não foi possível recarregar os dados atualizados.");
      return true;
    }
    const atualizada = linhaParaPrevisao(data as unknown as PrevisaoRow);
    setPrevisoes((prev) => {
      const idx = prev.findIndex((p) => p.semanaInicio === semanaInicio);
      if (idx === -1) return [...prev, atualizada];
      return prev.map((p, i) => (i === idx ? atualizada : p));
    });
    return true;
  }, []);

  return { previsoes, loading, erro, upsertSemana };
}

export type PrevisoesHook = ReturnType<typeof usePrevisoes>;
