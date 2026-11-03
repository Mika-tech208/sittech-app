// SERVER-ONLY. Implementação Supabase (service_role) do FechamentoIO. Toda regra vive em orquestrador.ts / src/features/escala/fechamento; aqui só IO e medição de tempo.
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { estadoDaProducao } from "@/features/escala/fluxo";
import type { ContagemFisicaPar } from "@/features/escala/fluxo/tipos";
import { buffersObrigatorios, estimarBuffers } from "@/features/escala/fechamento/catalogo";
import { portaoHard } from "@/features/escala/fechamento/validacao";
import { VALIDADE_ABERTURA_MIN, VALIDADE_TRAVA_S, type BufferCatalogo, type EstadoFechamento, type ModoFechamento, type ParSemBuffer, type PostoFechamento } from "@/features/escala/fechamento/tipos";
import { montarEntradaEscala } from "../montarEntrada";
import { dadosProducaoReal, insumosFluxo, regiaoRecalculavel } from "../fluxo/integracao";
import { carregarApontamentosBanco } from "../fluxo/supabaseFluxo";
import type { EstadoBruto } from "../estado";
import { processarSemana, type EscalaIO } from "../processar";
import { criarEscalaIO, resolverPrevisaoPorSemana } from "../supabaseIO";
import { CHAVE_MODO_FECHAMENTO, lerModoFechamento } from "./leitura";
import type { ContextoFechamento, FechamentoIO, FechamentoSalvo, ResultadoRecalculo, SnapshotParaGravar } from "./orquestrador";

