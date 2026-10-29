// VALOR FUTURO (PURO): comparação LEXICOGRÁFICA de planos (nunca valor_atual + valor_futuro com pesos) e estatística ROBUSTA do posto (para classificar confiança).
// Ordem: 1º valor da semana ATUAL; 2º, entre planos com resultado atual indistinguível (dentro do limiar de materialidade do melhor), valor FUTURO; depois menor WIP inútil,
// menor churn, maior estabilidade (menos postos alterados) e, por fim, equilíbrio (menor desvio) e id. Antecipação só entra depois que o recurso não tem alternativa atual materialmente melhor.
export interface PlanoMedido {
  id: string;
  valorAtual: number;
  valorFuturo: number;
  wipInutil: number;
  churn: number;
  postosAlterados?: number;
  desvioEquilibrio?: number;
}

/** < 0 ⇒ `a` preferido, dado o limiar (materialidade do ATUAL) e o limiar do futuro. Pareamento direto; para escolher o melhor use `melhorPlano` (usa o melhor atual como âncora). */
export function melhorPlano(planos: PlanoMedido[], limiarAtual: number, limiarFuturo = 0): PlanoMedido | null {
  if (planos.length === 0) return null;
  const maxAtual = Math.max(...planos.map((p) => p.valorAtual));
  const candidatos = planos.filter((p) => p.valorAtual >= maxAtual - limiarAtual); // atual indistinguível do melhor
  const maxFut = Math.max(...candidatos.map((p) => p.valorFuturo));
  const porFuturo = candidatos.filter((p) => p.valorFuturo >= maxFut - limiarFuturo);
  return [...porFuturo].sort((a, b) =>
    a.wipInutil - b.wipInutil || a.churn - b.churn || (a.postosAlterados ?? 0) - (b.postosAlterados ?? 0) || (a.desvioEquilibrio ?? 0) - (b.desvioEquilibrio ?? 0) || b.valorAtual - a.valorAtual || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

// ------------------------------------------------------------------------------------------------ estatística robusta do POSTO (nunca por pessoa)
export interface EstatisticaPosto {
  n: number; mediana: number; mediaRobusta: number; dispersaoMAD: number; ic95: [number, number]; amplitudeRelativa: number;
  confianca: "BAIXA_CONFIANCA_PRODUTIVIDADE" | "OK";
  metodo: string;
}
const mediana = (v: number[]) => { const o = [...v].sort((a, b) => a - b); const n = o.length; return n === 0 ? NaN : n % 2 ? o[(n - 1) / 2] : (o[n / 2 - 1] + o[n / 2]) / 2; };
/** PRNG determinístico (LCG) — o relatório é reproduzível. */
function lcg(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; }; }
/** Média aparada (10% em cada ponta). */
export const mediaAparada = (v: number[], p = 0.1) => { const o = [...v].sort((a, b) => a - b); const k = Math.floor(o.length * p); const m = o.slice(k, o.length - k); return m.length ? m.reduce((s, x) => s + x, 0) / m.length : NaN; };

/** Razões boas÷meta observadas do posto → n, mediana, média aparada, MAD×1,4826, IC 95% por bootstrap percentil (2000 reamostras, semente fixa) da média aparada.
 *  BAIXA_CONFIANCA_PRODUTIVIDADE se n < `nMin` (20) ou amplitude relativa do IC (largura ÷ mediana) > `amplMax` (0,15). */
export function estatisticaPosto(razoes: number[], nMin = 20, amplMax = 0.15, reamostras = 2000, semente = 20261029): EstatisticaPosto {
  const x = razoes.filter((r) => Number.isFinite(r));
  const n = x.length;
  const med = mediana(x);
  const mad = n ? 1.4826 * mediana(x.map((r) => Math.abs(r - med))) : NaN;
  const rnd = lcg(semente);
  const boots: number[] = [];
  for (let b = 0; b < reamostras && n > 0; b++) boots.push(mediaAparada(Array.from({ length: n }, () => x[Math.floor(rnd() * n)])));
  boots.sort((a, c) => a - c);
  const q = (p: number) => (boots.length ? boots[Math.min(boots.length - 1, Math.max(0, Math.floor(p * boots.length)))] : NaN);
  const ic: [number, number] = [q(0.025), q(0.975)];
  const ampl = n && med ? (ic[1] - ic[0]) / med : Number.POSITIVE_INFINITY;
  return { n, mediana: med, mediaRobusta: mediaAparada(x), dispersaoMAD: mad, ic95: ic, amplitudeRelativa: ampl, confianca: n < nMin || ampl > amplMax ? "BAIXA_CONFIANCA_PRODUTIVIDADE" : "OK", metodo: `bootstrap percentil 95% (${reamostras} reamostras, semente ${semente}) da média aparada 10%; baixa confiança se n<${nMin} ou largura do IC/mediana>${amplMax}` };
}
