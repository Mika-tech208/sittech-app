// PLANO REVERSO (backward planning) — SOMBRA, OFFLINE, DESLIGADO: nada no motor chama isto.
// PURO e GENÉRICO: ids opacos; qualquer rota A→B→C→D (lista de etapas montante→jusante), vários produtos, recursos (máquinas) COMPARTILHADOS entre produtos.
//
// Ordem do raciocínio (pedido do usuário):
//   1) NECESSIDADE FÍSICA (o que produzir, quanto, até quando) — sem escolher pessoa:
//        demanda final → (Embalar) → consumo bruto por ligação → − WIP existente = necessidade líquida → produção da etapa anterior (ALAP com lead time) → …
//   2) RESERVA de capacidade upstream (prioridade: demanda final primeiro; o que sobra só depois) e conversão em POSTOS-PERÍODO por recurso.
//   3) HEADCOUNT por período (postos distintos); comparação com as pessoas disponíveis. Só então a pessoa é escolhida (fora deste módulo).
//   4) ANTECIPAÇÃO ÚTIL (2ª camada, só com a capacidade E as pessoas que sobram): estoque de saída da sexta limitado à demanda recorrente conhecida (nunca WIP infinito).
// Lead time por ligação = 1 período (LOTE_PROXIMO_PERIODO): o que a etapa k produz em Tn só existe para a etapa k+1 no início de Tn+1.
// Produtividade: por etapa × recurso(máquina) × período (peças por posto-período) — NUNCA por pessoa. Meta ou histórico do posto: quem chama decide o vetor.
// Capacidade compartilhada: cada recurso tem UMA capacidade (unidades por período); o consumo de todos os produtos é somado nela (nunca duplica).
import { alapCurva, requisitoAcumulado, validarCadeia, type PlanoProducao, type SimulacaoCadeia } from "./planejamentoCadeia";
import type { EntradaForecast } from "./forecastBuffer";

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const zeros = (n: number) => new Array<number>(n).fill(0);
const EPS = 1e-6;
const cum = (v: number[]) => { let s = 0; return v.map((x) => (s += x)); };

export interface PeriodoRev { rotulo: string; duracaoMin: number }
/** Recurso físico (máquina/posto). `unidades[t]` = postos-período disponíveis no período t (1 = a máquina existe/está disponível). */
export interface RecursoRev { id: string; rotulo: string; unidades: number[] }
export interface AlternativaRev { recursoId: string; /** peças por posto-período, por período (0 = não opera) */ pecasPorPosto: number[] }
export interface EtapaRev { id: string; rotulo: string; alternativas: AlternativaRev[] }
export interface ProdutoRev {
  id: string; rotulo: string;
  /** rota montante → jusante (a última é a etapa final que entrega a demanda) */
  etapas: EtapaRev[];
  /** peças a entregar na etapa final no horizonte */
  demandaFinal: number;
  /** estoque no início do período 0 em cada ligação (etapas.length − 1 valores; ligação k = etapa k → etapa k+1) */
  wipInicial: number[];
  /** demanda recorrente conhecida por período (peças da etapa final) — limita o estoque de saída; 0 = sem antecipação */
  recorrentePorPeriodo?: number;
  valorUnitario?: number;
}
export interface EntradaReverso {
  periodos: PeriodoRev[];
  recursos: RecursoRev[];
  produtos: ProdutoRev[];
  /** "proporcional" (default): cada produto recebe, de um recurso compartilhado, a fração demanda_i/Σ demanda; "prioridade": na ordem de `produtos` (o 1º pega o que precisar) */
  compartilhamento?: "proporcional" | "prioridade";
  /** períodos de extensão (semana seguinte) cuja demanda recorrente valoriza o estoque de saída (default 1; 0 desliga a antecipação) */
  extensaoPeriodos?: number;
  /** pessoas disponíveis por período (default: ilimitado) */
  pessoas?: number[];
  /** true: o plano obrigatório respeita `pessoas` em cada período (entrega o que cabe, produtos em ordem de valor por posto-período); false (default): calcula a necessidade física e o déficit de pessoas é só reportado */
  limitarPorPessoas?: boolean;
  /** perfil da etapa final: "alap" (mínimo necessário, o mais tarde possível; default) ou "asap" */
  perfilFinal?: "alap" | "asap" | "nivelado";
  /** 0..1: quanto do upstream é ANTECIPADO (pré-produção em períodos com pessoa/máquina livre) entre o ALAP (0, mais tarde) e o ASAP limitado pela capacidade (1). Mantém o total produzido e a cadeia válida; só desloca a produção para antes. */
  upstreamCedo?: number;
}

