// SERVER-ONLY. Adaptador Supabase (service_role) para o processador da
// Escala: lê o estado de uma semana, aplica o recálculo via RPC e opera o
// outbox de eventos. Nada de regra de negócio aqui — só I/O.

import type { SupabaseClient } from "@supabase/supabase-js";
import { agregarHistoricoEquidade, JANELA_EQUIDADE_DIAS } from "@/features/escala/equidade";
import { lerParametros } from "@/features/escala/parametros";
import type { AlocacaoEscala, PeriodoEscala } from "@/features/escala/types";
import { linhasConsolidadas, type LinhaHistoricoBruta } from "./historicoConsolidado";
import { ConflitoDeVersaoError, type EstadoBruto, type PayloadAplicacao } from "./estado";
import { processarSemana, type EscalaIO, type OpcoesProcessamento } from "./processar";
import { carregarWipControle, gravarSnapshotsWip } from "./wipIO";
import { classificarGeracao, gerarEscalaSemanal, type DepsGeracaoSemanal, type OpcoesGeracaoSemanal, type ResultadoGeracaoSemanal } from "./geracaoSemanal";
import type { ResultadoProcessamento } from "./estado";

const META_COLS = "meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3";
const PERIODOS_META = ["m1", "m2", "m3", "t1", "t2", "t3"] as const;

function ok<T>(resp: { data: T | null; error: { message: string } | null }, onde: string): T {
  if (resp.error) throw new Error(`${onde}: ${resp.error.message}`);
  return (resp.data ?? ([] as unknown)) as T;
}

function hhmm(t: string): string {
  return String(t).slice(0, 5);
}

