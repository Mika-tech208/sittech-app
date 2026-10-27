"use client";

// Produtos elegíveis pra uma máquina, via roteiro_etapas + roteiro_etapa_maquinas
// — mesma elegibilidade que registrar_apontamento_producao/editar_apontamento_producao
// validam no servidor, só pra não deixar a supervisora escolher algo que o
// backend rejeitaria. Extraído do formulário de apontamento pra ser
// reaproveitado também na edição, sem duplicar a query.

import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";

export interface ProdutoElegivel {
  id: string;
  nome: string;
  // Produto de ROTAS: onde a etapa desta máquina está (CONV, AUTO ou COMUM). A rota é determinada pela etapa — o operador nunca a escolhe. Produto linear: ausente.
  rotaCodigo?: string;
}

interface ProdutoEtapaRow {
  roteiro_etapas: {
    id?: string;
    produto_id: string;
    produtos: { id: string; nome: string; ativo: boolean } | null;
  } | null;
}

export function useProdutosElegiveisPorMaquina(maquinaId: string | null) {
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
        .select("roteiro_etapas(id, produto_id, produtos(id, nome, ativo))")
        .eq("maquina_id", maquinaId)
        .returns<ProdutoEtapaRow[]>();
      if (!montado) return;
      if (error) {
        setErro("Não foi possível carregar os produtos desta máquina.");
        setLoading(false);
        return;
      }
      const mapa = new Map<string, ProdutoElegivel>();
      const etapaDoProduto = new Map<string, string>();
      (data || []).forEach((linha) => {
        const p = linha.roteiro_etapas?.produtos;
        if (p && p.ativo) { mapa.set(p.id, { id: p.id, nome: p.nome }); if (linha.roteiro_etapas?.id) etapaDoProduto.set(p.id, linha.roteiro_etapas.id); }
      });
      // rótulo de rota (só produto de rotas): a etapa já determina CONV/AUTO/fluxo comum; sem as tabelas ou erro = nenhum rótulo
      const etapaIds = [...etapaDoProduto.values()];
      if (etapaIds.length > 0) {
        const [re, pc] = await Promise.all([
          supabase.from("rota_etapas").select("etapa_id, produto_rota(codigo)").in("etapa_id", etapaIds),
          supabase.from("produto_pool_comum").select("etapa_id").in("etapa_id", etapaIds),
        ]);
        const grupo = new Map<string, string>();
        if (!re.error) (re.data || []).forEach((r: { etapa_id: string; produto_rota: { codigo: string } | { codigo: string }[] | null }) => { const c = Array.isArray(r.produto_rota) ? r.produto_rota[0]?.codigo : r.produto_rota?.codigo; if (c) grupo.set(r.etapa_id, c); });
        if (!pc.error) (pc.data || []).forEach((r: { etapa_id: string }) => grupo.set(r.etapa_id, "COMUM"));
        etapaDoProduto.forEach((etapaId, produtoId) => { const g = grupo.get(etapaId); const p = mapa.get(produtoId); if (g && p) p.rotaCodigo = g; });
      }
      if (!montado) return;
      setProdutos(Array.from(mapa.values()).sort((a, b) => a.nome.localeCompare(b.nome)));
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [maquinaId]);

  return { produtos, loading, erro };
}
