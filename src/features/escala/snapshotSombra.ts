// SNAPSHOT DA DECISÃO SOMBRA (Fase 4d) — PURO. Constrói o registro APPEND-ONLY que o servidor grava em escala_sombra_decisoes.
//
//   Snapshot = o que se SABIA naquele momento.  Resultado posterior (escala_sombra_resultados) = o que aconteceu depois; nunca o altera.
//   Reprodutível: `reproduzirSnapshot` refaz a decisão SÓ a partir de `entrada` (entrada canônica compacta) e confere os hashes (SHA-256).
//   Mínimo necessário: nada de payload do banco vivo; nomes só nos campos de diagnóstico.

import { hashAlocacoes } from "./horizonte";
import { hashCanonico } from "./hashCanonico";
import { executarCorteSombra, type DecisaoCorte, type ParametrosCorte } from "./sombraCorte";
import type { AvaliacaoFechamento } from "./fechamento";
import type { SnapshotRestrito } from "./replanejamentoRestrito";
import type { ApontamentoReal } from "./producaoReal";
import { construirSlotsDeDias } from "./tempo";
import type { AlocacaoEscala, EntradaEscala, HistoricoEquidadeFuncionario, IndisponibilidadeRecursoEscala, JanelaAusenciaEscala, PeriodoEscala, PoolEscala } from "./types";

export const VERSAO_MOTOR_SOMBRA = "4d.1";

// ---------- entrada canônica (JSON, compacta) ----------
export interface EntradaCanonicaCorte {
  versao: 2;
  c: number;
  corteMs: number;
  dias: { data: string; periodos: PeriodoEscala[] }[];
  funcionarios: string[];
  pools: PoolEscala[]; // quantidade PREVISTA da semana + adicional por etapa (teto) como a Escala oficial os vê (o restante real é derivado dos apontamentos)
  wip?: EntradaEscala["wip"]; // MESMA regra da Escala oficial: limites de estoque, estoque confirmado e saldo (ausente = WIP desligado)
  parametrosWip?: { wipModo: string; wipDiasLimite: number; wipDiasLimitePorSemana: number | null }; // configuração vigente no corte (auditoria)
  ausencias: JanelaAusenciaEscala[]; // já filtradas pelo corte
  indisponibilidades: IndisponibilidadeRecursoEscala[]; // idem
  maquinasIndisponiveisPrevisao: string[];
  maquinasInativas: string[];
  historicoEquidade: HistoricoEquidadeFuncionario[];
  apontamentos: ApontamentoPacote[]; // só ≤ c e lançados até o corte
  planoOficial: LinhaPacote[]; // plano oficial vigente da semana no momento da leitura
  impossivelNaOrigem: boolean;
  modoHorizonte: "comprometido" | "antigo";
  restrito?: boolean; // replanejamento restrito: WIP flexível sem teto fixo + trocas manuais como preferência (ausente = regra da 4d original)
}

export type ApontamentoPacote = [string, string, string | null, string | null, string | null, string | null, string | null, number, number, number, "p" | "s", string | null, number];
export type LinhaPacote = [string, string, string, string | null, string | null, string | null, string | null, number, number, string | null, string | null, "a" | "m"];

export const empacotarApontamento = (a: ApontamentoReal): ApontamentoPacote => [a.data, a.periodoId, a.funcionarioId, a.maquinaId, a.produtoId, a.etapaId, a.operacaoId, a.boas, a.refugo, a.meta, a.status === "produzindo" ? "p" : "s", a.motivo, a.lancadoEmMs];
export const desempacotarApontamento = (t: ApontamentoPacote): ApontamentoReal => ({ data: t[0], periodoId: t[1], funcionarioId: t[2], maquinaId: t[3], produtoId: t[4], etapaId: t[5], operacaoId: t[6], boas: t[7], refugo: t[8], meta: t[9], status: t[10] === "p" ? "produzindo" : "sem_producao", motivo: t[11], lancadoEmMs: t[12] });
export const empacotarLinha = (a: AlocacaoEscala): LinhaPacote => [a.data, a.periodoId, a.funcionarioId, a.maquinaId, a.produtoId, a.etapaId, a.operacaoId, a.pecas, a.pecasAdicional ?? 0, a.tipoAdicional ?? null, a.motivoSemPosto, a.origem === "manual" ? "m" : "a"];
export const desempacotarLinha = (t: LinhaPacote): AlocacaoEscala => ({
  data: t[0], periodoId: t[1], funcionarioId: t[2], maquinaId: t[3], produtoId: t[4], etapaId: t[5], operacaoId: t[6], pecas: t[7], ...(t[8] > 0 ? { pecasAdicional: t[8] } : {}),
  ...(t[9] === "acabado" || t[9] === "intermediario" ? { tipoAdicional: t[9] } : {}), motivoSemPosto: t[10], excecaoRevezamento: false, motivoExcecao: null, origem: t[11] === "m" ? "manual" : "auto",
});

