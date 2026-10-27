// SIMULADOR INDEPENDENTE (verificação cruzada da régua do núcleo, critério E). Escrito só a partir da spec §3, SEM reutilizar estado.ts/grafo.ts/simulador.ts.
// Modelo: por produto, cadeia linear de etapas por `ordemEtapa`. Pools do Conector legado são tratados como cadeias SEPARADAS (sem fusão): serve como
// referência de SINAL (o plano de fluxo melhora ou piora?), não de valor absoluto. Cenário pessimista (lo): boas = produzidas − refugo só de CONFIRMADO;
// período fechado sem linha = 0; WIP inicial = max(0, B_k − B_{k+1}); capacidade de cada linha = peças da linha × f (já são meta × fração); fluxo no mesmo
// período habilitado; etapa final limitada por Q_f − B_f; etapas intermediárias limitadas por Q_k − B_k (+ carga adicional).
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import type { AlocacaoEscala, EntradaEscala } from "@/features/escala/types";

export interface ResultadoSimInd { finalPorProduto: Record<string, number>; faltaTotal: number; wipFinal: number }

export function simularIndependente(entrada: EntradaEscala, apontamentos: ApontamentoReal[], agoraMs: number, tInicio: number, plano: AlocacaoEscala[], f: Record<string, number>, fechamentoMin = 10): ResultadoSimInd {
  const slots = entrada.slots;
  const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const ap = tInicio;
  const ultimoFechado = slots.reduce((m, s) => (s.fimMs + fechamentoMin * 60_000 <= agoraMs ? s.indice : m), -1);
  // boas reais por pool (somente lançamentos até agora, períodos fechados ou com linha)
  const B: Record<string, number> = {};
  apontamentos.filter((a) => a.lancadoEmMs <= agoraMs && a.status === "produzindo" && a.produtoId && a.etapaId).forEach((a) => { const k = `${a.produtoId}|${a.etapaId}`; B[k] = (B[k] ?? 0) + Math.max(0, a.boas); });
  void ultimoFechado;
  const porProduto = new Map<string, typeof entrada.pools>();
  entrada.pools.forEach((p) => (porProduto.get(p.produtoId) ?? porProduto.set(p.produtoId, []).get(p.produtoId)!).push(p));
  // produção planejada (cap) por pool e slot, a partir do plano (somente slots ≥ ap): pecas × f (+ adicional × f)
  const capBase: Record<string, number[]> = {}, capAdic: Record<string, number[]> = {};
  plano.forEach((a) => {
    const i = idx.get(`${a.data}|${a.periodoId}`); if (i === undefined || i < ap || !a.maquinaId || !a.produtoId || !a.etapaId) return;
    const k = `${a.produtoId}|${a.etapaId}`;
    (capBase[k] ??= new Array(slots.length).fill(0))[i] += (a.pecas ?? 0) * (f[k] ?? 1);
    (capAdic[k] ??= new Array(slots.length).fill(0))[i] += (a.pecasAdicional ?? 0) * (f[k] ?? 1);
  });
  const finalPorProduto: Record<string, number> = {};
  let falta = 0, wipFinal = 0;
  porProduto.forEach((pools, produtoId) => {
    pools.sort((a, b) => a.ordemEtapa - b.ordemEtapa);
    const n = pools.length;
    const k = pools.map((p) => `${p.produtoId}|${p.etapaId}`);
    const b = k.map((kk) => B[kk] ?? 0);
    const W = new Array(Math.max(0, n - 1)).fill(0).map((_, j) => Math.max(0, b[j] - b[j + 1]));
    const restBase = k.map((_, j) => Math.max(0, pools[j].quantidade - b[j]));
    const restAdic = k.map((_, j) => Math.max(0, pools[j].adicionalMax ?? 0));
    let finalProd = 0;
    for (let t = ap; t < slots.length; t++) {
      let prodAnt = 0;
      for (let j = 0; j < n; j++) {
        const disponivel = j === 0 ? Number.POSITIVE_INFINITY : W[j - 1] + prodAnt;
        const capB = Math.min(capBase[k[j]]?.[t] ?? 0, restBase[j]);
        let x = Math.min(capB, disponivel);
        restBase[j] -= x;
        // carga adicional: usa o que sobrar de material e o teto adicional restante (final = acabado além do previsto: não conta para a meta)
        const sobra = Math.max(0, disponivel - x);
        const xa = j === n - 1 ? 0 : Math.min(capAdic[k[j]]?.[t] ?? 0, restAdic[j], sobra);
        restAdic[j] -= xa;
        x += xa;
        if (j > 0) W[j - 1] = Math.max(0, W[j - 1] + prodAnt - x);
        if (j === n - 1) finalProd += Math.min(x, capB);
        prodAnt = x;
      }
    }
    const Qf = pools[n - 1].quantidade;
    const entregue = Math.min(Qf, b[n - 1] + finalProd);
    finalPorProduto[produtoId] = entregue;
    falta += Math.max(0, Qf - entregue);
    wipFinal += W.reduce((s, v) => s + v, 0);
  });
  return { finalPorProduto, faltaTotal: falta, wipFinal };
}
