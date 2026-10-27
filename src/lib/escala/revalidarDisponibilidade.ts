// SERVER-ONLY. Revalidação da disponibilidade das máquinas da Escala (Parada de máquina + bloqueio manual).
//
// Chamada pelo worker /api/escala/drenar (agendadores, inclusive os horários 5 min antes de cada período) e por
// /api/escala/processar (navegador). Sempre idempotente; sem mudança = nenhum evento e, portanto, nenhuma versão nova:
//   1) RECONCILIA o espelho Parada -> escala_recurso_indisponivel a partir de ocorrencias_maquina (fonte da verdade). Repara o que o
//      trigger não tenha feito (ex.: dado antigo) e só emite evento quando o ESTADO EFETIVO muda;
//   2) dentro da janela de um período (início −6 min .. +15 min), confere a INVARIANTE: nenhum período futuro pode ter alocação numa máquina
//      com causa ativa que o intersecte. Se houver violação e nenhum evento de bloqueio foi registrado para a causa, registra um
//      (fail-closed: com Parada aberta conhecida a máquina NUNCA é tratada como disponível por falta de resposta).
// O evento só entra no outbox; quem recalcula é o processamento normal (com seus locks e versões). Falha aqui nunca derruba a drenagem.

import type { SupabaseClient } from "@supabase/supabase-js";
import { dentroDaJanelaPreChecagem } from "@/features/escala/preChecagem";
import { registrarEvento } from "./supabaseIO";

export interface ViolacaoDisponibilidade { previsaoId: string; data: string; periodoId: string; maquinaId: string; desde: string; causaId: string }
// causaId = payload.indisponibilidade_id do evento: identifica A QUAL causa o evento se refere (um evento de outra Parada, mesmo recente, não cobre a causa)
export interface EventoBloqueioRecente { previsaoId: string; criadoEm: string; status: string; causaId: string | null }
export interface DecisaoViolacoes {
  registrar: { previsaoId: string; violacoes: number; causaId: string }[]; // nenhuma tentativa de resolver a causa foi registrada: pedir recálculo
  aguardando: string[]; // há evento de bloqueio da causa ainda na fila (será processado nesta mesma drenagem)
  persistentes: ViolacaoDisponibilidade[]; // o evento já foi processado e o plano ainda viola: NÃO repetir (evita laço); só alertar
}

// Decisão pura (testável): para cada semana com violação, existe evento de bloqueio DA(S) CAUSA(S) violada(s)?
export function decidirViolacoes(violacoes: ViolacaoDisponibilidade[], eventos: EventoBloqueioRecente[]): DecisaoViolacoes {
  const porSemana = new Map<string, ViolacaoDisponibilidade[]>();
  violacoes.forEach((v) => porSemana.set(v.previsaoId, [...(porSemana.get(v.previsaoId) ?? []), v]));
  const out: DecisaoViolacoes = { registrar: [], aguardando: [], persistentes: [] };
  for (const [previsaoId, lista] of porSemana) {
    const causas = new Set(lista.map((v) => v.causaId));
    const doEvento = eventos.filter((e) => e.previsaoId === previsaoId && e.causaId !== null && causas.has(e.causaId));
    if (doEvento.length === 0) out.registrar.push({ previsaoId, violacoes: lista.length, causaId: lista[0].causaId });
    else if (doEvento.some((e) => e.status !== "processado")) out.aguardando.push(previsaoId);
    else out.persistentes.push(...lista);
  }
  return out;
}

export interface ResumoRevalidacao {
  reconciliacao: { criadas: number; atualizadas: number; removidas: number } | null;
  dentroDaJanela: boolean;
  violacoes: number;
  eventosRegistrados: number;
  aguardandoProcessamento: number;
  persistentes: number;
  erro?: string;
}

export async function revalidarDisponibilidadeMaquinas(admin: SupabaseClient, agoraMs: number): Promise<ResumoRevalidacao> {
  const resumo: ResumoRevalidacao = { reconciliacao: null, dentroDaJanela: false, violacoes: 0, eventosRegistrados: 0, aguardandoProcessamento: 0, persistentes: 0 };
  try {
    const rec = await admin.rpc("escala_reconciliar_indisponibilidades");
    if (rec.error) throw new Error(`escala_reconciliar_indisponibilidades: ${rec.error.message}`);
    const r = (rec.data ?? {}) as { criadas?: number; atualizadas?: number; removidas?: number };
    resumo.reconciliacao = { criadas: Number(r.criadas ?? 0), atualizadas: Number(r.atualizadas ?? 0), removidas: Number(r.removidas ?? 0) };

    const per = await admin.from("periodos").select("inicio");
    if (per.error) throw new Error(`periodos: ${per.error.message}`);
    const periodos = ((per.data ?? []) as { inicio: string }[]).map((p) => ({ inicio: String(p.inicio).slice(0, 5) }));
    resumo.dentroDaJanela = dentroDaJanelaPreChecagem(agoraMs, periodos);
    if (!resumo.dentroDaJanela) return resumo;

    const vio = await admin.rpc("escala_violacoes_disponibilidade", { p_agora: new Date(agoraMs).toISOString() });
    if (vio.error) throw new Error(`escala_violacoes_disponibilidade: ${vio.error.message}`);
    const violacoes = ((vio.data ?? []) as { previsao_id: string; data: string; periodo_id: string; maquina_id: string; desde: string; indisponibilidade_id: string }[])
      .map((v) => ({ previsaoId: v.previsao_id, data: v.data, periodoId: v.periodo_id, maquinaId: v.maquina_id, desde: v.desde, causaId: v.indisponibilidade_id }));
    resumo.violacoes = violacoes.length;
    if (violacoes.length === 0) return resumo;

    const semanas = [...new Set(violacoes.map((v) => v.previsaoId))];
    const ev = await admin.from("escala_producao_eventos").select("previsao_id, criado_em, status, payload").eq("tipo", "recurso_bloqueado").in("previsao_id", semanas);
    if (ev.error) throw new Error(`escala_producao_eventos: ${ev.error.message}`);
    const eventos = ((ev.data ?? []) as { previsao_id: string; criado_em: string; status: string; payload: { indisponibilidade_id?: string } | null }[])
      .map((e) => ({ previsaoId: e.previsao_id, criadoEm: e.criado_em, status: e.status, causaId: e.payload?.indisponibilidade_id ?? null }));

    const decisao = decidirViolacoes(violacoes, eventos);
    for (const d of decisao.registrar) {
      await registrarEvento(admin, "recurso_bloqueado", d.previsaoId, { origem: "revalidacao_pre_periodo", violacoes: d.violacoes, indisponibilidade_id: d.causaId }, null);
      resumo.eventosRegistrados++;
    }
    resumo.aguardandoProcessamento = decisao.aguardando.length;
    resumo.persistentes = decisao.persistentes.length;
    if (decisao.persistentes.length > 0) {
      console.error(`escala/revalidar: ${decisao.persistentes.length} período(s) futuro(s) ainda alocam máquina com causa ativa após o recálculo`, JSON.stringify(decisao.persistentes.slice(0, 5)));
    }
  } catch (e) {
    resumo.erro = e instanceof Error ? e.message : String(e);
    console.error("escala/revalidar:", resumo.erro);
  }
  return resumo;
}
