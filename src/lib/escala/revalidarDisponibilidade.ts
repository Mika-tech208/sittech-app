// SERVER-ONLY. Revalidação da disponibilidade da Escala: MÁQUINAS (Parada de máquina + bloqueio manual) e FUNCIONÁRIOS (falta, atraso, saída, inatividade, equipe).
//
// Chamada pelo worker /api/escala/drenar (agendadores, inclusive os horários 5 min antes de cada período) e por
// /api/escala/processar (navegador). Sempre idempotente; sem mudança = nenhum evento e, portanto, nenhuma versão nova:
//   1) RECONCILIA o espelho Parada -> escala_recurso_indisponivel a partir de ocorrencias_maquina (fonte da verdade). Repara o que o
//      trigger não tenha feito (ex.: dado antigo) e só emite evento quando o ESTADO EFETIVO muda;
//   2) dentro da janela de um período (início −6 min .. +15 min), confere a INVARIANTE: nenhum período futuro pode ter alocação numa máquina
//      com causa ativa que o intersecte. Se houver violação e nenhum evento de bloqueio foi registrado para a causa, registra um
//      (fail-closed: com Parada aberta conhecida a máquina NUNCA é tratada como disponível por falta de resposta).
//   3) FUNCIONÁRIOS (mesma janela, mesma função de cron): escala_divergencias_funcionarios compara as FONTES (ausencias_funcionarios, funcionarios.ativo,
//      previsao_equipe_semana) com a Escala gravada nos períodos futuros — linha de quem não pode trabalhar, ou quem pode e está sem linha (retorno). Se nenhum
//      evento de replanejamento da semana está na fila, registra UM evento 'ausencia' (idempotente: assinatura das divergências; a mesma assinatura já tentada
//      não se repete — sem laço de recálculo).
// O evento só entra no outbox; quem recalcula é o processamento normal (com seus locks e versões). Falha aqui nunca derruba a drenagem.

import { createHash } from "node:crypto";
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

