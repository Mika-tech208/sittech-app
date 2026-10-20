// Camada de ADICIONAL por etapa (acabado + estoque intermediário), PURA — escolhe os postos da 2ª camada
// em UM período, para as pessoas que ficaram sem posto no previsto.
//
// Prioridade (ordem absoluta, dentro do período):
//   1) ACABADO adicional — "cadeias": para cada produto, o maior fluxo F de produto acabado que cabe nas
//      máquinas livres, nos tetos por etapa, no estoque já existente e nas pessoas disponíveis. Cada etapa
//      k processa y_k = max(0, F − U_k), onde U_k = estoque que já espera nas etapas k..n−1 (o que a
//      etapa seguinte consome DO ESTOQUE não precisa ser produzido de novo);
//   2) ESTOQUE INTERMEDIÁRIO (WIP) — o que sobrar de máquina e de pessoa, respeitando o teto de estoque.
// Logo o estoque NUNCA tira capacidade que permitiria gerar acabado: as cadeias de TODOS os produtos
// são decididas antes de qualquer estoque.
//
// PIPELINE no mesmo período: a etapa seguinte consome estoque anterior + o que a etapa anterior produziu
// até este período (inclusive neste mesmo período). Nunca mais do que existe cumulativamente — por
// construção: y_(k+1) − y_k ≤ estoque(k) e, no estoque, a etapa k+1 só pode andar até A_k.
// O previsto NÃO passa por aqui (continua com a lógica do motor).

import { EPS } from "./folga";
import { chavePool, type PoolEscala } from "./types";

export interface PostoAdicional {
  m: string;
  pool: PoolEscala;
  pecas: number;
}

export interface EntradaSelecaoWip {
  etapas: Map<string, PoolEscala[]>; // por produto, em ordem do roteiro
  adicRem: Map<string, number>; // teto restante por etapa (adicionalMax − já alocado/congelado)
  adicAlocado: Map<string, number>; // adicional acumulado por etapa (congelado + períodos anteriores)
  saldo0: Map<string, number>; // estoque confirmado aguardando a etapa seguinte, por chave da etapa de origem (Fase 3)
  limites: Record<string, number>; // teto de estoque entre k e k+1, por chave da etapa k
  // Revezamento duro (Fase 4a): recebe as operações de TODOS os postos já escolhidos + o(s) novo(s) e diz se ainda existe atribuição de
  // pessoas sem repetir a operação consecutiva. Cadeia/estoque que torna o conjunto inviável é descartado inteiro (a cadeia é atômica).
  viavel?: (operacoes: string[]) => boolean;
  ocupado?: Map<string, number>; // estoque CONFIRMADO que já ocupa o par (por chave da etapa k): consome o limite (Fase 3)
  livres: (pool: PoolEscala) => string[]; // máquinas selecionadas, disponíveis neste período, na ordem de preferência
  meta: (pool: PoolEscala) => number; // peças por máquina neste período
  usadas: Set<string>; // máquinas já usadas neste período (previsto) — é atualizado aqui
  orcamento: number; // pessoas sem posto
}

const chave = (p: PoolEscala) => chavePool(p.produtoId, p.etapaId);

