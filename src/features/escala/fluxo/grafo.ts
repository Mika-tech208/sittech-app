// GRAFO DE FLUXO — modelo lógico dos pools (nós) e das transferências de peças entre eles (arestas). PURO.
//
// Caso comum: cada produto é uma cadeia (etapa 1 → 2 → … → final). Casos especiais, SEM `if produto == ...`:
//   • Conector legado (spec §5): pools equivalentes de dois produtos (mesma operação, mesmas máquinas, metas compatíveis) são FUNDIDOS num
//     único nó lógico (membros[]). Os trechos exclusivos dos dois ramos alimentam o nó comum (peso = Q_ramo / ΣQ).
//   • Produto único (F#CONV / F#AUTO / F#COMUM): `ligacoes` declara que a última etapa de um produto alimenta a primeira de outro.
// Quando a fusão não é possível, o par fica em comportamento LEGADO (cadeias independentes) com diagnóstico explícito.

import { chavePool, type PoolEscala } from "../types";
import type { DiagnosticoItem, LigacaoProdutos, ParLegado, PoolFundido } from "./tipos";


export interface NoFluxo {
  id: string; // chave do pool representante
  membros: string[]; // chaves de pool (membros[0] = representante)
  produtoId: string;
  etapaId: string;
  ordem: number;
  quantidade: number; // Σ Q dos membros
  valorUnitario: number;
  grupo: string;
  final: boolean;
  succ: string | null; // id do nó seguinte
}

export interface ArestaFluxo {
  id: string; // = id do nó de origem (cada nó tem no máximo uma aresta de saída)
  origem: string;
  destino: string;
  peso: number; // fração da demanda do destino atendida por este ramo (1 em cadeia simples)
  produtoId: string; // da origem
  etapaOrigemId: string;
  etapaSeguinteId: string; // membro do destino correspondente ao ramo
  chavePar: string; // "produto|etapaOrigem" (chave do pool origem)
}

export interface GrupoFluxo {
  id: string;
  nos: string[]; // ordem topológica (origens primeiro)
  sink: string;
  arestas: string[];
}

export interface Grafo {
  nos: Record<string, NoFluxo>;
  arestas: Record<string, ArestaFluxo>;
  entradas: Record<string, string[]>; // nó -> ids das arestas que chegam
  grupos: GrupoFluxo[];
  noDoPool: Record<string, string>; // chave de pool -> id do nó
  fusoes: PoolFundido[];
  diagnosticos: DiagnosticoItem[];
}

const mesmoConjunto = (a: string[], b: string[]) => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

function ordenarCadeia(pools: PoolEscala[]): PoolEscala[] {
  return [...pools].sort((a, b) => a.ordemEtapa - b.ordemEtapa || (a.etapaId < b.etapaId ? -1 : a.etapaId > b.etapaId ? 1 : 0));
}

interface PlanoFusao {
  par: ParLegado;
  // por etapa comum: [pool convencional, pool automática]
  pares: { rotulo: string; conv: PoolEscala; auto: PoolEscala }[];
}

function avaliarFusao(par: ParLegado, cadeias: Map<string, PoolEscala[]>, diag: DiagnosticoItem[], fatores: Record<string, number>): PlanoFusao | null {
  const conv = cadeias.get(par.produtoConvencionalId);
  const auto = cadeias.get(par.produtoAutomaticaId);
  if (!conv && !auto) return null; // par sem relação com esta semana
  const legado = (motivo: string): null => {
    diag.push({
      codigo: "PRODUTO_EM_COMPORTAMENTO_LEGADO", severidade: "aviso", produtoId: par.produtoConvencionalId,
      mensagem: `Par "${par.id}" mantido em comportamento legado (pools comuns NÃO fundidos): ${motivo}`, detalhes: { parId: par.id, produtoAutomaticaId: par.produtoAutomaticaId, motivo },
    });
    return null;
  };
  if (!conv || !auto) {
    diag.push({ codigo: "PRODUTO_EM_COMPORTAMENTO_LEGADO", severidade: "info", produtoId: (conv ?? auto)![0].produtoId, mensagem: `Par "${par.id}": apenas um dos produtos está na Previsão — nada a fundir, produto em comportamento legado`, detalhes: { parId: par.id } });
    return null;
  }
  const n = par.etapasComuns.length;
  if (n === 0) return legado("par sem etapas comuns configuradas");
  const tol = par.toleranciaMeta ?? 0.01;
  const pares: PlanoFusao["pares"] = [];
  // as etapas comuns precisam ser o SUFIXO (na mesma ordem) das duas cadeias
  if (conv.length < n || auto.length < n) return legado("cadeia menor que o número de etapas comuns");
  for (let i = 0; i < n; i++) {
    const ec = par.etapasComuns[i];
    const pc = conv[conv.length - n + i];
    const pa = auto[auto.length - n + i];
    if (pc.etapaId !== ec.etapaConvencionalId || pa.etapaId !== ec.etapaAutomaticaId) return legado(`etapa comum "${ec.rotulo}" não é o ${i + 1}º trecho final esperado das duas cadeias`);
    if (pc.operacaoId !== pa.operacaoId) return legado(`etapa comum "${ec.rotulo}": operações diferentes`);
    if (!mesmoConjunto(pc.maquinasIds, pa.maquinasIds)) return legado(`etapa comum "${ec.rotulo}": conjuntos de máquinas diferentes`);
    const periodos = new Set([...Object.keys(pc.metas), ...Object.keys(pa.metas)]);
    for (const p of periodos) {
      const x = (pc.metas[p] ?? 0) / (fatores[chavePool(pc.produtoId, pc.etapaId)] || 1);
      const y = (pa.metas[p] ?? 0) / (fatores[chavePool(pa.produtoId, pa.etapaId)] || 1);
      if (Math.abs(x - y) > tol * Math.max(x, y, 1e-9)) return legado(`etapa comum "${ec.rotulo}": metas incompatíveis no período ${p} (${x} × ${y})`);
    }
    pares.push({ rotulo: ec.rotulo, conv: pc, auto: pa });
  }
  return { par, pares };
}

