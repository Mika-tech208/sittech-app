// ESCALA INTELIGENTE (fluxo) — INTEGRAÇÃO com o recálculo oficial. PURO: nenhum IO, nenhum relógio (agoraMs por parâmetro); o núcleo entra por
// injeção (`NucleoFluxo`), então tudo é testável com stubs e `desligado` NUNCA chega aqui (quem chama só entra com modoEfetivo sombra/ativo).
//
//  • tentarPlanoFluxo  — modo ATIVO: planejarComFluxo + verificação INDEPENDENTE de hard constraints + guarda de passado. Qualquer falha
//                        (exceção, violação, passado alterado) devolve `ok:false` e o chamador CAI para o gerarEscala oficial (diagnóstico `fallback`).
//  • avaliarFluxoSombra — modo SOMBRA: calcula o plano de fluxo e avalia o plano OFICIAL e o de fluxo pelo MESMO simulador. Nunca lança.
//  • ambos produzem um RegistroFluxo (o que vai para escala_fluxo_diagnosticos via escala_fluxo_registrar).

import { confirmadoDisponivelAte, inconsistencias, dataNoFusoSP } from "@/features/escala/wipSaldo";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { hashCanonico } from "@/features/escala/hashCanonico";
import * as nucleoReal from "@/features/escala/fluxo";
import type { AvaliacaoPlano, DadosProducaoReal, DiagnosticoFluxo, OpcoesFluxo, ResultadoFluxo, SaldoWipConfirmadoPar, ViolacaoDura } from "@/features/escala/fluxo/tipos";
import type { AlocacaoEscala, EntradaEscala, ResultadoEscala } from "@/features/escala/types";
import type { EstadoBruto } from "../estado";

export type GatilhoFluxo = "fechamento" | "evento" | "manual" | "replay";

/** O núcleo puro, injetável (testes usam stubs; produção usa `nucleoFluxo`). */
export interface NucleoFluxo {
  planejarComFluxo(entrada: EntradaEscala, dados: DadosProducaoReal, opcoes?: OpcoesFluxo): ResultadoFluxo;
  avaliarPlano(entrada: EntradaEscala, dados: DadosProducaoReal, alocacoes: AlocacaoEscala[], opcoes?: OpcoesFluxo): AvaliacaoPlano;
  verificarRestricoesDuras(entrada: EntradaEscala, alocacoes: AlocacaoEscala[]): ViolacaoDura[];
}
export const nucleoFluxo: NucleoFluxo = {
  planejarComFluxo: (...a) => nucleoReal.planejarComFluxo(...a),
  avaliarPlano: (...a) => nucleoReal.avaliarPlano(...a),
  verificarRestricoesDuras: (...a) => nucleoReal.verificarRestricoesDuras(...a),
};

export const VERSAO_MOTOR_FLUXO = `fluxo-v${nucleoReal.VERSAO_FLUXO}`;
const MAX_DECISOES = 600; // lista detalhada; `totalDecisoes` + `resumoDecisoes` (por período) cobrem SEMPRE 100% das linhas alteradas
const MAX_VIOLACOES = 200;

/** Linha de escala_fluxo_diagnosticos (camelCase; o adaptador Supabase converte). jsonb = JSON-serializável. */
export interface RegistroFluxo {
  previsaoId: string;
  semanaInicio: string;
  gatilho: GatilhoFluxo;
  modo: "sombra" | "ativo";
  resultado: "ok" | "fallback" | "erro";
  corte: { data: string | null; periodoId: string | null; c: number | null };
  versaoMotor: string;
  hashEntrada: string;
  hashPlanoOficial: string;
  hashPlanoFluxo: string;
  demandaOficial: Record<string, unknown>;
  demandaReal: Record<string, unknown>;
  wip: Record<string, unknown>;
  gargalos: Record<string, unknown>;
  avaliacaoOficial: Record<string, unknown>;
  avaliacaoFluxo: Record<string, unknown>;
  diff: Record<string, unknown>;
  violacoes: unknown[];
  churn: Record<string, unknown>;
  replanejamento: Record<string, unknown>;
  diagnosticos: unknown[];
  erro: string | null;
  aplicado: boolean;
}

export interface ContextoFluxo {
  nucleo: NucleoFluxo;
  estado: EstadoBruto; // com producaoReal
  entrada: EntradaEscala;
  agoraMs: number;
  gatilho: GatilhoFluxo;
  corte?: { data: string; periodoId: string } | null; // período FECHADO que originou o cálculo
}

