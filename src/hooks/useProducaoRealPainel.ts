"use client";

// Camada mínima de acesso ao Supabase para a tela principal de chão de
// fábrica da Produção Real V1. Modo automático (padrão): resolve o
// período atual via a RPC `resolver_periodo_por_horario` (mesma fonte de
// verdade usada por registrar_apontamento_producao/registrar_sem_producao
// — nunca recalculada aqui, evita divergir da regra de janela de
// fechamento de ~10min). Modo "outro período" (retroativo): recebe
// data+periodo_id já escolhidos pela supervisora e busca só o nome/
// horário do período em `periodos`, sem chamar a RPC de resolução
// automática nenhuma. Nos dois modos, busca os apontamentos_producao
// daquele dia/período e as ocorrencias_maquina abertas (qualquer período
// — uma parada não é do período, é da máquina).
//
// Meta, custo, OEE, performance etc. NUNCA são buscados aqui — a
// supervisora não vê nenhum desses campos nesta tela (decisão de UX já
// aprovada). "Apontado" mostra só produto + quantidade produzida.

import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { Maquina } from "@/types/domain";

export type EstadoPeriodoMaquina = "pendente" | "apontado" | "sem_producao";

export interface OcorrenciaAberta {
  id: string;
  produtoNome: string;
  funcionarioNome: string;
  motivoNome: string;
  descricao: string;
  abertaEm: string;
}

export interface MaquinaProducaoReal {
  id: string;
  nome: string;
  estadoPeriodo: EstadoPeriodoMaquina;
  estadoMaquina: "operando" | "parada";
  produtoNome: string | null;
  quantidadeProduzida: number | null;
  motivoSemProducao: string | null;
  ocorrenciaAberta: OcorrenciaAberta | null;
}

export interface PeriodoAtual {
  id: string;
  nome: string;
  inicio: string;
  fim: string;
  data: string;
}

export interface PeriodoSelecionado {
  data: string;
  periodoId: string;
}

interface PeriodoResolvidoRow {
  periodo_id: string;
  periodo_inicio: string;
  periodo_fim: string;
}

interface ApontamentoRow {
  maquina_id: string;
  status: "produzindo" | "sem_producao";
  quantidade_produzida: number;
  motivo_sem_producao: string | null;
  produtos: { nome: string } | null;
}

interface OcorrenciaAbertaRow {
  id: string;
  maquina_id: string;
  descricao: string;
  aberta_em: string;
  produtos: { nome: string } | null;
  funcionarios: { nome: string } | null;
  motivos_parada: { nome: string } | null;
}

