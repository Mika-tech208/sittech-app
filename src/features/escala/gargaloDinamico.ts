// GARGALO DINÂMICO e CAPACIDADE FUTURA AJUSTADA (replanejamento restrito) — núcleo PURO, só diagnóstico.
//
// Pergunta por corte: "qual recurso mais ameaça o RESTO da semana, dada a produção real até aqui?". Não é fixo: pode persistir, diminuir,
// desaparecer ou migrar. A pressão de um conjunto de máquinas compartilhadas é
//     pressão = períodos-máquina que o RESTANTE REAL exige (no melhor ritmo da etapa) ÷ períodos-máquina disponíveis daqui em diante.
// Calculada DUAS vezes: com as metas originais (f = 1) e com o ritmo observado suavizado (metas × f, mesma regra de desempenho.ts). A diferença é
// o efeito de a produção real estar acima/abaixo da meta. A quantidade restante real continua sendo o sinal principal; f só corrige a capacidade.

import { maquinaDisponivelNoSlot } from "./disponibilidade";
import { metaNoSlot } from "./folga";
import type { DesempenhoEtapa } from "./desempenho";
import { chavePool, type EntradaEscala, type PoolEscala } from "./types";

/** Acima disto o recurso está "sob pressão" (folga < 10%); acima de 1 está saturado (o restante real não cabe nem rodando sempre). */
export const PRESSAO_SOB_PRESSAO = 0.9;
/** Sem nenhum período-máquina disponível: pressão "infinita" representada por um teto finito (JSON-safe). */
export const PRESSAO_MAXIMA = 99;

export interface LinhaCapacidadePool {
  poolKey: string;
  produtoId: string;
  etapaId: string;
  metaOriginalMedia: number; // peças/máquina/período (média dos períodos com meta)
  produtividadeObservada: number | null; // obs = Σ boas / Σ meta (null = sem amostra)
  n: number;
  f: number; // fator suavizado aplicado ao futuro
  metaAjustadaMedia: number;
  restante: number; // peças reais ainda a produzir
  capacidadeFuturaOriginal: number; // máquinas disponíveis daqui em diante × metas originais
  capacidadeFuturaAjustada: number; // idem × f
}

export interface RecursoPressao {
  maquinas: string[];
  produtos: string[];
  necessarioOriginal: number; // períodos-máquina exigidos pelo restante real, metas originais
  necessarioAjustado: number; // idem, metas × f
  disponivel: number; // períodos-máquina disponíveis daqui em diante
  pressaoOriginal: number;
  pressaoAjustada: number;
  deficitAjustado: number; // max(0, necessário − disponível)
}

export type SituacaoGargalo = "saturado" | "sob_pressao" | "sem_gargalo";
export interface GargaloDinamico {
  situacao: SituacaoGargalo;
  principal: RecursoPressao | null; // o mais pressionado (mesmo sem estar saturado); null = nada a produzir
  recursos: RecursoPressao[]; // ordenado por pressão ajustada, decrescente
}

export interface DinamicaCorte { capacidade: LinhaCapacidadePool[]; gargalo: GargaloDinamico }

export type EvolucaoGargalo = "inicio" | "persistiu" | "diminuiu" | "aumentou" | "mudou" | "desapareceu" | "surgiu" | "sem_gargalo";

const chaveRecurso = (r: RecursoPressao | null) => (r ? r.maquinas.join(",") : "");

// Compara dois cortes consecutivos (a evolução fica registrada em cada snapshot)
export function evolucaoDoGargalo(anterior: GargaloDinamico | null, atual: GargaloDinamico): EvolucaoGargalo {
  if (!anterior) return atual.situacao === "sem_gargalo" ? "sem_gargalo" : "inicio";
  const aAnt = anterior.situacao !== "sem_gargalo", aAtu = atual.situacao !== "sem_gargalo";
  if (!aAnt && !aAtu) return "sem_gargalo";
  if (aAnt && !aAtu) return "desapareceu";
  if (!aAnt && aAtu) return "surgiu";
  if (chaveRecurso(anterior.principal) !== chaveRecurso(atual.principal)) return "mudou";
  const d = (atual.principal?.pressaoAjustada ?? 0) - (anterior.principal?.pressaoAjustada ?? 0);
  return Math.abs(d) < 0.01 ? "persistiu" : d < 0 ? "diminuiu" : "aumentou";
}

