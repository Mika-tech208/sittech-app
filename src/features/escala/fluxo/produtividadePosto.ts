// PRODUTIVIDADE DO POSTO (produto × operação × máquina) — NUNCA por pessoa. PURO, DESLIGADO (só o forecast de buffer/replays usam).
// Estima a razão real/meta de um posto no futuro a partir do histórico de apontamentos (janela curta, parâmetro). Meta = fallback quando há poucas amostras.
// Atenção ao viés: a janela e o mínimo de amostras são PARÂMETROS; a auditoria de 30/10 mostrou que janela de 7–14 dias foi ~5% melhor que a meta, mas essa janela
// foi escolhida olhando o teste (otimista). O resultado traz n e confiança para quem consome.
import type { ApontamentoReal } from "../producaoReal";
import type { FonteTaxa } from "./forecastBuffer";

export interface TaxaPosto {
  /** razão real/meta prevista (1 = meta) */
  razao: number;
  n: number;
  fonte: FonteTaxa;
  /** quantil baixo da razão (p20) na janela — margem de conservadorismo medida */
  p20: number;
  confianca: "alta" | "media" | "baixa";
}
export interface ConsultaPosto {
  produtoId: string;
  operacaoId: string;
  maquinaId: string;
}
export type EstimadorTaxa = (q: ConsultaPosto) => TaxaPosto;

export interface OpcoesEstimador {
  janelaDias: number; // 7–14 sugerido; parâmetro
  nMin: number; // amostras mínimas p/ sair do fallback (meta)
  nAlta?: number; // amostras p/ confiança alta (default 3 × nMin)
  estimador?: "mediana" | "media"; // default mediana
}

const MS_DIA = 86_400_000;
const quantil = (v: number[], q: number) => {
  const s = [...v].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

export const chavePosto = (q: ConsultaPosto) => `${q.produtoId}|${q.operacaoId}|${q.maquinaId}`;

/** Só linhas "produzindo" com meta > 0, lançadas até `agoraMs` e dentro da janela. Nada de funcionarioId. */
export function criarEstimadorPosto(apontamentos: ApontamentoReal[], agoraMs: number, op: OpcoesEstimador): EstimadorTaxa {
  const desde = agoraMs - op.janelaDias * MS_DIA;
  const grupos = new Map<string, number[]>();
  apontamentos.forEach((a) => {
    if (a.status !== "produzindo" || !(a.meta > 0) || !a.produtoId || !a.operacaoId || !a.maquinaId) return;
    if (a.lancadoEmMs > agoraMs || a.lancadoEmMs < desde) return;
    const k = chavePosto({ produtoId: a.produtoId, operacaoId: a.operacaoId, maquinaId: a.maquinaId });
    if (!grupos.has(k)) grupos.set(k, []);
    (grupos.get(k) as number[]).push(a.boas / a.meta);
  });
  const nAlta = op.nAlta ?? op.nMin * 3;
  return (q) => {
    const v = grupos.get(chavePosto(q)) ?? [];
    if (v.length < op.nMin) return { razao: 1, n: v.length, fonte: "meta", p20: 1, confianca: "baixa" };
    const razao = (op.estimador ?? "mediana") === "media" ? v.reduce((s, x) => s + x, 0) / v.length : quantil(v, 0.5);
    return { razao, n: v.length, fonte: "historico", p20: quantil(v, 0.2), confianca: v.length >= nAlta ? "alta" : "media" };
  };
}

/** Fator de reposição conservador (0,1]: p20 ÷ mediana da razão em todos os postos com amostra suficiente (medido; nunca > 1). */
export function fatorReposicaoMedido(estimador: EstimadorTaxa, postos: ConsultaPosto[]): { fator: number; postosUsados: number } {
  const rs = postos.map((p) => estimador(p)).filter((t) => t.fonte === "historico");
  if (rs.length === 0) return { fator: 1, postosUsados: 0 };
  const med = quantil(rs.map((t) => t.razao), 0.5);
  const p20 = quantil(rs.map((t) => t.p20), 0.5);
  return { fator: med > 0 ? Math.max(0.01, Math.min(1, p20 / med)) : 1, postosUsados: rs.length };
}
