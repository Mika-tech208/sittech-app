"use client";

// Modo TV da Escala: SOMENTE leitura. Busca o snapshot do dia (RPC
// escala_tv_snapshot) e o mantém atualizado por Realtime
// (escala_producao_dias) + polling de reserva + refetch ao voltar o foco.
// Nunca escreve, nunca calcula escala, nunca chama o processador.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/services/supabase-client";
import { calcularOffset, type LinhaTv } from "@/features/escala/tv";
import type { PeriodoEscala } from "@/features/escala/types";

export interface SnapshotTv {
  agora: string;
  data: string;
  existe: boolean;
  versao?: number;
  atualizado_em?: string;
  periodos?: PeriodoEscala[];
  alocacoes?: LinhaTv[];
  indisponiveis?: { maquina: string; desde: string; motivo: string }[];
}

const POLLING_MS = 30000;
const DESATUALIZADO_MS = 120000;

export function useEscalaTv(pronto: boolean) {
  const [snapshot, setSnapshot] = useState<SnapshotTv | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [ultimoSucessoMs, setUltimoSucessoMs] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tempoReal, setTempoReal] = useState<"conectando" | "ativo" | "polling">("conectando");
  const [tick, setTick] = useState(() => Date.now());
  const emVoo = useRef(false);

  const buscar = useCallback(async () => {
    if (emVoo.current) return;
    emVoo.current = true;
    try {
      const antes = Date.now();
      const { data, error } = await supabase.rpc("escala_tv_snapshot", { p_data: null });
      if (error) {
        setErro(error.message);
        return;
      }
      const s = data as SnapshotTv;
      setSnapshot(s);
      setOffsetMs(calcularOffset(s.agora, (antes + Date.now()) / 2));
      setUltimoSucessoMs(Date.now());
      setErro(null);
    } finally {
      emVoo.current = false;
    }
  }, []);

  useEffect(() => {
    if (!pronto) return;
    buscar();
    const poll = setInterval(buscar, POLLING_MS);
    const relogio = setInterval(() => setTick(Date.now()), 1000);
    const aoVoltar = () => { if (document.visibilityState === "visible") buscar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    const canal = supabase
      .channel("escala-tv")
      .on("postgres_changes", { event: "*", schema: "public", table: "escala_producao_dias" }, () => buscar())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setTempoReal("ativo");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setTempoReal("polling");
      });
    return () => {
      clearInterval(poll);
      clearInterval(relogio);
      document.removeEventListener("visibilitychange", aoVoltar);
      supabase.removeChannel(canal);
    };
  }, [pronto, buscar]);

  const agoraMs = tick + offsetMs;
  const desatualizado = ultimoSucessoMs === null ? false : tick - ultimoSucessoMs > DESATUALIZADO_MS;
  return { snapshot, agoraMs, erro, tempoReal, desatualizado, buscar };
}