// ---- insumos do núcleo ----------------------------------------------------------------------------------------------------------

/** Saldos de WIP CONFIRMADOS (wipSaldo.ts): só controle ativo, sem inconsistência bloqueante e com saldo > 0. Estimado nunca entra. */
export function saldosWipConfirmados(estado: EstadoBruto, agoraMs: number): SaldoWipConfirmadoPar[] {
  const w = estado.wipControle;
  if (!w || w.controles.length === 0) return [];
  const e = { ...w, hoje: dataNoFusoSP(agoraMs) };
  const r: SaldoWipConfirmadoPar[] = [];
  w.controles.filter((c) => c.ativo).forEach((c) => {
    if (inconsistencias(c, e).some((i) => i.bloqueante)) return;
    const saldo = confirmadoDisponivelAte(c, e, e.hoje);
    if (saldo > 0) r.push({ produtoId: c.produtoId, etapaOrigemId: c.etapaOrigemId, etapaSeguinteId: c.etapaSeguinteId, saldo });
  });
  return r;
}

export function dadosProducaoReal(estado: EstadoBruto, agoraMs: number): DadosProducaoReal {
  const wipConfirmado = saldosWipConfirmados(estado, agoraMs);
  // Contagens físicas: caminho INDEPENDENTE do wip_controle (não abate pool.quantidade, não passa por saldosWipConfirmados) — entram só no estado inicial do par, dentro do núcleo.
  const contagens = estado.producaoReal?.contagensFisicas ?? [];
  return {
    apontamentos: estado.producaoReal?.apontamentos ?? [], agoraMs, planoVigente: estado.alocacoes,
    ...(wipConfirmado.length > 0 ? { wipConfirmado } : {}), ...(contagens.length > 0 ? { contagensFisicas: contagens } : {}),
  };
}

/**
 * Entrada e opções do núcleo. O f de desempenho (do realizado visível no corte, a mesma regra da sombra: desempenho.ts) entra EMBUTIDO nas metas da entrada e é
 * informado em `fatoresEmbutidos` (compatibilidade do Conector). O núcleo NÃO reaplica f (`fatorPorPool` fica de fora): f é multiplicado UMA vez, e planos gravados
 * (que podem já trazer f embutido nas peças) são avaliados pela capacidade das metas, nunca pelas peças gravadas. θ: parâmetro configurado; ausente ⇒ 0 do núcleo.
 */
export function insumosFluxo(estado: EstadoBruto, entrada: EntradaEscala, agoraMs: number): { entrada: EntradaEscala; opcoes: OpcoesFluxo } {
  const pr = estado.producaoReal;
  const fator = pr ? nucleoReal.fatoresDeDesempenho(entrada, pr.apontamentos, agoraMs, pr.paresLegado) : {};
  const comF = nucleoReal.embutirFatores(entrada, fator);
  const opcoes: OpcoesFluxo = {
    ...(pr && pr.paresLegado.length > 0 ? { paresLegado: pr.paresLegado } : {}),
    ...(pr && pr.limiar !== null ? { limiarEstabilidadePecas: pr.limiar } : {}),
    ...(pr?.atingibilidade ? { preservarAtingibilidade: true } : {}),
    ...(Object.keys(fator).length > 0 ? { fatoresEmbutidos: fator } : {}),
  };
  return { entrada: comF, opcoes };
}

export function opcoesFluxo(estado: EstadoBruto, entrada: EntradaEscala, agoraMs: number): OpcoesFluxo {
  return insumosFluxo(estado, entrada, agoraMs).opcoes;
}

// ---- utilitários ----------------------------------------------------------------------------------------------------------------

/** Garante JSON puro para o jsonb (sem NaN/Infinity/undefined/Map). */
export function jsonPuro<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "number" && !Number.isFinite(x) ? null : x instanceof Map ? Object.fromEntries(x) : x instanceof Set ? [...x] : x))) as T;
}

const chaveLinha = (a: { data: string; periodoId: string }) => `${a.data}|${a.periodoId}`;

/** Linhas do plano gravado cujo período ainda pode ser recalculado (índice do slot ≥ aPartirDe) — a região que o recálculo substitui. */
export function regiaoRecalculavel(entrada: EntradaEscala, alocacoes: AlocacaoEscala[]): AlocacaoEscala[] {
  const indice = new Map(entrada.slots.map((s) => [chaveLinha({ data: s.data, periodoId: s.periodoId }), s.indice]));
  return alocacoes.filter((a) => (indice.get(chaveLinha(a)) ?? -1) >= entrada.aPartirDe);
}

