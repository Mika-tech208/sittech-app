"use client";

// Máquinas com causa de indisponibilidade ABERTA agora (Parada de máquina ou bloqueio manual da Escala) — a mesma verdade da Escala.
// Atualiza ao voltar para a aba e a cada 60 s. Se a leitura falhar, mantém o último valor conhecido (nunca "libera" por falta de resposta).

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/services/supabase-client";
import { dataHoraNoFuso } from "@/features/escala/tempo";

export interface MaquinasIndisponiveisAgora {
  ids: ReadonlySet<string>;
  emParada: ReadonlySet<string>; // subconjunto cuja causa é uma Parada de máquina (Produção Real)
  hoje: string; // data (America/Sao_Paulo) da última leitura — referência para saber quais semanas já terminaram
}

const VAZIO: MaquinasIndisponiveisAgora = { ids: new Set(), emParada: new Set(), hoje: "" };

export function useMaquinasIndisponiveisAgora(pronto: boolean): MaquinasIndisponiveisAgora {
  const [leitura, setLeitura] = useState<{ linhas: { maquina_id: string; origem_tipo: string }[]; hoje: string } | null>(null);
  useEffect(() => {
    if (!pronto) return;
    let vivo = true;
    const ler = async () => {
      const { data, error } = await supabase.rpc("escala_maquinas_indisponiveis_agora");
      if (!vivo || error) return;
      setLeitura({ linhas: (data ?? []) as { maquina_id: string; origem_tipo: string }[], hoje: dataHoraNoFuso(Date.now()).data });
    };
    void ler();
    const timer = setInterval(() => void ler(), 60_000);
    const aoVoltar = () => { if (document.visibilityState === "visible") void ler(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { vivo = false; clearInterval(timer); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [pronto]);
  return useMemo(() => (leitura === null ? VAZIO : {
    ids: new Set(leitura.linhas.map((l) => l.maquina_id)),
    emParada: new Set(leitura.linhas.filter((l) => l.origem_tipo === "ocorrencia_maquina").map((l) => l.maquina_id)),
    hoje: leitura.hoje,
  }), [leitura]);
}
