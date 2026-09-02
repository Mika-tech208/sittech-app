"use client";

// Camada mínima de acesso ao Supabase para produtos + roteiro de
// fabricação (roteiro_etapas, roteiro_etapa_maquinas) — únicos dados
// autorizados nesta etapa, além de cadastros-base, funcionários e
// máquinas já migrados. O frontend continua recebendo Produto/RoteiroEtapa
// no formato atual (operacao como nome, ordem = posição no array,
// maquinasIds = ids reais de Maquina) — a conversão banco <-> frontend
// (operacao_id, ordem, linhas de roteiro_etapa_maquinas) acontece só
// aqui. As funções de edição de formulário em
// features/produtos/calculations.ts (roteiroParaFormulario,
// adicionarEtapa, trocarOperacaoEtapa, etc.) continuam intocadas — elas
// só manipulam o estado do formulário em memória, nunca o banco.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { Produto, RoteiroEtapa, Prioridade } from "@/types/domain";

interface ProdutoPayload {
  nome: string;
  referencia: string;
  valorUnitario: number;
  prioridade: Prioridade;
  roteiro: RoteiroEtapa[];
}

interface RoteiroEtapaRow {
  id: string;
  ordem: number;
  meta_m1: number; meta_m2: number; meta_m3: number;
  meta_t1: number; meta_t2: number; meta_t3: number;
  operacoes: { nome: string } | null;
  roteiro_etapa_maquinas: { maquina_id: string }[] | null;
}

interface ProdutoRow {
  id: string;
  nome: string;
  referencia: string | null;
  valor_unitario: number;
  ativo: boolean;
  prioridade: Prioridade;
  roteiro_etapas: RoteiroEtapaRow[] | null;
}

async function resolverOperacaoId(nome: string): Promise<string | null> {
  const { data, error } = await supabase.from("operacoes").select("id").eq("nome", nome).maybeSingle();
  if (error || !data) return null;
  return data.id;
}

// Etapas carregadas do banco têm id em formato UUID real; etapas criadas
// na sessão de edição (criarEtapaVazia, via uid()) têm um id local em
// base36 — nunca colide com um UUID. É assim que a camada de acesso
// decide, sem precisar de nenhuma flag nova no formulário, se uma etapa
// do payload é "existente" (manda o id, vira UPDATE) ou "nova" (manda
// null, vira INSERT) na function atualizar_produto_com_roteiro.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRODUTO_COM_ROTEIRO_SELECT = `
  id, nome, referencia, valor_unitario, ativo, prioridade,
  roteiro_etapas(
    id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3,
    operacoes(nome),
    roteiro_etapa_maquinas(maquina_id)
  )