export function paraParametrosCorte(e: EntradaCanonicaCorte): ParametrosCorte {
  const slots = construirSlotsDeDias(e.dias);
  const base: EntradaEscala = {
    slots, aPartirDe: 0, pools: e.pools, funcionarios: e.funcionarios.map((id) => ({ id })), ausencias: [], maquinasIndisponiveisPrevisao: e.maquinasIndisponiveisPrevisao,
    maquinasInativas: e.maquinasInativas, indisponibilidades: [], congeladas: [], historicoEquidade: e.historicoEquidade, revezamentoDuro: true, ...(e.wip ? { wip: e.wip } : {}),
  };
  return {
    base, ausencias: e.ausencias, indisponibilidades: e.indisponibilidades, apontamentos: e.apontamentos.map(desempacotarApontamento), planoOficial: e.planoOficial.map(desempacotarLinha),
    c: e.c, corteMs: e.corteMs, impossivelNaOrigem: e.impossivelNaOrigem, modoHorizonte: e.modoHorizonte, ...(e.restrito ? { restrito: true } : {}),
  };
}

// ---------- snapshot ----------
export interface CompletudeSnapshot {
  dadosCompletos: boolean;
  motivoFechamento: "estavel" | "prazo";
  percentual: number;
  postosEsperados: number;
  postosRecebidos: number;
  postosFaltantes: string[];
  ultimoLancamentoMs: number | null;
  lancamentosTardiosNaLeitura: number; // informativo: chegaram depois do corte (a decisão NÃO os usa)
}
export const completudeDe = (a: AvaliacaoFechamento, tardios = 0): CompletudeSnapshot => ({
  dadosCompletos: a.dadosCompletos, motivoFechamento: a.motivo === "estavel" ? "estavel" : "prazo", percentual: Math.round(a.percentual * 100) / 100, postosEsperados: a.esperados, postosRecebidos: a.recebidos,
  postosFaltantes: a.faltantes, ultimoLancamentoMs: a.ultimoLancamentoMs, lancamentosTardiosNaLeitura: tardios,
});

// Referência ao plano oficial VIGENTE NO CORTE (versão append-only do banco) — prova de que a decisão não usou a Escala de depois.
export interface PlanoOficialRef {
  versaoId: string;
  origem: "trigger" | "baseline";
  validoDesdeMs: number; // timestamp de validade da versão usada
  corteMs: number;
  hashPlanoBanco: string; // SHA-256 da versão (banco)
  hashPlanoEscala: string; // SHA-256 das alocações da versão (mesma função da decisão)
  versoesDias: Record<string, number>; // versão da Escala de cada dia, vigente no corte
  versaoNoFimDoPeriodo: string; // versão usada para os postos esperados (vigente ao fim do período)
  comprometido: { slot: number; data: string; periodoId: string } | null;
  futuroRelevante: { periodo: string; linhas: [string, string | null, string | null, string | null, number][] }[]; // oficial dos próximos 6 períodos NAQUELE instante
}

export interface AlertaSnapshot { tipo: string; data?: string; periodoId?: string; produtoId?: string; etapaId?: string; quantidade?: number; pecas?: number }