// `originais`: pools com a metas ORIGINAIS; `restante`: peças reais restantes por pool; `c`: período de referência (o futuro começa em c+1).
export function calcularDinamica(p: { entrada: EntradaEscala; originais: PoolEscala[]; restante: Record<string, number>; desempenho: Record<string, DesempenhoEtapa>; c: number }): DinamicaCorte {
  const futuros = p.entrada.slots.filter((s) => s.indice > p.c);
  const chave = (pl: PoolEscala) => chavePool(pl.produtoId, pl.etapaId);
  const f = (pl: PoolEscala) => p.desempenho[chave(pl)]?.f ?? 1;
  const comRestante = p.originais.filter((pl) => pl.maquinasIds.length > 0);

  const capacidade: LinhaCapacidadePool[] = comRestante.map((pl) => {
    let cap = 0;
    futuros.forEach((s) => {
      const mu = metaNoSlot(pl, s);
      if (mu > 0) { cap += mu * [...new Set(pl.maquinasIds)].filter((m) => maquinaDisponivelNoSlot(p.entrada, m, s)).length; }
    });
    // meta média sobre TODOS os períodos com meta (não só os futuros): é o ritmo de referência da etapa
    const todas = Object.values(pl.metas).filter((m) => m > 0);
    const media = todas.length > 0 ? todas.reduce((a, b) => a + b, 0) / todas.length : 0;
    const d = p.desempenho[chave(pl)];
    return {
      poolKey: chave(pl), produtoId: pl.produtoId, etapaId: pl.etapaId, metaOriginalMedia: media, produtividadeObservada: d?.obs ?? null, n: d?.n ?? 0, f: f(pl),
      metaAjustadaMedia: media * f(pl), restante: p.restante[chave(pl)] ?? 0, capacidadeFuturaOriginal: cap, capacidadeFuturaAjustada: cap * f(pl),
    };
  });

  // conjuntos de máquinas compartilhadas (componentes conexos)
  const pai = new Map<string, string>();
  const achar = (x: string): string => { const v = pai.get(x) as string; if (v === x) return x; const r = achar(v); pai.set(x, r); return r; };
  comRestante.forEach((pl) => pl.maquinasIds.forEach((m) => { if (!pai.has(m)) pai.set(m, m); }));
  comRestante.forEach((pl) => { const ms = [...new Set(pl.maquinasIds)]; ms.slice(1).forEach((m) => pai.set(achar(m), achar(ms[0]))); });
  const conjuntos = new Map<string, { pools: PoolEscala[]; maquinas: Set<string> }>();
  comRestante.forEach((pl) => {
    const raiz = achar(pl.maquinasIds[0]);
    if (!conjuntos.has(raiz)) conjuntos.set(raiz, { pools: [], maquinas: new Set() });
    const c = conjuntos.get(raiz) as { pools: PoolEscala[]; maquinas: Set<string> };
    c.pools.push(pl);
    pl.maquinasIds.forEach((m) => c.maquinas.add(m));
  });

  const recursos: RecursoPressao[] = [];
  conjuntos.forEach((c) => {
    const exige = (fator: (pl: PoolEscala) => number) => c.pools.reduce((s, pl) => {
      const rest = p.restante[chave(pl)] ?? 0;
      const melhor = Math.max(0, ...Object.values(pl.metas)) * fator(pl);
      return s + (rest > 0 && melhor > 0 ? rest / melhor : 0);
    }, 0);
    let disponivel = 0;
    futuros.forEach((s) => { if (c.pools.some((pl) => metaNoSlot(pl, s) > 0)) disponivel += [...c.maquinas].filter((m) => maquinaDisponivelNoSlot(p.entrada, m, s)).length; });
    const nOrig = exige(() => 1), nAjus = exige(f);
    if (nOrig <= 0) return;
    recursos.push({
      maquinas: [...c.maquinas].sort(), produtos: [...new Set(c.pools.map((pl) => pl.produtoId))].sort(), necessarioOriginal: nOrig, necessarioAjustado: nAjus, disponivel,
      pressaoOriginal: disponivel > 0 ? nOrig / disponivel : PRESSAO_MAXIMA, pressaoAjustada: disponivel > 0 ? nAjus / disponivel : PRESSAO_MAXIMA, deficitAjustado: Math.max(0, nAjus - disponivel),
    });
  });
  recursos.sort((a, b) => b.pressaoAjustada - a.pressaoAjustada || (a.maquinas.join() < b.maquinas.join() ? -1 : 1));
  const principal = recursos[0] ?? null;
  const situacao: SituacaoGargalo = !principal ? "sem_gargalo" : principal.pressaoAjustada > 1 + 1e-9 ? "saturado" : principal.pressaoAjustada >= PRESSAO_SOB_PRESSAO ? "sob_pressao" : "sem_gargalo";
  return { capacidade, gargalo: { situacao, principal, recursos } };
}
