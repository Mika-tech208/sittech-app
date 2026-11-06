"use client";

// Produtos elegíveis pra uma máquina, via roteiro_etapas + roteiro_etapa_maquinas
// — mesma elegibilidade que registrar_apontamento_producao/editar_apontamento_producao
// validam no servidor, só pra não deixar a supervisora escolher algo que o
// backend rejeitaria. Extraído do formulário de apontamento pra ser
// reaproveitado também na edição, sem duplicar a query.

import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import { lerGuardaProdutos, type ClienteGuarda } from "@/features/produto-canonico/guardaDb";
import { produtosSelecionaveis } from "@/features/produto-canonico/guard";

export interface ProdutoElegivel {
  id: string;
  nome: string;
}

interface ProdutoEtapaRow {
  roteiro_etapas: {
    produto_id: string;
    produtos: { id: string; nome: string; ativo: boolean } | null;
  } | null;
}

// `dataIso` (YYYY-MM-DD): data do apontamento (retroativo/edição). Sem ela vale hoje. Só tem efeito com produto canônico cadastrado: semana >= cutover mostra o canônico e esconde os legados;
// anterior ao cutover mostra os legados (nunca o canônico). Sem canônico (hoje) a lista é a MESMA de antes.
export function useProdutosElegiveisPorMaquina(maquinaId: string | null, dataIso?: string | null) {
  const [produtos, setProdutos] = useState<ProdutoElegivel[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!maquinaId) {
      setProdutos([]);
      setLoading(false);
      return;
    }
    let montado = true;
    setLoading(true);
    setErro(null);
    (async () => {
      const { data, error } = await supabase
        .from("roteiro_etapa_maquinas")
        .select("roteiro_etapas(produto_id, produtos(id, nome, ativo))")
        .eq("maquina_id", maquinaId)
        .returns<ProdutoEtapaRow[]>();
      if (!montado) return;
      if (error) {
        setErro("Não foi possível carregar os produtos desta máquina.");
        setLoading(false);
        return;
      }
      const mapa = new Map<string, ProdutoElegivel>();
      (data || []).forEach((linha) => {
        const p = linha.roteiro_etapas?.produtos;
        if (p && p.ativo) mapa.set(p.id, { id: p.id, nome: p.nome });
      });
      let lista = Array.from(mapa.values());
      const guarda = await lerGuardaProdutos(supabase as unknown as ClienteGuarda);
      if (!montado) return;
      if (guarda.canonicos.size > 0) {
        const data = dataIso || new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
        const ok = new Set(produtosSelecionaveis(lista.map((p) => ({ ...p, ativo: true })), guarda.canonicos, guarda.legados, data, guarda.cutover).map((p) => p.id));
        lista = lista.filter((p) => ok.has(p.id));
      }
      setProdutos(lista.sort((a, b) => a.nome.localeCompare(b.nome)));
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [maquinaId, dataIso]);

  return { produtos, loading, erro };
}