export interface SnapshotSombra {
  versaoMotor: string;
  identificacao: { semanaInicio: string; data: string; periodoId: string; slot: number; corteMs: number };
  completude: CompletudeSnapshot;
  planoOficialRef?: PlanoOficialRef;
  horizonte: { congeladoAte: number; atual: number | null; comprometido: { slot: number; data: string; periodoId: string } | null; primeiroAlteravel: { slot: number; data: string; periodoId: string } | null };
  compromisso: {
    statusOriginal: "compromisso_valido" | "conflito_rotacao_comprometido" | "impossibilidade_fisica_detectada" | "conflito_e_impossibilidade";
    statusApos: string;
    statusErgonomico: string;
    statusFisico: string | null;
    hashOriginal: string;
    hashReparado: string;
    conflitos: { funcionarioId: string; operacao: string; posto: string; exposicaoIncerta: boolean }[];
    impedimentos: { tipo: string; funcionarioId?: string; maquinaId?: string; posto: string }[];
    mudancas: { pessoas: number; maquinas: { de: string; para: string }[] };
    postosVazios: { maquinaId: string; causa: string }[];
    contingencias: { maquinaId: string; nome?: string; produtoId: string | null; etapaId: string | null; operacaoId: string | null; postoAfetado: { maquinaId: string; nome?: string; funcionarioId: string }; motivoNaoUsada: string; contingencia_maquina_disponivel: true }[];
  };
  entradas: { restantePorPool: Record<string, number>; realizadoPorPool: Record<string, number>; desempenho: Record<string, { n: number; f: number }>; equipe: number; ausencias: number; indisponibilidades: number; wip: DecisaoCorte["wip"]; parametros: { revezamento: "duro"; replanejamento: "sombra"; wipModo: string; wipDiasLimite: number | null; wipDiasLimitePorSemana: number | null } };
  planos: {
    hashOficial: string;
    hashSombra: string;
    diferencas: { periodo: string; linhasDiferentes: number; postos: number }[];
    proximosPeriodos: { periodo: string; linhas: [string, string | null, string | null, string | null, number][] }[];
  };
  diagnostico: {
    situacao: string;
    faltaOficial: number;
    faltaSombra: number;
    recuperado: number;
    gargalo: { poolKey: string; falta: number } | null;
    cobertura: { oficial: number; sombra: number };
    postosVazios: DecisaoCorte["postosVazios"];
    incertezas: Record<string, number>;
    alertas: AlertaSnapshot[];
    avisos: string[]; // ressalvas legíveis (ex.: apontamento editado depois do corte)
    preenchimento: DecisaoCorte["preenchimento"]; // "se pudesse escrever agora": o que preencheria/esvaziaria no futuro alterável
    restrito?: SnapshotRestrito; // replanejamento restrito: proposta, gargalo dinâmico, capacidade ajustada e ociosidade explicada
  };
  hashes: { entrada: string; planoOficial: string; planoSombra: string; decisao: string };
  entrada: EntradaCanonicaCorte;
}

const periodoLabel = (s: { data: string; periodoId: string }) => `${s.data} ${s.periodoId}`;
const postoTxt = (p: { maquinaId: string; produtoId: string | null; etapaId: string | null }) => `${p.maquinaId}|${p.produtoId ?? ""}|${p.etapaId ?? ""}`;

