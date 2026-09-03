"use client";

// Realizado da Previsão Semanal, vindo de Produção Real — só a leitura
// (RPC obter_realizado_previsao_por_semana, migration 20). Devolve, por
// produto_id, a produção BOA (quantidade_produzida - quantidade_refugo)
// somada dos apontamentos_producao daquela semana (mesma definição de
// semana de src/lib/date.ts — a RPC recebe a mesma segunda-feira ISO já
// usada em toda a tela). Inclui produtos fora da previsão também — quem
// decide o que fazer com isso é o chamador (ver
// features/previsao/realizado.ts), esta camada só busca o dado.

import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";

export interface RealizadoProdutoSemana {
  produtoId: string;
  produtoNome: string;
  quantidadeBoa: number;
}

interface RealizadoRow {
  produto_id: string;
  produto_nome: string;
  quantidade_boa: number;
}

export function useRealizadoPrevisao(pronto: boolean, semanaInicio: string) {
  const [realizado, setRealizado] = useState<RealizadoProdutoSemana[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc("obter_realizado_previsao_por_semana", { p_semana_inicio: semanaInicio });
      if (!montado) return;
      if (error) {
        setErro("Não foi possível carregar o realizado da Produção Real para essa semana.");
        setRealizado([]);
        setLoading(false);
        return;
      }
      setRealizado(((data || []) as RealizadoRow[]).map((r) => ({
        produtoId: r.produto_id, produtoNome: r.produto_nome, quantidadeBoa: Number(r.quantidade_boa),
      })));
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [pronto, semanaInicio]);

  return { realizado, loading, erro };
}
