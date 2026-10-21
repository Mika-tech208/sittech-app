// SERVER-ONLY. Adaptador Supabase (service_role) do modo sombra: só I/O. Toda a regra está em sombraServico.ts / features/escala.
// Escreve APENAS em escala_sombra_decisoes (via RPC idempotente) e no status do próprio evento; nunca na Escala oficial.

import type { SupabaseClient } from "@supabase/supabase-js";
import { lerParametros } from "@/features/escala/parametros";
import type { SnapshotSombra } from "@/features/escala/snapshotSombra";
import { criarEscalaIO } from "./supabaseIO";
import { processarSombra, type ApontamentoBanco, type DecisaoParaGravar, type EventoSombra, type ResumoSombra, type SombraIO } from "./sombraServico";

const ms = (v: string | null | undefined) => (v ? Date.parse(v) : null);

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
    planos: s.planos,
    diagnostico: s.diagnostico,
    entrada: s.entrada,
    hash_entrada: s.hashes.entrada,
    hash_plano_oficial: s.hashes.planoOficial,
    hash_plano_sombra: s.hashes.planoSombra,
    hash_decisao: s.hashes.decisao,
    situacao: s.diagnostico.situacao,
    versao_motor: s.versaoMotor,
    replanejamento_modo: "sombra",
  };
}

export function criarSombraIO(admin: SupabaseClient): SombraIO {
  return {
    async lerModo() {
      const { data, error } = await admin.from("escala_parametros").select("chave, valor").eq("chave", "replanejamento_modo");
      if (error) throw new Error(`escala_parametros: ${error.message}`);
      return lerParametros(data as { chave: string; valor: unknown }[]).replanejamentoModo;
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
      const { data, error } = await admin.rpc("escala_sombra_apontamentos", { p_semana_inicio: estado.semanaInicio });
      if (error) throw new Error(`escala_sombra_apontamentos: ${error.message}`);
      const apontamentos = ((data ?? []) as Record<string, unknown>[]).map((r): ApontamentoBanco => ({
        data: String(r.data), periodoId: String(r.periodo_id), funcionarioId: (r.funcionario_id as string | null) ?? null, maquinaId: (r.maquina_id as string | null) ?? null,
        produtoId: (r.produto_id as string | null) ?? null, etapaId: (r.etapa_id as string | null) ?? null, operacaoId: (r.operacao_id as string | null) ?? null,
        quantidadeProduzida: Number(r.quantidade_produzida ?? 0), quantidadeRefugo: Number(r.quantidade_refugo ?? 0), meta: Number(r.meta ?? 0), status: String(r.status),
        motivo: (r.motivo as string | null) ?? null, criadoEmMs: ms(r.criado_em as string) as number, atualizadoEmMs: ms(r.atualizado_em as string | null),
      }));
      return { estado, apontamentos };
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
