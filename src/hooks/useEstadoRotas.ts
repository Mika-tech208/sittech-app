"use client";

// Estado da ativação programada do modelo de rotas para uma semana (leitura). Sem a função no banco ou erro = null (nada a mostrar; tudo legado).
import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import { consultarEstadoRotas, type EstadoAtivacaoRotas } from "@/lib/rotas/ativacao";

export function useEstadoRotas(pronto: boolean, semanaInicio: string) {
  const [estado, setEstado] = useState<EstadoAtivacaoRotas | null>(null);
  useEffect(() => {
    if (!pronto) return;
    let vivo = true;
    void (async () => { const e = await consultarEstadoRotas(supabase, semanaInicio); if (vivo) setEstado(e); })();
    return () => { vivo = false; };
  }, [pronto, semanaInicio]);
  return estado;
}
