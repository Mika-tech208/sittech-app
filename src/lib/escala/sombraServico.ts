// Serviço do MODO SOMBRA (Fase 4d) — independente de Supabase (IO injetado), como processar.ts: fechamento do período, evento lógico
// único, decisão sombra, snapshot append-only. NUNCA grava na Escala oficial (não há `aplicar` aqui) e NUNCA altera snapshot já gravado.
//
// Fluxo por evento lógico (semana + data + período):
//   1. modo: desligado => nada; sombra => processa; ativo => tratado como sombra (falha segura, aviso no resumo);
//   2. fechamento (fechamento.ts): enquanto não estável/20 min => AGUARDA sem reivindicar (não consome tentativa);
//   3. reivindica o evento (atômico no banco) => decisão => snapshot idempotente => conclui.
// O CORTE é o instante em que o período fechou (calculado pelos carimbos dos lançamentos), não o instante em que o worker roda.

import { analisarAtingibilidade } from "@/features/escala/atingibilidade";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { instanteDeFechamento, lancamentosTardios, type AvaliacaoFechamento, type LancamentoCarimbado } from "@/features/escala/fechamento";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { jsonCanonico } from "@/features/escala/hashCanonico";
import { modoEfetivoReplanejamento, type ModoReplanejamento } from "@/features/escala/parametros";
import { construirProposta, resumoRestrito, type MudancaLinha, type PropostaRestrita } from "@/features/escala/replanejamentoRestrito";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import { completudeDe, construirSnapshot, empacotarApontamento, empacotarLinha, paraParametrosCorte, type EntradaCanonicaCorte, type PlanoOficialRef, type SnapshotSombra } from "@/features/escala/snapshotSombra";
import { executarCorteSombra, type DecisaoCorte, type ParametrosCorte } from "@/features/escala/sombraCorte";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { AlocacaoEscala, EntradaEscala } from "@/features/escala/types";
import { ausenciaNoCorte } from "./ausenciaAberta";
import { ativoNoCorte } from "./situacaoFuncionario";
import { ConflitoDeVersaoError, type AusenciaBruta, type EstadoBruto } from "./estado";
import type { ConfigFluxo } from "./fluxo/parametrosFluxo";
import { semanasComFluxoAtivo } from "./fluxo/parametrosFluxo";
import type { ResultadoFechamentoFluxo } from "./fluxo/fechamento";
import { montarEntradaEscala } from "./montarEntrada";
import { estadoComVersao, type VersaoPlanoOficial } from "./planoVersionado";

export interface ApontamentoBanco {
  data: string;
  periodoId: string;
  funcionarioId: string | null;
  maquinaId: string | null;
  produtoId: string | null;
  etapaId: string | null;
  operacaoId: string | null;
  quantidadeProduzida: number;
  quantidadeRefugo: number;
  meta: number;
  status: string;
  motivo: string | null;
  criadoEmMs: number;
  atualizadoEmMs: number | null;
}

export interface EventoSombra { id: string; previsaoId: string; data: string; periodoId: string; status: string; tentativas: number }

export interface DecisaoParaGravar { eventoId: string | null; previsaoId: string; snapshot: SnapshotSombra; tardios: number; latenciaMs: number; revisao?: number; motivo?: string; modo?: "sombra" | "ativo_restrito" }

export type ResultadoAvaliacao = "aplicado" | "sem_mudanca" | "conflito" | "invalida" | "recusado" | "erro";
export interface CorteAplicacao { semanaInicio: string; data: string; periodoId: string; slot: number; revisao: number; motivo: string }
export interface AplicacaoRestrita {
  previsaoId: string;
  decisaoId: string;
  corte: CorteAplicacao;
  dias: { data: string; versao_base: number | null; periodos_snapshot: unknown }[];
  aPartirDeData: string;
  aPartirDePeriodo: string;
  alocacoes: AlocacaoEscala[];
  hashProposta: string;
  mudancas: { total: number; resumo: PropostaRestrita["resumo"]; churn: PropostaRestrita["churn"]; wip: PropostaRestrita["wip"]; ganho: PropostaRestrita["ganho"]; amostra: MudancaLinha[]; reparoDoComprometido: boolean };
  resumo: Record<string, unknown>;
}
export interface RegistroAvaliacao {
  previsaoId: string;
  decisaoId: string | null;
  corte: CorteAplicacao;
  resultado: Exclude<ResultadoAvaliacao, "aplicado">;
  motivo: string;
  aPartir?: { data: string; periodoId: string } | null;
  hashProposta?: string | null;
  mudancas?: unknown;
  resumo?: unknown;
  erro?: string | null;
}

