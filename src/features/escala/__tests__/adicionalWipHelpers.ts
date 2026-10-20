// Construtores e verificações compartilhados dos testes do adicional por etapa (não é um arquivo de teste).
import { calcularLimitesWip, etapasPorProduto } from "../wip";
import { chavePool, type AlocacaoEscala, type EntradaEscala, type PoolEscala, type ResultadoEscala } from "../types";
import { entrada, equipe, pool } from "./helpers";

const IL = 1e9;
const D1 = "2026-10-19";

// produto de várias etapas (ordem 1..n); `maquinas[k]` = máquinas da etapa k+1
export function produto(id: string, maquinas: string[][], opc: { q?: number; mu?: number | number[]; valor?: number } = {}): PoolEscala[] {
  return maquinas.map((ms, k) =>
    pool({ produto: id, etapa: `${id}-e${k + 1}`, ordem: k + 1, op: `${id}-op${k + 1}`, q: opc.q ?? 100, maquinas: ms, mu: Array.isArray(opc.mu) ? opc.mu[k] : opc.mu ?? 100, valor: opc.valor ?? 1 })
  );
}

// ativa o adicional por etapa: tetos (padrão ilimitado) + limites de estoque (padrão: `dias` de consumo)
export function comWip(e: EntradaEscala, opc: { teto?: (p: PoolEscala) => number; limite?: number | "dias"; dias?: number } = {}): EntradaEscala {
  const pools = e.pools.map((p) => ({ ...p, adicionalMax: opc.teto ? opc.teto(p) : IL }));
  const limites = calcularLimitesWip(pools, e.slots, { wipDiasLimite: opc.dias ?? 1 }, null);
  if (typeof opc.limite === "number") Object.keys(limites).forEach((k) => (limites[k] = opc.limite as number));
  return { ...e, pools, wip: { limites } };
}
export const semWip = (e: EntradaEscala): EntradaEscala => comWip(e, { limite: 0 }); // só cadeias de acabado

export const A = (r: ResultadoEscala, p: PoolEscala) => r.adicionalProduzido[chavePool(p.produtoId, p.etapaId)] ?? 0;
export const acabadoDe = (r: ResultadoEscala, pools: PoolEscala[], produtoId: string) => {
  const l = etapasPorProduto(pools).get(produtoId)!;
  return A(r, l[l.length - 1]);
};

// REPLAY do estado por período: adicional acumulado por etapa ao FIM de cada período (precedência cumulativa + teto de estoque)
export function verificarWip(e: EntradaEscala, r: ResultadoEscala): string[] {
  const erros: string[] = [];
  const idx = new Map(e.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const cum = new Map<string, number>();
  const porSlot = new Map<number, AlocacaoEscala[]>();
  r.alocacoes.forEach((a) => {
    const i = idx.get(`${a.data}|${a.periodoId}`) as number;
    porSlot.set(i, [...(porSlot.get(i) ?? []), a]);
  });
  const etapas = etapasPorProduto(e.pools);
  [...porSlot.keys()].sort((a, b) => a - b).forEach((i) => {
    (porSlot.get(i) as AlocacaoEscala[]).forEach((a) => {
      if (a.maquinaId && a.produtoId && a.etapaId && (a.pecasAdicional ?? 0) > 0) cum.set(chavePool(a.produtoId, a.etapaId), (cum.get(chavePool(a.produtoId, a.etapaId)) ?? 0) + (a.pecasAdicional as number));
    });
    etapas.forEach((l, produtoId) => {
      for (let k = 0; k < l.length; k++) {
        const ch = chavePool(produtoId, l[k].etapaId);
        const ak = cum.get(ch) ?? 0;
        if (ak > (l[k].adicionalMax ?? 0) + 1e-6) erros.push(`teto estourado em ${ch} (${ak} > ${l[k].adicionalMax})`);
        if (k > 0) {
          const ant = cum.get(chavePool(produtoId, l[k - 1].etapaId)) ?? 0;
          if (ak > ant + 1e-6) erros.push(`material fictício no período ${i}: ${ch} processou ${ak} e a etapa anterior só ${ant}`);
        }
        if (k + 1 < l.length) {
          const L = e.wip?.limites[ch];
          const wip = ak - (cum.get(chavePool(produtoId, l[k + 1].etapaId)) ?? 0);
          if (L !== undefined && wip > L + 1e-6) erros.push(`estoque acima do limite no período ${i}: ${ch} ${wip} > ${L}`);
        }
      }
    });
  });
  // linhas de adicional: tipo coerente (última etapa = acabado)
  r.alocacoes.forEach((a) => {
    if (!a.maquinaId || !(a.pecasAdicional && a.pecasAdicional > 0)) return;
    const l = etapas.get(a.produtoId as string)!;
    const ultima = l[l.length - 1].etapaId === a.etapaId;
    if (a.tipoAdicional !== (ultima ? "acabado" : "intermediario")) erros.push(`tipo_adicional incoerente em ${a.produtoId}|${a.etapaId}`);
  });
  return erros;
}


export function cenarioAleatorio(seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const nProd = 1 + Math.floor(rnd() * 3);
  const pools: PoolEscala[] = [];
  const maqGlobais = Array.from({ length: 8 }, (_, i) => `m${i + 1}`);
  for (let p = 0; p < nProd; p++) {
    const nEt = 1 + Math.floor(rnd() * 3);
    const maquinas = Array.from({ length: nEt }, () => Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => maqGlobais[Math.floor(rnd() * 8)]));
    pools.push(...produto(`p${p}`, maquinas, { q: 50 + Math.floor(rnd() * 4) * 50, mu: Array.from({ length: nEt }, () => 40 + Math.floor(rnd() * 100)), valor: 1 + Math.floor(rnd() * 10) }));
  }
  const nPessoas = 3 + Math.floor(rnd() * 10);
  const dias = rnd() < 0.5 ? [D1] : [D1, "2026-10-20"];
  const ausencias = rnd() < 0.4 ? [{ funcionarioId: "f01", data: D1, inicioMin: null, fimMin: null }] : [];
  const base = entrada({ funcionarios: equipe(nPessoas), pools, ausencias }, dias);
  const limite = rnd() < 0.3 ? 0 : rnd() < 0.5 ? undefined : Math.round(rnd() * 600);
  return { base, com: comWip(base, { limite: limite === undefined ? "dias" : limite }) };
}


