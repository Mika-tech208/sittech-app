// Sittech Intelligence V1 — fábrica de provider (§2/§3 da instrução).
// Único ponto que decide QUAL provider/modelo usar — o resto do sistema
// só conhece a interface IntelligenceProvider e chama obterProvider()/
// obterModeloConfigurado(). Trocar de fornecedor no futuro significa
// implementar outro providers/<nome>.ts e mudar só esta função — nunca
// espalhar `if (fornecedor === "x")` pelo resto do código.

import { openaiProvider } from "@/features/intelligence/providers/openai";
import type { IntelligenceProvider } from "@/features/intelligence/providers/types";

const MODELO_DEFAULT = "gpt-5.6-terra";

export function obterProvider(): IntelligenceProvider {
  // Só OpenAI nesta V1 (§2/§3 da instrução) — a variável existe desde já
  // pra não fixar isso em nenhum outro lugar do código quando um segundo
  // provider for adicionado.
  return openaiProvider;
}

export function obterModeloConfigurado(): string {
  return process.env.SITTECH_INTELLIGENCE_MODEL || MODELO_DEFAULT;
}
