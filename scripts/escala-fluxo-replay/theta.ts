// Varredura de θ (limiar de estabilidade, spec §4) × estabilização de pessoas: para cada fechamento roda o fluxo e mede churn × falta.
// v2: o padrão do núcleo é θ = 0 + estabilização (linha "0 + estab"); as demais linhas mostram o que θ > 0 acrescenta (ou não) a isso.
import { fechamentos, mediana, percentil, rodar } from "./comum";

export const GRADE_THETA: { rotulo: string; theta: number; estab: boolean }[] = [
  { rotulo: "0, sem estabilização (v1 sem derivado)", theta: 0, estab: false },
  { rotulo: "0 + estabilização (PADRÃO v2)", theta: 0, estab: true },
  { rotulo: "100 + estabilização", theta: 100, estab: true },
  { rotulo: "1000 + estabilização", theta: 1000, estab: true },
  { rotulo: "5000 + estabilização", theta: 5000, estab: true },
  { rotulo: "1000, sem estabilização", theta: 1000, estab: false },
];

export function varrerTheta(offset = 2) {
  const linhas: { rotulo: string; theta: number; estab: boolean; faltaLo: number; faltaHi: number; linhas: number[]; trocas: number[]; primeiroPeriodo: number[]; escolha: Record<string, number> }[] = [];
  for (const g of GRADE_THETA) {
    const L: number[] = [], T: number[] = [], P: number[] = []; let fLo = 0, fHi = 0; const esc: Record<string, number> = {};
    for (const d of fechamentos) {
      const r = rodar(d, { offset }, { limiarEstabilidadePecas: g.theta, estabilizarPessoas: g.estab });
      L.push(r.res.diagnostico.churn.linhasAlteradas); T.push(r.res.diagnostico.churn.trocasDePosto); P.push(r.res.diagnostico.churn.alteradasNoPrimeiroPeriodo);
      fLo += r.avFluxo.totais.faltaFinalLo; fHi += r.avFluxo.totais.faltaFinalHi;
      esc[r.res.diagnostico.planoEscolhido] = (esc[r.res.diagnostico.planoEscolhido] ?? 0) + 1;
    }
    linhas.push({ ...g, faltaLo: Math.round(fLo), faltaHi: Math.round(fHi), linhas: L, trocas: T, primeiroPeriodo: P, escolha: esc });
  }
  return linhas.map((x) => ({ ...x, medianaLinhas: mediana(x.linhas), p90Linhas: percentil(x.linhas, 0.9), medianaTrocas: mediana(x.trocas), p90Trocas: percentil(x.trocas, 0.9), medianaPrimeiro: mediana(x.primeiroPeriodo), p90Primeiro: percentil(x.primeiroPeriodo, 0.9) }));
}
