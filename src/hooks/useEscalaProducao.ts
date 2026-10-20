"use client";

// Leitura da Escala de Produção de UMA semana (RLS normal do usuário) e as
// ações da tela: trocar funcionários, bloquear/liberar recurso e gerar. A
// geração e o recálculo acontecem no SERVIDOR (/api/escala/*) — este hook
// nunca calcula escala.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/services/supabase-client";
import { dispararProcessamentoEscala, gerarEscalaNoServidor, reprocessarEventosEsgotados } from "@/lib/escala/disparar";
import type { AlertaEscala, PeriodoEscala } from "@/features/escala/types";

export interface DiaEscala {
  data: string;
  versao: number;
  atualizadoEm: string;
  periodos: PeriodoEscala[];
}

export interface AlocacaoLinha {
  data: string;
  periodoId: string;
  funcionarioId: string;
  maquinaId: string | null;
  produtoId: string | null;
  etapaId: string | null;
  operacaoId: string | null;
  pecas: number;
  origem: "auto" | "manual";
  excecaoRevezamento: boolean;
  motivoExcecao: string | null;
  motivoSemPosto: string | null;
}

export interface RecursoIndisponivel {
  id: string;
  maquinaId: string;
  motivo: string;
  observacao: string | null;
  desde: string;
  liberadaEm: string | null;
}

export interface Nomes {
  maquinas: Map<string, string>;
  produtos: Map<string, string>;
  operacoes: Map<string, string>;
  funcionarios: Map<string, string>;
}

export interface EstadoEscalaTela {
  previsaoId: string | null;
  dias: DiaEscala[];
  alocacoes: AlocacaoLinha[];
  alertas: AlertaEscala[];
  primeiraGeracaoEmAndamento: boolean;
  eventosPendentes: number;
  eventosComErro: number; // com erro, ainda dentro das 3 tentativas automáticas
  eventosEsgotados: number; // esgotaram as tentativas — em QUALQUER semana (precisa de ação)
  postosDaPrevisao: string[]; // máquinas selecionadas na Previsão da semana
  indisponibilidades: RecursoIndisponivel[]; // abertas
  nomes: Nomes;
}

const VAZIO: EstadoEscalaTela = {
  previsaoId: null, dias: [], alocacoes: [], alertas: [], primeiraGeracaoEmAndamento: false, eventosPendentes: 0, eventosComErro: 0, eventosEsgotados: 0,
  postosDaPrevisao: [], indisponibilidades: [],
  nomes: { maquinas: new Map(), produtos: new Map(), operacoes: new Map(), funcionarios: new Map() },
};

