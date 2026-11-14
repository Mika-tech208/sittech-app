"use client";

// TV de metas: SOMENTE leitura. Busca a RPC `tv_metas_producao` (sem nenhum dado financeiro) e a mantém atualizada por polling (15 s) + refetch ao
// voltar o foco da janela. Nunca escreve, nunca recalcula a escala, nunca dispara processamento.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/services/supabase-client";
import { dataHoraNoFuso } from "@/features/escala/tempo";
import { montarModeloTv, type ModeloTv, type PayloadMetasTv } from "@/features/escala/tv-metas/metasTv";

const POLLING_MS = 15_000;
const PENDENTE_MS = 75_000; // 5 leituras seguidas sem sucesso

export function useMetasTv(pronto: boolean) {
  const [modelo, setModelo] = useState<ModeloTv | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);
  const [ultimoSucessoMs, setUltimoSucessoMs] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const emVoo = useRef(false);

  const buscar = useCallback(async () => {
    if (emVoo.current) return;
    emVoo.current = true;
    try {
      const { data, error } = await supabase.rpc("tv_metas_producao", { p_semana_inicio: null });
      if (error) { setErro(error.message); return; }
      const payload = data as PayloadMetasTv;
      setModelo(montarModeloTv(payload));
      const { minutos } = dataHoraNoFuso(Date.parse(payload.agora));
      setAtualizadoEm(`${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`);
      setUltimoSucessoMs(Date.now());
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha de rede");
    } finally {
      emVoo.current = false;
    }
  }, []);

  useEffect(() => {
    if (!pronto) return;
    const inicial = setTimeout(() => void buscar(), 0); // fora do corpo do efeito (o setState vem de callback assíncrono)
    const poll = setInterval(() => void buscar(), POLLING_MS);
    const relogio = setInterval(() => setTick(Date.now()), 5000);
    const aoVoltar = () => { if (document.visibilityState === "visible") void buscar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { clearTimeout(inicial); clearInterval(poll); clearInterval(relogio); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [pronto, buscar]);

  const pendente = ultimoSucessoMs !== null && tick - ultimoSucessoMs > PENDENTE_MS;
  const conexao = ultimoSucessoMs === null ? (erro ? ("erro" as const) : ("carregando" as const)) : pendente ? ("pendente" as const) : ("ok" as const);
  return { modelo, atualizadoEm, conexao, erro };
}
