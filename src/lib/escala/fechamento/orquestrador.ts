// ORQUESTRADOR do fechamento físico atômico (sem Supabase: IO injetado, testável). Uma única ação:
//   validar → gravar inventário+snapshot (transação, idempotente) → RECALCULANDO → corte-v1 (com PORTÃO HARD) → publicar → fila drenada → CONFIRMADO
//   falha do motor ⇒ ERRO_RECALCULO com o ESTOQUE JÁ SALVO; retry seguro sem contar de novo.
import type { ContagemFisicaPar } from "@/features/escala/fluxo/tipos";
import { contagensDoInventario } from "@/features/escala/fechamento/catalogo";
import { validarConfirmacao, type ContextoValidacao } from "@/features/escala/fechamento/validacao";
import type { BufferCatalogo, EntradaConfirmacao, ErroValidacao, EstadoFechamento, EstimativaBuffer, ModoFechamento, ParSemBuffer, PostoFechamento, TemposFechamento } from "@/features/escala/fechamento/tipos";
import { VALIDADE_ABERTURA_MIN } from "@/features/escala/fechamento/tipos";

export interface PeriodoFechamento { data: string; periodoId: string; rotulo: string; inicioMs: number; fimMs: number; proximo: { data: string; periodoId: string; rotulo: string; inicioMs: number } | null }

export interface ContextoFechamento {
  semanaInicio: string;
  previsaoId: string;
  periodo: PeriodoFechamento;
  postos: PostoFechamento[];
  obrigatorios: BufferCatalogo[];
  estimativas: EstimativaBuffer[];
  periodoJaFechado: boolean;
  /** `sombra` = fechamento gravado em modo sombra (o plano oficial não nasceu dele): em `ativo` NÃO conta como período fechado e vira revisão 2. */
  fechamentoVigente: { id: string; estado: EstadoFechamento; sombra?: boolean } | null;
  hashPlanoAnterior: string | null;
  resumoProducao: Record<string, unknown>;
  tempoEntradaMs: number;
  /** Pares do motor SEM buffer no catálogo (e sem dispensa declarada): em `ativo` BLOQUEIA o fechamento (BUFFER_FISICO_NAO_CADASTRADO); em `sombra` só alerta. */
  paresSemBuffer?: ParSemBuffer[];
  /** A semana não está sob o planejador corte-v1 (ou a Produção Real não está ativa): em `ativo` BLOQUEIA o fechamento. */
  semCorteV1?: boolean;
  temposContexto?: { estado: number; montagem: number; buffers: number; postos: number };
  /** PRODUTO ÚNICO em PLANEJAMENTO (semana >= planejamento_desde e < cutover): plano FUTURO não liberado. Nenhum fechamento (nem abrir, nem confirmar) é permitido; o contexto vem vazio. */
  emPlanejamento?: boolean;
}

export const MENSAGEM_PLANEJAMENTO = "Semana em PLANEJAMENTO do produto único (plano futuro, não liberado): o fechamento físico só existe depois do cutover.";
export const MENSAGEM_SEM_CORTE_V1 = "Fechamento físico automático disponível apenas para semanas com corte-v1 ativo.";

/** Bloqueios do modo ATIVO (em sombra viram alertas no log). Cada par sem buffer vira um erro BUFFER_FISICO_NAO_CADASTRADO com produto, rota, etapas, semana e período. */
export function bloqueiosDoModoAtivo(c: ContextoFechamento): ErroValidacao[] {
  const erros: ErroValidacao[] = [];
  if (c.emPlanejamento) erros.push({ codigo: "PERIODO_EM_PLANEJAMENTO", mensagem: MENSAGEM_PLANEJAMENTO });
  if (c.semCorteV1) erros.push({ codigo: "SEMANA_SEM_CORTE_V1", mensagem: MENSAGEM_SEM_CORTE_V1 });
  (c.paresSemBuffer ?? []).forEach((p) => erros.push({
    codigo: "BUFFER_FISICO_NAO_CADASTRADO",
    mensagem: `Buffer físico não cadastrado: ${p.produto} — ${p.etapaOrigem} → ${p.etapaDestino}. Cadastre o buffer (ou declare que não há estoque físico) antes de fechar o período.`,
    detalhes: { produtoId: p.produtoId, produto: p.produto, rota: p.rota, etapaOrigemId: p.etapaOrigemId, etapaOrigem: p.etapaOrigem, etapaSeguinteId: p.etapaSeguinteId, etapaDestino: p.etapaDestino, semana: c.semanaInicio, periodo: c.periodo.periodoId, data: c.periodo.data },
  }));
  return erros;
}

