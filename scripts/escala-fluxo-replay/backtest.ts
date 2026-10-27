// Backtest do simulador: o WIP que a trajetória do plano VIGENTE no fechamento i previa para o slot c_j (j > i) × o WIP que o estado real estimou no fechamento j.
// Se o simulador (capacidade = meta × f, fluxo entre etapas) descreve a fábrica, a previsão cai dentro (ou perto) da faixa [lo, hi] observada.
import type { ResumoRodada } from "./resumo";
import type { ExtrasRodada } from "./extras";

type R = ResumoRodada & { extras: ExtrasRodada; obsoleta?: boolean };

export function backtestWip(resumos: R[]) {
  const base = resumos.filter((r) => r.rev === 0).sort((a, b) => a.c - b.c);
  const linhas: { de: string; para: string; chave: string; previsto: [number, number]; observado: [number, number]; erro: number; dentro: boolean }[] = [];
  for (const i of base) for (const j of base) {
    if (j.c <= i.c) continue;
    for (const par of j.pares) {
      const chave = `${par.produtoId}|${par.origem}`;
      const tr = i.extras.trajVigente[chave];
      const p = tr?.find((x) => x[0] === j.c);
      if (!p) continue;
      const obs: [number, number] = [par.lo, par.hi];
      const erro = p[1] > obs[1] ? p[1] - obs[1] : p[2] < obs[0] ? obs[0] - p[2] : 0; // distância do intervalo previsto ao observado
      linhas.push({ de: `${i.data.slice(5)} ${i.periodoId}`, para: `${j.data.slice(5)} ${j.periodoId}`, chave, previsto: [p[1], p[2]], observado: obs, erro, dentro: erro === 0 });
    }
  }
  const porPar = new Map<string, { n: number; dentro: number; erroMedio: number }>();
  linhas.forEach((l) => { const o = porPar.get(l.chave) ?? { n: 0, dentro: 0, erroMedio: 0 }; o.n++; o.dentro += l.dentro ? 1 : 0; o.erroMedio += l.erro; porPar.set(l.chave, o); });
  return { n: linhas.length, dentro: linhas.filter((l) => l.dentro).length, porPar: [...porPar.entries()].map(([chave, o]) => ({ chave, n: o.n, dentro: o.dentro, erroMedio: Math.round(o.erroMedio / o.n) })), amostra: linhas.filter((l) => l.de !== l.para).slice(0, 5) };
}
