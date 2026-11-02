// Parâmetros da Escala Inteligente (fluxo) — leitura TIPADA e DEFENSIVA de escala_parametros (PURO, sem IO).
// O portão canônico é o do banco (constraints + escala_producao_real_modo_semana); aqui o código repete a regra (defesa em profundidade):
// valor desconhecido/ausente = desligado; semana anterior a 2026-10-26 nunca vale.

import type { ConfigPlanejadorCorte } from "@/features/escala/fluxo/planoCorte";
import type { ContagemFisicaPar, DiagnosticoItem, ModoProducaoReal, ParEtapaComum, ParLegado } from "@/features/escala/fluxo/tipos";

export const CHAVE_PR_MODO = "producao_real_modo";
export const CHAVE_PR_SEMANAS = "producao_real_semanas_ativas";
export const CHAVE_PR_LIMIAR = "producao_real_limiar_estabilidade";
export const CHAVE_PR_PARES = "producao_real_pares_legado";
export const CHAVE_PR_CONTAGENS = "producao_real_contagens_fisicas";
export const CHAVE_PR_MESMO_PERIODO = "producao_real_fluxo_mesmo_periodo";
export const CHAVE_PR_CADEIA_DIAGNOSTICO = "producao_real_cadeia_diagnostico";
export const CHAVE_PR_PLANEJADOR_SEMANAS = "producao_real_planejador_semanas";
export const CHAVE_PR_PLANEJADOR_CONFIG = "producao_real_planejador_config";
export const PRIMEIRA_SEMANA_FLUXO = "2026-10-26";

export interface ConfigFluxo {
  modo: ModoProducaoReal; // configurado
  semanasAtivas: string[]; // segundas-feiras ISO em que sombra/ativo VALEM
  limiar: number | null; // θ (peças finais); null = derivado pelo núcleo
  paresLegado: ParLegado[];
  /** producao_real_contagens_fisicas (jsonb array; chave ausente/[] = nenhuma). Só itens VÁLIDOS em forma; o núcleo revalida (par, futuro, duplicadas). */
  contagensFisicas: ContagemFisicaPar[];
  /** Itens malformados da chave: ignorados, com diagnóstico (nunca derrubam o recálculo). */
  contagensFisicasDescartadas: DiagnosticoItem[];
  /** producao_real_fluxo_mesmo_periodo (boolean; padrão true = comportamento atual). false = REGRA CONSERVADORA: o downstream de um período só usa o estoque que existia no INÍCIO dele
   *  (a produção da etapa anterior no próprio período só alimenta o downstream no período seguinte), porque o tempo físico de transferência entre operações ainda não é modelado. */
  mesmoPeriodo?: boolean; // ausente = true
  /** Camadas do planejamento de cadeia (fluxo/cadeia.ts), cada uma ligada SÓ pelo JSON "ativo" na sua chave (producao_real_cadeia_diagnostico…); ausente/outro valor = desligada (chave omitida). */
  cadeia?: { diagnostico?: true };
  /** PLANEJADOR DE CORTE (ativação 02/11): semanas (dentro de semanasAtivas, com modo "ativo") cujo recálculo usa o planejador de corte em vez do fluxo/motor legado, e a sua configuração
   *  (objetivo, margens congeladas, piso, orçamento de busca). Ausente/[] = nenhuma semana (comportamento anterior, byte-idêntico). */
  planejador?: { semanas: string[]; config: ConfigPlanejadorCorte };
}

export const CONFIG_FLUXO_PADRAO: ConfigFluxo = { modo: "desligado", semanasAtivas: [], limiar: null, paresLegado: [], contagensFisicas: [], contagensFisicasDescartadas: [] };

const ehTexto = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function lerSemanas(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && x >= PRIMEIRA_SEMANA_FLUXO))].sort();
}