function somarDias(iso: string, dias: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Equidade: lê a escala REALMENTE gravada nas semanas anteriores (janela recente) — sem tabela
// agregada: ~100 linhas/dia, ~3 mil em 30 dias — e conta SÓ os períodos que já começaram
// (historicoConsolidado.ts): o plano futuro de uma semana em curso é saída descartável e nunca
// vira histórico. O PostgREST limita a resposta (1000 linhas por padrão), então pagina.
const PAGINA_HISTORICO = 1000;
async function carregarHistoricoEquidade(admin: SupabaseClient, semanaInicio: string, periodosAtuais: PeriodoEscala[], agoraMs: number) {
  const desde = somarDias(semanaInicio, -JANELA_EQUIDADE_DIAS);
  const snapshots = ok(
    await admin.from("escala_producao_dias").select("data, periodos_snapshot").gte("data", desde).lt("data", semanaInicio),
    "escala_producao_dias (histórico)"
  ) as { data: string; periodos_snapshot: PeriodoEscala[] }[];

  const brutas: LinhaHistoricoBruta[] = [];
  for (let de = 0; ; de += PAGINA_HISTORICO) {
    const resp = await admin
      .from("escala_producao_alocacoes")
      .select("data, periodo_id, funcionario_id, maquina_id, operacao_id")
      .gte("data", desde)
      .lt("data", semanaInicio)
      .order("data")
      .order("periodo_id")
      .order("funcionario_id")
      .range(de, de + PAGINA_HISTORICO - 1);
    const pagina = ok(resp, "escala_producao_alocacoes (histórico)") as LinhaHistoricoBruta[];
    brutas.push(...pagina);
    if (pagina.length < PAGINA_HISTORICO) break;
  }
  return agregarHistoricoEquidade(linhasConsolidadas(brutas, snapshots, periodosAtuais, agoraMs));
}

// Necessidade da próxima semana por produto: só quando a Previsão dela está salva (tem itens previstos).
function proximaSemanaDe(linha: { previsao_itens: { produto_id: string; quantidade: number; tipo: string }[] | null } | null): { quantidadePorProduto: Record<string, number> } | null {
  const itens = (linha?.previsao_itens ?? []).filter((i) => i.tipo === "previsto");
  if (itens.length === 0) return null;
  const quantidadePorProduto: Record<string, number> = {};
  itens.forEach((i) => (quantidadePorProduto[i.produto_id] = (quantidadePorProduto[i.produto_id] ?? 0) + Number(i.quantidade)));
  return { quantidadePorProduto };
}

export async function resolverPrevisaoPorSemana(admin: SupabaseClient, semanaInicio: string): Promise<string | null> {
  const { data, error } = await admin.from("previsoes").select("id").eq("semana_inicio", semanaInicio).maybeSingle();
  if (error) throw new Error(`previsoes: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}

export function criarEscalaIO(admin: SupabaseClient, previsaoId: string): EscalaIO {
  return {
    async carregarEstado(agoraMs: number = Date.now()): Promise<EstadoBruto> {
      const prev = ok(await admin.from("previsoes").select("id, semana_inicio").eq("id", previsaoId).single(), "previsoes") as { id: string; semana_inicio: string };
      const semanaFim = somarDias(prev.semana_inicio, 6);

      const [dias, equipe, itens, indispPrev, inativas, periodos, existentes, ausencias, indisp, operacoes, params, proxima] = await Promise.all([
        admin.from("previsao_dias_produtivos").select("dia, ativo").eq("previsao_id", previsaoId),
        admin.from("previsao_equipe_semana").select("funcionario_id, produtivo").eq("previsao_id", previsaoId),
        admin.from("previsao_itens").select("produto_id, valor_unitario, quantidade, quantidade_adicional, previsao_item_maquinas(etapa_id, maquina_id), previsao_item_adicional_etapa(etapa_id, quantidade)").eq("previsao_id", previsaoId).eq("tipo", "previsto"),
        admin.from("previsao_maquinas_indisponiveis").select("maquina_id").eq("previsao_id", previsaoId),
        admin.from("maquinas").select("id").eq("ativo", false),
        admin.from("periodos").select("id, nome, inicio, fim").order("id"),
        admin.from("escala_producao_dias").select("data, versao, periodos_snapshot").eq("previsao_id", previsaoId),
        admin.from("ausencias_funcionarios").select("funcionario_id, data, horario_inicio, horario_fim, criado_em").gte("data", prev.semana_inicio).lte("data", semanaFim),
        admin.from("escala_recurso_indisponivel").select("maquina_id, desde, liberada_em").or(`liberada_em.is.null,liberada_em.gte.${prev.semana_inicio}T00:00:00-03:00`),
        admin.from("operacoes").select("id, nome"),
        admin.from("escala_parametros").select("chave, valor"),
        admin.from("previsoes").select("id, previsao_itens(produto_id, quantidade, tipo)").eq("semana_inicio", somarDias(prev.semana_inicio, 7)).maybeSingle(),
      ]);

      const diasRows = ok(dias, "previsao_dias_produtivos") as { dia: string; ativo: boolean }[];
      const equipeRows = (ok(equipe, "previsao_equipe_semana") as { funcionario_id: string; produtivo: boolean }[]).filter((r) => r.produtivo);
      const itensRows = ok(itens, "previsao_itens") as { produto_id: string; valor_unitario: number; quantidade: number; quantidade_adicional: number | null; previsao_item_maquinas: { etapa_id: string; maquina_id: string }[] | null; previsao_item_adicional_etapa: { etapa_id: string; quantidade: number }[] | null }[];
      const existentesRows = ok(existentes, "escala_producao_dias") as { data: string; versao: number; periodos_snapshot: PeriodoEscala[] }[];

      const funcIds = equipeRows.map((r) => r.funcionario_id);
      const funcRows = funcIds.length
        ? (ok(await admin.from("funcionarios").select("id, nome, ativo").in("id", funcIds), "funcionarios") as { id: string; nome: string; ativo: boolean }[])
        : [];
      const produtoIds = [...new Set(itensRows.map((i) => i.produto_id))];
      const etapaRows = produtoIds.length
        ? (ok(await admin.from("roteiro_etapas").select(`id, produto_id, operacao_id, ordem, ${META_COLS}`).in("produto_id", produtoIds), "roteiro_etapas") as unknown as Record<string, string | number>[])
        : [];
      const etapaIds = etapaRows.map((e) => String(e.id));
      const compatRows = etapaIds.length
        ? (ok(await admin.from("roteiro_etapa_maquinas").select("etapa_id, maquina_id").in("etapa_id", etapaIds), "roteiro_etapa_maquinas") as { etapa_id: string; maquina_id: string }[])
        : [];
      const compatPorEtapa = new Map<string, string[]>();
      compatRows.forEach((r) => compatPorEtapa.set(r.etapa_id, [...(compatPorEtapa.get(r.etapa_id) ?? []), r.maquina_id]));
      const [maquinasNomes, produtosNomes] = await Promise.all([admin.from("maquinas").select("id, nome"), admin.from("produtos").select("id, nome")]);
      const datasExistentes = existentesRows.map((d) => d.data);
      const alocRows = datasExistentes.length
        ? (ok(await admin.from("escala_producao_alocacoes").select("*").in("data", datasExistentes), "escala_producao_alocacoes") as Record<string, unknown>[])
        : [];

      const periodosAtuais = (ok(periodos, "periodos") as PeriodoEscala[]).map((p) => ({ id: p.id, nome: p.nome, inicio: hhmm(p.inicio), fim: hhmm(p.fim) }));
      const historicoEquidade = await carregarHistoricoEquidade(admin, prev.semana_inicio, periodosAtuais, agoraMs);

      const itensBrutos = itensRows.map((i) => {
        const porEtapa: Record<string, string[]> = {};
        (i.previsao_item_maquinas ?? []).forEach((r) => {
          (porEtapa[r.etapa_id] ||= []).push(r.maquina_id);
        });
        const porEtapaAdic = i.previsao_item_adicional_etapa ?? [];
        return {
          produtoId: i.produto_id, quantidade: Number(i.quantidade), quantidadeAdicional: Number(i.quantidade_adicional ?? 0), valorUnitario: Number(i.valor_unitario), maquinasPorEtapa: porEtapa,
          ...(porEtapaAdic.length > 0 ? { adicionalPorEtapa: Object.fromEntries(porEtapaAdic.map((r) => [r.etapa_id, Number(r.quantidade)])) } : {}),
        };
      });

      const parametros = lerParametros(ok(params, "escala_parametros") as { chave: string; valor: unknown }[]);
      // estoque intermediário (Fase 3): só é lido com o WIP ativo; sem controles = undefined (comportamento anterior)
      const wipControle = parametros.wipModo === "ativo" ? await carregarWipControle(admin, prev.semana_inicio) : undefined;

      return {
        previsaoId,
        semanaInicio: prev.semana_inicio,
        diasProdutivos: diasRows.filter((d) => d.ativo).map((d) => d.dia).sort(),
        periodosAtuais,
        diasExistentes: existentesRows.map((d) => ({ data: d.data, versao: d.versao, periodosSnapshot: d.periodos_snapshot })),
        equipeProdutiva: equipeRows.map((r) => {
          const f = funcRows.find((x) => x.id === r.funcionario_id);
          return { funcionarioId: r.funcionario_id, nome: f?.nome, ativo: f?.ativo ?? false };
        }),
        itens: itensBrutos,
        etapas: etapaRows.map((e) => ({
          id: String(e.id),
          produtoId: String(e.produto_id),
          operacaoId: String(e.operacao_id),
          ordem: Number(e.ordem),
          metas: Object.fromEntries(PERIODOS_META.map((p) => [p, Number(e[`meta_${p}`] ?? 0)])),
          maquinasCompativeis: compatPorEtapa.get(String(e.id)) ?? [],
        })),
        maquinasIndisponiveisPrevisao: (ok(indispPrev, "previsao_maquinas_indisponiveis") as { maquina_id: string }[]).map((r) => r.maquina_id),
        maquinasInativas: (ok(inativas, "maquinas") as { id: string }[]).map((r) => r.id),
        ausencias: (ok(ausencias, "ausencias_funcionarios") as { funcionario_id: string; data: string; horario_inicio: string | null; horario_fim: string | null; criado_em?: string }[]).map((a) => ({
          funcionarioId: a.funcionario_id, data: a.data, horarioInicio: a.horario_inicio, horarioFim: a.horario_fim, ...(a.criado_em ? { registradaEm: a.criado_em } : {}),
        })),
        indisponibilidades: (ok(indisp, "escala_recurso_indisponivel") as { maquina_id: string; desde: string; liberada_em: string | null }[]).map((i) => ({
          maquinaId: i.maquina_id, desde: i.desde, liberadaEm: i.liberada_em,
        })),
        alocacoes: alocRows.map((r) => ({
          data: String(r.data), periodoId: String(r.periodo_id), funcionarioId: String(r.funcionario_id),
          maquinaId: (r.maquina_id as string | null) ?? null, produtoId: (r.produto_id as string | null) ?? null, etapaId: (r.etapa_id as string | null) ?? null,
          operacaoId: (r.operacao_id as string | null) ?? null, pecas: Number(r.pecas ?? 0), ...(Number(r.pecas_adicional ?? 0) > 0 ? { pecasAdicional: Number(r.pecas_adicional) } : {}), ...(r.tipo_adicional === "acabado" || r.tipo_adicional === "intermediario" ? { tipoAdicional: r.tipo_adicional as "acabado" | "intermediario" } : {}), motivoSemPosto: (r.motivo_sem_posto as string | null) ?? null,
          excecaoRevezamento: Boolean(r.excecao_revezamento), motivoExcecao: (r.motivo_excecao as string | null) ?? null,
          origem: r.origem === "manual" ? "manual" : "auto",
        })) as AlocacaoEscala[],
        nomesOperacao: Object.fromEntries((ok(operacoes, "operacoes") as { id: string; nome: string }[]).map((o) => [o.id, o.nome])),
        nomesMaquinas: Object.fromEntries((ok(maquinasNomes, "maquinas (nomes)") as { id: string; nome: string }[]).map((m) => [m.id, m.nome])),
        nomesProdutos: Object.fromEntries((ok(produtosNomes, "produtos (nomes)") as { id: string; nome: string }[]).map((x) => [x.id, x.nome])),
        historicoEquidade,
        parametros,
        ...(wipControle ? { wipControle } : {}),
        proximaSemana: proximaSemanaDe(ok(proxima, "previsoes (próxima semana)") as { previsao_itens: { produto_id: string; quantidade: number; tipo: string }[] | null } | null),
      };
    },

    async gravarSnapshotsWip(semanaInicio, snapshots) {
      await gravarSnapshotsWip(admin, semanaInicio, snapshots);
    },

    async aplicar(p: PayloadAplicacao) {
      const { data, error } = await admin.rpc("escala_aplicar_recalculo", {
        p_previsao_id: p.previsaoId,
        p_dias: p.dias,
        p_a_partir_data: p.aPartirDeData,
        p_a_partir_periodo: p.aPartirDePeriodo,
        p_alocacoes: p.alocacoes.map((a) => ({
          data: a.data, periodo_id: a.periodoId, funcionario_id: a.funcionarioId, maquina_id: a.maquinaId, produto_id: a.produtoId,
          etapa_id: a.etapaId, operacao_id: a.operacaoId, pecas: a.pecas, pecas_adicional: a.pecasAdicional ?? 0, tipo_adicional: a.tipoAdicional ?? null, origem: a.origem ?? "auto",
          excecao_revezamento: a.excecaoRevezamento, motivo_excecao: a.motivoExcecao, motivo_sem_posto: a.motivoSemPosto,
        })),
        p_usuario_id: p.usuarioId,
        p_evento_ids: p.eventoIds,
        p_resumo: p.resumo,
        p_remover_dias: p.removerDias,
      });
      if (error) {
        if (error.message.includes("ESCALA_VERSAO_CONFLITO")) throw new ConflitoDeVersaoError(error.message);
        throw new Error(`escala_aplicar_recalculo: ${error.message}`);
      }
      return { versoes: ((data as { versoes?: Record<string, number> } | null)?.versoes) ?? {} };
    },
  };
}

// ---- outbox ----

export interface EventoOutbox {
  id: string;
  tipo: string;
  previsao_id: string | null;
  payload: Record<string, unknown>;
  usuario_id: string | null;
  tentativas: number;
}

export async function registrarEvento(admin: SupabaseClient, tipo: string, previsaoId: string | null, payload: Record<string, unknown> = {}, usuarioId: string | null = null): Promise<string> {
  const { data, error } = await admin.rpc("escala_registrar_evento", { p_tipo: tipo, p_previsao_id: previsaoId, p_payload: payload, p_usuario_id: usuarioId });
  if (error) throw new Error(`escala_registrar_evento: ${error.message}`);
  return data as string;
}

// Reivindica e processa os eventos pendentes/falhados (retry simples: até 3
// tentativas, controlado pelo próprio banco). Um recálculo por semana mesmo
// que haja vários eventos dela. Não depende de nenhuma tela aberta.
export async function processarEventosPendentes(admin: SupabaseClient, agoraMs: number, limite = 50): Promise<{ semanas: number; processadas: number; ignoradas: number; erros: number }> {
  const { data, error } = await admin.rpc("escala_reivindicar_eventos", { p_limite: limite });
  if (error) throw new Error(`escala_reivindicar_eventos: ${error.message}`);
  const eventos = (data ?? []) as EventoOutbox[];
  const porSemana = new Map<string | null, EventoOutbox[]>();
  eventos.forEach((e) => {
    if (!porSemana.has(e.previsao_id)) porSemana.set(e.previsao_id, []);
    porSemana.get(e.previsao_id)!.push(e);
  });

  const resumo = { semanas: porSemana.size, processadas: 0, ignoradas: 0, erros: 0 };
  for (const [previsaoId, lista] of porSemana) {
    // Eventos 'geracao_semanal' (geração automática que falhou e está sendo retomada):
    // não têm Previsão associada — tentam gerar a semana indicada no payload.
    const semanais = lista.filter((e) => e.tipo === "geracao_semanal");
    if (semanais.length > 0) {
      for (const ev of semanais) {
        const semana = typeof ev.payload?.semanaInicio === "string" ? (ev.payload.semanaInicio as string) : null;
        try {
          const r = semana ? await gerarEscalaSemanalDoServidor(admin, agoraMs, { semanaAlvo: semana, eventoId: ev.id }) : null;
          if (!r) {
            await admin.rpc("escala_concluir_eventos", { p_ids: [ev.id], p_status: "ignorado", p_erro: "evento sem semana" });
            resumo.ignoradas++;
          } else if (r.status === "gerada" || r.status === "ja_existe") {
            await admin.rpc("escala_concluir_eventos", { p_ids: [ev.id], p_status: "processado", p_erro: null });
            resumo.processadas++;
          } else if (r.status === "semana_nao_atual" || r.status === "fora_da_janela") {
            await admin.rpc("escala_concluir_eventos", { p_ids: [ev.id], p_status: "ignorado", p_erro: r.status });
            resumo.ignoradas++;
          } else {
            await admin.rpc("escala_concluir_eventos", { p_ids: [ev.id], p_status: "erro", p_erro: r.mensagem });
            resumo.erros++;
          }
        } catch (e) {
          await admin.rpc("escala_concluir_eventos", { p_ids: [ev.id], p_status: "erro", p_erro: e instanceof Error ? e.message : String(e) });
          resumo.erros++;
        }
      }
      const restantes = lista.filter((e) => e.tipo !== "geracao_semanal");
      if (restantes.length === 0) continue;
      lista.splice(0, lista.length, ...restantes);
    }
    const ids = lista.map((e) => e.id);
    if (!previsaoId) {
      await admin.rpc("escala_concluir_eventos", { p_ids: ids, p_status: "ignorado", p_erro: "evento sem previsão associada" });
      resumo.ignoradas += ids.length;
      continue;
    }
    try {
      const r: ResultadoProcessamento = await processarSemana(criarEscalaIO(admin, previsaoId), {
        agoraMs, eventoIds: ids, criarSeNaoExiste: lista.some((e) => e.tipo === "geracao_manual"), usuarioId: lista.find((e) => e.usuario_id)?.usuario_id ?? null,
      });
      if (r.status === "processado") {
        resumo.processadas += ids.length; // a RPC de aplicação já baixou os eventos
      } else {
        await admin.rpc("escala_concluir_eventos", { p_ids: ids, p_status: r.status === "ignorado" ? "ignorado" : "processado", p_erro: r.motivoIgnorado ?? null });
        resumo.ignoradas += ids.length;
      }
    } catch (e) {
      await admin.rpc("escala_concluir_eventos", { p_ids: ids, p_status: "erro", p_erro: e instanceof Error ? e.message : String(e) });
      resumo.erros += ids.length;
    }
  }
  return resumo;
}

export interface ResumoDrenagem {
  lotes: number;
  semanas: number;
  processadas: number;
  ignoradas: number;
  erros: number;
  // Situação da fila DEPOIS da drenagem — o que a rotina agendada precisa enxergar.
  pendentesRestantes: number;
  esgotados: number; // eventos em erro que já gastaram as 3 tentativas (ficam parados até intervenção)
}

// Drenagem completa da outbox para o worker agendado: reivindica em lotes
// até esvaziar (ou até MAX_LOTES). Para no primeiro lote com erro — senão os
// eventos com erro seriam reivindicados de novo no mesmo ciclo e queimariam
// as 3 tentativas de uma vez. Idempotente: a reivindicação é `skip locked`
// e a aplicação é protegida por lock/versão, então execuções concorrentes
// (cron + chamada imediata do navegador) não duplicam trabalho.
const MAX_LOTES = 10;
const TAMANHO_LOTE = 50;

export async function drenarOutbox(admin: SupabaseClient, agoraMs: number): Promise<ResumoDrenagem> {
  const resumo: ResumoDrenagem = { lotes: 0, semanas: 0, processadas: 0, ignoradas: 0, erros: 0, pendentesRestantes: 0, esgotados: 0 };
  for (let i = 0; i < MAX_LOTES; i++) {
    const r = await processarEventosPendentes(admin, agoraMs, TAMANHO_LOTE);
    const tratados = r.processadas + r.ignoradas + r.erros;
    if (tratados === 0) break;
    resumo.lotes++;
    resumo.semanas += r.semanas;
    resumo.processadas += r.processadas;
    resumo.ignoradas += r.ignoradas;
    resumo.erros += r.erros;
    if (r.erros > 0 || tratados < TAMANHO_LOTE) break;
  }
  const pend = await admin.from("escala_producao_eventos").select("id", { count: "exact", head: true }).in("status", ["pendente", "processando"]).neq("tipo", "apontamento_periodo");
  if (pend.error) throw new Error(`escala_producao_eventos (pendentes): ${pend.error.message}`);
  const esg = await admin.from("escala_producao_eventos").select("id", { count: "exact", head: true }).eq("status", "erro").gte("tentativas", 3).neq("tipo", "apontamento_periodo");
  if (esg.error) throw new Error(`escala_producao_eventos (esgotados): ${esg.error.message}`);
  resumo.pendentesRestantes = pend.count ?? 0;
  resumo.esgotados = esg.count ?? 0;
  return resumo;
}

// Geração manual / regeração: registra o evento (histórico) e processa na hora.
export async function gerarEscalaDaSemana(
  admin: SupabaseClient,
  semanaInicio: string,
  usuarioId: string | null,
  agoraMs: number,
  extra?: Partial<OpcoesProcessamento>
): Promise<ResultadoProcessamento> {
  const previsaoId = await resolverPrevisaoPorSemana(admin, semanaInicio);
  if (!previsaoId) throw new Error("Não existe Previsão Semanal para esta semana");
  const eventoId = await registrarEvento(admin, "geracao_manual", previsaoId, { semanaInicio }, usuarioId);
  try {
    return await processarSemana(criarEscalaIO(admin, previsaoId), { agoraMs, usuarioId, eventoIds: [eventoId], criarSeNaoExiste: true, ...extra });
  } catch (e) {
    await admin.rpc("escala_concluir_eventos", { p_ids: [eventoId], p_status: "erro", p_erro: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

// ---- geração automática da semana (segunda 06:30 America/Sao_Paulo) ----

export async function gerarEscalaSemanalDoServidor(
  admin: SupabaseClient,
  agoraMs: number,
  opcoes: OpcoesGeracaoSemanal & { eventoId?: string } = {}
): Promise<ResultadoGeracaoSemanal> {
  const deps: DepsGeracaoSemanal = {
    resolverPrevisao: (semana) => resolverPrevisaoPorSemana(admin, semana),
    async semanaTemEscala(previsaoId) {
      const { count, error } = await admin.from("escala_producao_dias").select("data", { count: "exact", head: true }).eq("previsao_id", previsaoId);
      if (error) throw new Error(`escala_producao_dias: ${error.message}`);
      return (count ?? 0) > 0;
    },
    gerar: (previsaoId) => processarSemana(criarEscalaIO(admin, previsaoId), { agoraMs, criarSeNaoExiste: true, somenteSeNaoExiste: true }),
    async registrarErro(semana, mensagem) {
      if (opcoes.eventoId) return; // retentativa de um evento que já existe: ele próprio volta a "erro" no chamador
      // um único evento aberto por semana (as 3 execuções de segunda não multiplicam)
      const { count, error } = await admin
        .from("escala_producao_eventos")
        .select("id", { count: "exact", head: true })
        .eq("tipo", "geracao_semanal")
        .in("status", ["pendente", "processando", "erro"])
        .contains("payload", { semanaInicio: semana });
      if (error) throw new Error(`escala_producao_eventos: ${error.message}`);
      if ((count ?? 0) > 0) return;
      const id = await registrarEvento(admin, "geracao_semanal", null, { semanaInicio: semana, origem: "automatica", tentativa: opcoes.tentativa ?? "principal", classificacao: "erro" });
      await admin.rpc("escala_concluir_eventos", { p_ids: [id], p_status: "erro", p_erro: mensagem });
    },
    async registrarGerada(semana, previsaoId, resumo, tentativa) {
      const id = await registrarEvento(admin, "geracao_semanal", previsaoId, {
        semanaInicio: semana, origem: opcoes.eventoId ? "retentativa" : "automatica", tentativa, classificacao: classificarGeracao(tentativa), resumo,
      });
      await admin.rpc("escala_concluir_eventos", { p_ids: [id], p_status: "processado", p_erro: null });
    },
    async registrarJaExistia(semana, previsaoId, tentativa) {
      if (opcoes.eventoId) return; // retentativa de evento existente: não gera linha de histórico extra
      const id = await registrarEvento(admin, "geracao_semanal", previsaoId, { semanaInicio: semana, origem: "automatica", tentativa, classificacao: "ja_existia" });
      await admin.rpc("escala_concluir_eventos", { p_ids: [id], p_status: "ignorado", p_erro: "já existia" });
    },
  };
  return gerarEscalaSemanal(deps, agoraMs, opcoes);
}