/** Alertas (modo sombra) no formato do diagnóstico. */
export function alertasDeSombra(c: ContextoFechamento): Record<string, unknown>[] {
  return bloqueiosDoModoAtivo(c).map((e) => ({ codigo: e.codigo, mensagem: e.mensagem, ...(e.detalhes ?? {}) }));
}

export interface SnapshotParaGravar {
  aberturaId: string | null; contexto: ContextoFechamento; entrada: EntradaConfirmacao; usuarioId: string; iniciadoEmMs: number; contadoEmMs: number; instanteMotorMs: number;
  excecao: boolean; chave: string; forcarRevisao: boolean;
}

export interface ResultadoRecalculo {
  status: "processado" | "sem_alteracao" | "bloqueado" | "ignorado";
  motivo: string | null;
  hashPlanoNovo: string | null;
  /** versão (escala_producao_dias.versao) de cada dia gravado por ESTE recálculo — vira o vínculo explícito fechamento→plano na transação do CONFIRMADO */
  planoVersoes?: Record<string, number>;
  temposParciais: { entrada: number; corte: number; validacao: number; persistencia: number };
  filaRestante: number;
}

export interface FechamentoSalvo { id: string; data: string; periodoId: string; semanaInicio: string; previsaoId: string; estado: EstadoFechamento; excecao: boolean; instanteMotorMs: number; fechadoPor: string | null; buffers: { bufferId: string; fisico: number | null }[]; tentativas: number; estadoEmMs: number | null }

export interface FechamentoIO {
  modo(): Promise<ModoFechamento>;
  contexto(data: string, periodoId: string, agoraMs: number): Promise<ContextoFechamento>;
  podeExcecao(usuarioId: string): Promise<boolean>;
  abrir(a: { contexto: ContextoFechamento; usuarioId: string; dispositivo: string | null; forcar: boolean }): Promise<{ aberturaId: string; validoAteMs: number }>;
  aberturaAtual(data: string, periodoId: string, usuarioId: string): Promise<string | null>;
  registrar(s: SnapshotParaGravar): Promise<string>;
  travaAdquirir(semanaInicio: string, fechamentoId: string): Promise<boolean>;
  travaLiberar(semanaInicio: string, fechamentoId: string): Promise<void>;
  /** dryRun = ENSAIO (modo sombra): roda o motor e o portão com o inventário em memória e NÃO grava plano, evento nem diagnóstico — mede o tempo e se o portão aprovaria. */
  recalcular(a: { fechamentoId: string; contexto: ContextoFechamento; contagens: ContagemFisicaPar[]; usuarioId: string; agoraMs: number; dryRun?: boolean }): Promise<ResultadoRecalculo>;
  resultado(fechamentoId: string, estado: EstadoFechamento, detalhe: Record<string, unknown>): Promise<void>;
  carregarFechamento(fechamentoId: string): Promise<FechamentoSalvo | null>;
  fechamentoPorChave(chave: string): Promise<FechamentoSalvo | null>;
}

export interface ResultadoFechamento {
  ok: boolean;
  estado: EstadoFechamento | null;
  fechamentoId: string | null;
  erros: ErroValidacao[];
  exigeConfirmacao: string[];
  mensagem: string | null;
  tempos: TemposFechamento | null;
  hashPlanoAnterior: string | null;
  hashPlanoNovo: string | null;
  duplicado?: boolean;
  /** Fechamento de EXCEÇÃO (sem contagem): a programação seguinte é baseada PARCIALMENTE em estimativa. */
  parcial?: boolean;
  /** Período que acabou de ser (ou será) confirmado: a tela mostra a programação dele imediatamente. */
  proximo?: { data: string; periodoId: string; rotulo: string } | null;
}

const vazio = (o: Partial<ResultadoFechamento>): ResultadoFechamento => ({ ok: false, estado: null, fechamentoId: null, erros: [], exigeConfirmacao: [], mensagem: null, tempos: null, hashPlanoAnterior: null, hashPlanoNovo: null, ...o });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export type Relogio = () => number;

