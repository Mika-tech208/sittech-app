"use client";

// Apontado real da(s) semana(s) (Produção Real) para a Previsão semanal — SÓ LEITURA. Uma chamada ao banco por semana (agregada no servidor):
// nada de N consultas por produto. A regra de "última etapa" está em features/previsao/apontadoReal.ts.
// Atualiza sozinho: ao voltar para a aba/janela e a cada 60 s com a página visível, para refletir apontamentos feitos/corrigidos em outra tela
// sem ninguém digitar nada na Previsão.
import { useEffect, useRef, useState } from "react";
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

const INTERVALO_MS = 60_000;

async function buscarSemana(semanaInicio: string): Promise<Map<string, ApontadoRealProduto> | null> {
  const { data, error } = await supabase.rpc("obter_apontado_real_previsao_por_semana", { p_semana_inicio: semanaInicio });
  if (error) return null;
  const linhas: LinhaApontadoEtapa[] = ((data || []) as Linha[]).map((r) => ({
    produtoId: r.produto_id, etapaId: r.etapa_id, operacaoId: r.operacao_id, quantidadeBoa: Number(r.quantidade_boa), nApontamentos: Number(r.n_apontamentos),
    etapaOrdem: r.etapa_ordem, etapaOperacaoId: r.etapa_operacao_id, ultimaOrdem: r.ultima_ordem, nNaUltimaOrdem: Number(r.n_na_ultima_ordem ?? 0), ultimaOperacaoId: r.ultima_operacao_id,
  }));
  return calcularApontadoReal(linhas);
}

// chama `recarregar` ao voltar para a aba e a cada INTERVALO_MS enquanto visível
function useAtualizacaoPeriodica(ativo: boolean, recarregar: () => void) {
  const ref = useRef(recarregar);
  useEffect(() => { ref.current = recarregar; });
  useEffect(() => {
    if (!ativo) return;
    const visivelAgora = () => { if (document.visibilityState === "visible") ref.current(); };
    const timer = window.setInterval(visivelAgora, INTERVALO_MS);
    document.addEventListener("visibilitychange", visivelAgora);
    window.addEventListener("focus", visivelAgora);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visivelAgora); window.removeEventListener("focus", visivelAgora); };
  }, [ativo]);
}

export function useApontadoRealSemana(pronto: boolean, semanaInicio: string) {
  // guarda a semana junto: ao trocar de semana o valor da anterior nunca aparece na nova (null = carregando ou erro)
  const [estado, setEstado] = useState<{ semana: string; mapa: Map<string, ApontadoRealProduto> | null; erro: string | null } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      const mapa = await buscarSemana(semanaInicio);
      if (!montado) return;
      if (!mapa) {
        setEstado({ semana: semanaInicio, mapa: null, erro: "Não foi possível carregar o apontado real da Produção Real para essa semana." });
        return;
      }
      setEstado({ semana: semanaInicio, mapa, erro: null });
    })();
    return () => { montado = false; };
  }, [pronto, semanaInicio, tick]);

  useAtualizacaoPeriodica(pronto, () => setTick((t) => t + 1));

  const atual = estado && estado.semana === semanaInicio ? estado : null;
  return { mapa: atual?.mapa ?? null, erro: atual?.erro ?? null };
}

// Várias semanas de uma vez (Histórico semanal). Semanas que falharem ficam fora do mapa (a tela mostra "—").
export function useApontadoRealSemanas(pronto: boolean, semanas: string[]) {
  const [mapas, setMapas] = useState<Map<string, Map<string, ApontadoRealProduto>>>(new Map());
  const [tick, setTick] = useState(0);
  const chave = semanas.join(",");

  useEffect(() => {
    if (!pronto || !chave) return;
    let montado = true;
    (async () => {
      const lista = chave.split(",");
      const novo = new Map<string, Map<string, ApontadoRealProduto>>();
      for (let i = 0; i < lista.length; i += 6) {
        const lote = lista.slice(i, i + 6);
        const res = await Promise.all(lote.map((s) => buscarSemana(s)));
        lote.forEach((s, k) => { const m = res[k]; if (m) novo.set(s, m); });
        if (!montado) return;
      }
      if (montado) setMapas(novo);
    })();
    return () => { montado = false; };
  }, [pronto, chave, tick]);

  useAtualizacaoPeriodica(pronto && !!chave, () => setTick((t) => t + 1));
  return mapas;
}