/** Valida/normaliza o jsonb de pares. Par malformado é DESCARTADO (o produto fica em comportamento legado, nunca exceção). */
export function lerParesLegado(v: unknown): ParLegado[] {
  if (!Array.isArray(v)) return [];
  const pares: ParLegado[] = [];
  v.forEach((p, i) => {
    if (!p || typeof p !== "object") return;
    const o = p as Record<string, unknown>;
    if (!ehTexto(o.produtoConvencionalId) || !ehTexto(o.produtoAutomaticaId) || !Array.isArray(o.etapasComuns)) return;
    const etapasComuns: ParEtapaComum[] = [];
    for (const e of o.etapasComuns) {
      const x = (e ?? {}) as Record<string, unknown>;
      if (ehTexto(x.etapaConvencionalId) && ehTexto(x.etapaAutomaticaId)) etapasComuns.push({ rotulo: ehTexto(x.rotulo) ? x.rotulo : "etapa", etapaConvencionalId: x.etapaConvencionalId, etapaAutomaticaId: x.etapaAutomaticaId });
    }
    if (etapasComuns.length === 0) return;
    pares.push({
      id: ehTexto(o.id) ? o.id : `par-${i}`,
      produtoConvencionalId: o.produtoConvencionalId,
      produtoAutomaticaId: o.produtoAutomaticaId,
      etapasComuns,
      ...(typeof o.toleranciaMeta === "number" && Number.isFinite(o.toleranciaMeta) && o.toleranciaMeta >= 0 ? { toleranciaMeta: o.toleranciaMeta } : {}),
    });
  });
  return pares;
}

/**
 * Lê `producao_real_contagens_fisicas`: [{ produtoId, etapaOrigemId, etapaSeguinteId, saldo (≥ 0), contadoEm (ISO COM fuso), informadoPor?, observacao? }].
 * Ausente/null/[] = nenhuma. Item malformado é DESCARTADO com diagnóstico `CONTAGEM_FISICA_IGNORADA`; nunca lança.
 */
export function lerContagensFisicas(v: unknown): { itens: ContagemFisicaPar[]; descartes: DiagnosticoItem[] } {
  const itens: ContagemFisicaPar[] = [];
  const descartes: DiagnosticoItem[] = [];
  if (v === undefined || v === null) return { itens, descartes };
  const descarta = (i: number, motivo: string, o?: Record<string, unknown>) =>
    descartes.push({
      codigo: "CONTAGEM_FISICA_IGNORADA", severidade: "aviso", ...(o && ehTexto(o.produtoId) ? { produtoId: o.produtoId } : {}), ...(o && ehTexto(o.etapaOrigemId) ? { etapaId: o.etapaOrigemId } : {}),
      mensagem: `Contagem física #${i + 1} ignorada: ${motivo}`, detalhes: { indice: i, motivo },
    });
  if (!Array.isArray(v)) {
    descarta(0, "o valor de producao_real_contagens_fisicas deve ser um array JSON");
    return { itens, descartes };
  }
  v.forEach((x, i) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return descarta(i, "item não é um objeto");
    const o = x as Record<string, unknown>;
    if (!ehTexto(o.produtoId) || !ehTexto(o.etapaOrigemId) || !ehTexto(o.etapaSeguinteId)) return descarta(i, "produtoId/etapaOrigemId/etapaSeguinteId ausentes", o);
    const saldo = typeof o.saldo === "number" ? o.saldo : typeof o.saldo === "string" && o.saldo.trim() !== "" ? Number(o.saldo) : Number.NaN;
    if (!Number.isFinite(saldo) || saldo < 0) return descarta(i, "saldo deve ser um número ≥ 0", o);
    if (typeof o.contadoEm !== "string" || !/(Z|[+-]\d{2}:?\d{2})$/i.test(o.contadoEm.trim())) return descarta(i, "contadoEm deve ser ISO COM fuso (ex.: 2026-10-28T06:30:00-03:00)", o);
    const ms = Date.parse(o.contadoEm.trim());
    if (!Number.isFinite(ms)) return descarta(i, "contadoEm não é uma data válida", o);
    itens.push({
      produtoId: o.produtoId, etapaOrigemId: o.etapaOrigemId, etapaSeguinteId: o.etapaSeguinteId, saldo, contadoEmMs: ms,
      ...(typeof o.informadoPor === "string" && o.informadoPor ? { informadoPor: o.informadoPor.slice(0, 120) } : {}),
      ...(typeof o.observacao === "string" && o.observacao ? { observacao: o.observacao.slice(0, 300) } : {}),
    });
  });
  return { itens, descartes };
}

const numOu = (v: unknown, min: number, max: number): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined);