export function useEscalaProducao(pronto: boolean, semanaInicio: string) {
  const [estado, setEstado] = useState<EstadoEscalaTela>(VAZIO);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [acaoEmAndamento, setAcaoEmAndamento] = useState(false);
  const montado = useRef(true);

  const carregar = useCallback(async () => {
    if (!pronto) return;
    setErro(null);
    const falha = (msg: string) => { setErro(msg); setLoading(false); };

    const { data: prev, error: ePrev } = await supabase.from("previsoes").select("id").eq("semana_inicio", semanaInicio).maybeSingle();
    if (ePrev) return falha("Não foi possível carregar a Previsão da semana.");

    const [maq, prod, ops, func] = await Promise.all([
      supabase.from("maquinas").select("id, nome"),
      supabase.from("produtos").select("id, nome"),
      supabase.from("operacoes").select("id, nome"),
      supabase.from("funcionarios_elegibilidade").select("id, nome"),
    ]);
    const nomes: Nomes = {
      maquinas: new Map((maq.data || []).map((r: { id: string; nome: string }) => [r.id, r.nome])),
      produtos: new Map((prod.data || []).map((r: { id: string; nome: string }) => [r.id, r.nome])),
      operacoes: new Map((ops.data || []).map((r: { id: string; nome: string }) => [r.id, r.nome])),
      funcionarios: new Map((func.data || []).map((r: { id: string; nome: string }) => [r.id, r.nome])),
    };

    const indisp = await supabase.from("escala_recurso_indisponivel").select("id, maquina_id, motivo, observacao, desde, liberada_em").is("liberada_em", null).order("desde");
    const indisponibilidades: RecursoIndisponivel[] = (indisp.data || []).map((r: { id: string; maquina_id: string; motivo: string; observacao: string | null; desde: string; liberada_em: string | null }) => ({
      id: r.id, maquinaId: r.maquina_id, motivo: r.motivo, observacao: r.observacao, desde: r.desde, liberadaEm: r.liberada_em,
    }));

    const esg = await supabase.from("escala_producao_eventos").select("id", { count: "exact", head: true }).eq("status", "erro").gte("tentativas", 3);
    const eventosEsgotados = esg.error ? 0 : (esg.count ?? 0);

    if (!prev) {
      if (montado.current) setEstado({ ...VAZIO, nomes, indisponibilidades, eventosEsgotados });
      setLoading(false);
      return;
    }
    const previsaoId = (prev as { id: string }).id;

    const [diasR, itensR, eventosR] = await Promise.all([
      supabase.from("escala_producao_dias").select("data, versao, atualizado_em, periodos_snapshot").eq("previsao_id", previsaoId).order("data"),
      supabase.from("previsao_itens").select("previsao_item_maquinas(maquina_id)").eq("previsao_id", previsaoId).eq("tipo", "previsto"),
      supabase.from("escala_producao_eventos").select("tipo, status, tentativas, criado_em, payload").eq("previsao_id", previsaoId).order("criado_em"),
    ]);
    if (diasR.error) return falha("Não foi possível carregar a Escala.");

    const dias: DiaEscala[] = (diasR.data || []).map((d: { data: string; versao: number; atualizado_em: string; periodos_snapshot: PeriodoEscala[] }) => ({
      data: d.data, versao: d.versao, atualizadoEm: d.atualizado_em, periodos: d.periodos_snapshot,
    }));
    let alocacoes: AlocacaoLinha[] = [];
    if (dias.length > 0) {
      const aR = await supabase.from("escala_producao_alocacoes").select("*").in("data", dias.map((d) => d.data));
      if (aR.error) return falha("Não foi possível carregar as alocações.");
      alocacoes = (aR.data || []).map((r: Record<string, unknown>) => ({
        data: String(r.data), periodoId: String(r.periodo_id), funcionarioId: String(r.funcionario_id),
        maquinaId: (r.maquina_id as string | null) ?? null, produtoId: (r.produto_id as string | null) ?? null, etapaId: (r.etapa_id as string | null) ?? null,
        operacaoId: (r.operacao_id as string | null) ?? null, pecas: Number(r.pecas ?? 0), origem: (r.origem as "auto" | "manual") ?? "auto",
        excecaoRevezamento: Boolean(r.excecao_revezamento), motivoExcecao: (r.motivo_excecao as string | null) ?? null, motivoSemPosto: (r.motivo_sem_posto as string | null) ?? null,
      }));
    }

    const eventos = (eventosR.data || []) as { tipo: string; status: string; tentativas: number; criado_em: string; payload: { resumo?: { alertasDetalhe?: AlertaEscala[]; primeiraGeracaoComSemanaEmAndamento?: boolean } } }[];
    const recalculos = eventos.filter((e) => e.tipo === "recalculo");
    const ultimo = recalculos[recalculos.length - 1];
    const primeiro = recalculos[0];
    const postos = new Set<string>();
    ((itensR.data || []) as { previsao_item_maquinas: { maquina_id: string }[] | null }[]).forEach((i) => (i.previsao_item_maquinas || []).forEach((m) => postos.add(m.maquina_id)));

    if (!montado.current) return;
    setEstado({
      previsaoId, dias, alocacoes,
      alertas: ultimo?.payload?.resumo?.alertasDetalhe ?? [],
      primeiraGeracaoEmAndamento: Boolean(primeiro?.payload?.resumo?.primeiraGeracaoComSemanaEmAndamento),
      eventosPendentes: eventos.filter((e) => ["pendente", "processando"].includes(e.status)).length,
      eventosComErro: eventos.filter((e) => e.status === "erro" && e.tentativas < 3).length,
      eventosEsgotados,
      postosDaPrevisao: [...postos],
      indisponibilidades, nomes,
    });
    setLoading(false);
  }, [pronto, semanaInicio]);

  useEffect(() => {
    montado.current = true;
    setLoading(true);
    carregar();
    return () => { montado.current = false; };
  }, [carregar]);

  async function executar(fn: () => Promise<string | null>): Promise<string | null> {
    if (acaoEmAndamento) return "Aguarde a ação em andamento.";
    setAcaoEmAndamento(true);
    try {
      const msg = await fn();
      await carregar();
      return msg;
    } finally {
      setAcaoEmAndamento(false);
    }
  }

  const gerar = () => executar(async () => {
    const r = await gerarEscalaNoServidor(semanaInicio);
    if (!r.ok) return r.erro || "Falha ao gerar a Escala.";
    if (r.status === "ignorado") return r.motivoIgnorado || "Nada a gerar.";
    return null;
  });

  const trocar = (data: string, periodoId: string, a: string, b: string, motivo: string) => executar(async () => {
    const { error } = await supabase.rpc("escala_trocar_alocacoes", { p_data: data, p_periodo_id: periodoId, p_funcionario_a: a, p_funcionario_b: b, p_motivo: motivo });
    return error ? error.message.replace(/^(ESCALA_PERIODO_NAO_EDITAVEL|ESCALA_MOTIVO_OBRIGATORIO|ESCALA_ROTACAO_VIOLADA):\s*/, "") : null;
  });

  const bloquear = (maquinaId: string, motivo: string, observacao: string) => executar(async () => {
    const { error } = await supabase.rpc("escala_bloquear_recurso", { p_maquina_id: maquinaId, p_motivo: motivo, p_observacao: observacao || null });
    if (error) return error.message;
    await dispararProcessamentoEscala();
    return null;
  });

  const liberar = (id: string) => executar(async () => {
    const { error } = await supabase.rpc("escala_liberar_recurso", { p_id: id });
    if (error) return error.message;
    await dispararProcessamentoEscala();
    return null;
  });

  const processarPendentes = () => executar(async () => {
    await dispararProcessamentoEscala();
    return null;
  });

  const tentarNovamente = () => executar(async () => {
    const r = await reprocessarEventosEsgotados();
    return r.ok ? null : r.erro || "Falha ao reprocessar a Escala.";
  });

  return { estado, loading, erro, acaoEmAndamento, recarregar: carregar, gerar, trocar, bloquear, liberar, processarPendentes, tentarNovamente };
}
