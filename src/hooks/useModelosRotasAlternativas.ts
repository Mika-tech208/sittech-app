"use client";

// Modelos canônicos VIGENTES (cutover definido) para esconder indicadores consultivos de produto com rotas alternativas.
// [] antes do cutover / sem modelo / erro de leitura do modelo => as telas ficam exatamente como antes.
import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import { lerModelosVigentes, type ClienteModelosVigentes } from "@/features/produto-canonico/rotasAlternativasDb";
import type { ModeloCanonico } from "@/features/produto-canonico/tipos";

export function useModelosRotasAlternativas(pronto: boolean): ModeloCanonico[] {
  const [modelos, setModelos] = useState<ModeloCanonico[]>([]);
  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    void lerModelosVigentes(supabase as unknown as ClienteModelosVigentes).then((m) => { if (montado) setModelos(m); });
    return () => { montado = false; };
  }, [pronto]);
  return modelos;
}