export interface ResumoFuncionarios { divergencias: number; eventosRegistrados: number; aguardandoProcessamento: number; persistentes: number }
export interface ResumoRevalidacao {
  reconciliacao: { criadas: number; atualizadas: number; removidas: number } | null;
  dentroDaJanela: boolean;
  violacoes: number;
  eventosRegistrados: number;
  aguardandoProcessamento: number;
  persistentes: number;
  funcionarios: ResumoFuncionarios;
  erro?: string;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// FUNCIONÁRIOS
// ---------------------------------------------------------------------------------------------------------------------------------------------
export type TipoDivergenciaFuncionario = "alocado_ausente" | "alocado_inativo" | "alocado_fora_equipe" | "disponivel_sem_linha";
export interface DivergenciaFuncionario { previsaoId: string; data: string; periodoId: string; funcionarioId: string; tipo: TipoDivergenciaFuncionario; causaId: string | null }
export interface EventoDaSemana {
  previsaoId: string; tipo: string; status: string; tentativas: number; criadoEm: string;
  origem: string | null; assinatura: string | null; // payload.origem / payload.assinatura (só os eventos da própria revalidação carregam)
}
export interface DecisaoDivergencias {
  registrar: { previsaoId: string; assinatura: string; divergencias: number; tipos: string[] }[];
  aguardando: string[]; // já existe evento de replanejamento na fila: a drenagem recalcula (não cria outro)
  persistentes: DivergenciaFuncionario[]; // a mesma divergência já foi tentada (processada/erro) e continua: NÃO repete (evita laço); só alerta
}

export const ORIGEM_REVALIDACAO_FUNCIONARIOS = "revalidacao_funcionarios";
const TIPOS_QUE_RECALCULAM = ["ausencia", "previsao", "recurso_bloqueado", "recurso_liberado", "geracao_manual"];
const JANELA_MEMORIA_MS = 6 * 60 * 60_000; // a mesma assinatura tentada há menos de 6 h é "persistente"

export function assinaturaDivergencias(lista: DivergenciaFuncionario[]): string {
  // inclui a CAUSA (id da ausência): uma ausência nova com as mesmas datas/períodos é uma divergência nova, não a repetição de uma já tentada
  const chaves = lista.map((d) => `${d.data}|${d.periodoId}|${d.funcionarioId}|${d.tipo}|${d.causaId ?? ""}`).sort().join(";");
  return createHash("sha256").update(chaves).digest("hex").slice(0, 16);
}

// Decisão pura (testável). Idempotência: com evento de replanejamento pendente => aguarda; sem divergência => nada; mesma assinatura já tentada => só alerta.
export function decidirDivergenciasFuncionarios(divergencias: DivergenciaFuncionario[], eventos: EventoDaSemana[], agoraMs: number): DecisaoDivergencias {
  const porSemana = new Map<string, DivergenciaFuncionario[]>();
  divergencias.forEach((d) => porSemana.set(d.previsaoId, [...(porSemana.get(d.previsaoId) ?? []), d]));
  const out: DecisaoDivergencias = { registrar: [], aguardando: [], persistentes: [] };
  for (const [previsaoId, lista] of porSemana) {
    const daSemana = eventos.filter((e) => e.previsaoId === previsaoId);
    const naFila = daSemana.some((e) => TIPOS_QUE_RECALCULAM.includes(e.tipo) && (e.status === "pendente" || e.status === "processando" || (e.status === "erro" && e.tentativas < 3)));
    if (naFila) { out.aguardando.push(previsaoId); continue; }
    const assinatura = assinaturaDivergencias(lista);
    const jaTentada = daSemana.some((e) => e.origem === ORIGEM_REVALIDACAO_FUNCIONARIOS && e.assinatura === assinatura && (e.status === "processado" || e.status === "erro") && agoraMs - Date.parse(e.criadoEm) < JANELA_MEMORIA_MS);
    if (jaTentada) { out.persistentes.push(...lista); continue; }
    out.registrar.push({ previsaoId, assinatura, divergencias: lista.length, tipos: [...new Set(lista.map((d) => d.tipo))].sort() });
  }
  return out;
}

async function revalidarFuncionarios(admin: SupabaseClient, agoraMs: number): Promise<ResumoFuncionarios> {
  const r: ResumoFuncionarios = { divergencias: 0, eventosRegistrados: 0, aguardandoProcessamento: 0, persistentes: 0 };
  const dv = await admin.rpc("escala_divergencias_funcionarios", { p_agora: new Date(agoraMs).toISOString() });
  if (dv.error) throw new Error(`escala_divergencias_funcionarios: ${dv.error.message}`);
  const divergencias = ((dv.data ?? []) as { previsao_id: string; data: string; periodo_id: string; funcionario_id: string; tipo: TipoDivergenciaFuncionario; causa_id: string | null }[])
    .map((d) => ({ previsaoId: d.previsao_id, data: d.data, periodoId: d.periodo_id, funcionarioId: d.funcionario_id, tipo: d.tipo, causaId: d.causa_id }));
  r.divergencias = divergencias.length;
  if (divergencias.length === 0) return r; // consistente: NO-OP

  const semanas = [...new Set(divergencias.map((d) => d.previsaoId))];
  type Linha = { previsao_id: string; tipo: string; status: string; tentativas: number; criado_em: string; payload: { origem?: string; assinatura?: string } | null };
  const colunas = "previsao_id, tipo, status, tentativas, criado_em, payload";
  const [recentes, naFila] = await Promise.all([
    admin.from("escala_producao_eventos").select(colunas).in("previsao_id", semanas).in("tipo", TIPOS_QUE_RECALCULAM).gte("criado_em", new Date(agoraMs - JANELA_MEMORIA_MS).toISOString()),
    admin.from("escala_producao_eventos").select(colunas).in("previsao_id", semanas).in("tipo", TIPOS_QUE_RECALCULAM).in("status", ["pendente", "processando", "erro"]),
  ]);
  if (recentes.error) throw new Error(`escala_producao_eventos: ${recentes.error.message}`);
  if (naFila.error) throw new Error(`escala_producao_eventos: ${naFila.error.message}`);
  const unicos = new Map<string, EventoDaSemana>();
  [...((recentes.data ?? []) as Linha[]), ...((naFila.data ?? []) as Linha[])].forEach((e) => {
    unicos.set(`${e.previsao_id}|${e.tipo}|${e.criado_em}|${e.status}`, {
      previsaoId: e.previsao_id, tipo: e.tipo, status: e.status, tentativas: Number(e.tentativas ?? 0), criadoEm: e.criado_em,
      origem: e.payload?.origem ?? null, assinatura: e.payload?.assinatura ?? null,
    });
  });

  const decisao = decidirDivergenciasFuncionarios(divergencias, [...unicos.values()], agoraMs);
  for (const d of decisao.registrar) {
    await registrarEvento(admin, "ausencia", d.previsaoId, { origem: ORIGEM_REVALIDACAO_FUNCIONARIOS, assinatura: d.assinatura, divergencias: d.divergencias, tipos: d.tipos }, null);
    r.eventosRegistrados++;
  }
  r.aguardandoProcessamento = decisao.aguardando.length;
  r.persistentes = decisao.persistentes.length;
  if (decisao.persistentes.length > 0) {
    console.error(`escala/revalidar: ${decisao.persistentes.length} divergência(s) de funcionário persistem após o replanejamento`, JSON.stringify(decisao.persistentes.slice(0, 5)));
  }
  return r;
}

// MÁQUINAS (após a janela confirmada): confere a invariante e registra o bloqueio que faltar.
async function revalidarMaquinas(admin: SupabaseClient, agoraMs: number, resumo: ResumoRevalidacao): Promise<void> {
  const vio = await admin.rpc("escala_violacoes_disponibilidade", { p_agora: new Date(agoraMs).toISOString() });
  if (vio.error) throw new Error(`escala_violacoes_disponibilidade: ${vio.error.message}`);
  const violacoes = ((vio.data ?? []) as { previsao_id: string; data: string; periodo_id: string; maquina_id: string; desde: string; indisponibilidade_id: string }[])
    .map((v) => ({ previsaoId: v.previsao_id, data: v.data, periodoId: v.periodo_id, maquinaId: v.maquina_id, desde: v.desde, causaId: v.indisponibilidade_id }));
  resumo.violacoes = violacoes.length;
  if (violacoes.length === 0) return;

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
}

// UMA revalidação para máquinas E funcionários. Cada parte falha sozinha (a outra continua); nunca lança.
export async function revalidarDisponibilidade(admin: SupabaseClient, agoraMs: number): Promise<ResumoRevalidacao> {
  const resumo: ResumoRevalidacao = {
    reconciliacao: null, dentroDaJanela: false, violacoes: 0, eventosRegistrados: 0, aguardandoProcessamento: 0, persistentes: 0,
    funcionarios: { divergencias: 0, eventosRegistrados: 0, aguardandoProcessamento: 0, persistentes: 0 },
  };
  const erros: string[] = [];
  try {
    const rec = await admin.rpc("escala_reconciliar_indisponibilidades");
    if (rec.error) throw new Error(`escala_reconciliar_indisponibilidades: ${rec.error.message}`);
    const r = (rec.data ?? {}) as { criadas?: number; atualizadas?: number; removidas?: number };
    resumo.reconciliacao = { criadas: Number(r.criadas ?? 0), atualizadas: Number(r.atualizadas ?? 0), removidas: Number(r.removidas ?? 0) };
  } catch (e) {
    erros.push(e instanceof Error ? e.message : String(e));
  }
  try {
    const per = await admin.from("periodos").select("inicio");
    if (per.error) throw new Error(`periodos: ${per.error.message}`);
    const periodos = ((per.data ?? []) as { inicio: string }[]).map((p) => ({ inicio: String(p.inicio).slice(0, 5) }));
    resumo.dentroDaJanela = dentroDaJanelaPreChecagem(agoraMs, periodos);
  } catch (e) {
    erros.push(e instanceof Error ? e.message : String(e));
    if (erros.length > 0) { resumo.erro = erros.join(" | "); console.error("escala/revalidar:", resumo.erro); }
    return resumo;
  }
  if (resumo.dentroDaJanela) {
    try { await revalidarMaquinas(admin, agoraMs, resumo); } catch (e) { erros.push(e instanceof Error ? e.message : String(e)); }
    try { resumo.funcionarios = await revalidarFuncionarios(admin, agoraMs); } catch (e) { erros.push(e instanceof Error ? e.message : String(e)); }
  }
  if (erros.length > 0) { resumo.erro = erros.join(" | "); console.error("escala/revalidar:", resumo.erro); }
  return resumo;
}

// Nome histórico (rotas e testes existentes): a mesma revalidação.
export const revalidarDisponibilidadeMaquinas = revalidarDisponibilidade;