export function construirSnapshot(p: { semanaInicio: string; entrada: EntradaCanonicaCorte; decisao: DecisaoCorte; completude: CompletudeSnapshot; nomesMaquinas?: Record<string, string>; extraIncertezas?: Record<string, number>; planoOficialRef?: PlanoOficialRef; restrito?: SnapshotRestrito }): SnapshotSombra {
  const { entrada: e, decisao: d } = p;
  const par = paraParametrosCorte(e);
  const slots = par.base.slots;
  const hz = d.horizonte;
  const av = hz.avaliacaoCompromisso;
  const nome = (m: string) => p.nomesMaquinas?.[m];
  const sombraFut = [...hz.comprometidas, ...hz.alteravel];
  const idx = (a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? -1;
  const oficialFut = par.planoOficial.filter((a) => idx(a) >= e.c + 1);
  const primeiros = slots.filter((s) => hz.horizonte.primeiroAlteravel !== null && s.indice >= hz.horizonte.primeiroAlteravel).slice(0, 6);
  const dif = primeiros.map((s) => {
    const of = oficialFut.filter((a) => a.data === s.data && a.periodoId === s.periodoId);
    const so = hz.alteravel.filter((a) => a.data === s.data && a.periodoId === s.periodoId);
    const mapaOf = new Map(of.map((a) => [a.funcionarioId, a.maquinaId ?? ""]));
    return { periodo: periodoLabel(s), linhasDiferentes: so.filter((a) => (mapaOf.get(a.funcionarioId) ?? "") !== (a.maquinaId ?? "")).length, postos: so.filter((a) => a.maquinaId).length };
  });
  const prox = primeiros.map((s) => ({ periodo: periodoLabel(s), linhas: hz.alteravel.filter((a) => a.data === s.data && a.periodoId === s.periodoId).map((a) => [a.funcionarioId, a.maquinaId, a.produtoId, a.etapaId, Math.round(a.pecas)] as [string, string | null, string | null, string | null, number]) }));
  const hashOficial = hashAlocacoes(oficialFut);
  const hashSombra = hashAlocacoes(sombraFut);
  const conf = av.conflitos.length > 0, imp = av.impedimentos.length > 0;
  const inc: Record<string, number> = {};
  d.incertezas.forEach((i) => (inc[i.tipo] = (inc[i.tipo] ?? 0) + 1));
  Object.entries(p.extraIncertezas ?? {}).forEach(([k, v]) => { if (v > 0) inc[k] = (inc[k] ?? 0) + v; });
  const rest = d.restantePorPool;
  const boas: Record<string, number> = {};
  e.pools.forEach((pl) => { const k = `${pl.produtoId}|${pl.etapaId}`; boas[k] = Math.max(0, pl.quantidade - (rest[k] ?? 0)); });
  const alertas = [...(hz.resultado?.alertas ?? []), ...hz.alertas.filter((a) => !(hz.resultado?.alertas ?? []).includes(a))];
  const alertasResumo: AlertaSnapshot[] = alertas.map((a) => ({ tipo: a.tipo, data: a.data, periodoId: a.periodoId, produtoId: a.produtoId, etapaId: a.etapaId, quantidade: a.quantidade, pecas: a.pecas === undefined ? undefined : Math.round(a.pecas) }));
  const AVISOS: Record<string, string> = {
    apontamento_editado_apos_corte: "apontamento(s) editado(s) depois do corte: foi usada a versão atual da linha, que pode diferir do que existia no corte",
  };
  const avisos = Object.entries(inc).filter(([k]) => AVISOS[k]).map(([k, v]) => `${k}: ${v} — ${AVISOS[k]}`);
  return {
    versaoMotor: VERSAO_MOTOR_SOMBRA,
    identificacao: { semanaInicio: p.semanaInicio, data: slots[e.c].data, periodoId: slots[e.c].periodoId, slot: e.c, corteMs: e.corteMs },
    completude: p.completude,
    ...(p.planoOficialRef ? { planoOficialRef: p.planoOficialRef } : {}),
    horizonte: {
      congeladoAte: hz.horizonte.congeladoAte, atual: hz.horizonte.atual,
      comprometido: hz.horizonte.comprometido === null ? null : { slot: hz.horizonte.comprometido, data: slots[hz.horizonte.comprometido].data, periodoId: slots[hz.horizonte.comprometido].periodoId },
      primeiroAlteravel: hz.horizonte.primeiroAlteravel === null ? null : { slot: hz.horizonte.primeiroAlteravel, data: slots[hz.horizonte.primeiroAlteravel].data, periodoId: slots[hz.horizonte.primeiroAlteravel].periodoId },
    },
    compromisso: {
      statusOriginal: conf && imp ? "conflito_e_impossibilidade" : imp ? "impossibilidade_fisica_detectada" : conf ? "conflito_rotacao_comprometido" : "compromisso_valido",
      statusApos: av.status, statusErgonomico: av.statusErgonomico, statusFisico: av.statusFisico,
      hashOriginal: hz.snapshot.hashComprometido, hashReparado: hz.snapshot.hashComprometidoReparado,
      conflitos: av.conflitos.map((c) => ({ funcionarioId: c.funcionarioId, operacao: c.operacaoRepetida, posto: postoTxt(c.posto), exposicaoIncerta: c.exposicaoIncerta })),
      impedimentos: av.impedimentos.map((i) => ({ tipo: i.tipo, funcionarioId: i.funcionarioId, maquinaId: i.maquinaId, posto: postoTxt(i.posto) })),
      mudancas: { pessoas: av.trocas.length, maquinas: av.trocasMaquina.map((t) => ({ de: t.de, para: t.para })) },
      postosVazios: av.postosVazios.map((v) => ({ maquinaId: v.maquinaId, causa: v.causa })),
      contingencias: av.contingencias.map((c) => ({ ...c, nome: nome(c.maquinaId), postoAfetado: { ...c.postoAfetado, nome: nome(c.postoAfetado.maquinaId) }, contingencia_maquina_disponivel: true as const })),
    },
    entradas: {
      restantePorPool: rest, realizadoPorPool: boas, desempenho: Object.fromEntries(Object.entries(d.desempenho).map(([k, v]) => [k, { n: v.n, f: Math.round(v.f * 10000) / 10000 }])),
      equipe: e.funcionarios.length, ausencias: e.ausencias.length, indisponibilidades: e.indisponibilidades.length, wip: d.wip,
      parametros: { revezamento: "duro", replanejamento: "sombra", wipModo: e.wip ? "ativo" : "desligado", wipDiasLimite: e.parametrosWip?.wipDiasLimite ?? null, wipDiasLimitePorSemana: e.parametrosWip?.wipDiasLimitePorSemana ?? null },
    },
    planos: { hashOficial, hashSombra, diferencas: dif, proximosPeriodos: prox },
    diagnostico: {
      situacao: d.situacao, faltaOficial: Math.round(d.faltaOficial.total), faltaSombra: Math.round(d.faltaSombra.total), recuperado: Math.round(d.recuperacao.recuperado), gargalo: d.faltaSombra.gargalo ? { poolKey: d.faltaSombra.gargalo.poolKey, falta: Math.round(d.faltaSombra.gargalo.falta) } : null,
      cobertura: { oficial: Math.round(d.cobertura.oficial * 10) / 10, sombra: Math.round(d.cobertura.sombra * 10) / 10 }, postosVazios: d.postosVazios, incertezas: inc, alertas: alertasResumo, avisos, preenchimento: d.preenchimento, ...(p.restrito ? { restrito: p.restrito } : {}),
    },
    hashes: { entrada: hashCanonico(e), planoOficial: hashOficial, planoSombra: hashSombra, decisao: d.hashDecisao },
    entrada: e,
  };
}

// Refaz a decisão SÓ com a entrada canônica gravada e confere os hashes (mesma entrada => mesmo plano => mesmo hash).
export function reproduzirSnapshot(s: SnapshotSombra): { igual: boolean; hashes: SnapshotSombra["hashes"]; diferentes: string[] } {
  const d = executarCorteSombra(paraParametrosCorte(s.entrada));
  const sombra = hashAlocacoes([...d.horizonte.comprometidas, ...d.horizonte.alteravel]);
  const hashes = { entrada: hashCanonico(s.entrada), planoOficial: s.hashes.planoOficial, planoSombra: sombra, decisao: d.hashDecisao };
  const diferentes: string[] = (Object.keys(hashes) as (keyof typeof hashes)[]).filter((k) => hashes[k] !== s.hashes[k]);
  if (d.horizonte.snapshot.hashComprometido !== s.compromisso.hashOriginal) diferentes.push("comprometidoOriginal");
  if (d.horizonte.snapshot.hashComprometidoReparado !== s.compromisso.hashReparado) diferentes.push("comprometidoReparado");
  return { igual: diferentes.length === 0, hashes, diferentes };
}

