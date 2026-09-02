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
// Escrita via RPC (upsert_previsao_semana, migration 7): salvar uma
// semana inteira (upsert de previsoes + sincronizar itens previstos e/ou
// realizados + sincronizar máquinas indisponíveis) acontece numa única
// transação no Postgres — qualquer erro no meio desfaz tudo. Antes disso
// eram várias chamadas REST sequenciais sem transação entre elas (mesma
// classe de risco já corrigida pro roteiro de produtos). O contrato com o
// frontend não muda: cada uma das três partes só é tocada se o campo
// correspondente veio em `campos` (null no parâmetro da RPC = não mexe),
// e dentro de uma parte tocada o comportamento continua sendo apagar tudo
// daquele tipo e recriar do zero (UUIDs novos a cada save).

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

// Formato aceito pela RPC upsert_previsao_semana pra cada item — mesmos
// dados de sempre (produto_id só o id que já veio no item, escolhido no
// <select> a partir de `produtos` já migrado, nunca resolvido/recalculado
// aqui; produto_nome/valor_unitario como snapshot, nunca relidos de
// `produtos`), só reempacotados pro formato que a function espera.
function itemParaPayloadRPC(it: PrevisaoItem) {
  return {
    produto_id: it.produtoId,
    produto_nome: it.produtoNome,
    valor_unitario: it.valorUnitario,
    quantidade: it.quantidade,
    maquinas_por_etapa: it.maquinasPorEtapa || {},
  };
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
  // ficam como já estavam no banco — por isso `null` (não o array) pra RPC
  // nos campos que não vieram em `campos`, que é o sinal de "não mexe"
  // dentro da function (ver migration 7).
  const upsertSemana = useCallback(async (semanaInicio: string, campos: Partial<Previsao>): Promise<boolean> => {
    const { data: previsaoId, error: rpcErro } = await supabase.rpc("upsert_previsao_semana", {
      p_semana_inicio: semanaInicio,
      p_itens_previsto: campos.itens !== undefined ? campos.itens.map(itemParaPayloadRPC) : null,
      p_itens_realizado: campos.itensRealizados !== undefined ? campos.itensRealizados.map(itemParaPayloadRPC) : null,
      p_maquinas_indisponiveis: campos.maquinasIndisponiveis !== undefined ? campos.maquinasIndisponiveis : null,
    });
    if (rpcErro || !previsaoId) {
      setErro("Não foi possível salvar a previsão dessa semana.");
      return false;
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