/** Alguma linha do plano proposto cai ANTES do primeiro período mutável? (passado é imutável) */
export function passadoAlterado(entrada: EntradaEscala, alocacoes: AlocacaoEscala[]): AlocacaoEscala[] {
  const indice = new Map(entrada.slots.map((s) => [chaveLinha({ data: s.data, periodoId: s.periodoId }), s.indice]));
  return alocacoes.filter((a) => (indice.get(chaveLinha(a)) ?? Number.POSITIVE_INFINITY) < entrada.aPartirDe);
}

function corteDe(entrada: EntradaEscala, corte: ContextoFluxo["corte"]): RegistroFluxo["corte"] {
  if (corte) {
    const s = entrada.slots.find((x) => x.data === corte.data && x.periodoId === corte.periodoId);
    return { data: corte.data, periodoId: corte.periodoId, c: s ? s.indice : null };
  }
  const c = entrada.aPartirDe - 1; // último período já iniciado
  const s = c >= 0 ? entrada.slots[c] : undefined;
  return { data: s?.data ?? null, periodoId: s?.periodoId ?? null, c: s ? c : null };
}

const resumoAvaliacao = (a: AvaliacaoPlano | null | undefined) => (a ? { versao: a.versao, totais: a.totais, produtos: a.produtos, diagnosticos: a.diagnosticos } : {});

function hashDaEntrada(ctx: ContextoFluxo, dados: DadosProducaoReal, opcoes: OpcoesFluxo, ultimoFechado: number | null): string {
  return hashCanonico({
    entrada: ctx.entrada, apontamentos: dados.apontamentos, wipConfirmado: dados.wipConfirmado ?? [], ...(dados.contagensFisicas && dados.contagensFisicas.length > 0 ? { contagensFisicas: dados.contagensFisicas } : {}),
    opcoes, ultimoFechado, planoVigente: hashAlocacoes(dados.planoVigente), versao: VERSAO_MOTOR_FLUXO,
  });
}

function registroBase(ctx: ContextoFluxo, modo: "sombra" | "ativo", dados: DadosProducaoReal, opcoes: OpcoesFluxo): RegistroFluxo {
  return {
    previsaoId: ctx.estado.previsaoId, semanaInicio: ctx.estado.semanaInicio, gatilho: ctx.gatilho, modo, resultado: "ok", corte: corteDe(ctx.entrada, ctx.corte), versaoMotor: VERSAO_MOTOR_FLUXO,
    hashEntrada: hashDaEntrada(ctx, dados, opcoes, null), hashPlanoOficial: "", hashPlanoFluxo: "",
    demandaOficial: {}, demandaReal: {}, wip: {}, gargalos: {}, avaliacaoOficial: {}, avaliacaoFluxo: {}, diff: {}, violacoes: [], churn: {}, replanejamento: {}, diagnosticos: [], erro: null, aplicado: false,
  };
}

