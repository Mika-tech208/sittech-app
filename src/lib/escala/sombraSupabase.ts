// SERVER-ONLY. Adaptador Supabase (service_role) do modo sombra: só I/O. Toda a regra está em sombraServico.ts / features/escala.
// Escreve APENAS em escala_sombra_decisoes (via RPC idempotente) e no status do próprio evento; nunca na Escala oficial.

import type { SupabaseClient } from "@supabase/supabase-js";
import { lerParametros } from "@/features/escala/parametros";
import { ConflitoDeVersaoError } from "./estado";
import type { SnapshotSombra } from "@/features/escala/snapshotSombra";
import { versaoDeLinhaBanco } from "./planoVersionado";
import { criarEscalaIO } from "./supabaseIO";
import { carregarApontamentosBanco, registrarDiagnosticoFluxo } from "./fluxo/supabaseFluxo";
import { CHAVE_PR_LIMIAR, CHAVE_PR_MODO, CHAVE_PR_PARES, CHAVE_PR_SEMANAS, lerConfigFluxo } from "./fluxo/parametrosFluxo";
import { fluxoNoFechamento } from "./fluxo/fechamento";
import { processarSemana } from "./processar";
import { processarSombra, type AplicacaoRestrita, type DecisaoParaGravar, type EventoSombra, type RegistroAvaliacao, type ResumoSombra, type SombraIO } from "./sombraServico";

function linhaDecisao(d: DecisaoParaGravar) {
  const s: SnapshotSombra = d.snapshot;
  return {
    previsao_id: d.previsaoId,
    semana_inicio: s.identificacao.semanaInicio,
    data: s.identificacao.data,
    periodo_id: s.identificacao.periodoId,
    slot: s.identificacao.slot,
    corte_em: new Date(s.identificacao.corteMs).toISOString(),
    motivo_fechamento: s.completude.motivoFechamento,
    dados_completos: s.completude.dadosCompletos,
    completude_percentual: s.completude.percentual,
    postos_esperados: s.completude.postosEsperados,
    postos_recebidos: s.completude.postosRecebidos,
    postos_faltantes: s.completude.postosFaltantes,
    ultimo_lancamento_em: s.completude.ultimoLancamentoMs === null ? null : new Date(s.completude.ultimoLancamentoMs).toISOString(),
    lancamentos_tardios_na_leitura: d.tardios,
    latencia_ms: Math.max(0, Math.round(d.latenciaMs)),
    horizonte: s.horizonte,
    compromisso: s.compromisso,
    entradas: s.entradas,
    planos: { ...s.planos, ...(s.planoOficialRef ? { planoOficialRef: s.planoOficialRef } : {}) }, // inclui a versão do plano oficial usada no corte (id, hashes, versões dos dias)
    diagnostico: s.diagnostico,
    entrada: s.entrada,
    hash_entrada: s.hashes.entrada,
    hash_plano_oficial: s.hashes.planoOficial,
    hash_plano_sombra: s.hashes.planoSombra,
    hash_decisao: s.hashes.decisao,
    situacao: s.diagnostico.situacao,
    versao_motor: s.versaoMotor,
    replanejamento_modo: d.modo ?? "sombra",
    revisao: d.revisao ?? 0,
    motivo: d.motivo ?? "fechamento",
  };
}

