"use client";

// Guarda de produtos (canônicos x legados x cutover) para pickers por data. Sem canônico cadastrado (hoje) devolve a guarda vazia => nenhuma lista muda.
import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import { GUARDA_VAZIA, lerGuardaProdutos, type ClienteGuarda, type GuardaProdutos } from "@/features/produto-canonico/guardaDb";

export function useGuardaProdutos(pronto: boolean): GuardaProdutos {
  const [guarda, setGuarda] = useState<GuardaProdutos>(GUARDA_VAZIA());
  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    void lerGuardaProdutos(supabase as unknown as ClienteGuarda).then((g) => { if (montado) setGuarda(g); });
    return () => { montado = false; };
  }, [pronto]);
  return guarda;
}