/** Janela de troca: abre o EM_FECHAMENTO para este usuário (apontamentos do período só por ele). */
export async function abrirFechamento(io: FechamentoIO, a: { data: string; periodoId: string; usuarioId: string; dispositivo?: string | null; forcar?: boolean }, relogio: Relogio = Date.now): Promise<{ ok: boolean; aberturaId?: string; validoAteMs?: number; contexto?: ContextoFechamento; erro?: string; erros?: ErroValidacao[]; alertas?: Record<string, unknown>[] }> {
  const modo = await io.modo();
  if (modo === "desligado") return { ok: false, erro: "Fechamento físico desligado." };
  const contexto = await io.contexto(a.data, a.periodoId, relogio());
  if (contexto.emPlanejamento) return { ok: false, contexto, erro: MENSAGEM_PLANEJAMENTO, erros: [{ codigo: "PERIODO_EM_PLANEJAMENTO", mensagem: MENSAGEM_PLANEJAMENTO }] };   // vale em QUALQUER modo do fechamento
  const jaOficial = contexto.periodoJaFechado && !(modo === "ativo" && contexto.fechamentoVigente?.sombra);
  if (jaOficial && !a.forcar) return { ok: false, contexto, erro: "Este período já foi fechado." };
  // MODO ATIVO: catálogo incompleto ou semana fora do corte-v1 BLOQUEIA (nada de fechamento "confirmado" omitindo estoque); em sombra só alerta
  const bloqueios = modo === "ativo" ? bloqueiosDoModoAtivo(contexto) : [];
  if (bloqueios.length > 0) return { ok: false, contexto, erro: bloqueios[0].mensagem, erros: bloqueios };
  try {
    const r = await io.abrir({ contexto, usuarioId: a.usuarioId, dispositivo: a.dispositivo ?? null, forcar: a.forcar === true });
    return { ok: true, aberturaId: r.aberturaId, validoAteMs: r.validoAteMs, contexto, ...(modo === "sombra" ? { alertas: alertasDeSombra(contexto) } : {}) };
  } catch (e) {
    return { ok: false, contexto, erro: msg(e) };
  }
}
export const VALIDADE_ABERTURA_MS = VALIDADE_ABERTURA_MIN * 60_000;

