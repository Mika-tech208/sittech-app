// Parâmetros da ANTECIPAÇÃO PARA A SEMANA SEGUINTE e da FORMAÇÃO DE ESTOQUE (escala_parametros) — leitura TIPADA e DEFENSIVA (PURO, sem IO).
//   escala_antecipacao_modo                    'desligado' (padrão; chave ausente/valor desconhecido = desligado) | 'ativo'
//   escala_formacao_estoque_produtos           POLÍTICA POR PRODUTO: lista de produto_id (string) ou {produtoId, limiteFisicoPecas?, bufferExtraPecas?} (legado: tetoPecas = limiteFisicoPecas). Ausente/[] = nenhum produto forma estoque.
//   escala_formacao_estoque_desconta_destino   boolean (padrão false): o estoque FORMADO também desconta a quantidade da semana de destino? Padrão não (visível, não silencioso).
//   escala_antecipacao_semana_seguinte         'desligado' (padrão) | 'ativo': OPT-IN da ANTECIPAÇÃO da meta da semana seguinte (com desconto). Sem ele, só há FORMAÇÃO de estoque por política.
// A quantidade da Previsão é META MÍNIMA de produção (não teto). As chaves NUNCA disparam recálculo (escala_trg_parametros); valem a partir do próximo recálculo natural da semana.
import type { DadosAntecipacao } from "@/features/escala/types";

export const CHAVE_ANTECIPACAO_MODO = "escala_antecipacao_modo";
export const CHAVE_FORMACAO_PRODUTOS = "escala_formacao_estoque_produtos";
export const CHAVE_FORMACAO_DESCONTA = "escala_formacao_estoque_desconta_destino";
export const CHAVE_ANTECIPACAO_SEMANA_SEGUINTE = "escala_antecipacao_semana_seguinte";

export interface ConfigAntecipacao {
  modo: "desligado" | "ativo";
  politicas: DadosAntecipacao["politicasFormacao"];
  descontaFormacao: boolean;
  /** opt-in da antecipação da meta da semana seguinte */
  antecipacaoSolicitada: boolean;
}

const ehId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{8,}$/i.test(v);

/** Aceita ids puros ou objetos {produtoId, limiteFisicoPecas}; item inválido é IGNORADO (nunca lança, nunca vira política por engano). Duplicata: vale o 1º. */
export function lerPoliticasFormacao(v: unknown): DadosAntecipacao["politicasFormacao"] {
  if (!Array.isArray(v)) return [];
  const out: DadosAntecipacao["politicasFormacao"] = [];
  const vistos = new Set<string>();
  for (const x of v) {
    let pid: string | null = null, teto: number | undefined, buf: number | undefined;
    if (ehId(x)) pid = x;
    else if (x && typeof x === "object" && ehId((x as Record<string, unknown>).produtoId)) {
      const o = x as Record<string, unknown>;
      pid = o.produtoId as string;
      const lim = o.limiteFisicoPecas ?? o.tetoPecas; // tetoPecas = nome antigo (compatibilidade)
      if (typeof lim === "number" && Number.isFinite(lim) && lim >= 0) teto = lim;
      if (typeof o.bufferExtraPecas === "number" && Number.isFinite(o.bufferExtraPecas) && o.bufferExtraPecas > 0) buf = o.bufferExtraPecas;
    }
    if (!pid || vistos.has(pid)) continue;
    vistos.add(pid);
    out.push({ produtoId: pid, ...(teto !== undefined ? { limiteFisicoPecas: teto } : {}), ...(buf !== undefined ? { bufferExtraPecas: buf } : {}) });
  }
  return out.sort((a, b) => (a.produtoId < b.produtoId ? -1 : 1));
}

export function lerConfigAntecipacao(linhas: { chave: string; valor: unknown }[] | null | undefined): ConfigAntecipacao {
  const mapa = new Map((linhas ?? []).map((l) => [l.chave, l.valor]));
  return {
    modo: mapa.get(CHAVE_ANTECIPACAO_MODO) === "ativo" ? "ativo" : "desligado",
    politicas: lerPoliticasFormacao(mapa.get(CHAVE_FORMACAO_PRODUTOS)),
    descontaFormacao: mapa.get(CHAVE_FORMACAO_DESCONTA) === true,
    antecipacaoSolicitada: mapa.get(CHAVE_ANTECIPACAO_SEMANA_SEGUINTE) === "ativo",
  };
}