export interface LinhaLigacao {
  periodo: number; periodoRotulo: string;
  etapaDownstream: string; etapaUpstream: string;
  quantidadeNecessaria: number; wipDisponivel: number; necessidadeLiquida: number;
  /** último período (índice) em que a etapa upstream ainda pode produzir para cobrir a necessidade líquida acumulada até aqui; null = coberta pelo WIP */
  ultimoPeriodoSeguro: number | null; ultimoPeriodoSeguroRotulo: string | null;
  postosPeriodoNecessarios: number;
}
export interface ResultadoLigacao {
  origem: string; destino: string; wipInicial: number;
  consumoBruto: number[]; necessidadeLiquida: number[];
  producaoOrigemObrigatoria: number[]; producaoOrigemAntecipacao: number[];
  /** estoque no início de cada período (H+1 valores; o último = estoque de saída) com a produção total */
  wipProjetado: number[]; wipProjetadoObrigatorio: number[];
  coberturaPeriodos: number | null;
  inevitavel: number;
  linhas: LinhaLigacao[];
}
export interface ResultadoEtapa {
  etapaId: string; rotulo: string;
  producaoObrigatoria: number[]; producaoAntecipacao: number[];
  postosObrigatorios: number[]; postosAntecipacao: number[];
  usoPorRecurso: Record<string, number[]>;
  /** fração dos postos-período disponíveis ao produto que a etapa usa na semana (0..1) */
  utilizacao: number;
}
export interface ResultadoProdutoRev {
  produtoId: string; rotulo: string; demandaFinal: number; entregavel: number; faltaFinal: number; receita: number;
  etapas: ResultadoEtapa[]; ligacoes: ResultadoLigacao[];
  /** etapa que limita a entrega (a de maior utilização com capacidade esgotada) */
  gargaloEtapaId: string | null;
  /** produção total (obrigatória + antecipação) por etapa, para validar/comparar */
  plano: PlanoProducao;
  avisos: string[];
}
export interface HeadcountPeriodo {
  periodo: number; rotulo: string;
  postosObrigatorios: number; postosAntecipacao: number; pessoasDisponiveis: number | null;
  folga: number | null; deficit: number;
  /** recursos ocupados no período (obrigatório), do mais carregado ao menos */
  recursos: { recursoId: string; rotulo: string; uso: number }[];
  /** etapa (produto|etapa) que mais ocupa postos no período — candidata a gargalo quando há déficit */
  etapaMaisPostos: string | null;
}
export interface ResultadoReverso {
  periodos: PeriodoRev[]; produtos: ResultadoProdutoRev[]; headcount: HeadcountPeriodo[];
  headcountMinimo: number; picoComAntecipacao: number; periodosComDeficit: number[];
  usoPorRecurso: Record<string, { obrigatorio: number[]; antecipacao: number[] }>;
  avisos: string[];
}

// ---------------------------------------------------------------------------------------------------------------------------------
interface Ledger { orig: Map<string, number[]>; livre: Map<string, number[]>; uso: Map<string, number[]> }
const disponivelPara = (lg: Ledger, rid: string, t: number, share: number) => Math.max(0, Math.min(lg.livre.get(rid)?.[t] ?? 0, (lg.orig.get(rid)?.[t] ?? 0) * share));

function alternativasOrdenadas(et: EtapaRev, t: number): AlternativaRev[] {
  return [...et.alternativas].filter((a) => (a.pecasPorPosto[t] ?? 0) > 0).sort((a, b) => b.pecasPorPosto[t] - a.pecasPorPosto[t] || (a.recursoId < b.recursoId ? -1 : 1));
}

