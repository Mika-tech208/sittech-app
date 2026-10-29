// Parâmetros da Escala Inteligente (fluxo) — leitura TIPADA e DEFENSIVA de escala_parametros (PURO, sem IO).
// O portão canônico é o do banco (constraints + escala_producao_real_modo_semana); aqui o código repete a regra (defesa em profundidade):
// valor desconhecido/ausente = desligado; semana anterior a 2026-10-26 nunca vale.

import type { ContagemFisicaPar, DiagnosticoItem, ModoProducaoReal, ParEtapaComum, ParLegado } from "@/features/escala/fluxo/tipos";

export const CHAVE_PR_MODO = "producao_real_modo";
export const CHAVE_PR_SEMANAS = "producao_real_semanas_ativas";
export const CHAVE_PR_LIMIAR = "producao_real_limiar_estabilidade";
export const CHAVE_PR_PARES = "producao_real_pares_legado";
export const CHAVE_PR_CONTAGENS = "producao_real_contagens_fisicas";
export const CHAVE_PR_ATINGIBILIDADE = "producao_real_atingibilidade"; // "desligado" (padrão) | "ativo": preserva a atingibilidade das metas semanais (tier 1)
export const CHAVE_PR_ATINGIBILIDADE_MODO = "producao_real_atingibilidade_modo"; // "off" (padrão) | "sombra" | "ativo"; tem precedência sobre a chave legada acima
export const CHAVE_PR_OBJETIVO = "producao_real_objetivo_escala"; // "pecas" (padrão) | "financeiro"
export const CHAVE_PR_K = "producao_real_atingibilidade_k"; // k do limite econômico da atingibilidade (número > 0); ausente = padrão do núcleo (2)
export const CHAVE_PR_PESOS = "producao_real_pesos_comerciais"; // jsonb {produtoId: peso>0}; vazio por padrão (peso comercial manual)
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
  /** producao_real_atingibilidade = "ativo": o núcleo preserva a atingibilidade das metas semanais antes de maximizar peças (default false; chave ausente/desconhecida = false). */
  atingibilidade: boolean;
  /** off | sombra (mede e reporta, não altera o plano) | ativo. Derivado de producao_real_atingibilidade_modo; se ausente, da chave legada ("ativo" ⇒ ativo). `atingibilidade` = (modo === ativo). */
  atingibilidadeModo: "off" | "sombra" | "ativo";
  objetivo: "pecas" | "financeiro";
  pesosComerciais: Record<string, number>;
  /** producao_real_atingibilidade_k (> 0) ou null = padrão do núcleo. */
  atingibilidadeK: number | null;
}

export const CONFIG_FLUXO_PADRAO: ConfigFluxo = { modo: "desligado", semanasAtivas: [], limiar: null, paresLegado: [], contagensFisicas: [], contagensFisicasDescartadas: [], atingibilidade: false, atingibilidadeModo: "off", objetivo: "pecas", pesosComerciais: {}, atingibilidadeK: null };

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

/** Pesos comerciais manuais por produto: só números finitos > 0; qualquer outra coisa é descartada (nunca inventa valores). */
export function lerPesos(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  Object.entries(v as Record<string, unknown>).forEach(([k, x]) => { if (typeof x === "number" && Number.isFinite(x) && x > 0) out[k] = x; });
  return out;
}

export function lerConfigFluxo(linhas: { chave: string; valor: unknown }[] | null | undefined): ConfigFluxo {
  const mapa = new Map((linhas ?? []).map((l) => [l.chave, l.valor]));
  const modo = mapa.get(CHAVE_PR_MODO);
  const limiar = mapa.get(CHAVE_PR_LIMIAR);
  const contagens = lerContagensFisicas(mapa.get(CHAVE_PR_CONTAGENS));
  const m = mapa.get(CHAVE_PR_ATINGIBILIDADE_MODO);
  const atingModo: "off" | "sombra" | "ativo" = m === "ativo" || m === "sombra" ? m : m === "off" ? "off" : mapa.get(CHAVE_PR_ATINGIBILIDADE) === "ativo" ? "ativo" : "off";
  return {
    modo: modo === "sombra" || modo === "ativo" ? modo : "desligado", // ausente/desconhecido = desligado
    semanasAtivas: lerSemanas(mapa.get(CHAVE_PR_SEMANAS)),
    limiar: typeof limiar === "number" && Number.isFinite(limiar) && limiar >= 0 ? limiar : null, // JSON null = derivado (Number(null) seria 0: não usar)
    paresLegado: lerParesLegado(mapa.get(CHAVE_PR_PARES)),
    contagensFisicas: contagens.itens,
    contagensFisicasDescartadas: contagens.descartes,
    atingibilidade: atingModo === "ativo",
    atingibilidadeModo: atingModo,
    objetivo: mapa.get(CHAVE_PR_OBJETIVO) === "financeiro" ? "financeiro" : "pecas",
    pesosComerciais: lerPesos(mapa.get(CHAVE_PR_PESOS)),
    atingibilidadeK: (() => { const k = mapa.get(CHAVE_PR_K); return typeof k === "number" && Number.isFinite(k) && k > 0 ? k : null; })(),
  };
}

/** Modo EFETIVO da semana: o configurado só vale se a semana está autorizada (mesma regra de escala_producao_real_modo_semana). */
export function modoEfetivoFluxo(cfg: ConfigFluxo, semanaInicio: string): ModoProducaoReal {
  if (cfg.modo === "desligado") return "desligado";
  return cfg.semanasAtivas.includes(semanaInicio) ? cfg.modo : "desligado";
}

/** Semanas em que o modo ATIVO do fluxo vale (para o interlock com o replanejamento restrito). */
export const semanasComFluxoAtivo = (cfg: ConfigFluxo): string[] => (cfg.modo === "ativo" ? cfg.semanasAtivas : []);
