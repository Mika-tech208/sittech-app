"use client";

// Modo do adicional por etapa (parâmetro `wip_modo` em escala_parametros, via RPC `escala_wip_modo`).
// Qualquer falha = "desligado": a tela cai no formulário anterior, nunca no novo.

import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";

export function useWipModo(pronto: boolean): boolean {
  const [ativo, setAtivo] = useState(false);
  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("escala_wip_modo");
        if (montado) setAtivo(!error && data === "ativo");
      } catch {
        if (montado) setAtivo(false);
      }
    })();
    return () => { montado = false; };
  }, [pronto]);
  return ativo;
}