export async function confirmarFechamento(io: FechamentoIO, entrada: EntradaConfirmacao, usuarioId: string, relogio: Relogio = Date.now, opcoes: { iniciadoEmMs?: number; forcarRevisao?: boolean } = {}): Promise<ResultadoFechamento> {
  const t0 = relogio();
  const modo = await io.modo();
  if (modo === "desligado") return vazio({ mensagem: "Fechamento físico desligado." });

  // DUPLO CLIQUE / reenvio do tablet: a mesma chave já gravada devolve o resultado existente (nunca grava nem recalcula duas vezes)
  const existente = await io.fechamentoPorChave(entrada.chave);
  if (existente) {
    return vazio({ ok: existente.estado === "CONFIRMADO", estado: existente.estado, fechamentoId: existente.id, duplicado: true, mensagem: existente.estado === "CONFIRMADO" ? "Já confirmado." : existente.estado === "ERRO_RECALCULO" ? "Estoque salvo. Programação ainda não gerada." : "Recalculando…" });
  }
  const contexto = await io.contexto(entrada.data, entrada.periodoId, t0);
  // MODO ATIVO: bloqueio ANTES de gravar qualquer coisa (inclusive na exceção: sem catálogo completo e sem corte-v1 não há fechamento oficial)
  const bloqueios = contexto.emPlanejamento || modo === "ativo" ? bloqueiosDoModoAtivo(contexto) : [];   // planejamento bloqueia em QUALQUER modo
  if (bloqueios.length > 0) return vazio({ erros: bloqueios, mensagem: bloqueios[0].mensagem });
  const podeExcecao = entrada.excecao ? await io.podeExcecao(usuarioId) : false;
  const agoraMs = relogio();
  const vctx: ContextoValidacao = { agoraMs, fimPeriodoMs: contexto.periodo.fimMs, postos: contexto.postos, obrigatorios: contexto.obrigatorios, estimativas: contexto.estimativas, podeExcecao, periodoJaFechado: contexto.periodoJaFechado && !opcoes.forcarRevisao && !(modo === "ativo" && contexto.fechamentoVigente?.sombra) };
  const v = validarConfirmacao(entrada, vctx);
  if (!v.ok) return vazio({ erros: v.erros, exigeConfirmacao: v.exigeConfirmacao, mensagem: v.erros[0]?.mensagem ?? "Fechamento inválido." });

  const instanteMotorMs = contexto.periodo.fimMs; // estado congelado: máquinas paradas ⇒ o inventário vale como o estado no fim do período
  const contadoEmMs = entrada.contadoEmMs ?? agoraMs;
  const aberturaId = await io.aberturaAtual(entrada.data, entrada.periodoId, usuarioId);
  const tGrav0 = relogio();
  let fechamentoId: string;
  try {
    fechamentoId = await io.registrar({ aberturaId, contexto, entrada, usuarioId, iniciadoEmMs: opcoes.iniciadoEmMs ?? t0, contadoEmMs, instanteMotorMs, excecao: !!entrada.excecao, chave: entrada.chave, forcarRevisao: opcoes.forcarRevisao === true || (modo === "ativo" && contexto.fechamentoVigente?.sombra === true) });
  } catch (e) {
    return vazio({ mensagem: `Não foi possível gravar o fechamento: ${msg(e)}` });
  }
  const gravacao = relogio() - tGrav0;

  const contagens = entrada.excecao ? [] : contagensDoInventario(contexto.obrigatorios, entrada.buffers, instanteMotorMs, usuarioId, "Fechamento físico (inventário na troca de período)");
  if (modo === "sombra") {
    // SOMBRA: grava o inventário e MEDE o erro do WIP; o motor oficial NÃO usa o físico. Faz também um ENSAIO do recálculo (sem gravar nada) para medir o tempo real
    // e saber se o portão HARD aprovaria — são os números do GO/NO-GO da ativação.
    let ensaio: Record<string, unknown> = {};
    if (contexto.semCorteV1) ensaio = { publicavel: false, motivo: "SEMANA_SEM_CORTE_V1", status: "nao_executado" };
    else if (!entrada.excecao) {
      try {
        const tE = relogio();
        const r = await io.recalcular({ fechamentoId, contexto, contagens, usuarioId, agoraMs: relogio(), dryRun: true });
        ensaio = { status: r.status, publicavel: r.status === "processado" || r.status === "sem_alteracao", motivo: r.motivo, hash_plano_novo: r.hashPlanoNovo, ms: relogio() - tE, tempos_ms: r.temposParciais };
      } catch (e) { ensaio = { erro: msg(e), publicavel: false }; }
    }
    const tempos: TemposFechamento = { gravacao, entrada: contexto.tempoEntradaMs, corte: 0, validacao: 0, persistencia: 0, total: relogio() - t0 };
    await io.resultado(fechamentoId, "CONFIRMADO", { sombra: true, tentativa: 1, tempos_ms: tempos, hash_plano_anterior: contexto.hashPlanoAnterior, ensaio, alertas: alertasDeSombra(contexto), ...(entrada.excecao ? { excecao: true, base_parcial_estimativa: true, buffers_sem_contagem: contexto.obrigatorios.map((b) => b.id) } : {}), nota: "modo sombra: inventário e erro gravados; o motor NÃO usou o físico" });
    return vazio({ ok: true, estado: "CONFIRMADO", fechamentoId, tempos, hashPlanoAnterior: contexto.hashPlanoAnterior, mensagem: "Fechamento gravado (modo sombra)." });
  }
  return executarRecalculo(io, { fechamentoId, contexto, contagens, usuarioId, tentativa: 1, t0, gravacao, relogio, excecao: !!entrada.excecao });
}

interface ArgsRecalculo { fechamentoId: string; contexto: ContextoFechamento; contagens: ContagemFisicaPar[]; usuarioId: string; tentativa: number; t0: number; gravacao: number; relogio: Relogio; excecao: boolean }

