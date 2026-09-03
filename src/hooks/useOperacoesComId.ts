"use client";

// Leitura mínima de operações (id/nome) — useCadastrosBase já busca
// `operacoes`, mas só expõe nomes (string[], formato herdado da tela de
// Custo por Hora). Indicadores de Produção precisa filtrar por
// operacao_id (uuid), não por nome — hook separado em vez de mudar o
// formato que useCadastrosBase já expõe pros outros consumidores.

import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";

export interface OperacaoComId {
  id: string;
  nome: string;
}

export function useOperacoesComId(pronto: boolean) {
  const [operacoes, setOperacoes] = useState<OperacaoComId[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      const { data, error } = await supabase.from("operacoes").select("id, nome").order("nome").returns<OperacaoComId[]>();
      if (!montado) return;
      if (error) {
        setErro("Não foi possível carregar as operações.");
        setLoading(false);
        return;
      }
      setOperacoes(data || []);
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [pronto]);

  return { operacoes, loading, erro };
}