// "HH:MM:SS"/"YYYY-MM-DD" em horário de São Paulo — mesma assunção de
// fuso já usada em todas as RPCs de Produção Real (períodos não cruzam
// meia-noite). Exportadas pro seletor "Outro período" reusar o mesmo
// cálculo de "agora", sem duplicar.
export function horaLocalSP(): string {
  return new Date().toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour12: false });
}
export function dataLocalSP(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export function useProducaoRealPainel(
  pronto: boolean,
  maquinasAtivas: Pick<Maquina, "id" | "nome">[],
  periodoSelecionado?: PeriodoSelecionado | null
) {
  const [periodoAtual, setPeriodoAtual] = useState<PeriodoAtual | null>(null);
  const [maquinasView, setMaquinasView] = useState<MaquinaProducaoReal[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const modoRetroativo = !!periodoSelecionado;

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      setLoading(true);
      setErro(null);
      // Limpa o estado anterior ANTES de tentar buscar de novo — senão,
      // ao trocar de período (ou voltar pro automático) e essa nova busca
      // falhar, o banner/grade antigos continuam na tela por baixo da
      // mensagem de erro, em vez de sumirem.
      setPeriodoAtual(null);
      setMaquinasView([]);

      let dataLocal: string;
      let resolvido: PeriodoResolvidoRow;

      if (periodoSelecionado) {
        dataLocal = periodoSelecionado.data;
        const { data: periodoRow, error: periodoErro } = await supabase
          .from("periodos")
          .select("id, inicio, fim")
          .eq("id", periodoSelecionado.periodoId)
          .maybeSingle();
        if (!montado) return;
        if (periodoErro || !periodoRow) {
          setErro("Não foi possível carregar o período escolhido.");
          setLoading(false);
          return;
        }
        resolvido = { periodo_id: periodoRow.id, periodo_inicio: periodoRow.inicio, periodo_fim: periodoRow.fim };
      } else {
        dataLocal = dataLocalSP();
        const { data: periodoRowsRaw, error: periodoErro } = await supabase
          .rpc("resolver_periodo_por_horario", { p_hora_local: horaLocalSP() });
        const periodoRows = periodoRowsRaw as PeriodoResolvidoRow[] | null;
        if (!montado) return;
        if (periodoErro || !periodoRows || periodoRows.length === 0) {
          setErro(periodoErro?.message || "Não foi possível identificar o período atual.");
          setLoading(false);
          return;
        }
        resolvido = periodoRows[0];
      }

      const [apontamentosRes, ocorrenciasRes] = await Promise.all([
        supabase
          .from("apontamentos_producao")
          .select("maquina_id, status, quantidade_produzida, motivo_sem_producao, produtos(nome)")
          .eq("data", dataLocal)
          .eq("periodo_id", resolvido.periodo_id)
          .returns<ApontamentoRow[]>(),
        supabase
          .from("ocorrencias_maquina")
          .select("id, maquina_id, descricao, aberta_em, produtos(nome), funcionarios(nome), motivos_parada(nome)")
          .is("encerrada_em", null)
          .returns<OcorrenciaAbertaRow[]>(),
      ]);
      if (!montado) return;
      if (apontamentosRes.error || ocorrenciasRes.error) {
        setErro("Não foi possível carregar os apontamentos ou ocorrências deste período.");
        setLoading(false);
        return;
      }

      const apontamentoPorMaquina = new Map<string, ApontamentoRow>();
      (apontamentosRes.data || []).forEach((a) => apontamentoPorMaquina.set(a.maquina_id, a));
      const ocorrenciaAbertaPorMaquina = new Map<string, OcorrenciaAberta>();
      (ocorrenciasRes.data || []).forEach((o) =>
        ocorrenciaAbertaPorMaquina.set(o.maquina_id, {
          id: o.id,
          produtoNome: o.produtos?.nome || "",
          funcionarioNome: o.funcionarios?.nome || "",
          motivoNome: o.motivos_parada?.nome || "",
          descricao: o.descricao,
          abertaEm: o.aberta_em,
        })
      );

      // Nome/horário de exibição do período: já temos o id — só falta o
      // nome amigável ("T2"), que mora em `periodos`.
      const { data: periodoNomeRow } = await supabase
        .from("periodos")
        .select("nome")
        .eq("id", resolvido.periodo_id)
        .maybeSingle();

      if (!montado) return;

      setPeriodoAtual({
        id: resolvido.periodo_id,
        nome: periodoNomeRow?.nome || resolvido.periodo_id.toUpperCase(),
        inicio: String(resolvido.periodo_inicio).slice(0, 5),
        fim: String(resolvido.periodo_fim).slice(0, 5),
        data: dataLocal,
      });

      setMaquinasView(
        maquinasAtivas.map((m) => {
          const ap = apontamentoPorMaquina.get(m.id);
          const estadoPeriodo: EstadoPeriodoMaquina = !ap ? "pendente" : ap.status === "sem_producao" ? "sem_producao" : "apontado";
          const ocorrenciaAberta = ocorrenciaAbertaPorMaquina.get(m.id) || null;
          return {
            id: m.id,
            nome: m.nome,
            estadoPeriodo,
            estadoMaquina: ocorrenciaAberta ? "parada" : "operando",
            produtoNome: estadoPeriodo === "apontado" ? ap?.produtos?.nome || null : null,
            quantidadeProduzida: estadoPeriodo === "apontado" ? Number(ap?.quantidade_produzida ?? 0) : null,
            motivoSemProducao: estadoPeriodo === "sem_producao" ? ap?.motivo_sem_producao || null : null,
            ocorrenciaAberta,
          };
        })
      );
      setLoading(false);
    })();
    return () => { montado = false; };
    // maquinasAtivas vem de outro hook (useMaquinas) já estável após seu
    // próprio carregamento — recalcular só quando `pronto` ou o período
    // escolhido mudam evita refetch em loop a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, periodoSelecionado?.data, periodoSelecionado?.periodoId]);

  // Atualiza um card localmente pra "apontado" sem refazer a busca inteira
  // — chamado pelo formulário logo depois de um registrar_apontamento_producao
  // (ou _retroativo) bem-sucedido (a grade não recarrega do zero).
  function marcarMaquinaApontada(maquinaId: string, produtoNome: string, quantidadeProduzida: number) {
    setMaquinasView((prev) =>
      prev.map((m) =>
        m.id === maquinaId
          ? { ...m, estadoPeriodo: "apontado", produtoNome, quantidadeProduzida, motivoSemProducao: null }
          : m
      )
    );
  }

  // Mesma ideia, pro fluxo "sem produção" — chamado logo depois de um
  // registrar_sem_producao (ou _retroativo) bem-sucedido.
  function marcarMaquinaSemProducao(maquinaId: string, motivoSemProducao: string) {
    setMaquinasView((prev) =>
      prev.map((m) =>
        m.id === maquinaId
          ? { ...m, estadoPeriodo: "sem_producao", motivoSemProducao, produtoNome: null, quantidadeProduzida: null }
          : m
      )
    );
  }

  // Atualiza um card localmente pra "parada" assim que abrir_ocorrencia_maquina
  // retorna com sucesso — independente do estadoPeriodo (pendente/apontado/
  // sem_producao continua exatamente como estava).
  function marcarOcorrenciaAberta(maquinaId: string, ocorrencia: OcorrenciaAberta) {
    setMaquinasView((prev) =>
      prev.map((m) => (m.id === maquinaId ? { ...m, estadoMaquina: "parada", ocorrenciaAberta: ocorrencia } : m))
    );
  }

  // Mesma ideia, chamada logo depois de um encerrar_ocorrencia_maquina
  // bem-sucedido — remove "PARADA AGORA" sem tocar no estadoPeriodo.
  function marcarOcorrenciaEncerrada(maquinaId: string) {
    setMaquinasView((prev) =>
      prev.map((m) => (m.id === maquinaId ? { ...m, estadoMaquina: "operando", ocorrenciaAberta: null } : m))
    );
  }

  return {
    periodoAtual, maquinasView, loading, erro, modoRetroativo,
    marcarMaquinaApontada, marcarMaquinaSemProducao,
    marcarOcorrenciaAberta, marcarOcorrenciaEncerrada,
  };
}

export type ProducaoRealPainelHook = ReturnType<typeof useProducaoRealPainel>;
