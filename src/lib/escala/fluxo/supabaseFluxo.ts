// SERVER-ONLY. Adaptador Supabase (service_role) da Escala Inteligente (fluxo): só I/O.
//  - leitura dos apontamentos da semana (reaproveita a RPC escala_sombra_apontamentos: TODAS as linhas, produzindo e sem_producao, com motivo e carimbo);
//  - gravação do diagnóstico via escala_fluxo_registrar (idempotente, com portão no banco).
// Toda a regra vive em integracao.ts / src/features/escala/fluxo.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import { paraReal, type ApontamentoBanco } from "../sombraServico";
import type { RegistroFluxo } from "./integracao";

const ms = (v: string | null | undefined) => (v ? Date.parse(v) : null);

export function linhasParaApontamentosBanco(rows: Record<string, unknown>[]): ApontamentoBanco[] {
  return rows.map((r): ApontamentoBanco => ({
    data: String(r.data), periodoId: String(r.periodo_id), funcionarioId: (r.funcionario_id as string | null) ?? null, maquinaId: (r.maquina_id as string | null) ?? null,
    produtoId: (r.produto_id as string | null) ?? null, etapaId: (r.etapa_id as string | null) ?? null, operacaoId: (r.operacao_id as string | null) ?? null,
    quantidadeProduzida: Number(r.quantidade_produzida ?? 0), quantidadeRefugo: Number(r.quantidade_refugo ?? 0), meta: Number(r.meta ?? 0), status: String(r.status),
    motivo: (r.motivo as string | null) ?? null, criadoEmMs: ms(r.criado_em as string) as number, atualizadoEmMs: ms(r.atualizado_em as string | null),
  }));
}

/** Todas as linhas de apontamento da semana (RPC escala_sombra_apontamentos). */
export async function carregarApontamentosBanco(admin: SupabaseClient, semanaInicio: string): Promise<ApontamentoBanco[]> {
  const { data, error } = await admin.rpc("escala_sombra_apontamentos", { p_semana_inicio: semanaInicio });
  if (error) throw new Error(`escala_sombra_apontamentos: ${error.message}`);
  return linhasParaApontamentosBanco((data ?? []) as Record<string, unknown>[]);
}

export async function carregarApontamentosReais(admin: SupabaseClient, semanaInicio: string): Promise<ApontamentoReal[]> {
  return (await carregarApontamentosBanco(admin, semanaInicio)).map(paraReal);
}

export function linhaDiagnostico(r: RegistroFluxo): Record<string, unknown> {
  return {
    previsao_id: r.previsaoId, semana_inicio: r.semanaInicio, gatilho: r.gatilho, modo: r.modo, resultado: r.resultado,
    corte_data: r.corte.data, corte_periodo_id: r.corte.periodoId, corte_c: r.corte.c, versao_motor: r.versaoMotor,
    hash_entrada: r.hashEntrada, hash_plano_oficial: r.hashPlanoOficial, hash_plano_fluxo: r.hashPlanoFluxo,
    demanda_oficial: r.demandaOficial, demanda_real: r.demandaReal, wip: r.wip, gargalos: r.gargalos, avaliacao_oficial: r.avaliacaoOficial, avaliacao_fluxo: r.avaliacaoFluxo,
    diff: r.diff, violacoes: r.violacoes, churn: r.churn, replanejamento: r.replanejamento, diagnosticos: r.diagnosticos, erro: r.erro, aplicado: r.aplicado,
  };
}

/** Idempotente: o mesmo (previsão, gatilho, hash da entrada, hash do plano de fluxo, modo) não duplica. `bloqueado` = o portão do banco recusou (modo desligado/semana fora da lista). */
export async function registrarDiagnosticoFluxo(admin: SupabaseClient, r: RegistroFluxo): Promise<{ inserido: boolean; id: string | null; bloqueado?: string }> {
  const { data, error } = await admin.rpc("escala_fluxo_registrar", { p_dados: linhaDiagnostico(r) });
  if (error) throw new Error(`escala_fluxo_registrar: ${error.message}`);
  const x = (data ?? {}) as { inserido?: boolean; id?: string | null; bloqueado?: string };
  return { inserido: x.inserido === true, id: x.id ?? null, ...(x.bloqueado ? { bloqueado: x.bloqueado } : {}) };
}