export function criarSombraIO(admin: SupabaseClient): SombraIO {
  return {
    async lerModo() {
      const { data, error } = await admin.from("escala_parametros").select("chave, valor").eq("chave", "replanejamento_modo");
      if (error) throw new Error(`escala_parametros: ${error.message}`);
      return lerParametros(data as { chave: string; valor: unknown }[]).replanejamentoModo;
    },
    async lerSemanasAtivas() {
      const { data, error } = await admin.from("escala_parametros").select("chave, valor").eq("chave", "replanejamento_semanas_ativas");
      if (error) throw new Error(`escala_parametros: ${error.message}`);
      return lerParametros(data as { chave: string; valor: unknown }[]).replanejamentoSemanasAtivas;
    },
    async lerConfigFluxo() {
      const { data, error } = await admin.from("escala_parametros").select("chave, valor").in("chave", [CHAVE_PR_MODO, CHAVE_PR_SEMANAS, CHAVE_PR_LIMIAR, CHAVE_PR_PARES]);
      if (error) throw new Error(`escala_parametros: ${error.message}`);
      return lerConfigFluxo(data as { chave: string; valor: unknown }[]);
    },
    async aoFechamento(a) {
      return fluxoNoFechamento(
        { recalcular: (opcoes) => processarSemana(criarEscalaIO(admin, a.estado.previsaoId), opcoes), registrar: async (registro) => { await registrarDiagnosticoFluxo(admin, registro); } },
        { estado: a.estado, ev: { data: a.ev.data, periodoId: a.ev.periodoId }, agoraMs: a.agoraMs }
      );
    },
    async proximaRevisao(previsaoId, data, periodoId) {
      const { data: rows, error } = await admin.from("escala_sombra_decisoes").select("revisao").eq("previsao_id", previsaoId).eq("data", data).eq("periodo_id", periodoId).order("revisao", { ascending: false }).limit(1);
      if (error) throw new Error(`escala_sombra_decisoes: ${error.message}`);
      return ((rows as { revisao: number }[] | null)?.[0]?.revisao ?? -1) + 1;
    },
    async aplicarRestrito(a: AplicacaoRestrita) {
      const { data, error } = await admin.rpc("escala_replanejamento_aplicar", {
        p_previsao: a.previsaoId,
        p_decisao_id: a.decisaoId,
        p_corte: { semana_inicio: a.corte.semanaInicio, data: a.corte.data, periodo_id: a.corte.periodoId, slot: a.corte.slot, revisao: a.corte.revisao, motivo: a.corte.motivo },
        p_dias: a.dias,
        p_a_partir_data: a.aPartirDeData,
        p_a_partir_periodo: a.aPartirDePeriodo,
        p_alocacoes: a.alocacoes.map((x) => ({
          data: x.data, periodo_id: x.periodoId, funcionario_id: x.funcionarioId, maquina_id: x.maquinaId, produto_id: x.produtoId, etapa_id: x.etapaId, operacao_id: x.operacaoId, pecas: x.pecas,
          pecas_adicional: x.pecasAdicional ?? 0, tipo_adicional: x.tipoAdicional ?? null, origem: x.origem ?? "auto", excecao_revezamento: false, motivo_excecao: null, motivo_sem_posto: x.motivoSemPosto,
        })),
        p_hash_proposta: a.hashProposta,
        p_mudancas: a.mudancas,
        p_resumo: a.resumo,
      });
      if (error) {
        if (error.message.includes("ESCALA_VERSAO_CONFLITO")) throw new ConflitoDeVersaoError(error.message);
        throw new Error(`escala_replanejamento_aplicar: ${error.message}`);
      }
      const r = data as { id: string; hash_antes: string; hash_depois: string; versoes_antes: Record<string, number>; versoes_depois: Record<string, number> };
      return { id: r.id, hashAntes: r.hash_antes, hashDepois: r.hash_depois, versoesAntes: r.versoes_antes, versoesDepois: r.versoes_depois };
    },
    async registrarAvaliacao(r: RegistroAvaliacao) {
      const { error } = await admin.rpc("escala_replanejamento_registrar", {
        p_dados: {
          decisao_id: r.decisaoId, previsao_id: r.previsaoId, semana_inicio: r.corte.semanaInicio, data: r.corte.data, periodo_id: r.corte.periodoId, slot: r.corte.slot, revisao: r.corte.revisao, tipo: "aplicacao",
          resultado: r.resultado, motivo: r.motivo, gatilho: r.corte.motivo, a_partir_data: r.aPartir?.data ?? null, a_partir_periodo: r.aPartir?.periodoId ?? null, hash_proposta: r.hashProposta ?? null, mudancas: r.mudancas ?? null, resumo: r.resumo ?? null, erro: r.erro ?? null,
        },
      });
      if (error) throw new Error(`escala_replanejamento_registrar: ${error.message}`);
    },
    async reavaliacoesPendentes(semanas: string[]) {
      const { data, error } = await admin.rpc("escala_replanejamento_pendentes", { p_semanas: semanas });
      if (error) throw new Error(`escala_replanejamento_pendentes: ${error.message}`);
      return ((data ?? []) as { previsao_id: string; data: string; periodo_id: string }[]).map((x) => ({ previsaoId: x.previsao_id, data: x.data, periodoId: x.periodo_id }));
    },
    async listarEventos(): Promise<EventoSombra[]> {
      const { data, error } = await admin.rpc("escala_sombra_listar_eventos");
      if (error) throw new Error(`escala_sombra_listar_eventos: ${error.message}`);
      return ((data ?? []) as { id: string; previsao_id: string | null; status: string; tentativas: number; payload: { data?: string; periodo_id?: string } }[])
        .filter((e) => e.previsao_id && e.payload?.data && e.payload?.periodo_id)
        .map((e) => ({ id: e.id, previsaoId: e.previsao_id as string, data: e.payload.data as string, periodoId: e.payload.periodo_id as string, status: e.status, tentativas: e.tentativas }));
    },
    async carregar(previsaoId: string) {
      const estado = await criarEscalaIO(admin, previsaoId).carregarEstado(Date.now());
      const apontamentos = await carregarApontamentosBanco(admin, estado.semanaInicio);
      return { estado, apontamentos };
    },
    async versaoDoPlano(previsaoId: string, emMs: number) {
      const { data, error } = await admin.rpc("escala_plano_versao_em", { p_previsao: previsaoId, p_em: new Date(emMs).toISOString() });
      if (error) throw new Error(`escala_plano_versao_em: ${error.message}`);
      const linha = ((data ?? []) as Record<string, unknown>[])[0];
      return linha ? versaoDeLinhaBanco(linha) : null;
    },
    async reivindicar(eventoId: string) {
      const { data, error } = await admin.rpc("escala_sombra_reivindicar", { p_evento_id: eventoId });
      if (error) throw new Error(`escala_sombra_reivindicar: ${error.message}`);
      return data === true;
    },
    async gravarDecisao(d: DecisaoParaGravar) {
      const { data, error } = await admin.rpc("escala_sombra_gravar_decisao", { p_evento_id: d.eventoId, p_dados: linhaDecisao(d) });
      if (error) throw new Error(`escala_sombra_gravar_decisao: ${error.message}`);
      const r = data as { inserida: boolean; id: string };
      return { inserida: r.inserida === true, id: r.id };
    },
    async concluir(eventoId, status, erro = null) {
      const { error } = await admin.rpc("escala_concluir_eventos", { p_ids: [eventoId], p_status: status, p_erro: erro });
      if (error) throw new Error(`escala_concluir_eventos: ${error.message}`);
    },
  };
}

// Chamado pelos endpoints /api/escala/processar e /api/escala/drenar depois do processamento normal. Nunca lança: o modo sombra não pode
// atrapalhar a Escala oficial (qualquer erro vira log + resumo).
export async function processarSombraDoServidor(admin: SupabaseClient, agoraMs: number): Promise<ResumoSombra | { erro: string }> {
  try {
    return await processarSombra(criarSombraIO(admin), agoraMs);
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error("escala/sombra:", erro);
    return { erro };
  }
}
