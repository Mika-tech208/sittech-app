"use client";

// Ocorrências de máquina em aberto (encerrada_em IS NULL) — select pequeno
// e direto, mesmo padrão já usado por useProducaoRealPainel.ts (mesma
// tabela, mesma policy RLS `usuario_ativo_full_access`, nenhuma RPC
// nova). Diferença: aqui incluímos o nome da MÁQUINA no próprio select
// (useProducaoRealPainel já tem a lista de máquinas carregada à parte e
// cruza por maquina_id; a Visão Geral não carrega essa lista, então busca
// direto). Usado pelo bloco "Agora" da Visão Geral da Produção Real.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";

export interface OcorrenciaAbertaComMaquina {
  id: string;
  maquinaId: string;
  maquinaNome: string;
  motivoNome: string;
  descricao: string;
  abertaEm: string;
}

interface OcorrenciaAbertaRow {
  id: string;
  maquina_id: string;
  descricao: string;
  aberta_em: string;
  maquinas: { nome: string } | { nome: string }[] | null;
  motivos_parada: { nome: string } | { nome: string }[] | null;
}

function primeiro<T>(v: T | T[] | null): T | null {
  if (v === null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export function useOcorrenciasAbertas(pronto: boolean) {
  const [ocorrencias, setOcorrencias] = useState<OcorrenciaAbertaComMaquina[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [buscou, setBuscou] = useState(false);

  const buscar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    const { data, error } = await supabase
      .from("ocorrencias_maquina")
      .select("id, maquina_id, descricao, aberta_em, maquinas(nome), motivos_parada(nome)")
      .is("encerrada_em", null)
      .returns<OcorrenciaAbertaRow[]>();

    if (error) {
      setErro("Não foi possível carregar as ocorrências abertas.");
      setLoading(false);
      setBuscou(true);
      return;
    }

    setOcorrencias(
      (data || []).map((o) => ({
        id: o.id,
        maquinaId: o.maquina_id,
        maquinaNome: primeiro(o.maquinas)?.nome || "Máquina",
        motivoNome: primeiro(o.motivos_parada)?.nome || "Motivo não informado",
        descricao: o.descricao,
        abertaEm: o.aberta_em,
      }))
    );
    setLoading(false);
    setBuscou(true);
  }, []);

  useEffect(() => {
    if (!pronto || buscou) return;
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, buscou]);

  return { ocorrencias, loading, erro, buscou, buscar };
}

export type OcorrenciasAbertasHook = ReturnType<typeof useOcorrenciasAbertas>;