async function executarRecalculo(io: FechamentoIO, a: ArgsRecalculo): Promise<ResultadoFechamento> {
  const { relogio, contexto, fechamentoId } = a;
  const trava = await io.travaAdquirir(contexto.semanaInicio, fechamentoId);
  if (!trava) {
    return vazio({ estado: "RECALCULANDO", fechamentoId, mensagem: "Outro recálculo desta semana está em andamento. O estoque já está salvo; aguarde ou tente novamente.", hashPlanoAnterior: contexto.hashPlanoAnterior });
  }
  let r: ResultadoRecalculo | null = null;
  let erro: string | null = null;
  const tCorte0 = relogio();
  try {
    r = await io.recalcular({ fechamentoId, contexto, contagens: a.contagens, usuarioId: a.usuarioId, agoraMs: relogio() });
    if (r.status === "bloqueado" || r.status === "ignorado") erro = r.motivo ?? "o recálculo não publicou o plano";
    else if (r.filaRestante > 0) erro = `fila de eventos não drenada (${r.filaRestante} pendente(s))`;
  } catch (e) {
    erro = msg(e);
  } finally {
    await io.travaLiberar(contexto.semanaInicio, fechamentoId).catch(() => undefined);
  }
  const total = relogio() - a.t0;
  const tempos: TemposFechamento = r
    ? { gravacao: a.gravacao, entrada: contexto.tempoEntradaMs + r.temposParciais.entrada, corte: r.temposParciais.corte, validacao: r.temposParciais.validacao, persistencia: r.temposParciais.persistencia, total, ...(contexto.temposContexto ? { contexto: contexto.temposContexto } : {}) }
    : { gravacao: a.gravacao, entrada: contexto.tempoEntradaMs, corte: relogio() - tCorte0, validacao: 0, persistencia: 0, total, ...(contexto.temposContexto ? { contexto: contexto.temposContexto } : {}) };
  const detalheBase = { ...(a.excecao ? { base_parcial_estimativa: true, buffers_sem_contagem: contexto.obrigatorios.map((b) => b.id) } : {}), tentativa: a.tentativa, tempos_ms: tempos, hash_plano_anterior: contexto.hashPlanoAnterior, hash_plano_novo: r?.hashPlanoNovo ?? null, ...(r?.planoVersoes && Object.keys(r.planoVersoes).length > 0 ? { plano_versoes: r.planoVersoes } : {}), excecao: a.excecao };
  if (erro) {
    await io.resultado(fechamentoId, "ERRO_RECALCULO", { ...detalheBase, erro });
    return vazio({ estado: "ERRO_RECALCULO", fechamentoId, tempos, proximo: contexto.periodo.proximo ? { data: contexto.periodo.proximo.data, periodoId: contexto.periodo.proximo.periodoId, rotulo: contexto.periodo.proximo.rotulo } : null, hashPlanoAnterior: contexto.hashPlanoAnterior, mensagem: "Estoque salvo. Programação ainda não gerada.", erros: [{ codigo: "RECALCULO_FALHOU", mensagem: erro }] });
  }
  await io.resultado(fechamentoId, "CONFIRMADO", detalheBase);
  return vazio({ ok: true, estado: "CONFIRMADO", fechamentoId, tempos, hashPlanoAnterior: contexto.hashPlanoAnterior, hashPlanoNovo: r?.hashPlanoNovo ?? null, parcial: a.excecao, proximo: contexto.periodo.proximo ? { data: contexto.periodo.proximo.data, periodoId: contexto.periodo.proximo.periodoId, rotulo: contexto.periodo.proximo.rotulo } : null, mensagem: contexto.periodo.proximo ? `${contexto.periodo.proximo.rotulo} CONFIRMADO${a.excecao ? " — baseado PARCIALMENTE em estimativa (fechamento sem contagem)" : ""}` : "Período fechado (último da semana)." });
}

/** Retry seguro: NÃO pede a contagem de novo. Usa o inventário já gravado. Idempotente se já CONFIRMADO. */
export async function reprocessarFechamento(io: FechamentoIO, fechamentoId: string, usuarioId: string, relogio: Relogio = Date.now): Promise<ResultadoFechamento> {
  const t0 = relogio();
  const modo = await io.modo();
  if (modo !== "ativo") return vazio({ mensagem: "Fechamento físico não está ativo." });
  const f = await io.carregarFechamento(fechamentoId);
  if (!f) return vazio({ mensagem: "Fechamento não encontrado." });
  if (f.estado === "CONFIRMADO") return vazio({ ok: true, estado: "CONFIRMADO", fechamentoId, duplicado: true, mensagem: "Já confirmado." });
  const contexto = await io.contexto(f.data, f.periodoId, t0);
  const contagens = f.excecao ? [] : contagensDoInventario(contexto.obrigatorios, f.buffers, f.instanteMotorMs, f.fechadoPor ?? usuarioId, "Fechamento físico (inventário na troca de período)");
  return executarRecalculo(io, { fechamentoId, contexto, contagens, usuarioId, tentativa: f.tentativas + 1, t0, gravacao: 0, relogio, excecao: f.excecao });
}