export interface SombraIO {
  lerModo(): Promise<ModoReplanejamento>;
  listarEventos(): Promise<EventoSombra[]>; // não concluídos (pendentes, erro < 3 tentativas, processando travado)
  carregar(previsaoId: string): Promise<{ estado: EstadoBruto; apontamentos: ApontamentoBanco[] }>; // estado ATUAL (catálogos); o plano/Previsão do passado vêm das versões
  versaoDoPlano(previsaoId: string, emMs: number): Promise<VersaoPlanoOficial | null>; // a versão VIGENTE no instante (nunca "a Escala de agora")
  reivindicar(eventoId: string): Promise<boolean>; // atômico; só aqui uma tentativa é consumida
  gravarDecisao(d: DecisaoParaGravar): Promise<{ inserida: boolean; id: string }>; // idempotente: (previsão, data, período)
  concluir(eventoId: string, status: "processado" | "ignorado" | "erro", erro?: string | null): Promise<void>;
  // ---- replanejamento restrito (só chamados com ativo_restrito + semana autorizada) ----
  lerSemanasAtivas?(): Promise<string[]>; // semanas (segunda ISO) em que o modo restrito PODE escrever
  proximaRevisao?(previsaoId: string, data: string, periodoId: string): Promise<number>; // 1 + a maior revisão da decisão do período (0 = decisão do corte)
  aplicarRestrito?(a: AplicacaoRestrita): Promise<{ id: string; hashAntes: string; hashDepois: string; versoesAntes: Record<string, number>; versoesDepois: Record<string, number> }>; // lança ConflitoDeVersaoError
  registrarAvaliacao?(r: RegistroAvaliacao): Promise<void>; // append-only: sem_mudanca / recusado / conflito / invalida / erro
  reavaliacoesPendentes?(semanas: string[]): Promise<{ previsaoId: string; data: string; periodoId: string }[]>; // Escala mudou depois da última avaliação (evento: ausência, Previsão...)
  // ---- Escala Inteligente (fluxo) ----
  lerConfigFluxo?(): Promise<ConfigFluxo>; // producao_real_* (modo, semanas autorizadas, ...)
  // período FECHADO (decisão gravada agora): ativo => recálculo oficial da semana pelo fluxo; sombra => diagnóstico. Nunca lança.
  aoFechamento?(a: { estado: EstadoBruto; ev: EventoSombra; agoraMs: number; corteMs: number }): Promise<ResultadoFechamentoFluxo | null>;
}

export interface ResumoSombra {
  modo: ModoReplanejamento;
  modoEfetivo: "desligado" | "sombra" | "ativo_restrito";
  avisoAtivoNaoImplementado: boolean;
  aplicadas: number;
  semMudanca: number;
  recusadas: number;
  conflitos: number;
  reavaliacoes: number;
  reavaliacoesDispensadas: number; // pendentes cuja região-alvo já iniciou: registradas como recusa SEM rodar o motor
  eventos: number;
  aguardando: number;
  processadas: number;
  duplicadas: number;
  ignoradas: number;
  concorrencia: number;
  erros: number;
  // Escala Inteligente (fluxo) — presentes só quando o fluxo está ligado (sombra/ativo em alguma semana autorizada)
  fluxo?: { semanasAtivas: string[]; fechamentos: number; erros: number };
  interlockFluxo?: string[]; // semanas em que o fluxo é ATIVO: o replanejamento restrito NÃO aplica nelas
}

export const paraReal = (a: ApontamentoBanco): ApontamentoReal => ({
  data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId,
  boas: a.quantidadeProduzida - a.quantidadeRefugo, refugo: a.quantidadeRefugo, meta: a.meta, status: a.status === "produzindo" ? "produzindo" : "sem_producao", motivo: a.motivo, lancadoEmMs: a.criadoEmMs,
});

