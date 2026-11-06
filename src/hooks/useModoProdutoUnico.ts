"use client";

// Modo do produto único POR SEMANA (LEGADO | PLANEJAMENTO | OPERACIONAL) para as telas. Lê `produto_unico_cutover` e `produto_unico_planejamento_desde` (RPCs, ver guardaDb)
// e decide SÓ por `modoProdutoUnicoDaSemana` (cutover.ts). Sem parâmetros (ou RPC ausente/erro) => LEGADO: nada muda.
// `carregado` = os parâmetros já foram lidos (telas operacionais podem esperar antes de oferecer ações).
import { useCallback, useEffect, useState } from "react";
import { modoProdutoUnicoDaSemana, type ModoProdutoUnico } from "@/features/produto-canonico/cutover";
import { lerParametrosProdutoUnico, type ClienteGuarda, type LinhaParametro } from "@/features/produto-canonico/guardaDb";

export interface ModoProdutoUnicoTela {
  carregado: boolean;
  parametros: LinhaParametro[];
  /** modo da semana que contém `dataIso` (qualquer dia) */
  modoDe: (dataIso: string) => ModoProdutoUnico;
  /** a data (qualquer dia) pertence a uma semana de PLANEJAMENTO (plano futuro, NÃO liberado para produção)? OPERACIONAL: no MODO MANUAL (escala automática desligada) é sempre false — o plano futuro não interfere no chão. */
  planoFuturo: (dataIso: string) => boolean;
  /** modo manual (escala_operacao_manual() = true): producao_real_modo, replanejamento_modo e escala_fechamento_fisico_modo desligados */
  operacaoManual: boolean;
}

export function useModoProdutoUnico(pronto: boolean): ModoProdutoUnicoTela {
  const [parametros, setParametros] = useState<LinhaParametro[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [operacaoManual, setOperacaoManual] = useState(false);
  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    // cliente carregado sob demanda: componentes operacionais (modais) importam este hook sem puxar o cliente Supabase na carga do módulo.
    // Qualquer falha de leitura = sem parâmetros (LEGADO), como em toda a leitura dos parâmetros do produto único; o bloqueio de verdade está no banco.
    void (async () => {
      let p: LinhaParametro[] = [];
      let manual = false;
      try {
        const { supabase } = await import("@/services/supabase-client");
        const cliente = supabase as unknown as ClienteGuarda;
        p = await lerParametrosProdutoUnico(cliente);
        // MODO MANUAL: RPC ausente/erro => false (comportamento anterior; o bloqueio de verdade está no banco)
        try { const r = await cliente.rpc("escala_operacao_manual"); manual = !r.error && r.data === true; } catch { manual = false; }
      } catch { p = []; }
      if (montado) { setParametros(p); setOperacaoManual(manual); setCarregado(true); }
    })();
    return () => { montado = false; };
  }, [pronto]);
  const modoDe = useCallback((dataIso: string) => modoProdutoUnicoDaSemana(parametros, dataIso), [parametros]);
  const planoFuturo = useCallback((dataIso: string) => !operacaoManual && modoProdutoUnicoDaSemana(parametros, dataIso) === "PLANEJAMENTO", [parametros, operacaoManual]);
  return { carregado, parametros, modoDe, planoFuturo, operacaoManual };
}
