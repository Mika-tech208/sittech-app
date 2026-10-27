"use client";

// Causas de indisponibilidade de máquina COM JANELA (Parada / bloqueio manual, abertas e encerradas) que tocam a semana exibida — mesma tabela da Escala.
// Semana já encerrada: nem consulta (histórico nunca é recalculado com indisponibilidade registrada depois). Atualiza ao voltar para a aba e a cada 60 s.
// Falha na leitura: mantém o último valor conhecido (nunca "libera" a máquina por falta de resposta).

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/services/supabase-client";
import { fimDaSemanaIso, type CausaMaquina } from "@/features/capacidade/disponibilidadeSemana";

export function useCausasIndisponibilidadeSemana(pronto: boolean, semanaInicio: string, hojeIso: string): CausaMaquina[] {
  const [linhas, setLinhas] = useState<{ semana: string; dados: { maquina_id: string; desde: string; liberada_em: string | null }[] } | null>(null);
  const encerrada = !!hojeIso && fimDaSemanaIso(semanaInicio) < hojeIso;
  useEffect(() => {
    if (!pronto || encerrada) return;
    let vivo = true;
    const ler = async () => {
      const { data, error } = await supabase.rpc("escala_causas_indisponibilidade_semana", { p_inicio: semanaInicio, p_fim: fimDaSemanaIso(semanaInicio) });
      if (!vivo || error) return;
      setLinhas({ semana: semanaInicio, dados: (data ?? []) as { maquina_id: string; desde: string; liberada_em: string | null }[] });
    };
    void ler();
    const timer = setInterval(() => void ler(), 60_000);
    const aoVoltar = () => { if (document.visibilityState === "visible") void ler(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { vivo = false; clearInterval(timer); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [pronto, semanaInicio, encerrada]);
  return useMemo(() => (!encerrada && linhas && linhas.semana === semanaInicio
    ? linhas.dados.map((l) => ({ maquinaId: l.maquina_id, desdeMs: Date.parse(l.desde), liberadaEmMs: l.liberada_em ? Date.parse(l.liberada_em) : null }))
    : []), [linhas, semanaInicio, encerrada]);
}