// visão do ESTADO no corte: ausências registradas e indisponibilidades iniciadas até o corte (liberação posterior = desconhecida)
export function estadoNoCorte(estado: EstadoBruto, corteMs: number): EstadoBruto {
  return {
    ...estado,
    ausencias: estado.ausencias.map((a) => ausenciaNoCorte(a, corteMs)).filter((a): a is AusenciaBruta => a !== null),
    // ativo/inativo COMO ERA no corte: só vale o que já tinha sido registrado até o corte; o desligamento efetivo antes do corte, mas registrado depois, não existe para ele
    equipeProdutiva: estado.equipeProdutiva.map((m) => (estado.situacaoFuncionarios?.[m.funcionarioId] ? { ...m, ativo: ativoNoCorte(estado.situacaoFuncionarios[m.funcionarioId], corteMs, corteMs, m.ativo) } : m)),
    indisponibilidades: estado.indisponibilidades.filter((i) => Date.parse(i.desde) <= corteMs).map((i) => (i.liberadaEm && Date.parse(i.liberadaEm) > corteMs ? { ...i, liberadaEm: null } : i)),
    // WIP: confirmações e ajustes criados depois do corte não existiam (append-only, com carimbo); a Produção Real é lida só até a data do corte
    ...(estado.wipControle
      ? { wipControle: { ...estado.wipControle, confirmacoes: estado.wipControle.confirmacoes.filter((c) => Date.parse(c.criadoEm) <= corteMs), ajustes: estado.wipControle.ajustes.filter((a) => !a.criadoEm || Date.parse(a.criadoEm) <= corteMs) } }
      : {}),
  };
}

export type PreparoDecisao =
  | { pronto: false; avaliacao: AvaliacaoFechamento; motivoIgnorado?: undefined }
  | { pronto: false; avaliacao?: undefined; motivoIgnorado: string }
  | { pronto: true; snapshot: SnapshotSombra; corteMs: number; tardios: number; par: ParametrosCorte; decisao: DecisaoCorte; proposta: PropostaRestrita | null };

export interface OpcoesPreparo {
  // replanejamento restrito: WIP flexível sem teto fixo, trocas manuais como preferência, proposta + gargalo dinâmico + ociosidade no snapshot
  restrito?: boolean;
  // leitura FRESCA (imediatamente antes de gravar): Escala, ausências, indisponibilidades e Previsão do INSTANTE ATUAL, não do corte. Nunca usada no modo sombra.
  fresco?: boolean;
}

