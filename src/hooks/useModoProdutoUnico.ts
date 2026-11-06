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
  /** a data (qualquer dia) pertence a uma semana de PLANEJAMENTO (plano futuro, NÃO liberado para produção)? */
  planoFuturo: (dataIso: string) => boolean;
}

export function useModoProdutoUnico(pronto: boolean): ModoProdutoUnicoTela {
  const [parametros, setParametros] = useState<LinhaParametro[]>([]);
  const [carregado, setCarregado] = useState(false);
  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    // cliente carregado sob demanda: componentes operacionais (modais) importam este hook sem puxar o cliente Supabase na carga do módulo.
    // Qualquer falha de leitura = sem parâmetros (LEGADO), como em toda a leitura dos parâmetros do produto único; o bloqueio de verdade está no banco.
    void (async () => {
      let p: LinhaParametro[] = [];
      try {
        const { supabase } = await import("@/services/supabase-client");
        p = await lerParametrosProdutoUnico(supabase as unknown as ClienteGuarda);
      } catch { p = []; }
      if (montado) { setParametros(p); setCarregado(true); }
    })();
    return () => { montado = false; };
  }, [pronto]);
  const modoDe = useCallback((dataIso: string) => modoProdutoUnicoDaSemana(parametros, dataIso), [parametros]);
  const planoFuturo = useCallback((dataIso: string) => modoProdutoUnicoDaSemana(parametros, dataIso) === "PLANEJAMENTO", [parametros]);
  return { carregado, parametros, modoDe, planoFuturo };
}