/** Lê `producao_real_planejador_config` (jsonb objeto). Campo inválido é IGNORADO (nunca lança). Margens: só números finitos. */
export function lerConfigPlanejador(v: unknown): ConfigPlanejadorCorte {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const cfg: ConfigPlanejadorCorte = {};
  if (o.objetivo === "EQUILIBRIO" || o.objetivo === "MAX_PECAS_FINAIS" || o.objetivo === "MAX_RESULTADO_ECONOMICO") cfg.objetivo = o.objetivo;
  if (o.margemPorPeca && typeof o.margemPorPeca === "object" && !Array.isArray(o.margemPorPeca)) {
    const m: Record<string, number> = {};
    Object.entries(o.margemPorPeca as Record<string, unknown>).forEach(([k, x]) => { if (typeof x === "number" && Number.isFinite(x)) m[k] = x; });
    if (Object.keys(m).length > 0) cfg.margemPorPeca = m;
  }
  const cob = numOu(o.coberturaMinima, 0, 1);
  if (cob !== undefined) cfg.coberturaMinima = cob;
  if (Array.isArray(o.prioridade) && o.prioridade.every((x) => typeof x === "string")) cfg.prioridade = o.prioridade as string[];
  const busca = (b: unknown) => {
    if (!b || typeof b !== "object") return undefined;
    const x = b as Record<string, unknown>;
    const r = { ...(numOu(x.iter, 1000, 2_000_000) !== undefined ? { iter: x.iter as number } : {}), ...(numOu(x.reinicios, 1, 6) !== undefined ? { reinicios: x.reinicios as number } : {}), ...(numOu(x.semente, 0, 1_000_000) !== undefined ? { semente: x.semente as number } : {}) };
    return Object.keys(r).length > 0 ? r : undefined;
  };
  const b1 = busca(o.busca), b2 = busca(o.buscaComVigente);
  if (b1) cfg.busca = b1;
  if (b2) cfg.buscaComVigente = b2;
  return cfg;
}

export function lerConfigFluxo(linhas: { chave: string; valor: unknown }[] | null | undefined): ConfigFluxo {
  const mapa = new Map((linhas ?? []).map((l) => [l.chave, l.valor]));
  const modo = mapa.get(CHAVE_PR_MODO);
  const limiar = mapa.get(CHAVE_PR_LIMIAR);
  const contagens = lerContagensFisicas(mapa.get(CHAVE_PR_CONTAGENS));
  return {
    modo: modo === "sombra" || modo === "ativo" ? modo : "desligado", // ausente/desconhecido = desligado
    semanasAtivas: lerSemanas(mapa.get(CHAVE_PR_SEMANAS)),
    limiar: typeof limiar === "number" && Number.isFinite(limiar) && limiar >= 0 ? limiar : null, // JSON null = derivado (Number(null) seria 0: não usar)
    paresLegado: lerParesLegado(mapa.get(CHAVE_PR_PARES)),
    contagensFisicas: contagens.itens,
    contagensFisicasDescartadas: contagens.descartes,
    ...(mapa.get(CHAVE_PR_MESMO_PERIODO) === false ? { mesmoPeriodo: false } : {}), // só o JSON `false` liga a regra conservadora; ausente/outro valor = padrão (chave omitida)
    ...(mapa.get(CHAVE_PR_CADEIA_DIAGNOSTICO) === "ativo" ? { cadeia: { diagnostico: true as const } } : {}),
    ...(lerSemanas(mapa.get(CHAVE_PR_PLANEJADOR_SEMANAS)).length > 0 ? { planejador: { semanas: lerSemanas(mapa.get(CHAVE_PR_PLANEJADOR_SEMANAS)), config: lerConfigPlanejador(mapa.get(CHAVE_PR_PLANEJADOR_CONFIG)) } } : {}),
  };
}

/** Modo EFETIVO da semana: o configurado só vale se a semana está autorizada (mesma regra de escala_producao_real_modo_semana). */
export function modoEfetivoFluxo(cfg: ConfigFluxo, semanaInicio: string): ModoProducaoReal {
  if (cfg.modo === "desligado") return "desligado";
  return cfg.semanasAtivas.includes(semanaInicio) ? cfg.modo : "desligado";
}

/** A semana usa o PLANEJADOR DE CORTE? Exige o modo efetivo "ativo" da semana (producao_real_modo + semanas_ativas) E a semana em producao_real_planejador_semanas. */
export const planejadorCorteNaSemana = (cfg: ConfigFluxo, semanaInicio: string): boolean => modoEfetivoFluxo(cfg, semanaInicio) === "ativo" && (cfg.planejador?.semanas ?? []).includes(semanaInicio);

/** Semanas em que o modo ATIVO do fluxo vale (para o interlock com o replanejamento restrito). */
export const semanasComFluxoAtivo = (cfg: ConfigFluxo): string[] => (cfg.modo === "ativo" ? cfg.semanasAtivas : []);