// Núcleo: dado o estado ATUAL (só catálogos), os apontamentos e as VERSÕES do plano, decide se o período fechou e (se sim) monta o snapshot com a
// Escala e a Previsão que valiam no corte. Informação posterior ao corte (plano recalculado, troca manual, ausência, indisponibilidade) não entra.
export async function prepararDecisao(
  estadoAtual: EstadoBruto,
  apontamentos: ApontamentoBanco[],
  ev: { data: string; periodoId: string },
  agoraMs: number,
  obterVersao: (emMs: number) => Promise<VersaoPlanoOficial | null>,
  opcoes: OpcoesPreparo = {}
): Promise<PreparoDecisao> {
  // 1) geometria do período (horários) e plano vigente ao FIM do período => postos esperados (período encerrado = linhas congeladas)
  const geometria = montarEntradaEscala(estadoAtual, agoraMs).entrada.slots.find((s) => s.data === ev.data && s.periodoId === ev.periodoId);
  if (!geometria) return { pronto: false, motivoIgnorado: "período fora da escala da semana" };
  const v0 = await obterVersao(geometria.fimMs);
  if (!v0) return { pronto: false, motivoIgnorado: "sem versão do plano oficial anterior ao fim do período" };
  const estado0 = estadoComVersao(estadoAtual, v0);
  const base0 = montarEntradaEscala(estado0, agoraMs).entrada;
  const slot = base0.slots.find((s) => s.data === ev.data && s.periodoId === ev.periodoId);
  if (!slot) return { pronto: false, motivoIgnorado: "período fora da escala vigente ao fim do período" };
  const oficialDoSlot = estado0.alocacoes.filter((a) => a.data === ev.data && a.periodoId === ev.periodoId);
  if (oficialDoSlot.length === 0) return { pronto: false, motivoIgnorado: "período sem escala oficial" };

  // 2) fechamento (só carimbos dos lançamentos)
  const doPeriodo = apontamentos.filter((a) => a.data === ev.data && a.periodoId === ev.periodoId);
  const lanc: LancamentoCarimbado[] = doPeriodo.map((a) => ({ maquinaId: a.maquinaId, ms: a.criadoEmMs }));
  const esperados = oficialDoSlot.filter((a) => a.maquinaId).map((a) => a.maquinaId as string);
  const f = instanteDeFechamento({ fimMs: slot.fimMs, agoraMs, postosEsperados: esperados, lancamentos: lanc });
  if (f.corteMs === null) return { pronto: false, avaliacao: f.avaliacao };
  const corteHonesto = f.corteMs;
  // leitura fresca: o que vale AGORA (a decisão será gravada agora); caso contrário, o que valia no corte
  const corteMs = opcoes.fresco ? Math.max(corteHonesto, agoraMs) : corteHonesto;

  // 3) Escala + Previsão VIGENTES NO CORTE, e só o que existia no corte (ausências, indisponibilidades, apontamentos)
  const v1 = corteMs === geometria.fimMs ? v0 : await obterVersao(corteMs);
  if (!v1) return { pronto: false, motivoIgnorado: "sem versão do plano oficial anterior ao corte" };
  const estado = estadoComVersao(estadoAtual, v1);
  const est = estadoNoCorte(estado, corteMs);
  const montadaCorte = montarEntradaEscala(est, corteMs);
  const ent: EntradaEscala = montadaCorte.entrada;
  const selecoesInvalidas = montadaCorte.avisos.filter((a) => a.tipo === "selecao_maquina_invalida").length;
  const chaveAp = (a: ApontamentoReal) => [a.data, a.periodoId, a.maquinaId ?? "", a.funcionarioId ?? "", a.lancadoEmMs.toString().padStart(15, "0"), a.status].join("|");
  const visiveis = apontamentos.filter((a) => a.criadoEmMs <= corteMs).map(paraReal).sort((x, y) => (chaveAp(x) < chaveAp(y) ? -1 : 1)); // ordem canônica: mesmo conteúdo => mesmo hash
  const origemMs = epochMsNoFuso(estado.semanaInicio, "05:00");
  const entOrigem = montarEntradaEscala(estadoNoCorte(estado, origemMs), origemMs).entrada;
  const zero = { ...entOrigem, aPartirDe: 0, congeladas: [], revezamentoDuro: true, pools: entOrigem.pools.map((p) => ({ ...p, adicionalMax: 0 })) };
  const impossivelNaOrigem = analisarAtingibilidade(zero, gerarEscala(zero)).status === "impossivel";

  const canonica: EntradaCanonicaCorte = {
    versao: 2, c: slot.indice, corteMs,
    dias: [...new Set(ent.slots.map((s) => s.data))].map((data) => ({ data, periodos: (estado.diasExistentes.find((d) => d.data === data)?.periodosSnapshot ?? estado.periodosAtuais) })),
    funcionarios: ent.funcionarios.map((x) => x.id).sort(), pools: ent.pools, ...(ent.wip ? { wip: ent.wip } : {}),
    parametrosWip: { wipModo: estado.parametros?.wipModo ?? "desligado", wipDiasLimite: estado.parametros?.wipDiasLimite ?? 1, wipDiasLimitePorSemana: estado.parametros?.wipDiasLimitePorSemana?.[estado.semanaInicio] ?? null },
    ausencias: [...ent.ausencias].sort((x, y) => (jsonCanonico(x) < jsonCanonico(y) ? -1 : 1)), indisponibilidades: [...ent.indisponibilidades].sort((x, y) => (jsonCanonico(x) < jsonCanonico(y) ? -1 : 1)),
    maquinasIndisponiveisPrevisao: ent.maquinasIndisponiveisPrevisao, maquinasInativas: ent.maquinasInativas ?? [], historicoEquidade: ent.historicoEquidade ?? [],
    apontamentos: visiveis.map(empacotarApontamento),
    planoOficial: [...estado.alocacoes].sort((x, y) => (x.data + x.periodoId + x.funcionarioId < y.data + y.periodoId + y.funcionarioId ? -1 : 1)).map(empacotarLinha), impossivelNaOrigem, modoHorizonte: "comprometido", ...(opcoes.restrito ? { restrito: true } : {}),
  };
  const par = paraParametrosCorte(canonica);
  const decisao = executarCorteSombra(par);
  const proposta = opcoes.restrito ? construirProposta(par, decisao) : null;
  const tardios = lancamentosTardios(lanc, corteHonesto);
  const comp = decisao.horizonte.horizonte.comprometido;
  const slotsC = ent.slots;
  const futuroRelevante = slotsC.filter((s) => s.indice > slot.indice && s.indice <= slot.indice + 6).map((s) => ({
    periodo: `${s.data} ${s.periodoId}`,
    linhas: estado.alocacoes.filter((a) => a.data === s.data && a.periodoId === s.periodoId).map((a) => [a.funcionarioId, a.maquinaId, a.produtoId, a.etapaId, Math.round(a.pecas)] as [string, string | null, string | null, string | null, number]),
  }));
  const planoRef: PlanoOficialRef = {
    versaoId: v1.id, origem: v1.origem, validoDesdeMs: v1.validoDesdeMs, corteMs, hashPlanoBanco: v1.hashPlano, hashPlanoEscala: hashAlocacoes(estado.alocacoes),
    versoesDias: Object.fromEntries(v1.dias.map((d) => [d.data, d.versao])), versaoNoFimDoPeriodo: v0.id,
    comprometido: comp === null ? null : { slot: comp, data: slotsC[comp].data, periodoId: slotsC[comp].periodoId }, futuroRelevante,
  };
  const snapshot = construirSnapshot({
    semanaInicio: estado.semanaInicio, entrada: canonica, decisao, completude: completudeDe(f.avaliacao, tardios), nomesMaquinas: estado.nomesMaquinas, planoOficialRef: planoRef,
    extraIncertezas: {
      // o banco só guarda a versão ATUAL da linha: se foi editada depois do corte, o valor visto aqui pode não ser o que existia no corte
      // a Previsão do corte tinha máquina que o roteiro atual não torna elegível: o motor a ignorou, mas a decisão NÃO serve de evidência de qualidade produtiva
      entrada_com_roteiro_inconsistente: selecoesInvalidas,
      apontamento_editado_apos_corte: apontamentos.filter((a) => a.criadoEmMs <= corteMs && a.atualizadoEmMs !== null && a.atualizadoEmMs > corteMs + 1000).length,
    },
    ...(proposta ? { restrito: resumoRestrito(par, decisao, proposta) } : {}),
  });
  return { pronto: true, snapshot, corteMs, tardios, par, decisao, proposta };
}