/** Capacidade em peças da etapa em cada período, dado o que sobra nos recursos (× fração do produto) e o teto de postos por período. */
function capacidadeEtapa(et: EtapaRev, H: number, lg: Ledger, share: (rid: string) => number, tetoPostos?: (t: number) => number): number[] {
  const cap = zeros(H);
  for (let t = 0; t < H; t++) {
    let resta = tetoPostos ? Math.max(0, Math.floor(tetoPostos(t) + EPS)) : Number.POSITIVE_INFINITY;
    for (const a of alternativasOrdenadas(et, t)) {
      const u = Math.min(disponivelPara(lg, a.recursoId, t, share(a.recursoId)), resta);
      if (u <= 0) continue;
      cap[t] += u * a.pecasPorPosto[t];
      resta -= u;
    }
  }
  return cap;
}

/** Converte produção em uso de recursos (postos-período), enchendo primeiro o recurso mais rápido, e baixa o saldo do ledger. */
function alocarEtapa(et: EtapaRev, prod: number[], lg: Ledger, share: (rid: string) => number, tetoPostos?: (t: number) => number): Record<string, number[]> {
  const H = prod.length;
  const uso: Record<string, number[]> = {};
  for (let t = 0; t < H; t++) {
    let falta = prod[t];
    let resta = tetoPostos ? Math.max(0, Math.floor(tetoPostos(t) + EPS)) : Number.POSITIVE_INFINITY;
    for (const a of alternativasOrdenadas(et, t)) {
      if (falta <= EPS) break;
      const disp = Math.min(disponivelPara(lg, a.recursoId, t, share(a.recursoId)), resta);
      const u = Math.min(disp, falta / a.pecasPorPosto[t]);
      if (u <= 0) continue;
      (uso[a.recursoId] ??= zeros(H))[t] += u;
      lg.livre.get(a.recursoId)![t] -= u;
      (lg.uso.get(a.recursoId) ?? lg.uso.set(a.recursoId, zeros(H)).get(a.recursoId)!)[t] += u;
      falta -= u * a.pecasPorPosto[t];
      resta -= u;
    }
  }
  return uso;
}

/** Produção máxima ASAP da cadeia (forward) com os tetos de capacidade `cap[etapa][t]`: devolve produção por etapa/período. */
function maximoAsap(cap: number[][], wip: number[], H: number): number[][] {
  const n = cap.length;
  const P = cap.map(() => zeros(H));
  const stock = wip.map((w) => w);
  for (let t = 0; t < H; t++) {
    const chega = zeros(n);
    for (let s = 0; s < n; s++) {
      const disp = s === 0 ? Number.POSITIVE_INFINITY : stock[s - 1];
      P[s][t] = Math.max(0, Math.min(cap[s][t], disp));
      if (s > 0) stock[s - 1] -= P[s][t];
      if (s < n - 1) chega[s] = P[s][t];
    }
    for (let s = 0; s < n - 1; s++) stock[s] += chega[s];
  }
  return P;
}

function wipProjetado(P: number[][], wip: number[], H: number): number[][] {
  // ligação k: estoque no início de cada período (H+1 valores) com consumo limitado ao estoque do início
  return wip.map((w, k) => {
    const out = [w];
    let s = w;
    for (let t = 0; t < H; t++) { s = s - Math.min(P[k + 1][t], s) + P[k][t]; out.push(r3(s)); }
    return out;
  });
}

/** Retropropagação de UM produto: devolve produção por etapa (obrigatória) e inevitável por ligação. */
function retropropagar(finalProd: number[], caps: number[][], wip: number[], lag = 1, cedo = 0): { P: number[][]; inev: number[] } {
  const n = caps.length, H = finalProd.length;
  const P = caps.map(() => zeros(H));
  P[n - 1] = finalProd.slice();
  const inev = zeros(Math.max(0, n - 1));
  for (let s = n - 1; s >= 1; s--) {
    const req = requisitoAcumulado(P[s], wip[s - 1], lag, zeros(H));
    const a = alapCurva(req, caps[s - 1]);
    P[s - 1] = a.producao;
    if (cedo > 0 && a.inevitavel <= 1e-3) {
      // ANTECIPAÇÃO: cumulativo = ALAP + θ·(ASAP limitado pela capacidade − ALAP). Mesmo total; nunca depois do ALAP ⇒ a cadeia continua válida.
      const total = a.producao.reduce((x, y) => x + y, 0);
      let cAlap = 0, cCap = 0, prev = 0;
      P[s - 1] = a.producao.map((_, t) => {
        cAlap += a.producao[t]; cCap += caps[s - 1][t];
        const asap = Math.min(total, cCap);
        const cum = cAlap + cedo * Math.max(0, asap - cAlap);
        const v = Math.max(0, cum - prev); prev = cum; return v;
      });
    }
    inev[s - 1] = a.inevitavel;
  }
  return { P, inev };
}

