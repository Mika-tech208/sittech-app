"use client";

// Camada mínima de acesso ao Supabase pros 4 cadastros-base já aprovados
// pra migração: categorias, operacoes, periodos, configuracoes_empresa.
// O banco já é a fonte de verdade pras 20 tabelas — aqui só carregamos e
// escrevemos os 4 conjuntos que esta etapa autorizou, preservando o MESMO
// formato que o frontend já espera hoje (categorias/operacoes como
// string[], período como Periodo[]), pra não exigir mudança de tipo em
// nenhum componente consumidor.
//
// Os demais dados (funcionarios, maquinas, produtos, previsoes,
// faturamentos, custos, auditoria, usuarios) já têm seus próprios hooks
// Supabase (useFuncionarios, useMaquinas, useProdutos, usePrevisoes,
// useFaturamentos, useCustos, useAuditoria, useUsuarios) — não tocados aqui.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { Periodo } from "@/types/domain";

// `pronto` deve ser true só quando já existe uma sessão Supabase Auth
// válida (auth.autenticado) — o client anon/deslogado não tem GRANT nas
// tabelas (só `authenticated` tem, ver migration de RLS), então buscar
// antes disso sempre retorna 401. Sem esse gate, o fetch dispara no mount
// (antes do login) e nunca tenta de novo depois que a sessão existe.
export function useCadastrosBase(pronto: boolean) {
  const [categorias, setCategorias] = useState<string[]>([]);
  const [operacoes, setOperacoes] = useState<string[]>([]);
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [diasUteis, setDiasUteisState] = useState("22");
  const [diasUteisSemana, setDiasUteisSemanaState] = useState("5");
  const [configId, setConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      const [catRes, opRes, perRes, cfgRes] = await Promise.all([
        supabase.from("categorias").select("id, nome").order("nome"),
        supabase.from("operacoes").select("id, nome").order("nome"),
        // id é a chave natural "m1".."t3" — ordenar por id já dá a ordem
        // certa de exibição (M1, M2, M3, T1, T2, T3), sem precisar de coluna extra.
        supabase.from("periodos").select("id, nome, inicio, fim").order("id"),
        supabase.from("configuracoes_empresa").select("id, dias_uteis, dias_uteis_semana").limit(1).maybeSingle(),
      ]);
      if (!montado) return;

      if (catRes.error || opRes.error || perRes.error || cfgRes.error) {
        setErro("Não foi possível carregar categorias, operações, períodos ou configurações da empresa.");
        setLoading(false);
        return;
      }

      setCategorias((catRes.data || []).map((c) => c.nome));
      setOperacoes((opRes.data || []).map((o) => o.nome));
      // Postgres `time` volta como "HH:MM:SS" — o frontend sempre trabalhou
      // com "HH:MM" (ver Periodo.inicio/fim); adaptação de formato só aqui,
      // na camada de dados, sem mexer em nenhuma fórmula.
      setPeriodos((perRes.data || []).map((p) => ({ id: p.id, nome: p.nome, inicio: String(p.inicio).slice(0, 5), fim: String(p.fim).slice(0, 5) })));
      if (cfgRes.data) {
        setConfigId(cfgRes.data.id);
        setDiasUteisState(String(cfgRes.data.dias_uteis));
        setDiasUteisSemanaState(String(cfgRes.data.dias_uteis_semana));
      }
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [pronto]);

  // Mesmo contrato do addCategoria/addOperacao antigos (dedup
  // case-insensitive, devolve o nome resolvido) — só que agora async,
  // porque o dado mora no Supabase.
  const criarCategoria = useCallback(async (nomeDigitado: string): Promise<string | null> => {
    const nome = nomeDigitado.trim();
    if (!nome) return null;
    const existente = categorias.find((c) => c.toLowerCase() === nome.toLowerCase());
    if (existente) return existente;
    const { data, error } = await supabase.from("categorias").insert({ nome }).select("nome").single();
    if (error || !data) {
      setErro("Não foi possível criar a categoria.");
      return null;
    }
    setCategorias((prev) => [...prev, data.nome].sort((a, b) => a.localeCompare(b)));
    return data.nome;
  }, [categorias]);

  const criarOperacao = useCallback(async (nomeDigitado: string): Promise<string | null> => {
    const nome = nomeDigitado.trim();
    if (!nome) return null;
    const existente = operacoes.find((o) => o.toLowerCase() === nome.toLowerCase());
    if (existente) return existente;
    const { data, error } = await supabase.from("operacoes").insert({ nome }).select("nome").single();
    if (error || !data) {
      setErro("Não foi possível criar a operação.");
      return null;
    }
    setOperacoes((prev) => [...prev, data.nome].sort((a, b) => a.localeCompare(b)));
    return data.nome;
  }, [operacoes]);

  const atualizarPeriodo = useCallback(async (id: string, campo: "inicio" | "fim", valor: string) => {
    setPeriodos((prev) => prev.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)));
    const { error } = await supabase.from("periodos").update({ [campo]: valor }).eq("id", id);
    if (error) setErro("Não foi possível salvar o período.");
  }, []);

  // Sempre UPDATE no registro já existente (configId vem do carregamento
  // inicial) — nunca insere linha nova, conforme exigido.
  const atualizarConfiguracoesEmpresa = useCallback(async (overrides: { diasUteis?: string; diasUteisSemana?: string }) => {
    if (!configId) return;
    const patch: Record<string, number> = {};
    if (overrides.diasUteis !== undefined) {
      patch.dias_uteis = Number(String(overrides.diasUteis).replace(",", ".")) || 0;
      setDiasUteisState(overrides.diasUteis);
    }
    if (overrides.diasUteisSemana !== undefined) {
      patch.dias_uteis_semana = Number(String(overrides.diasUteisSemana).replace(",", ".")) || 0;
      setDiasUteisSemanaState(overrides.diasUteisSemana);
    }
    if (Object.keys(patch).length === 0) return;
    const { error } = await supabase.from("configuracoes_empresa").update(patch).eq("id", configId);
    if (error) setErro("Não foi possível salvar a configuração.");
  }, [configId]);

  return {
    categorias, operacoes, periodos, diasUteis, diasUteisSemana,
    loading, erro,
    criarCategoria, criarOperacao, atualizarPeriodo, atualizarConfiguracoesEmpresa,
  };
}

export type CadastrosBase = ReturnType<typeof useCadastrosBase>;
