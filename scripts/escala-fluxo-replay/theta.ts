// Varredura de θ (limiar de estabilidade, spec §4): para cada fechamento, roda o fluxo com θ ∈ grade e mede churn × falta.
import { fechamentos, mediana, percentil, rodar } from "./comum";

export const GRADE_THETA: (number | "padrao")[] = [0, 0.01, 100, 1000, 5000, "padrao"];

export function varrerTheta(offset = 2) {
  const linhas: { theta: number | "padrao"; thetaUsado: number[]; faltaLo: number; faltaHi: number; linhas: number[]; trocas: number[]; primeiroPeriodo: number[]; escolha: Record<string, number> }[] = [];
  for (const th of GRADE_THETA) {
    const L: number[] = [], T: number[] = [], P: number[] = [], th2: number[] = []; let fLo = 0, fHi = 0; const esc: Record<string, number> = {};
    for (const d of fechamentos) {
      const r = rodar(d, { offset }, th === "padrao" ? {} : { limiarEstabilidadePecas: th });
      L.push(r.res.diagnostico.churn.linhasAlteradas); T.push(r.res.diagnostico.churn.trocasDePosto); P.push(r.res.diagnostico.churn.alteradasNoPrimeiroPeriodo);
      th2.push(r.res.diagnostico.theta);
      fLo += r.avFluxo.totais.faltaFinalLo; fHi += r.avFluxo.totais.faltaFinalHi;
      esc[r.res.diagnostico.planoEscolhido] = (esc[r.res.diagnostico.planoEscolhido] ?? 0) + 1;
    }
    linhas.push({ theta: th, thetaUsado: th2, faltaLo: Math.round(fLo), faltaHi: Math.round(fHi), linhas: L, trocas: T, primeiroPeriodo: P, escolha: esc });
  }
  return linhas.map((x) => ({ ...x, medianaLinhas: mediana(x.linhas), p90Linhas: percentil(x.linhas, 0.9), medianaTrocas: mediana(x.trocas), p90Trocas: percentil(x.trocas, 0.9), medianaPrimeiro: mediana(x.primeiroPeriodo), p90Primeiro: percentil(x.primeiroPeriodo, 0.9) }));
}