`;

// Grava as etapas do roteiro (em ordem) e depois as linhas de máquinas
// elegíveis — usado tanto na criação quanto na edição (que já apagou o
// roteiro antigo antes de chamar isto). `null` = falhou no meio; o que já
// foi gravado até ali fica no banco (sem transação entre chamadas REST,
// mesma limitação já aceita em funcionario_custos/configuracoes_empresa).
async function salvarRoteiro(produtoId: string, roteiro: RoteiroEtapa[]): Promise<RoteiroEtapa[] | null> {
  const etapasSalvas: RoteiroEtapa[] = [];
  for (let i = 0; i < roteiro.length; i++) {
    const etapa = roteiro[i];
    const operacaoId = await resolverOperacaoId(etapa.operacao);
    if (!operacaoId) return null;
    const { data, error } = await supabase
      .from("roteiro_etapas")
      .insert({
        produto_id: produtoId, operacao_id: operacaoId, ordem: i,
        meta_m1: etapa.metas.m1, meta_m2: etapa.metas.m2, meta_m3: etapa.metas.m3,
        meta_t1: etapa.metas.t1, meta_t2: etapa.metas.t2, meta_t3: etapa.metas.t3,
      })
      .select("id")
      .single();
    if (error || !data) return null;
    etapasSalvas.push({ ...etapa, id: data.id });
  }
  const linhasMaquinas = etapasSalvas.flatMap((e) => e.maquinasIds.map((maquinaId) => ({ etapa_id: e.id, maquina_id: maquinaId })));
  if (linhasMaquinas.length > 0) {
    const { error } = await supabase.from("roteiro_etapa_maquinas").insert(linhasMaquinas);
    if (error) return null;
  }
  return etapasSalvas;
}

function linhaParaProduto(p: ProdutoRow): Produto {
  return {
    id: p.id, nome: p.nome, referencia: p.referencia || "", valorUnitario: Number(p.valor_unitario),
    ativo: p.ativo, prioridade: p.prioridade,
    roteiro: (p.roteiro_etapas || [])
      .slice()
      .sort((a, b) => a.ordem - b.ordem)
      .map((e) => ({
        id: e.id,
        operacao: e.operacoes?.nome || "",
        metas: {
          m1: Number(e.meta_m1), m2: Number(e.meta_m2), m3: Number(e.meta_m3),
          t1: Number(e.meta_t1), t2: Number(e.meta_t2), t3: Number(e.meta_t3),
        },
        maquinasIds: (e.roteiro_etapa_maquinas || []).map((m) => m.maquina_id),
      })),
  };
}

export function useProdutos(pronto: boolean) {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select(PRODUTO_COM_ROTEIRO_SELECT)
        .order("created_at")
        .order("ordem", { referencedTable: "roteiro_etapas" });
      if (!montado) return;
      if (error) {
        setErro("Não foi possível carregar os produtos.");
        setLoading(false);
        return;
      }
      setProdutos(((data || []) as unknown as ProdutoRow[]).map(linhaParaProduto));
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [pronto]);

  const criarProduto = useCallback(async (payload: ProdutoPayload): Promise<Produto | null> => {
    const { data: prodRow, error: prodErro } = await supabase
      .from("produtos")
      .insert({
        nome: payload.nome, referencia: payload.referencia || null,
        valor_unitario: payload.valorUnitario, prioridade: payload.prioridade, ativo: true,
      })
      .select("id, nome, referencia, valor_unitario, ativo, prioridade")
      .single();
    if (prodErro || !prodRow) {
      setErro("Não foi possível criar o produto.");
      return null;
    }
    const roteiroSalvo = await salvarRoteiro(prodRow.id, payload.roteiro);
    if (roteiroSalvo === null) setErro("Produto criado, mas não foi possível salvar o roteiro de fabricação.");
    const novo: Produto = {
      id: prodRow.id, nome: prodRow.nome, referencia: prodRow.referencia || "",
      valorUnitario: Number(prodRow.valor_unitario), ativo: prodRow.ativo, prioridade: prodRow.prioridade,
      roteiro: roteiroSalvo || [],
    };
    setProdutos((prev) => [...prev, novo]);
    return novo;
  }, []);

  // Produto + roteiro são persistidos atomicamente via RPC
  // (atualizar_produto_com_roteiro, migration 5): uma etapa existente
  // (id em formato UUID) vira UPDATE pelo id; uma etapa nova (id local
  // criado por uid() em criarEtapaVazia, nunca em formato UUID) vira
  // INSERT; uma etapa que existia pro produto e não veio mais no payload
  // vira DELETE — e só nesse caso o RESTRICT de previsao_item_maquinas
  // pode disparar. Como tudo roda dentro de uma função Postgres só, um
  // RESTRICT (ou qualquer outro erro) desfaz a operação inteira,
  // incluindo os campos do produto — nunca fica parcialmente salvo.
  const atualizarProduto = useCallback(async (id: string, payload: ProdutoPayload): Promise<boolean> => {
    const roteiroPayload: Record<string, unknown>[] = [];
    for (let i = 0; i < payload.roteiro.length; i++) {
      const etapa = payload.roteiro[i];
      const operacaoId = await resolverOperacaoId(etapa.operacao);
      if (!operacaoId) {
        setErro("Não foi possível salvar o produto: operação não encontrada.");
        return false;
      }
      roteiroPayload.push({
        id: UUID_RE.test(etapa.id) ? etapa.id : null,
        ordem: i,
        operacao_id: operacaoId,
        meta_m1: etapa.metas.m1, meta_m2: etapa.metas.m2, meta_m3: etapa.metas.m3,
        meta_t1: etapa.metas.t1, meta_t2: etapa.metas.t2, meta_t3: etapa.metas.t3,
        maquinas_ids: etapa.maquinasIds,
      });
    }

    const { error } = await supabase.rpc("atualizar_produto_com_roteiro", {
      p_produto_id: id,
      p_nome: payload.nome,
      p_referencia: payload.referencia || null,
      p_valor_unitario: payload.valorUnitario,
      p_prioridade: payload.prioridade,
      p_roteiro: roteiroPayload,
    });
    if (error) {
      setErro(
        error.code === "23503"
          ? "Não foi possível salvar: uma etapa removida já está em uso numa previsão lançada. Nada foi alterado."
          : "Não foi possível salvar o produto."
      );
      return false;
    }

    // Salvou de verdade — busca o produto de novo só pra pegar os ids
    // reais das etapas que eram novas (a function não devolve isso).
    const { data, error: fetchErro } = await supabase
      .from("produtos")
      .select(PRODUTO_COM_ROTEIRO_SELECT)
      .eq("id", id)
      .single();
    if (fetchErro || !data) {
      setErro("Produto salvo, mas não foi possível recarregar os dados atualizados.");
      return true;
    }
    const atualizado = linhaParaProduto(data as unknown as ProdutoRow);
    setProdutos((prev) => prev.map((p) => (p.id === id ? atualizado : p)));
    return true;
  }, []);

  const alternarProdutoAtivo = useCallback(async (id: string) => {
    const atual = produtos.find((p) => p.id === id);
    if (!atual) return;
    const novoAtivo = !atual.ativo;
    setProdutos((prev) => prev.map((p) => (p.id === id ? { ...p, ativo: novoAtivo } : p)));
    const { error } = await supabase.from("produtos").update({ ativo: novoAtivo }).eq("id", id);
    if (error) setErro("Não foi possível atualizar o produto.");
  }, [produtos]);

  // Exclusão respeita as FKs do banco: roteiro_etapas/roteiro_etapa_maquinas
  // são CASCADE (somem junto, como esperado), mas previsao_itens.produto_id
  // é RESTRICT — um produto já usado numa previsão lançada não pode ser
  // excluído, e isso vira um erro claro em vez de falhar silenciosamente.
  // Não otimista de propósito: só some da lista se realmente excluiu.
  const removerProduto = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await supabase.from("produtos").delete().eq("id", id);
    if (error) {
      if (error.code === "23503") {
        setErro("Esse produto está referenciado em uma previsão lançada e não pode ser excluído — pause ele em vez de excluir.");
      } else {
        setErro("Não foi possível excluir o produto.");
      }
      return false;
    }
    setProdutos((prev) => prev.filter((p) => p.id !== id));
    return true;
  }, []);

  return {
    produtos, loading, erro,
    criarProduto, atualizarProduto, alternarProdutoAtivo, removerProduto,
  };
}

export type ProdutosHook = ReturnType<typeof useProdutos>;