// A reavaliação de um período `c` só pode regravar de c+1 (reparo do comprometido) ou c+2 em diante. Se o período c+2 já INICIOU, nenhuma região possível é
// regravável: a decisão seria recusada de qualquer forma. Devolve a região-alvo (c+2) quando já iniciou; null quando ainda há o que avaliar (ou não há c+2).
export function regiaoAlvoJaIniciada(estado: EstadoBruto, ev: { data: string; periodoId: string }, agoraMs: number): { alvo: { data: string; periodoId: string }; slotOrigem: number } | null {
  const slots = montarEntradaEscala(estado, agoraMs).entrada.slots;
  const origem = slots.find((s) => s.data === ev.data && s.periodoId === ev.periodoId);
  if (!origem) return null;
  const alvo = slots.find((s) => s.indice === origem.indice + 2);
  return alvo && alvo.inicioMs <= agoraMs ? { alvo: { data: alvo.data, periodoId: alvo.periodoId }, slotOrigem: origem.indice } : null;
}

const MAX_TENTATIVAS_APLICACAO = 3;

type Contexto = { estado: EstadoBruto; apontamentos: ApontamentoBanco[] };
type CarregarFn = (previsaoId: string) => Promise<Contexto>;

// (A) calcula a decisão com o estado do INSTANTE e a proposta; (B) grava o snapshot (revisão ≥ 1, append-only); (C) aplica SÓ a região autorizada, com
// concorrência otimista; (D) registra exatamente o que mudou. Se a Escala mudou entre a leitura e a gravação, NADA é gravado: relê e recalcula.
export async function avaliarEAplicar(
  io: SombraIO,
  ev: { id: string | null; previsaoId: string; data: string; periodoId: string },
  inicial: Contexto,
  carregar: CarregarFn,
  agoraMs: number,
  motivo: "fechamento" | "reavaliacao"
): Promise<ResultadoAvaliacao> {
  if (!io.aplicarRestrito || !io.registrarAvaliacao || !io.proximaRevisao) return "erro";
  let ctx = inicial;
  let ultimo: ResultadoAvaliacao = "erro";
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_APLICACAO; tentativa++) {
    if (tentativa > 1) ctx = await carregar(ev.previsaoId); // a Escala mudou: descarta a leitura anterior
    const r = await prepararDecisao(ctx.estado, ctx.apontamentos, ev, agoraMs, (ms) => io.versaoDoPlano(ev.previsaoId, ms), { restrito: true, fresco: true });
    const base = { previsaoId: ev.previsaoId };
    const idCorte = (revisao: number, slot: number, semanaInicio: string): CorteAplicacao => ({ semanaInicio, data: ev.data, periodoId: ev.periodoId, slot, revisao, motivo });
    if (!r.pronto) {
      // sem o período fechado/versão: nada a avaliar agora (não é erro)
      return "invalida";
    }
    const snap = r.snapshot;
    const corte0 = idCorte(0, snap.identificacao.slot, snap.identificacao.semanaInicio);
    const prop = r.proposta as PropostaRestrita;
    const revisao = await io.proximaRevisao(ev.previsaoId, ev.data, ev.periodoId);
    const g = await io.gravarDecisao({ eventoId: ev.id, previsaoId: ev.previsaoId, snapshot: snap, tardios: r.tardios, latenciaMs: agoraMs - r.corteMs, revisao, motivo, modo: "ativo_restrito" });
    if (!g.inserida) return "conflito"; // outro worker avaliou a mesma revisão: não aplica duas vezes
    const corte = { ...corte0, revisao };
    const comum = { ...base, decisaoId: g.id, corte, aPartir: prop.aPartir, hashProposta: prop.hashProposta, resumo: prop.resumo };
    if (prop.veredito === "sem_mudanca") { await io.registrarAvaliacao({ ...comum, resultado: "sem_mudanca", motivo: prop.motivoVeredito }); return "sem_mudanca"; }
    if (prop.veredito === "recusar" || !prop.aPartir || prop.aPartirSlot === null) {
      await io.registrarAvaliacao({ ...comum, resultado: "recusado", motivo: prop.motivoVeredito || "proposta inválida", mudancas: { total: prop.mudancas.length, amostra: prop.mudancas.slice(0, 20) } });
      return "recusado";
    }
    // região já iniciada (worker atrasado): nunca regrava período em andamento
    const slotAlvo = r.par.base.slots[prop.aPartirSlot];
    if (slotAlvo.inicioMs <= agoraMs) {
      await io.registrarAvaliacao({ ...comum, resultado: "recusado", motivo: `região já iniciada (${slotAlvo.data} ${slotAlvo.periodoId}): decisão defasada` });
      return "recusado";
    }
    const versoes = snap.planoOficialRef?.versoesDias ?? {};
    const dias = snap.entrada.dias.map((d) => ({ data: d.data, versao_base: versoes[d.data] ?? null, periodos_snapshot: d.periodos }));
    if (dias.some((d) => d.versao_base === null)) {
      await io.registrarAvaliacao({ ...comum, resultado: "invalida", motivo: "versão da Escala de algum dia ausente na versão do plano" });
      return "invalida";
    }
    const decisaoWip = r.decisao.horizonte.resultado;
    try {
      await io.aplicarRestrito({
        previsaoId: ev.previsaoId, decisaoId: g.id, corte, dias, aPartirDeData: prop.aPartir.data, aPartirDePeriodo: prop.aPartir.periodoId, alocacoes: prop.linhas, hashProposta: prop.hashProposta,
        mudancas: { total: prop.mudancas.length, resumo: prop.resumo, churn: prop.churn, wip: prop.wip, ganho: prop.ganho, amostra: prop.mudancas.slice(0, 200), reparoDoComprometido: prop.reparoDoComprometido },
        resumo: {
          alocacoes: prop.linhas.length, semPosto: prop.linhas.filter((a) => !a.maquinaId).length, excecoesRevezamento: 0, alertas: decisaoWip?.alertas.length ?? 0, alertasDetalhe: (decisaoWip?.alertas ?? []).slice(0, 300),
          primeiraGeracaoComSemanaEmAndamento: false, decisaoRevisao: revisao, motivo,
        },
      });
      return "aplicado";
    } catch (e) {
      if (e instanceof ConflitoDeVersaoError) {
        ultimo = "conflito";
        await io.registrarAvaliacao({ ...comum, resultado: "conflito", motivo: `a Escala mudou entre a decisão e a gravação (tentativa ${tentativa}/${MAX_TENTATIVAS_APLICACAO}); nada foi gravado`, erro: e.message });
        continue;
      }
      await io.registrarAvaliacao({ ...comum, resultado: "erro", motivo: "falha ao aplicar", erro: e instanceof Error ? e.message : String(e) });
      return "erro";
    }
  }
  return ultimo;
}