const mensagemErro = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Preenche o registro com o diagnóstico do núcleo (demanda, WIP, gargalos, avaliação, diff, churn, ANTES/DECISÃO/MOTIVO/DEPOIS). */
function preencher(reg: RegistroFluxo, d: DiagnosticoFluxo, avaliacaoOficial: AvaliacaoPlano | null, oficial: AlocacaoEscala[], fluxo: AlocacaoEscala[], extras: unknown[] = []): RegistroFluxo {
  const est = d.estado;
  const porEstado = (e: string) => est.celulas.filter((c) => c.estado === e).length;
  return {
    ...reg,
    hashPlanoOficial: hashAlocacoes(oficial),
    hashPlanoFluxo: hashAlocacoes(fluxo),
    demandaOficial: { porPool: Object.fromEntries(est.demanda.map((p) => [p.chave, p.remLegado])), versao: est.versao },
    demandaReal: {
      remPorPool: est.remPorPool, demanda: est.demanda, produtos: est.produtos, etapas: est.etapas, poolsFundidos: est.poolsFundidos,
      celulas: { confirmado: porEstado("confirmado"), zero_confirmado: porEstado("zero_confirmado"), nao_confirmado: porEstado("nao_confirmado"), futuro: porEstado("futuro") },
      ultimoFechado: est.ultimoFechado, aPartirDe: est.aPartirDe,
    },
    wip: { pares: est.pares, projecao: est.projecao.wip },
    gargalos: { antes: d.antes.gargalosFluxo, oficial: avaliacaoOficial?.produtos.map((p) => ({ produtoId: p.produtoId, gargalo: p.gargaloFluxo })) ?? [], fluxo: d.avaliacaoFluxo.produtos.map((p) => ({ produtoId: p.produtoId, gargalo: p.gargaloFluxo })) },
    avaliacaoOficial: resumoAvaliacao(avaliacaoOficial),
    avaliacaoFluxo: { ...resumoAvaliacao(d.avaliacaoFluxo), planoBaseDoNucleo: d.depoisBase, depois: d.depois, iteracoes: d.iteracoes, planoEscolhido: d.planoEscolhido, iteracaoEscolhida: d.iteracaoEscolhida, theta: d.theta },
    diff: {
      referencia: d.referencia, totalDecisoes: d.decisoesTotal, decisoesListadas: Math.min(d.decisoes.length, MAX_DECISOES), truncado: d.decisoesTotal > Math.min(d.decisoes.length, MAX_DECISOES), linhasAlteradas: d.churn.linhasAlteradas,
      reconciliacao: d.reconciliacao, resumoDecisoes: d.resumoDecisoes, decisoes: d.decisoes.slice(0, MAX_DECISOES),
    },
    churn: d.churn as unknown as Record<string, unknown>,
    replanejamento: {
      referencia: d.referencia, antes: d.antes, decisoes: d.decisoes.slice(0, MAX_DECISOES), decisoesTotal: d.decisoesTotal, resumoDecisoes: d.resumoDecisoes, reconciliacao: d.reconciliacao,
      depois: d.depois, depoisBase: d.depoisBase, depoisVigente: d.depoisVigente, vigente: d.vigente, estabilizacao: d.estabilizacao, planoEscolhido: d.planoEscolhido,
    },
    diagnosticos: extras.length > 0 ? [...d.diagnosticos, ...extras] : d.diagnosticos,
  };
}

/** Itens de producao_real_contagens_fisicas malformados (descartados na leitura): entram no diagnóstico do registro. */
const descartesContagem = (ctx: ContextoFluxo): unknown[] => ctx.estado.producaoReal?.contagensFisicasDescartadas ?? [];

/** Resumo de erro: o fluxo não produziu diagnóstico (exceção). Fica registrado para auditoria. */
function registroDeErro(reg: RegistroFluxo, erro: string, resultado: "erro" | "fallback", oficial: AlocacaoEscala[]): RegistroFluxo {
  return jsonPuro({ ...reg, resultado, erro, hashPlanoOficial: hashAlocacoes(oficial), diagnosticos: [{ codigo: "ERRO_FLUXO", severidade: "erro", mensagem: erro }] });
}

// ---- MODO ATIVO -----------------------------------------------------------------------------------------------------------------

export type TentativaFluxo =
  | { ok: true; resultado: ResultadoEscala; registro: RegistroFluxo }
  | { ok: false; motivo: string; registro: RegistroFluxo };

/**
 * O plano de fluxo SÓ vale se: o núcleo não lançou, não há violação de restrição dura (verificador independente do motor) e nenhuma linha cai no
 * passado. Caso contrário `ok:false` e o chamador usa o gerarEscala oficial (a semana nunca fica sem plano). `registro.aplicado` é decidido por quem aplica.
 */
