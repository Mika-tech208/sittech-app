"use client";

// Motivos de parada pra uso MANUAL dentro do apontamento (Setup/Troca,
// Falta de material etc — os operacionais do cadastro, mas sem excluir
// Quebra/Manutenção/Outros: "demais motivos existentes no cadastro" foi
// pedido explicitamente sem restrição de categoria). Só ativos. Nada a
// ver com o filtro vinculavel_ocorrencia=true usado em
// AbrirOcorrenciaModal.tsx — esse fluxo de ocorrência não é tocado aqui.

import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";

export interface MotivoParada {
  id: string;
  nome: string;
  exigeDescricao: boolean;
}

interface MotivoParadaRow {
  id: string;
  nome: string;
  exige_descricao: boolean;
}

export function useMotivosParada(pronto: boolean) {
  const [motivos, setMotivos] = useState<MotivoParada[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      const { data, error } = await supabase
        .from("motivos_parada")
        .select("id, nome, exige_descricao")
        .eq("ativo", true)
        .order("nome")
        .returns<MotivoParadaRow[]>();
      if (!montado) return;
      if (error) {
        setErro("Não foi possível carregar os motivos de parada.");
        setLoading(false);
        return;
      }
      setMotivos((data || []).map((m) => ({ id: m.id, nome: m.nome, exigeDescricao: m.exige_descricao })));
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [pronto]);

  return { motivos, loading, erro };
}
