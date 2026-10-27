// Parâmetros da Escala Inteligente (fluxo) — leitura TIPADA e DEFENSIVA de escala_parametros (PURO, sem IO).
// O portão canônico é o do banco (constraints + escala_producao_real_modo_semana); aqui o código repete a regra (defesa em profundidade):
// valor desconhecido/ausente = desligado; semana anterior a 2026-10-26 nunca vale.

import type { ModoProducaoReal, ParEtapaComum, ParLegado } from "@/features/escala/fluxo/tipos";

export const CHAVE_PR_MODO = "producao_real_modo";
export const CHAVE_PR_SEMANAS = "producao_real_semanas_ativas";
export const CHAVE_PR_LIMIAR = "producao_real_limiar_estabilidade";
export const CHAVE_PR_PARES = "producao_real_pares_legado";
export const PRIMEIRA_SEMANA_FLUXO = "2026-10-26";

export interface ConfigFluxo {
  modo: ModoProducaoReal; // configurado
  semanasAtivas: string[]; // segundas-feiras ISO em que sombra/ativo VALEM
  limiar: number | null; // θ (peças finais); null = derivado pelo núcleo
  paresLegado: ParLegado[];
}

export const CONFIG_FLUXO_PADRAO: ConfigFluxo = { modo: "desligado", semanasAtivas: [], limiar: null, paresLegado: [] };

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

export function lerConfigFluxo(linhas: { chave: string; valor: unknown }[] | null | undefined): ConfigFluxo {
  const mapa = new Map((linhas ?? []).map((l) => [l.chave, l.valor]));
  const modo = mapa.get(CHAVE_PR_MODO);
  const limiar = mapa.get(CHAVE_PR_LIMIAR);
  return {
    modo: modo === "sombra" || modo === "ativo" ? modo : "desligado", // ausente/desconhecido = desligado
    semanasAtivas: lerSemanas(mapa.get(CHAVE_PR_SEMANAS)),
    limiar: typeof limiar === "number" && Number.isFinite(limiar) && limiar >= 0 ? limiar : null, // JSON null = derivado (Number(null) seria 0: não usar)
    paresLegado: lerParesLegado(mapa.get(CHAVE_PR_PARES)),
  };
}

/** Modo EFETIVO da semana: o configurado só vale se a semana está autorizada (mesma regra de escala_producao_real_modo_semana). */
export function modoEfetivoFluxo(cfg: ConfigFluxo, semanaInicio: string): ModoProducaoReal {
  if (cfg.modo === "desligado") return "desligado";
  return cfg.semanasAtivas.includes(semanaInicio) ? cfg.modo : "desligado";
}

/** Semanas em que o modo ATIVO do fluxo vale (para o interlock com o replanejamento restrito). */
export const semanasComFluxoAtivo = (cfg: ConfigFluxo): string[] => (cfg.modo === "ativo" ? cfg.semanasAtivas : []);
