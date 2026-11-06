"use client";

// Modelos canônicos (produto único com rotas) para as telas. Sem a migration/backfill (ou em erro) => [] e as telas ficam exatamente como antes.
import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import { lerModelosCanonicos, type ClienteLeitura } from "@/features/produto-canonico/modeloDb";
import type { ModeloCanonico } from "@/features/produto-canonico/tipos";

export function useModelosCanonicos(pronto: boolean): ModeloCanonico[] {
  const [modelos, setModelos] = useState<ModeloCanonico[]>([]);
  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    void lerModelosCanonicos(supabase as unknown as ClienteLeitura).then((m) => { if (montado) setModelos(m); });
    return () => { montado = false; };
  }, [pronto]);
  return modelos;
}