const sh = (m: Map<string, number>) => (rid: string) => m.get(rid) ?? 1;

export function planejarReverso(e: EntradaReverso): ResultadoReverso {
  const H = e.periodos.length;
  const avisos: string[] = [];
  const ledger: Ledger = { orig: new Map(e.recursos.map((r) => [r.id, r.unidades.slice(0, H)])), livre: new Map(e.recursos.map((r) => [r.id, r.unidades.slice(0, H)])), uso: new Map() };
  e.produtos.forEach((p) => {
    if (p.wipInicial.length !== p.etapas.length - 1) throw new Error(`planoReverso: ${p.id} precisa de ${p.etapas.length - 1} valores de WIP inicial`);
    p.etapas.forEach((et) => et.alternativas.forEach((a) => { if (!ledger.livre.has(a.recursoId)) throw new Error(`planoReverso: recurso ${a.recursoId} não declarado`); }));
  });
  // frações dos recursos compartilhados
  const recursosDoProduto = (p: ProdutoRev) => new Set(p.etapas.flatMap((et) => et.alternativas.map((a) => a.recursoId)));
  const fracao = new Map<string, Map<string, number>>();
  e.produtos.forEach((p) => fracao.set(p.id, new Map()));
  if ((e.compartilhamento ?? "proporcional") === "proporcional") {
    e.recursos.forEach((r) => {
      const usam = e.produtos.filter((p) => recursosDoProduto(p).has(r.id));
      if (usam.length < 2) return;
      const tot = usam.reduce((s, p) => s + Math.max(0, p.demandaFinal), 0);
      usam.forEach((p) => fracao.get(p.id)!.set(r.id, tot > 0 ? Math.max(0, p.demandaFinal) / tot : 1 / usam.length));
    });
  }

  // ---------- camada 1: OBRIGATÓRIO ----------
  const pessoas = e.pessoas;
  const pessoasUsadas = (t: number) => { let s = 0; ledger.uso.forEach((v) => (s += Math.ceil(v[t] - 1e-6))); return s; };
  const snap = (lg: Pick<Ledger, "livre" | "uso">) => ({ livre: new Map([...lg.livre].map(([k, v]) => [k, v.slice()] as [string, number[]])), uso: new Map([...lg.uso].map(([k, v]) => [k, v.slice()] as [string, number[]])) });
  type Obrig = { P: number[][]; inev: number[]; uso: Record<string, number[]>[]; entregavel: number; caps: number[][]; frac: number };
  const obrig = new Map<string, Obrig>();
  const passe = (p: ProdutoRev, frac: number): Obrig => {
    const s = sh(fracao.get(p.id)!);
    const n = p.etapas.length;
    const caps = p.etapas.map((et) => capacidadeEtapa(et, H, ledger, s));
    const M = maximoAsap(caps, p.wipInicial, H);
    const maxFinal = M[n - 1].reduce((a, b) => a + b, 0);
    const alvo = Math.max(0, Math.min(p.demandaFinal * frac, maxFinal));
    let finalProd: number[];
    if ((e.perfilFinal ?? "alap") === "asap") finalProd = M[n - 1].map((v, t) => { const ja = M[n - 1].slice(0, t).reduce((a, b) => a + b, 0); return Math.max(0, Math.min(v, alvo - ja)); });
    else if (e.perfilFinal === "nivelado") {
      // NIVELADO: a etapa final produz em proporção à sua capacidade máxima de cada período (carga constante ⇒ menos pico de pessoas por período)
      const capTot = M[n - 1].reduce((a, b) => a + b, 0);
      finalProd = M[n - 1].map((v) => (capTot > 0 ? (alvo * v) / capTot : 0));
    } else {
      const req = zeros(H); req[H - 1] = alvo;
      finalProd = alapCurva(req, M[n - 1]).producao;
    }
    const cedo = e.upstreamCedo ?? 0;
    let { P, inev } = retropropagar(finalProd, caps, p.wipInicial, 1, cedo);
    // se a capacidade compartilhada não deixa produzir tudo a tempo, reduz o final até a cadeia fechar (iteração curta)
    let guarda = 0;
    while (inev.some((v) => v > 1e-3) && guarda++ < 40) {
      const falta = Math.max(...inev);
      const tot = P[n - 1].reduce((a, b) => a + b, 0);
      const novo = Math.max(0, tot - falta);
      const req = zeros(H); req[H - 1] = novo;
      ({ P, inev } = retropropagar(alapCurva(req, M[n - 1]).producao, caps, p.wipInicial, 1, cedo));
      if (novo === 0) break;
    }
    const uso = p.etapas.map((et, k) => alocarEtapa(et, P[k], ledger, s));
    return { P, inev, uso, entregavel: P[n - 1].reduce((a, b) => a + b, 0), caps, frac };
  };
  const excede = () => { if (!pessoas) return 0; let m = 0; for (let t = 0; t < H; t++) m = Math.max(m, pessoasUsadas(t) - (pessoas[t] ?? 0)); return m; };
  const postosPorPeca = (p: ProdutoRev) => p.etapas.reduce((a, et) => a + 1 / Math.max(1, ...et.alternativas.map((x) => Math.max(...x.pecasPorPosto))), 0);
  const ordem = e.limitarPorPessoas && pessoas ? [...e.produtos].sort((a, b) => (b.valorUnitario ?? 0) / postosPorPeca(b) - (a.valorUnitario ?? 0) / postosPorPeca(a)) : e.produtos;
  for (const p of ordem) {
    if (!(e.limitarPorPessoas && pessoas)) { obrig.set(p.id, passe(p, 1)); continue; }
    // LIMITADO POR PESSOAS: maior fração da demanda cujo plano (somado aos produtos anteriores) cabe nas pessoas de cada período
    const base0 = snap(ledger);
    const restaura = () => { const c = snap(base0); ledger.livre = c.livre; ledger.uso = c.uso; };
    const aplica = (f: number): Obrig | null => { restaura(); const r = passe(p, f); return excede() > 0 ? null : r; };
    let melhor = aplica(1);
    if (!melhor) {
      let lo = 0, hi = 1;
      for (let it = 0; it < 14; it++) { const mid = (lo + hi) / 2; if (aplica(mid)) lo = mid; else hi = mid; }
      melhor = aplica(lo);
      if (!melhor) { restaura(); melhor = passe(p, 0); }
    }
    obrig.set(p.id, melhor);
  }
  const usoObrig = new Map<string, number[]>();
  ledger.uso.forEach((v, k) => usoObrig.set(k, v.slice()));
  const postosObrigPorPeriodo = Array.from({ length: H }, (_, t) => pessoasUsadas(t));

  // ---------- camada 2: ANTECIPAÇÃO ÚTIL (estoque de saída limitado à demanda recorrente; só com capacidade E pessoas que sobram) ----------
  const K = e.extensaoPeriodos ?? 1;
  const antec = new Map<string, { P: number[][]; uso: Record<string, number[]>[]; frac: number }>();
  for (const p of e.produtos) {
    const o = obrig.get(p.id)!;
    const n = p.etapas.length;
    const base = Math.max(0, p.recorrentePorPeriodo ?? 0) * K;
    const tetoPostos = pessoas ? (t: number) => (pessoas[t] ?? 0) - pessoasUsadas(t) : undefined;
    // TUDO OU NADA por produto: a antecipação só vale se a cadeia inteira (cada etapa até a primeira) a sustenta; senão reduz a meta de estoque de saída.
    const tentar = (frac: number) => {
      const S = snap(ledger);
      const Ptot = o.P.map((v) => v.slice());
      const usoAnt: Record<string, number[]>[] = p.etapas.map(() => ({}));
      const rec = base * frac;
      for (let s = n - 1; s >= 1; s--) {
        const C = [...Ptot[s], rec]; // consumo do destino + demanda recorrente da semana seguinte
        const req = requisitoAcumulado(C, p.wipInicial[s - 1], 1, zeros(H + 1));
        const capLeft = capacidadeEtapa(p.etapas[s - 1], H, ledger, () => 1, tetoPostos);
        const al = alapCurva(req, [...capLeft.map((v, t) => v + Ptot[s - 1][t]), 0]);
        if (al.inevitavel > (o.inev[s - 1] ?? 0) + 1e-3) { ledger.livre = S.livre; ledger.uso = S.uso; return null; }
        const extra = al.producao.slice(0, H).map((v, t) => Math.max(0, v - Ptot[s - 1][t]));
        if (extra.some((v) => v > EPS)) {
          usoAnt[s - 1] = alocarEtapa(p.etapas[s - 1], extra, ledger, () => 1, tetoPostos);
          Ptot[s - 1] = Ptot[s - 1].map((v, t) => v + extra[t]);
        }
      }
      return { P: Ptot, uso: usoAnt, frac };
    };
    let escolhido: { P: number[][]; uso: Record<string, number[]>[]; frac: number } = { P: o.P.map((v) => v.slice()), uso: p.etapas.map(() => ({})), frac: 0 };
    if (base > 0 && n > 1) for (const f of [1, 0.75, 0.5, 0.25, 0.1]) { const r = tentar(f); if (r) { escolhido = r; break; } }
    if (base > 0 && n > 1 && escolhido.frac < 1) avisos.push(`${p.rotulo}: antecipação útil limitada a ${Math.round(escolhido.frac * 100)}% da demanda recorrente (capacidade/pessoas)`);
    antec.set(p.id, escolhido);
  }

  // ---------- montagem do resultado ----------
  const produtos: ResultadoProdutoRev[] = e.produtos.map((p) => {
    const o = obrig.get(p.id)!, a = antec.get(p.id)!;
    const n = p.etapas.length;
    const Wobr = wipProjetado(o.P, p.wipInicial, H);
    const Wtot = wipProjetado(a.P, p.wipInicial, H);
    const etapas: ResultadoEtapa[] = p.etapas.map((et, k) => {
      const uso: Record<string, number[]> = {};
      const soma = (src: Record<string, number[]>) => Object.entries(src).forEach(([r, v]) => { const d = (uso[r] ??= zeros(H)); v.forEach((x, t) => (d[t] += x)); });
      soma(o.uso[k] ?? {});
      const uAnt: Record<string, number[]> = a.uso[k] ?? {};
      const po = zeros(H), pa = zeros(H);
      Object.values(o.uso[k] ?? {}).forEach((v) => v.forEach((x, t) => (po[t] += x)));
      Object.values(uAnt).forEach((v) => v.forEach((x, t) => (pa[t] += x)));
      const dispPecas = o.caps[k].reduce((x, y) => x + y, 0);
      const usadoPecas = o.P[k].reduce((x, y) => x + y, 0);
      return {
        etapaId: et.id, rotulo: et.rotulo, producaoObrigatoria: o.P[k].map(r3), producaoAntecipacao: a.P[k].map((v, t) => r3(v - o.P[k][t])),
        postosObrigatorios: po.map(r3), postosAntecipacao: pa.map(r3), usoPorRecurso: uso, utilizacao: dispPecas > 0 ? r3(usadoPecas / dispPecas) : 0,
      };
    });
    const ligacoes: ResultadoLigacao[] = [];
    for (let k = 0; k < n - 1; k++) {
      const C = o.P[k + 1]; // consumo do destino
      const cc = cum(C);
      const liq = C.map((_, t) => Math.max(0, cc[t] - p.wipInicial[k]) - (t > 0 ? Math.max(0, cc[t - 1] - p.wipInicial[k]) : 0));
      const cprod = cum(o.P[k]);
      const cliq = cum(liq);
      const linhas: LinhaLigacao[] = [];
      C.forEach((c, t) => {
        if (c <= EPS) return;
        let seguro: number | null = null;
        if (liq[t] > EPS) { for (let kk = 0; kk < H; kk++) if (cprod[kk] + EPS >= cliq[t]) { seguro = kk; break; } }
        const rate = etapaRate(p.etapas[k], seguro ?? Math.max(0, t - 1));
        linhas.push({
          periodo: t, periodoRotulo: e.periodos[t].rotulo, etapaDownstream: p.etapas[k + 1].rotulo, etapaUpstream: p.etapas[k].rotulo,
          quantidadeNecessaria: r3(c), wipDisponivel: Wobr[k][t], necessidadeLiquida: r3(liq[t]), ultimoPeriodoSeguro: seguro, ultimoPeriodoSeguroRotulo: seguro === null ? null : e.periodos[seguro].rotulo,
          postosPeriodoNecessarios: r3(rate > 0 ? liq[t] / rate : 0),
        });
      });
      let cob: number | null = null;
      { let s = p.wipInicial[k]; let c = 0; for (let t = 0; t < H; t++) { const need = o.P[k + 1][t]; if (need <= EPS) continue; if (s >= need) { s -= need; c += 1; } else { cob = c + s / need; break; } } if (cob === null) cob = c; }
      ligacoes.push({
        origem: p.etapas[k].id, destino: p.etapas[k + 1].id, wipInicial: p.wipInicial[k], consumoBruto: C.map(r3), necessidadeLiquida: liq.map(r3),
        producaoOrigemObrigatoria: o.P[k].map(r3), producaoOrigemAntecipacao: a.P[k].map((v, t) => r3(v - o.P[k][t])), wipProjetado: Wtot[k], wipProjetadoObrigatorio: Wobr[k],
        coberturaPeriodos: r3(cob), inevitavel: r3(o.inev[k] ?? 0), linhas,
      });
    }
    const gargalo = [...etapas].sort((x, y) => y.utilizacao - x.utilizacao)[0];
    const av: string[] = [];
    if (o.entregavel + 1 < p.demandaFinal) av.push(`entregável ${Math.round(o.entregavel)} < demanda ${Math.round(p.demandaFinal)}: limitado pela capacidade/WIP (gargalo ${gargalo?.rotulo})`);
    if (o.inev.some((v) => v > 1)) av.push("há reposição inevitável: a capacidade upstream não alcança a necessidade a tempo");
    return {
      produtoId: p.id, rotulo: p.rotulo, demandaFinal: p.demandaFinal, entregavel: r3(o.entregavel), faltaFinal: r3(Math.max(0, p.demandaFinal - o.entregavel)), receita: r3(o.entregavel * (p.valorUnitario ?? 0)),
      etapas, ligacoes, gargaloEtapaId: o.entregavel + 1 < p.demandaFinal ? gargalo?.etapaId ?? null : null, plano: Object.fromEntries(p.etapas.map((et, k) => [et.id, a.P[k].map(r3)])), avisos: av,
    };
  });

  // ---------- headcount ----------
  const usoRec: ResultadoReverso["usoPorRecurso"] = {};
  e.recursos.forEach((r) => {
    const tot = ledger.uso.get(r.id) ?? zeros(H), ob = usoObrig.get(r.id) ?? zeros(H);
    usoRec[r.id] = { obrigatorio: ob.map(r3), antecipacao: tot.map((v, t) => r3(v - ob[t])) };
  });
  const headcount: HeadcountPeriodo[] = Array.from({ length: H }, (_, t) => {
    const recs = e.recursos.map((r) => ({ recursoId: r.id, rotulo: r.rotulo, uso: usoRec[r.id].obrigatorio[t] })).filter((x) => x.uso > 1e-6).sort((a, b) => b.uso - a.uso);
    const pob = recs.reduce((s, x) => s + Math.ceil(x.uso - 1e-6), 0);
    const ptot = e.recursos.reduce((s, r) => s + Math.ceil(usoRec[r.id].obrigatorio[t] + usoRec[r.id].antecipacao[t] - 1e-6), 0);
    const disp = pessoas ? pessoas[t] ?? 0 : null;
    let mais: string | null = null, mx = 0;
    produtos.forEach((p) => p.etapas.forEach((et) => { if (et.postosObrigatorios[t] > mx + 1e-9) { mx = et.postosObrigatorios[t]; mais = `${p.rotulo} | ${et.rotulo}`; } }));
    return { periodo: t, rotulo: e.periodos[t].rotulo, postosObrigatorios: pob, postosAntecipacao: Math.max(0, ptot - pob), pessoasDisponiveis: disp, folga: disp === null ? null : Math.max(0, disp - pob), deficit: disp === null ? 0 : Math.max(0, pob - disp), recursos: recs, etapaMaisPostos: mais };
  });
  void postosObrigPorPeriodo;
  return {
    periodos: e.periodos, produtos, headcount, headcountMinimo: Math.max(0, ...headcount.map((h) => h.postosObrigatorios)), picoComAntecipacao: Math.max(0, ...headcount.map((h) => h.postosObrigatorios + h.postosAntecipacao)),
    periodosComDeficit: headcount.filter((h) => h.deficit > 0).map((h) => h.periodo), usoPorRecurso: usoRec, avisos,
  };
}