export function construirGrafo(pools: PoolEscala[], opcoes: { paresLegado?: ParLegado[]; ligacoes?: LigacaoProdutos[]; fatoresEmbutidos?: Record<string, number> } = {}): Grafo {
  const diagnosticos: DiagnosticoItem[] = [];
  const porProduto = new Map<string, PoolEscala[]>();
  [...pools].sort((a, b) => (a.produtoId + a.etapaId < b.produtoId + b.etapaId ? -1 : 1)).forEach((p) => {
    if (!porProduto.has(p.produtoId)) porProduto.set(p.produtoId, []);
    porProduto.get(p.produtoId)!.push(p);
  });
  const cadeias = new Map<string, PoolEscala[]>();
  porProduto.forEach((l, pid) => {
    const c = ordenarCadeia(l);
    cadeias.set(pid, c);
    const ultima = c[c.length - 1];
    if (c.length > 1 && c[c.length - 2].ordemEtapa === ultima.ordemEtapa) {
      diagnosticos.push({ codigo: "ETAPA_FINAL_AMBIGUA", severidade: "aviso", produtoId: pid, etapaId: ultima.etapaId, mensagem: "Produto com duas etapas na maior ordem do roteiro: usada a de maior etapaId como final" });
    }
  });

  // ---- fusões legadas ----
  const noDoPool: Record<string, string> = {};
  const fusoes: PoolFundido[] = [];
  const membrosDoNo = new Map<string, string[]>();
  [...(opcoes.paresLegado ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((par) => {
    const plano = avaliarFusao(par, cadeias, diagnosticos, opcoes.fatoresEmbutidos ?? {});
    if (!plano) return;
    plano.pares.forEach((e) => {
      const rep = chavePool(e.conv.produtoId, e.conv.etapaId);
      const k2 = chavePool(e.auto.produtoId, e.auto.etapaId);
      noDoPool[rep] = rep;
      noDoPool[k2] = rep;
      membrosDoNo.set(rep, [rep, k2]);
      const soma = e.conv.quantidade + e.auto.quantidade;
      fusoes.push({ parId: par.id, rotulo: e.rotulo, chaveConvencional: rep, chaveAutomatica: k2, demandaComum: soma, proporcaoConvencional: soma > 0 ? e.conv.quantidade / soma : 0.5 });
      diagnosticos.push({
        codigo: "POOL_FUNDIDO", severidade: "info", produtoId: par.produtoConvencionalId, etapaId: e.conv.etapaId,
        mensagem: `Pools "${e.rotulo}" de ${par.id} fundidos logicamente (cálculo de fluxo/demanda); linhas saem no produto convencional`, detalhes: { parId: par.id, rotulo: e.rotulo },
      });
    });
  });

  // ---- nós ----
  const nos: Record<string, NoFluxo> = {};
  const poolPorChave = new Map(pools.map((p) => [chavePool(p.produtoId, p.etapaId), p]));
  pools.forEach((p) => {
    const k = chavePool(p.produtoId, p.etapaId);
    if (noDoPool[k] === undefined) noDoPool[k] = k;
  });
  [...poolPorChave.keys()].sort().forEach((k) => {
    const id = noDoPool[k];
    if (nos[id]) return;
    const membros = membrosDoNo.get(id) ?? [id];
    const rep = poolPorChave.get(id) as PoolEscala;
    nos[id] = {
      id, membros, produtoId: rep.produtoId, etapaId: rep.etapaId, ordem: rep.ordemEtapa,
      quantidade: membros.reduce((s, m) => s + Math.max(0, poolPorChave.get(m)?.quantidade ?? 0), 0),
      valorUnitario: membros.length > 1 && membros.reduce((q, m) => q + (poolPorChave.get(m)?.quantidade ?? 0), 0) > 0 ? membros.reduce((v, m) => v + (poolPorChave.get(m)?.quantidade ?? 0) * (poolPorChave.get(m)?.valorUnitario ?? 0), 0) / membros.reduce((q, m) => q + (poolPorChave.get(m)?.quantidade ?? 0), 0) : rep.valorUnitario, grupo: "", final: false, succ: null,
    };
  });

  // ---- arestas ----
  const arestas: Record<string, ArestaFluxo> = {};
  const addAresta = (origemNo: string, destinoNo: string, produtoRamo: string) => {
    if (origemNo === destinoNo) return;
    const o = nos[origemNo];
    const d = nos[destinoNo];
    if (arestas[origemNo]) return;
    const seguinte = d.membros.map((m) => poolPorChave.get(m) as PoolEscala).find((p) => p.produtoId === produtoRamo) ?? (poolPorChave.get(d.id) as PoolEscala);
    arestas[origemNo] = { id: origemNo, origem: origemNo, destino: destinoNo, peso: 1, produtoId: o.produtoId, etapaOrigemId: o.etapaId, etapaSeguinteId: seguinte.etapaId, chavePar: origemNo };
    o.succ = destinoNo;
  };
  cadeias.forEach((c, pid) => {
    for (let i = 0; i + 1 < c.length; i++) addAresta(noDoPool[chavePool(c[i].produtoId, c[i].etapaId)], noDoPool[chavePool(c[i + 1].produtoId, c[i + 1].etapaId)], pid);
  });
  (opcoes.ligacoes ?? []).forEach((l) => {
    const co = cadeias.get(l.produtoOrigemId);
    const cd = cadeias.get(l.produtoDestinoId);
    if (!co || !cd) return;
    const ultimo = co[co.length - 1];
    const primeiro = cd[0];
    addAresta(noDoPool[chavePool(ultimo.produtoId, ultimo.etapaId)], noDoPool[chavePool(primeiro.produtoId, primeiro.etapaId)], l.produtoOrigemId);
  });

  const entradas: Record<string, string[]> = {};
  Object.keys(nos).forEach((id) => (entradas[id] = []));
  Object.values(arestas).forEach((a) => entradas[a.destino].push(a.id));
  Object.values(entradas).forEach((l) => l.sort());

  // peso dos ramos: proporção da quantidade (Q do ramo / ΣQ dos ramos que chegam ao mesmo destino)
  Object.entries(entradas).forEach(([destino, lista]) => {
    if (lista.length <= 1) return;
    const q = (id: string) => {
      const a = arestas[id];
      const d = nos[destino];
      // fusão: Q do membro do destino que corresponde ao ramo; ligação entre produtos: Q final do produto de origem
      const membro = d.membros.map((m) => poolPorChave.get(m) as PoolEscala).find((p) => p.etapaId === a.etapaSeguinteId && d.membros.length > 1);
      return Math.max(0, membro ? membro.quantidade : nos[a.origem].quantidade);
    };
    const tot = lista.reduce((s, id) => s + q(id), 0);
    lista.forEach((id) => (arestas[id].peso = tot > 0 ? q(id) / tot : 1 / lista.length));
  });

  // ---- grupos (componentes conexos) + ordem topológica ----
  const pai: Record<string, string> = {};
  const raiz = (x: string): string => (pai[x] === x ? x : (pai[x] = raiz(pai[x])));
  Object.keys(nos).forEach((id) => (pai[id] = id));
  Object.values(arestas).forEach((a) => {
    const x = raiz(a.origem);
    const y = raiz(a.destino);
    if (x !== y) pai[x < y ? y : x] = x < y ? x : y;
  });
  const gMap = new Map<string, string[]>();
  Object.keys(nos).sort().forEach((id) => {
    const r = raiz(id);
    if (!gMap.has(r)) gMap.set(r, []);
    gMap.get(r)!.push(id);
  });
  const grupos: GrupoFluxo[] = [];
  [...gMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([gid, ids]) => {
    // topológica: profundidade = maior caminho desde uma origem
    const prof: Record<string, number> = {};
    const profDe = (id: string): number => {
      if (prof[id] !== undefined) return prof[id];
      prof[id] = 0;
      prof[id] = entradas[id].length === 0 ? 0 : 1 + Math.max(...entradas[id].map((e) => profDe(arestas[e].origem)));
      return prof[id];
    };
    ids.forEach(profDe);
    const topo = [...ids].sort((a, b) => prof[a] - prof[b] || (a < b ? -1 : 1));
    const sinks = topo.filter((id) => nos[id].succ === null);
    const sink = sinks.sort((a, b) => nos[b].ordem - nos[a].ordem || (a < b ? -1 : 1))[0];
    ids.forEach((id) => {
      nos[id].grupo = gid;
      nos[id].final = id === sink;
    });
    grupos.push({ id: gid, nos: topo, sink, arestas: ids.filter((id) => arestas[id]).sort() });
  });

  return { nos, arestas, entradas, grupos, noDoPool, fusoes, diagnosticos };
}
