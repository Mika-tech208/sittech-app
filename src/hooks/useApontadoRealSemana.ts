"use client";

// Apontado real da semana (Produção Real) para a Previsão semanal — SÓ LEITURA/DIAGNÓSTICO. Uma única chamada ao banco por semana (agregada no servidor):
// nada de N consultas por produto. A regra de "última etapa" está em features/previsao/apontadoReal.ts.
import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import { calcularApontadoReal, type ApontadoRealProduto, type LinhaApontadoEtapa } from "@/features/previsao/apontadoReal";

interface Linha {
  produto_id: string;
  etapa_id: string | null;
  operacao_id: string | null;
  quantidade_boa: number | string;
  n_apontamentos: number | string;
  etapa_ordem: number | null;
  etapa_operacao_id: string | null;
  ultima_ordem: number | null;
  n_na_ultima_ordem: number | null;
  ultima_operacao_id: string | null;
}

export function useApontadoRealSemana(pronto: boolean, semanaInicio: string) {
  // guarda a semana junto: ao trocar de semana o valor da anterior nunca aparece na nova (null = carregando ou erro)
  const [estado, setEstado] = useState<{ semana: string; mapa: Map<string, ApontadoRealProduto> | null; erro: string | null } | null>(null);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      const { data, error } = await supabase.rpc("obter_apontado_real_previsao_por_semana", { p_semana_inicio: semanaInicio });
      if (!montado) return;
      if (error) {
        setEstado({ semana: semanaInicio, mapa: null, erro: "Não foi possível carregar o apontado real da Produção Real para essa semana." });
        return;
      }
      const linhas: LinhaApontadoEtapa[] = ((data || []) as Linha[]).map((r) => ({
        produtoId: r.produto_id, etapaId: r.etapa_id, operacaoId: r.operacao_id, quantidadeBoa: Number(r.quantidade_boa), nApontamentos: Number(r.n_apontamentos),
        etapaOrdem: r.etapa_ordem, etapaOperacaoId: r.etapa_operacao_id, ultimaOrdem: r.ultima_ordem, nNaUltimaOrdem: Number(r.n_na_ultima_ordem ?? 0), ultimaOperacaoId: r.ultima_operacao_id,
      }));
      setEstado({ semana: semanaInicio, mapa: calcularApontadoReal(linhas), erro: null });
    })();
    return () => { montado = false; };
  }, [pronto, semanaInicio]);

  const atual = estado && estado.semana === semanaInicio ? estado : null;
  return { mapa: atual?.mapa ?? null, erro: atual?.erro ?? null };
}