export function tentarPlanoFluxo(ctx: ContextoFluxo): TentativaFluxo {
  const dados = dadosProducaoReal(ctx.estado, ctx.agoraMs);
  const { entrada: entradaF, opcoes } = insumosFluxo(ctx.estado, ctx.entrada, ctx.agoraMs);
  const base = registroBase(ctx, "ativo", dados, opcoes);
  const oficial = regiaoRecalculavel(ctx.entrada, ctx.estado.alocacoes);
  let out: ResultadoFluxo;
  try {
    out = ctx.nucleo.planejarComFluxo(entradaF, dados, opcoes);
  } catch (e) {
    const erro = `planejarComFluxo falhou: ${mensagemErro(e)}`;
    return { ok: false, motivo: erro, registro: registroDeErro(base, erro, "fallback", oficial) };
  }
  let registro: RegistroFluxo;
  try {
    registro = jsonPuro(preencher({ ...base, hashEntrada: hashDaEntrada(ctx, dados, opcoes, out.diagnostico.estado.ultimoFechado) }, out.diagnostico, null, oficial, out.resultado.alocacoes, descartesContagem(ctx)));
  } catch (e) {
    const erro = `diagnóstico do fluxo inválido: ${mensagemErro(e)}`;
    return { ok: false, motivo: erro, registro: registroDeErro(base, erro, "fallback", oficial) };
  }
  let violacoes: ViolacaoDura[];
  try {
    violacoes = ctx.nucleo.verificarRestricoesDuras(entradaF, out.resultado.alocacoes);
  } catch (e) {
    const erro = `verificarRestricoesDuras falhou: ${mensagemErro(e)}`;
    return { ok: false, motivo: erro, registro: { ...registro, resultado: "fallback", erro, diagnosticos: [...registro.diagnosticos, { codigo: "ERRO_FLUXO", severidade: "erro", mensagem: erro }] } };
  }
  const passado = passadoAlterado(ctx.entrada, out.resultado.alocacoes);
  if (violacoes.length > 0 || passado.length > 0) {
    const erro = violacoes.length > 0 ? `${violacoes.length} violação(ões) de restrição dura (ex.: ${violacoes[0].tipo})` : `${passado.length} linha(s) do plano de fluxo caem no passado`;
    return { ok: false, motivo: erro, registro: { ...registro, resultado: "fallback", erro, violacoes: jsonPuro(violacoes.slice(0, MAX_VIOLACOES)) } };
  }
  return { ok: true, resultado: out.resultado, registro };
}

// ---- MODO SOMBRA ----------------------------------------------------------------------------------------------------------------

/**
 * Sombra: NUNCA altera a Escala. `oficial` = plano oficial VIGENTE da região (já gravado, ou o que o recálculo acabou de gravar).
 * Avalia o oficial e o plano de fluxo pelo MESMO simulador, roda o verificador de hard constraints sobre o plano de fluxo e devolve o registro.
 * Nunca lança: falha vira registro `erro`.
 */
export function avaliarFluxoSombra(ctx: ContextoFluxo, oficial: AlocacaoEscala[]): RegistroFluxo {
  const dados = dadosProducaoReal(ctx.estado, ctx.agoraMs);
  const { entrada: entradaF, opcoes } = insumosFluxo(ctx.estado, ctx.entrada, ctx.agoraMs);
  const base = registroBase(ctx, "sombra", dados, opcoes);
  try {
    const out = ctx.nucleo.planejarComFluxo(entradaF, dados, opcoes);
    let avaliacaoOficial: AvaliacaoPlano | null = null;
    const extras: unknown[] = [];
    try {
      avaliacaoOficial = ctx.nucleo.avaliarPlano(entradaF, dados, oficial, opcoes);
    } catch (e) {
      extras.push({ codigo: "ERRO_AVALIACAO_OFICIAL", severidade: "erro", mensagem: mensagemErro(e) });
    }
    let violacoes: ViolacaoDura[] = [];
    try {
      violacoes = ctx.nucleo.verificarRestricoesDuras(entradaF, out.resultado.alocacoes);
    } catch (e) {
      extras.push({ codigo: "ERRO_VERIFICADOR", severidade: "erro", mensagem: mensagemErro(e) });
    }
    const passado = passadoAlterado(ctx.entrada, out.resultado.alocacoes).length;
    const reg = preencher({ ...base, hashEntrada: hashDaEntrada(ctx, dados, opcoes, out.diagnostico.estado.ultimoFechado) }, out.diagnostico, avaliacaoOficial, oficial, out.resultado.alocacoes, descartesContagem(ctx));
    const faltaOf = avaliacaoOficial?.totais.faltaFinalLo ?? null;
    const faltaFl = out.diagnostico.avaliacaoFluxo.totais.faltaFinalLo;
    return jsonPuro({
      ...reg,
      violacoes: violacoes.slice(0, MAX_VIOLACOES),
      diagnosticos: [...reg.diagnosticos, ...extras, ...(passado > 0 ? [{ codigo: "PASSADO_ALTERADO", severidade: "erro", mensagem: `${passado} linha(s) do plano de fluxo caem no passado` }] : [])],
      diff: { ...reg.diff, faltaFinalLo: { oficial: faltaOf, fluxo: faltaFl, delta: faltaOf === null ? null : faltaFl - faltaOf }, violacoes: violacoes.length, passadoAlterado: passado },
    });
  } catch (e) {
    return registroDeErro(base, `sombra do fluxo falhou: ${mensagemErro(e)}`, "erro", oficial);
  }
}
