"use client";

// Funcionários necessários para executar a programação (servidor, motor da Escala). Estado explícito: enquanto não há valor, a tela
// mostra "calculando…"/"indisponível" — NUNCA o número de máquinas como se fosse headcount.

import { useEffect, useMemo, useRef, useState } from "react";
import { calcularFuncionariosNecessariosNoServidor } from "@/lib/escala/disparar";
import type { FuncionariosNecessariosResultado } from "@/lib/escala/funcionariosNecessarios";
import type { PrevisaoItem } from "@/types/domain";

export type EstadoFuncionariosNecessarios =
  | { status: "sem_itens" }
  | { status: "calculando" }
  | { status: "ok"; dados: FuncionariosNecessariosResultado }
  | { status: "indisponivel"; motivo: string };

/** Entrada que dimensiona a equipe: produto, quantidade e máquinas por etapa de cada item (a carga adicional não conta). */
export function payloadFuncionariosNecessarios(itens: Pick<PrevisaoItem, "produtoId" | "quantidade" | "valorUnitario" | "maquinasPorEtapa">[]) {
  return itens.map((i) => ({ produto_id: i.produtoId, quantidade: i.quantidade, valor_unitario: i.valorUnitario, maquinas_por_etapa: i.maquinasPorEtapa ?? {} }));
}

export function useFuncionariosNecessarios(semanaInicio: string, itens: PrevisaoItem[], ativo: boolean): EstadoFuncionariosNecessarios {
  // chave estável do que dimensiona a equipe (novo array de itens com o mesmo conteúdo não refaz o pedido)
  const chave = JSON.stringify(payloadFuncionariosNecessarios(itens));
  const assinatura = `${semanaInicio}|${chave}`;
  const payload = useMemo(() => JSON.parse(chave) as ReturnType<typeof payloadFuncionariosNecessarios>, [chave]);
  const [estado, setEstado] = useState<{ assinatura: string; valor: EstadoFuncionariosNecessarios } | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!ativo || payload.length === 0) return;
    const minha = ++seq.current;
    const t = setTimeout(async () => {
      const resp = await calcularFuncionariosNecessariosNoServidor(semanaInicio, payload);
      if (minha !== seq.current) return; // chegou um pedido mais novo
      setEstado({ assinatura: `${semanaInicio}|${JSON.stringify(payload)}`, valor: resp.ok ? { status: "ok", dados: resp.dados } : { status: "indisponivel", motivo: resp.erro } });
    }, 500);
    return () => clearTimeout(t);
  }, [payload, semanaInicio, ativo]);

  if (itens.length === 0) return { status: "sem_itens" };
  // resposta de outra semana/itens = obsoleta: volta a "calculando"
  return estado && estado.assinatura === assinatura ? estado.valor : { status: "calculando" };
}
