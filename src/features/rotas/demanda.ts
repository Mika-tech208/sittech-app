// NECESSIDADE por etapa dada uma divisão (leitura PURA; a divisão é ENTRADA — quem decide a divisão é o planejador do M2).
// Regra: trecho exclusivo de cada rota precisa só do que a rota entrega ao pool; o fluxo COMUM (Etiquetar, Embalar) tem UMA necessidade = Σ entregas (= demanda), nunca uma por rota.
import type { EstruturaProduto } from "./tipos";

export function necessidadePorEtapa(estrutura: EstruturaProduto, entregaPorRota: Record<string, number>): Record<string, number> {
  const necessidade: Record<string, number> = {};
  let total = 0;
  estrutura.rotas.forEach((r) => {
    const q = entregaPorRota[r.codigo] ?? 0;
    total += q;
    r.etapas.forEach((id) => { necessidade[id] = q; });
  });
  (estrutura.poolComum?.etapas ?? []).forEach((id) => { necessidade[id] = total; });
  return necessidade;
}
