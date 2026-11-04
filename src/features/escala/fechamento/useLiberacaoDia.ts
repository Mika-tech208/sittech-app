"use client";

// Liberação por período do dia (fonte única: RPC escala_liberacao_dia). Usada na tela interna de Escala para marcar o que é PLANO INTERNO/ESTIMADO.
import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { LiberacaoDia } from "./visaoTv";

export function useLiberacaoDia(data: string | null | undefined, intervaloMs = 15_000): LiberacaoDia | null {
  const [lib, setLib] = useState<{ data: string; l: LiberacaoDia } | null>(null);
  useEffect(() => {
    if (!data) return;
    let vivo = true;
    const ler = () => { void Promise.resolve(supabase.rpc("escala_liberacao_dia", { p_data: data })).then(({ data: d, error }) => { if (vivo && !error && d) setLib({ data, l: d as LiberacaoDia }); }).catch(() => undefined); };
    ler();
    const t = setInterval(ler, intervaloMs);
    return () => { vivo = false; clearInterval(t); };
  }, [data, intervaloMs]);
  return lib && lib.data === data ? lib.l : null;
}
