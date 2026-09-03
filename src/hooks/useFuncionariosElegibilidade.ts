"use client";

// Leitura mínima de funcionários (id/nome/ativo) via a view
// `funcionarios_elegibilidade` — nunca inclui salario_base. Existe só
// porque, com a RLS de `funcionarios` restrita por permissão (módulo
// Funcionários/Custo por Hora), a Produção Real precisa continuar
// enxergando funcionários (inclusive inativos, pra rotular apontamentos
// antigos corretamente em "Apontamentos realizados") sem exigir permissão
// nenhuma de módulo — ver migration 20260902190000_permissoes_por_usuario.sql.
// Retorna TODOS (ativos e inativos) — cada consumidor filtra por `ativo`
// quando precisar (ex.: dropdown de novo apontamento só mostra ativos;
// resumo/listagem de histórico precisa rotular qualquer um).

import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";

export interface FuncionarioElegivel {
  id: string;
  nome: string;
  ativo: boolean;
}

interface FuncionarioElegibilidadeRow {
  id: string;
  nome: string;
  ativo: boolean;
}

export function useFuncionariosElegibilidade(pronto: boolean) {
  const [funcionarios, setFuncionarios] = useState<FuncionarioElegivel[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      const { data, error } = await supabase
        .from("funcionarios_elegibilidade")
        .select("id, nome, ativo")
        .order("nome")
        .returns<FuncionarioElegibilidadeRow[]>();
      if (!montado) return;
      if (error) {
        setErro("Não foi possível carregar os funcionários.");
        setLoading(false);
        return;
      }
      setFuncionarios((data || []).map((f) => ({ id: f.id, nome: f.nome, ativo: f.ativo })));
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [pronto]);

  return { funcionarios, loading, erro };
}