function ok<T>(resp: { data: T | null; error: { message: string } | null }, onde: string): T {
  if (resp.error) throw new Error(`${onde}: ${resp.error.message}`);
  return (resp.data ?? ([] as unknown)) as T;
}
const segundaDe = (data: string) => {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

interface PeriodoSnap { id: string; nome: string; inicio: string; fim: string }

export function criarFechamentoIO(admin: SupabaseClient, opcoes: { podeExcecao: boolean; relogio?: () => number }): FechamentoIO {
  const relogio = opcoes.relogio ?? Date.now;
  const cache = new Map<string, EstadoBruto>(); // estado carregado em `contexto`, reaproveitado no recálculo da MESMA confirmação (evita 2ª carga de ~1–2 s)

  async function modo(): Promise<ModoFechamento> {
    const rows = ok(await admin.from("escala_parametros").select("chave, valor").eq("chave", CHAVE_MODO_FECHAMENTO), "escala_parametros") as { chave: string; valor: unknown }[];
    return lerModoFechamento(rows);
  }

  async function carregarCatalogo(data: string): Promise<BufferCatalogo[]> {
    const [bufs, pares] = await Promise.all([
      admin.from("escala_buffers_fisicos").select("id, chave, rotulo, ordem").eq("ativo", true),
      admin.from("escala_buffer_pares").select("buffer_id, produto_id, etapa_origem_id, etapa_seguinte_id, papel, vigente_de, vigente_ate"),
    ]);
    const ps = (ok(pares, "escala_buffer_pares") as { buffer_id: string; produto_id: string; etapa_origem_id: string; etapa_seguinte_id: string; papel: "contabil" | "zero"; vigente_de: string; vigente_ate: string | null }[])
      .filter((p) => p.vigente_de <= data && (!p.vigente_ate || p.vigente_ate >= data));
    return (ok(bufs, "escala_buffers_fisicos") as { id: string; chave: string; rotulo: string; ordem: number }[]).map((b) => ({
      id: b.id, chave: b.chave, rotulo: b.rotulo, ordem: b.ordem,
      pares: ps.filter((p) => p.buffer_id === b.id).map((p) => ({ produtoId: p.produto_id, etapaOrigemId: p.etapa_origem_id, etapaSeguinteId: p.etapa_seguinte_id, papel: p.papel })),
    }));
  }

  async function carregarFechamento(id: string): Promise<FechamentoSalvo | null> {
    const f = (ok(await admin.from("escala_fechamentos").select("id, semana_inicio, data, periodo_id, excecao, instante_motor, fechado_por").eq("id", id), "escala_fechamentos") as Record<string, unknown>[])[0];
    if (!f) return null;
    const [bs, logs, prev] = await Promise.all([
      admin.from("escala_fechamento_buffers").select("buffer_id, saldo_fisico").eq("fechamento_id", id),
      admin.from("escala_fechamento_log").select("estado, em").eq("fechamento_id", id).order("seq", { ascending: false }),
      resolverPrevisaoPorSemana(admin, String(f.semana_inicio)),
    ]);
    const ls = ok(logs, "escala_fechamento_log") as { estado: EstadoFechamento; em: string }[];
    return {
      id, data: String(f.data), periodoId: String(f.periodo_id), semanaInicio: String(f.semana_inicio), previsaoId: prev ?? "", estado: ls[0]?.estado ?? "RECALCULANDO", excecao: f.excecao === true,
      instanteMotorMs: Date.parse(String(f.instante_motor)), fechadoPor: (f.fechado_por as string | null) ?? null,
      buffers: (ok(bs, "escala_fechamento_buffers") as { buffer_id: string; saldo_fisico: number | string | null }[]).map((b) => ({ bufferId: b.buffer_id, fisico: b.saldo_fisico === null ? null : Number(b.saldo_fisico) })),
      tentativas: ls.filter((l) => l.estado !== "RECALCULANDO").length, estadoEmMs: ls[0] ? Date.parse(ls[0].em) : null,
    };
  }

  return {
    modo,
    async podeExcecao() { return opcoes.podeExcecao; },

    async contexto(data, periodoId, agoraMs): Promise<ContextoFechamento> {
      const t0 = relogio();
      const semanaInicio = segundaDe(data);
      const previsaoId = await resolverPrevisaoPorSemana(admin, semanaInicio);
      if (!previsaoId) throw new Error(`Sem Previsão para a semana ${semanaInicio}`);
      const dias = (ok(await admin.from("escala_producao_dias").select("data, periodos_snapshot").eq("previsao_id", previsaoId).order("data"), "escala_producao_dias") as { data: string; periodos_snapshot: PeriodoSnap[] }[]);
      const diaIdx = dias.findIndex((d) => d.data === data);
      const pIdx = diaIdx >= 0 ? dias[diaIdx].periodos_snapshot.findIndex((p) => p.id === periodoId) : -1;
      if (pIdx < 0) throw new Error(`Período ${periodoId} de ${data} não existe na Escala`);
      const atual = dias[diaIdx].periodos_snapshot[pIdx];
      const prox = dias[diaIdx].periodos_snapshot[pIdx + 1] ? { data, p: dias[diaIdx].periodos_snapshot[pIdx + 1] } : dias[diaIdx + 1]?.periodos_snapshot[0] ? { data: dias[diaIdx + 1].data, p: dias[diaIdx + 1].periodos_snapshot[0] } : null;
      const periodo = {
        data, periodoId, rotulo: atual.nome, inicioMs: epochMsNoFuso(data, atual.inicio), fimMs: epochMsNoFuso(data, atual.fim),
        proximo: prox ? { data: prox.data, periodoId: prox.p.id, rotulo: prox.p.nome, inicioMs: epochMsNoFuso(prox.data, prox.p.inicio) } : null,
      };

      const base = criarEscalaIO(admin, previsaoId);
      const tEstado0 = relogio();
      const estado = await base.carregarEstado(agoraMs, periodo.proximo ? { data: periodo.proximo.data, periodoId: periodo.proximo.periodoId, agoraEquidadeMs: periodo.proximo.inicioMs - 1 } : undefined);
      const tEstado = relogio() - tEstado0;
      // semana fora do corte-v1 (ou Produção Real inativa): em `ativo` o orquestrador BLOQUEIA; em sombra segue só para registrar o inventário (sem estimativa nem ensaio)
      const semCorteV1 = !estado.producaoReal || !estado.planejadorCorte;
      if (estado.producaoReal) estado.producaoReal = { ...estado.producaoReal, fechamentoFisicoFimMs: periodo.fimMs };
      const chaveCache = `${previsaoId}|${data}|${periodoId}`;
      cache.set(chaveCache, estado);

      const tMont0 = relogio();
      const montada = montarEntradaEscala(estado, agoraMs);
      const { entrada, opcoes: opcoesFluxo } = insumosFluxo(estado, montada.entrada, agoraMs);
      const pares = estado.producaoReal ? estadoDaProducao(entrada, dadosProducaoReal(estado, agoraMs), opcoesFluxo).pares : [];
      const tMontagem = relogio() - tMont0;
      const tBuf0 = relogio();
      const produtosAtivos = new Set(estado.itens.filter((i) => i.quantidade + (i.quantidadeAdicional ?? 0) > 0).map((i) => i.produtoId));
      const [catalogo, dispensas] = await Promise.all([carregarCatalogo(data), admin.from("escala_buffer_dispensas").select("produto_id, etapa_origem_id, etapa_seguinte_id, vigente_de, vigente_ate")]);
      const obrigatorios = buffersObrigatorios(catalogo, produtosAtivos);
      const estimativas = estado.producaoReal ? estimarBuffers(obrigatorios, pares) : [];
      const chavePar = (p: string, o: string, s: string) => `${p}|${o}|${s}`;
      const cobertos = new Set([
        ...catalogo.flatMap((b) => b.pares.map((p) => chavePar(p.produtoId, p.etapaOrigemId, p.etapaSeguinteId))),
        ...(ok(dispensas, "escala_buffer_dispensas") as { produto_id: string; etapa_origem_id: string; etapa_seguinte_id: string; vigente_de: string; vigente_ate: string | null }[])
          .filter((d) => d.vigente_de <= data && (!d.vigente_ate || d.vigente_ate >= data)).map((d) => chavePar(d.produto_id, d.etapa_origem_id, d.etapa_seguinte_id)),
      ]);
      // nome da etapa = operação da etapa (ex.: "Parafusar"); rota = produto + etapas em ordem
      const nomeEtapa = (id: string) => { const e = estado.etapas.find((x) => x.id === id); return (e ? estado.nomesOperacao?.[e.operacaoId] : null) ?? id.slice(0, 8); };
      const nomeProduto = (id: string) => (estado.nomesProdutos?.[id] ?? id.slice(0, 8)).trim();
      const rotaDe = (produtoId: string) => estado.etapas.filter((e) => e.produtoId === produtoId).sort((a, b) => a.ordem - b.ordem).map((e) => nomeEtapa(e.id)).join(" → ");
      const paresSemBuffer: ParSemBuffer[] = pares.filter((p) => produtosAtivos.has(p.produtoId) && !cobertos.has(chavePar(p.produtoId, p.etapaOrigemId, p.etapaSeguinteId)))
        .map((p) => ({ produtoId: p.produtoId, produto: nomeProduto(p.produtoId), etapaOrigemId: p.etapaOrigemId, etapaOrigem: nomeEtapa(p.etapaOrigemId), etapaSeguinteId: p.etapaSeguinteId, etapaDestino: nomeEtapa(p.etapaSeguinteId), rota: rotaDe(p.produtoId) }));
      const tBuffers = relogio() - tBuf0;
      const tPostos0 = relogio();

      // postos esperados = máquinas do plano oficial do período; coletado = tem apontamento (produzindo ou sem_producao)
      const esperados = [...new Set(estado.alocacoes.filter((a) => a.data === data && a.periodoId === periodoId && a.maquinaId).map((a) => a.maquinaId as string))];
      const apont = (await carregarApontamentosBanco(admin, semanaInicio)).filter((a) => a.data === data && a.periodoId === periodoId);
      const postos: PostoFechamento[] = esperados.map((m): PostoFechamento => {
        const linhas = apont.filter((a) => a.maquinaId === m);
        const nome = (estado.nomesMaquinas?.[m] ?? m).trim();
        if (linhas.length === 0) return { maquinaId: m, nome, status: "pendente", produzido: 0, refugo: 0, motivo: null };
        const prod = linhas.filter((a) => a.status === "produzindo");
        return { maquinaId: m, nome, status: prod.length > 0 ? "produzindo" : "sem_producao", produzido: prod.reduce((s, a) => s + a.quantidadeProduzida, 0), refugo: linhas.reduce((s, a) => s + a.quantidadeRefugo, 0), motivo: linhas.find((a) => a.motivo)?.motivo ?? null };
      });
      const paradasRpc = await admin.rpc("escala_fechamento_paradas", { p_data: data, p_periodo: periodoId });
      if (paradasRpc.error) throw new Error(`escala_fechamento_paradas: ${paradasRpc.error.message}`);
      const paradas = ((paradasRpc.data ?? []) as { maquina_id: string; motivo_id: string; minutos: number | string }[]).map((p) => ({ maquinaId: p.maquina_id, motivoId: p.motivo_id, minutos: Number(p.minutos) }));

      const vigente = (ok(await admin.from("escala_fechamento_estado").select("fechamento_id, estado, sombra").eq("data", data).eq("periodo_id", periodoId), "escala_fechamento_estado") as { fechamento_id: string; estado: EstadoFechamento; sombra: boolean }[])[0];
      const vigenteEstado = vigente?.estado ?? null;
      return {
        semanaInicio, previsaoId, periodo, postos, obrigatorios, estimativas,
        periodoJaFechado: !!vigente, fechamentoVigente: vigente && vigenteEstado ? { id: vigente.fechamento_id, estado: vigenteEstado, sombra: vigente.sombra } : null,
        hashPlanoAnterior: hashAlocacoes(regiaoRecalculavel(entrada, estado.alocacoes)),
        resumoProducao: { postos: postos.map((p) => ({ maquinaId: p.maquinaId, status: p.status, produzido: p.produzido, refugo: p.refugo, motivo: p.motivo })), paradas },
        tempoEntradaMs: relogio() - t0, paresSemBuffer, semCorteV1,
        temposContexto: { estado: tEstado, montagem: tMontagem, buffers: tBuffers, postos: relogio() - tPostos0 },
      };
    },

    async abrir({ contexto, usuarioId, dispositivo, forcar }) {
      const { data, error } = await admin.rpc("escala_fechamento_abrir", { p_semana: contexto.semanaInicio, p_data: contexto.periodo.data, p_periodo: contexto.periodo.periodoId, p_usuario: usuarioId, p_dispositivo: dispositivo, p_ttl_min: VALIDADE_ABERTURA_MIN, p_forcar: forcar });
      if (error) throw new Error(error.message);
      return { aberturaId: data as string, validoAteMs: relogio() + VALIDADE_ABERTURA_MIN * 60_000 };
    },
    async aberturaAtual(data, periodoId, usuarioId) {
      const ab = (ok(await admin.from("escala_fechamento_aberturas").select("id").eq("data", data).eq("periodo_id", periodoId).eq("aberto_por", usuarioId).gt("valido_ate", new Date(relogio()).toISOString()).order("aberto_em", { ascending: false }).limit(1), "escala_fechamento_aberturas") as { id: string }[])[0];
      if (!ab) return null;
      const usada = ok(await admin.from("escala_fechamentos").select("id").eq("abertura_id", ab.id), "escala_fechamentos") as { id: string }[];
      return usada.length > 0 ? null : ab.id;
    },

    async registrar(s: SnapshotParaGravar) {
      const buffers = s.excecao ? s.contexto.obrigatorios.map((b) => {
        const est = s.contexto.estimativas.find((x) => x.bufferId === b.id);
        return { buffer_id: b.id, saldo_estimado: est?.estimado ?? null, estimado_lo: est?.lo ?? null, estimado_hi: est?.hi ?? null, saldo_fisico: null, motivo: null };
      }) : s.entrada.buffers.map((b) => {
        const est = s.contexto.estimativas.find((x) => x.bufferId === b.bufferId);
        return { buffer_id: b.bufferId, saldo_estimado: est?.estimado ?? null, estimado_lo: est?.lo ?? null, estimado_hi: est?.hi ?? null, saldo_fisico: b.fisico, motivo: b.motivo ?? null };
      });
      const { data, error } = await admin.rpc("escala_fechamento_registrar", {
        p_abertura: s.aberturaId, p_semana: s.contexto.semanaInicio, p_data: s.contexto.periodo.data, p_periodo: s.contexto.periodo.periodoId, p_tipo: "periodo",
        p_iniciado_em: new Date(s.iniciadoEmMs).toISOString(), p_contado_em: new Date(s.contadoEmMs).toISOString(), p_instante_motor: new Date(s.instanteMotorMs).toISOString(),
        p_usuario: s.usuarioId, p_dispositivo: s.entrada.dispositivo ?? null, p_postos_esperados: s.contexto.postos.length, p_postos_coletados: s.contexto.postos.filter((p) => p.status !== "pendente").length,
        p_resumo: s.contexto.resumoProducao, p_buffers: buffers, p_buffers_obrigatorios: s.contexto.obrigatorios.length, p_hash_plano_anterior: s.contexto.hashPlanoAnterior,
        p_excecao: s.excecao, p_excecao_motivo: s.entrada.excecao?.motivo ?? null, p_observacao: s.entrada.observacao ?? null, p_chave: s.chave, p_forcar_revisao: s.forcarRevisao,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },

    async travaAdquirir(semana, id) {
      const { data, error } = await admin.rpc("escala_fechamento_trava_adquirir", { p_semana: semana, p_fechamento: id, p_ttl_s: VALIDADE_TRAVA_S });
      if (error) throw new Error(error.message);
      return data === true;
    },
    async travaLiberar(semana, id) { await admin.rpc("escala_fechamento_trava_liberar", { p_semana: semana, p_fechamento: id }); },

    async recalcular({ contexto, contagens, usuarioId, agoraMs, dryRun }): Promise<ResultadoRecalculo> {
      const chaveCache = `${contexto.previsaoId}|${contexto.periodo.data}|${contexto.periodo.periodoId}`;
      const p = contexto.periodo;
      const corte = p.proximo ? { data: p.proximo.data, periodoId: p.proximo.periodoId, agoraEquidadeMs: p.proximo.inicioMs - 1 } : undefined;
      const base = criarEscalaIO(admin, contexto.previsaoId);
      const injetar = (e: EstadoBruto): EstadoBruto => {
        if (!e.producaoReal) return e;
        const mesma = (c: ContagemFisicaPar, d: ContagemFisicaPar) => c.produtoId === d.produtoId && c.etapaOrigemId === d.etapaOrigemId && c.etapaSeguinteId === d.etapaSeguinteId && c.contadoEmMs === d.contadoEmMs;
        const existentes = (e.producaoReal.contagensFisicas ?? []).filter((c) => !contagens.some((d) => mesma(c, d)));
        return { ...e, producaoReal: { ...e.producaoReal, fechamentoFisicoFimMs: p.fimMs, contagensFisicas: [...existentes, ...contagens] } };
      };
      let tEntrada = 0, tPersist = 0, tValid = 0;
      let primeira = cache.get(chaveCache) ?? null;
      const pendentes = dryRun ? [] : (ok(await admin.from("escala_producao_eventos").select("id").eq("previsao_id", contexto.previsaoId).in("status", ["pendente", "processando", "erro"]).neq("tipo", "fechamento_fisico"), "escala_producao_eventos") as { id: string }[]).map((x) => x.id);
      const io: EscalaIO = {
        ...base,
        async carregarEstado(a, c) {
          const t = relogio();
          try {
            if (primeira) { const e = primeira; primeira = null; return injetar(e); }
            return injetar(await base.carregarEstado(a, c));
          } finally { tEntrada += relogio() - t; }
        },
        async aplicar(payload) { if (dryRun) return { versoes: Object.fromEntries(payload.dias.map((d) => [d.data, 0])) }; const t = relogio(); try { return await base.aplicar(payload); } finally { tPersist += relogio() - t; } },
        ...(dryRun ? { registrarFluxo: async () => undefined, gravarSnapshotsWip: async () => undefined } : {}),
      };
      const tProc0 = relogio();
      const r = await processarSemana(io, {
        agoraMs, criarSeNaoExiste: false, usuarioId, eventoIds: pendentes, gatilhoFluxo: "fechamento", corteFluxo: { data: p.data, periodoId: p.periodoId }, ...(corte ? { corteExplicito: corte } : {}),
        portaoPublicacao: (c) => {
          const t = relogio();
          try {
            return portaoHard({
              corteUsado: c.corteUsado, corteMotivoFalha: c.corteMotivoFalha, checagens: (c.checagens as Record<string, number> | null) ?? null, contagens,
              paresDoEstado: ((c.registro?.wip as { pares?: { produtoId: string; etapaOrigemId: string; etapaSeguinteId: string; wip: { lo: number; hi: number }; negativo?: boolean }[] } | undefined)?.pares) ?? null,
            });
          } finally { tValid += relogio() - t; }
        },
      });
      const total = relogio() - tProc0;
      if (dryRun) return { status: r.status, motivo: r.motivoIgnorado ?? r.corte?.motivoFalha ?? null, hashPlanoNovo: r.corte?.hashPlano ?? null, filaRestante: 0, temposParciais: { entrada: tEntrada, validacao: tValid, persistencia: 0, corte: Math.max(0, total - tEntrada - tValid) } };
      if (r.status === "sem_alteracao" && pendentes.length > 0) await admin.rpc("escala_concluir_eventos", { p_ids: pendentes, p_status: "processado", p_erro: null });
      const restante = (ok(await admin.from("escala_producao_eventos").select("id").eq("previsao_id", contexto.previsaoId).in("status", ["pendente", "processando", "erro"]).neq("tipo", "fechamento_fisico"), "escala_producao_eventos") as { id: string }[]).length;
      return {
        status: r.status, motivo: r.motivoIgnorado ?? r.corte?.motivoFalha ?? null, hashPlanoNovo: r.corte?.hashPlano ?? null, filaRestante: restante,
        temposParciais: { entrada: tEntrada, validacao: tValid, persistencia: tPersist, corte: Math.max(0, total - tEntrada - tValid - tPersist) },
      };
    },

    async resultado(id, estado, detalhe) {
      const { error } = await admin.rpc("escala_fechamento_resultado", { p_fechamento: id, p_estado: estado, p_detalhe: detalhe });
      if (error) throw new Error(error.message);
    },
    carregarFechamento,
    async fechamentoPorChave(chave) {
      const r = (ok(await admin.from("escala_fechamentos").select("id").eq("chave_idempotencia", chave), "escala_fechamentos") as { id: string }[])[0];
      return r ? carregarFechamento(r.id) : null;
    },
  };
}