export function selecionarAdicionalWip(e: EntradaSelecaoWip): PostoAdicional[] {
  const posts: PostoAdicional[] = [];
  const comp = new Map<string, number>(); // peças decididas NESTE período, por etapa
  let orc = e.orcamento;
  const g = (m: Map<string, number>, k: string) => m.get(k) ?? 0;
  const aloc = (p: PoolEscala) => g(e.adicAlocado, chave(p)) + g(comp, chave(p));
  const capRest = (p: PoolEscala) => Math.max(0, g(e.adicRem, chave(p)) - g(comp, chave(p)));
  // Máquina disputada por várias etapas/produtos vale mais para quem NÃO tem alternativa: entre as livres de uma
  // etapa, usa primeiro as que menos outras etapas (com teto restante) poderiam usar — assim uma etapa não
  // "rouba" a máquina compartilhada de outra cadeia quando tem uma máquina só dela. Empate: ordem recebida
  // (continuidade do previsto, depois id) — nada aqui depende do estoque/adicional já alocado.
  const disputa = new Map<string, number>();
  [...e.etapas.values()].flat().forEach((p) => {
    if (g(e.adicRem, chave(p)) <= EPS || e.meta(p) <= EPS) return;
    new Set(p.maquinasIds).forEach((m) => disputa.set(m, (disputa.get(m) ?? 0) + 1));
  });
  const livresDe = (p: PoolEscala) =>
    e
      .livres(p)
      .filter((m) => !e.usadas.has(m))
      .map((m, i) => ({ m, i }))
      .sort((a, b) => (disputa.get(a.m) ?? 0) - (disputa.get(b.m) ?? 0) || a.i - b.i)
      .map((x) => x.m);

  // produtos por valor (maior primeiro) e id — o acabado de maior valor escolhe primeiro as máquinas compartilhadas
  const produtos = [...e.etapas.keys()].sort((a, b) => {
    const va = e.etapas.get(a)![0].valorUnitario;
    const vb = e.etapas.get(b)![0].valorUnitario;
    return Math.abs(va - vb) > 1e-9 ? vb - va : a < b ? -1 : 1;
  });

  const tomar = (p: PoolEscala, pecas: number) => {
    const mu = e.meta(p);
    const n = Math.ceil(pecas / mu - 1e-9);
    const ms = livresDe(p).slice(0, n);
    let resto = pecas;
    ms.forEach((m) => {
      const parte = Math.min(mu, resto);
      if (parte <= EPS) return;
      if (e.viavel && !e.viavel([...posts.map((x) => x.pool.operacaoId), p.operacaoId])) return; // revezamento duro
      posts.push({ m, pool: p, pecas: parte });
      e.usadas.add(m);
      comp.set(chave(p), g(comp, chave(p)) + parte);
      resto -= parte;
      orc -= 1;
    });
  };

  // ---- 1) ACABADO: cadeia máxima por produto ----
  for (const produto of produtos) {
    if (orc <= 0) break;
    const st = e.etapas.get(produto)!;
    const n = st.length;
    const mu = st.map((p) => e.meta(p));
    if (mu.some((x) => x <= EPS)) continue; // etapa sem meta neste período: a cadeia não fecha
    // estoque anterior aguardando a etapa seguinte (existente + o que períodos anteriores deixaram)
    const S = st.slice(0, n - 1).map((p, k) => Math.max(0, g(e.saldo0, chave(p)) + aloc(p) - aloc(st[k + 1])));
    const U = new Array<number>(n).fill(0);
    for (let k = n - 2; k >= 0; k--) U[k] = U[k + 1] + S[k];
    const B = st.map((p, k) => Math.min(livresDe(p).length * mu[k], capRest(p)));
    const Fmax = Math.min(...st.map((_, k) => U[k] + B[k]));
    if (Fmax <= EPS) continue;
    const y = (F: number, k: number) => Math.max(0, F - U[k]);
    const pessoas = (F: number) => st.reduce((s, _, k) => s + (y(F, k) > EPS ? Math.ceil(y(F, k) / mu[k] - 1e-9) : 0), 0);
    const candidatos = new Set<number>([Fmax]);
    // fronteiras onde o nº de pessoas muda: o estoque acumulado U_k (a etapa k passa a precisar de gente acima dele) e
    // múltiplos da meta de cada etapa acima do estoque
    U.forEach((u) => {
      if (u > EPS && u <= Fmax + EPS) candidatos.add(Math.min(u, Fmax));
    });
    st.forEach((_, k) => {
      for (let c = 1; c <= Math.ceil(B[k] / mu[k] - 1e-9); c++) {
        const F = U[k] + c * mu[k];
        if (F <= Fmax + EPS) candidatos.add(Math.min(F, Fmax));
      }
    });
    // Máquinas da cadeia: etapa mais RESTRITA primeiro (a que tem menos máquinas livres escolhe antes), para que uma etapa
    // não consuma a única máquina de outra etapa do mesmo produto. Testa os fluxos do maior para o menor até caber.
    const tentar = (F: number): PostoAdicional[] | null => {
      const reservadas = new Set<string>();
      const ordem = st.map((_, k) => k).sort((a, b) => livresDe(st[a]).length - livresDe(st[b]).length || a - b);
      const escolhidos = new Map<number, string[]>();
      for (const k of ordem) {
        const yk = y(F, k);
        if (yk <= EPS) continue;
        const precisa = Math.ceil(yk / mu[k] - 1e-9);
        const candidatas = livresDe(st[k]).filter((m) => !reservadas.has(m));
        if (candidatas.length < precisa) return null;
        const ms = candidatas.slice(0, precisa);
        ms.forEach((m) => reservadas.add(m));
        escolhidos.set(k, ms);
      }
      if (e.viavel && !e.viavel([...posts.map((x) => x.pool.operacaoId), ...st.flatMap((p, k) => (escolhidos.get(k) ?? []).map(() => p.operacaoId))])) return null;
      const saida: PostoAdicional[] = [];
      st.forEach((p, k) => {
        const ms = escolhidos.get(k);
        if (!ms) return;
        let resto = y(F, k);
        ms.forEach((m) => {
          const parte = Math.min(mu[k], resto);
          saida.push({ m, pool: p, pecas: parte });
          resto -= parte;
        });
      });
      return saida;
    };
    for (const F of [...candidatos].sort((a, b) => b - a)) {
      if (F <= EPS || pessoas(F) > orc) continue;
      const cadeia = tentar(F);
      if (!cadeia) continue;
      cadeia.forEach((x) => {
        posts.push(x);
        e.usadas.add(x.m);
        comp.set(chave(x.pool), g(comp, chave(x.pool)) + x.pecas);
        orc -= 1;
      });
      break;
    }
  }

  // ---- 2) ESTOQUE INTERMEDIÁRIO: o que sobrou, respeitando teto de estoque e pipeline ----
  let mudou = true;
  for (let guarda = 0; mudou && orc > 0 && guarda < 12; guarda++) {
    mudou = false;
    for (const produto of produtos) {
      const st = e.etapas.get(produto)!;
      const n = st.length;
      for (let k = 0; k < n && orc > 0; k++) {
        const p = st[k];
        const mu = e.meta(p);
        if (mu <= EPS) continue;
        let cap = capRest(p);
        if (k > 0) cap = Math.min(cap, g(e.saldo0, chave(st[k - 1])) + aloc(st[k - 1]) - aloc(p)); // pipeline: só o que já existe
        if (k < n - 1) {
          const L = e.limites[chave(p)];
          if (L !== undefined) cap = Math.min(cap, L - (g(e.ocupado ?? new Map(), chave(p)) + aloc(p) - aloc(st[k + 1])));
        }
        if (cap <= EPS) continue;
        const livres = livresDe(p).length;
        if (livres === 0) continue;
        const nPostos = Math.min(livres, orc, Math.ceil(cap / mu - 1e-9));
        const pecas = Math.min(cap, nPostos * mu);
        const antes = posts.length;
        tomar(p, pecas);
        if (posts.length > antes) mudou = true;
      }
    }
  }
  return posts;
}