function etapaRate(et: EtapaRev, t: number): number {
  return Math.max(0, ...et.alternativas.map((a) => a.pecasPorPosto[Math.min(t, a.pecasPorPosto.length - 1)] ?? 0));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Validação: um plano de produção por etapa (qualquer origem: legado, fluxo atual, reverso) contra o WIP inicial, período a período.
// ---------------------------------------------------------------------------------------------------------------------------------
export interface CadeiaSimples { etapas: { id: string; rotulo: string }[]; wipInicial: number[]; periodos: PeriodoRev[] }

/** Constrói a EntradaForecast linear (etapa k → k+1, lote de 1 período) para `validarCadeia`. */
export function entradaDeCadeia(c: CadeiaSimples, plano: PlanoProducao): EntradaForecast {
  return {
    periodos: c.periodos.map((p) => ({ rotulo: p.rotulo, duracaoMin: p.duracaoMin })),
    nos: c.etapas.map((et) => ({ id: et.id, rotulo: et.rotulo, producaoPrevista: plano[et.id] ?? zeros(c.periodos.length), demandaRestante: null })),
    ligacoes: c.etapas.slice(0, -1).map((et, k) => ({ id: `${et.id}>${c.etapas[k + 1].id}`, origem: et.id, destino: c.etapas[k + 1].id, wipInicial: c.wipInicial[k], confianca: "media" as const, atrasoPeriodos: 1 })),
  };
}
export function validarPlanoCadeia(c: CadeiaSimples, plano: PlanoProducao): SimulacaoCadeia {
  return validarCadeia(entradaDeCadeia(c, plano), plano, { usarCapacidadeMaxima: false });
}

/** Texto em cadeia (Embalar X ← Y etiquetadas ← Z …) para um período de uso da etapa final. */
export function explicarCadeia(p: ResultadoProdutoRev, periodoDeUso: number, rotulos: string[]): string {
  const n = rotulos.length;
  const partes: string[] = [];
  let t = periodoDeUso;
  const X = p.ligacoes[n - 2]?.consumoBruto[t] ?? 0;
  partes.push(`Para ${rotulos[n - 1]} ${Math.round(X)} peças em ${p.ligacoes[n - 2]?.linhas.find((l) => l.periodo === t)?.periodoRotulo ?? `P${t}`}`);
  for (let k = n - 2; k >= 0; k--) {
    const lg = p.ligacoes[k];
    const need = lg.consumoBruto[t] ?? 0;
    const wip = lg.wipProjetadoObrigatorio[t] ?? 0;
    const prev = Math.max(0, t - 1);
    const prod = lg.producaoOrigemObrigatoria[prev] ?? 0;
    partes.push(`é preciso ter ${Math.round(need)} (${rotulos[k]}) no início (estoque projetado ${Math.round(wip)})`);
    partes.push(`${rotulos[k]} precisa produzir ${Math.round(prod)} no período anterior`);
    t = prev;
    if (t === 0 && k > 0) { partes.push(`o que não existir no estoque inicial não pode mais ser produzido a tempo`); break; }
  }
  return partes.join("; ") + ".";
}