export async function processarSombra(io: SombraIO, agoraMs: number): Promise<ResumoSombra> {
  const modo = await io.lerModo();
  const efetivo = modoEfetivoReplanejamento(modo);
  const resumo: ResumoSombra = { modo, modoEfetivo: efetivo, avisoAtivoNaoImplementado: modo === "ativo", aplicadas: 0, semMudanca: 0, recusadas: 0, conflitos: 0, reavaliacoes: 0, reavaliacoesDispensadas: 0, eventos: 0, aguardando: 0, processadas: 0, duplicadas: 0, ignoradas: 0, concorrencia: 0, erros: 0 };
  // Escala Inteligente (fluxo): configuração lida UMA vez. Sem fluxo ligado (cfg ausente/desligado) este bloco é inerte e o comportamento é exatamente o anterior.
  const cfgFluxo = io.lerConfigFluxo ? await io.lerConfigFluxo() : null;
  const fluxoLigado = cfgFluxo !== null && cfgFluxo.modo !== "desligado" && cfgFluxo.semanasAtivas.length > 0;
  if (resumo.modoEfetivo === "desligado" && !fluxoLigado) return resumo;
  const restrito = efetivo !== "desligado"; // com o replanejamento desligado e só o fluxo ligado, o período fechado é detectado, mas não se calcula proposta restrita
  // INTERLOCK: nas semanas em que o fluxo é ATIVO o replanejamento restrito NÃO aplica (o fluxo é o dono do recálculo); o parâmetro do restrito não é alterado.
  const semanasFluxoAtivo = cfgFluxo ? semanasComFluxoAtivo(cfgFluxo) : [];
  const semanasAtivas = (efetivo === "ativo_restrito" && io.lerSemanasAtivas ? await io.lerSemanasAtivas() : []).filter((s) => !semanasFluxoAtivo.includes(s));
  if (fluxoLigado) {
    resumo.fluxo = { semanasAtivas: cfgFluxo.semanasAtivas, fechamentos: 0, erros: 0 };
    if (efetivo === "ativo_restrito" && semanasFluxoAtivo.length > 0) resumo.interlockFluxo = semanasFluxoAtivo;
  }
  const contabilizar = (r: ResultadoAvaliacao) => {
    if (r === "aplicado") resumo.aplicadas++;
    else if (r === "sem_mudanca") resumo.semMudanca++;
    else if (r === "recusado" || r === "invalida") resumo.recusadas++;
    else if (r === "conflito") resumo.conflitos++;
    else resumo.erros++;
  };

  const eventos = await io.listarEventos();
  resumo.eventos = eventos.length;
  const cache = new Map<string, Contexto>();
  const carregar: CarregarFn = async (previsaoId) => { const c = await io.carregar(previsaoId); cache.set(previsaoId, c); return c; };
  for (const ev of [...eventos].sort((a, b) => (a.data + a.periodoId < b.data + b.periodoId ? -1 : 1))) {
    try {
      if (!cache.has(ev.previsaoId)) cache.set(ev.previsaoId, await io.carregar(ev.previsaoId));
      const ctx = cache.get(ev.previsaoId)!;
      const r = await prepararDecisao(ctx.estado, ctx.apontamentos, ev, agoraMs, (ms) => io.versaoDoPlano(ev.previsaoId, ms), { restrito });
      if (!r.pronto) {
        if (r.motivoIgnorado) {
          if (await io.reivindicar(ev.id)) { await io.concluir(ev.id, "ignorado", r.motivoIgnorado); resumo.ignoradas++; } else resumo.concorrencia++;
        } else resumo.aguardando++; // ainda não fechou: NÃO reivindica, NÃO consome tentativa
        continue;
      }
      if (!(await io.reivindicar(ev.id))) { resumo.concorrencia++; continue; }
      try {
        // (A)+(B) decisão no corte (revisão 0, modo sombra): sempre gravada, mesmo no modo restrito
        const g = await io.gravarDecisao({ eventoId: ev.id, previsaoId: ev.previsaoId, snapshot: r.snapshot, tardios: r.tardios, latenciaMs: agoraMs - r.corteMs, revisao: 0, motivo: "fechamento", modo: "sombra" });
        // (C)+(D) só com o modo restrito E semana autorizada E algo a mudar
        if (g.inserida && efetivo === "ativo_restrito" && semanasAtivas.includes(r.snapshot.identificacao.semanaInicio) && r.proposta && r.proposta.veredito !== "sem_mudanca") {
          contabilizar(await avaliarEAplicar(io, ev, ctx, carregar, agoraMs, "fechamento"));
        }
        // Escala Inteligente (fluxo): período fechado => ativo recalcula pelo fluxo; sombra grava o diagnóstico. Só na 1ª vez do evento; nunca lança nem muda o status do evento.
        if (g.inserida && fluxoLigado && io.aoFechamento) {
          const f = await io.aoFechamento({ estado: ctx.estado, ev, agoraMs, corteMs: r.corteMs });
          if (f && resumo.fluxo) {
            resumo.fluxo.fechamentos++;
            if (f.resultado === "erro") resumo.fluxo.erros++;
          }
        }
        await io.concluir(ev.id, "processado", g.inserida ? null : "decisão já existia");
        if (g.inserida) resumo.processadas++; else resumo.duplicadas++;
      } catch (e) {
        await io.concluir(ev.id, "erro", e instanceof Error ? e.message : String(e));
        resumo.erros++;
      }
    } catch (e) {
      console.error("escala/sombra:", e instanceof Error ? e.message : e);
      resumo.erros++;
    }
  }

  // reavaliação por EVENTO (ausência, indisponibilidade, Previsão...): a Escala oficial mudou depois da última avaliação do período mais recente
  if (efetivo === "ativo_restrito" && semanasAtivas.length > 0 && io.reavaliacoesPendentes) {
    try {
      for (const p of await io.reavaliacoesPendentes(semanasAtivas)) {
        const ctx = await carregar(p.previsaoId);
        // outra invocação concorrente pode ter avaliado/registrado enquanto carregávamos: só segue se continua pendente (a idempotência final está no banco)
        const mesmo = (x: { previsaoId: string; data: string; periodoId: string }) => x.previsaoId === p.previsaoId && x.data === p.data && x.periodoId === p.periodoId;
        if (!(await io.reavaliacoesPendentes(semanasAtivas)).some(mesmo)) { resumo.concorrencia++; continue; }
        // região-alvo já iniciada: a decisão seria recusada de qualquer forma ("decisão defasada") — não roda o motor nem grava nova decisão; só registra (uma vez) a recusa
        const iniciada = regiaoAlvoJaIniciada(ctx.estado, p, agoraMs);
        if (iniciada && io.registrarAvaliacao && io.proximaRevisao) {
          const revisao = Math.max(0, (await io.proximaRevisao(p.previsaoId, p.data, p.periodoId)) - 1);
          await io.registrarAvaliacao({
            previsaoId: p.previsaoId, decisaoId: null, corte: { semanaInicio: ctx.estado.semanaInicio, data: p.data, periodoId: p.periodoId, slot: iniciada.slotOrigem, revisao, motivo: "reavaliacao" },
            resultado: "recusado", motivo: `região já iniciada (${iniciada.alvo.data} ${iniciada.alvo.periodoId}): decisão defasada (reavaliação dispensada)`, aPartir: iniciada.alvo, hashProposta: null,
          });
          resumo.reavaliacoesDispensadas++;
          contabilizar("recusado");
          continue;
        }
        resumo.reavaliacoes++;
        contabilizar(await avaliarEAplicar(io, { id: null, ...p }, ctx, carregar, agoraMs, "reavaliacao"));
      }
    } catch (e) {
      console.error("escala/sombra reavaliação:", e instanceof Error ? e.message : e);
      resumo.erros++;
    }
  }
  return resumo;
}
