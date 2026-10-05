"use client";

// Jornada oficial de Faltas e Ausências — 07:12–12:00 + 13:00–17:00 = 8h48,
// independente dos períodos M1-T3 (que têm uma folga operacional de 5min
// pra bater cartão antes do almoço — ver migration 38). Mesmo shape de
// PeriodoSimples que os períodos reais, pra reaproveitar sem mudar nada em
// src/features/ausencias/calculations.ts — só muda a FONTE dos dois
// "períodos" (manhã/tarde) que entram no cálculo.

import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { PeriodoSimples } from "@/features/ausencias/calculations";

interface JornadaRow {
  manha_inicio: string;
  manha_fim: string;
  tarde_inicio: string;
  tarde_fim: string;
}

export function useJornadaOficialAusencias(pronto: boolean) {
  const [jornada, setJornada] = useState<PeriodoSimples[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      const { data, error } = await supabase
        .from("jornada_oficial_ausencias")
        .select("manha_inicio, manha_fim, tarde_inicio, tarde_fim")
        .limit(1)
        .maybeSingle<JornadaRow>();
      if (!montado) return;
      if (error || !data) {
        setErro("Não foi possível carregar a jornada oficial de ausências.");
        setLoading(false);
        return;
      }
      setJornada([
        { id: "manha", nome: "Manhã", inicio: data.manha_inicio.slice(0, 5), fim: data.manha_fim.slice(0, 5) },
        { id: "tarde", nome: "Tarde", inicio: data.tarde_inicio.slice(0, 5), fim: data.tarde_fim.slice(0, 5) },
      ]);
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [pronto]);

  return { jornada, loading, erro };
}
