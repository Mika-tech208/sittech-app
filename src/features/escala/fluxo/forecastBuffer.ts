// FORECAST DE BUFFER — fluxo PUXADO (Embalar puxa Etiquetar, que puxa Parafusar, que puxa Rosquear). PURO, DESLIGADO, OFFLINE: nada no motor chama isto.
//
// Em vez de "tenho material agora?", pergunta, por LIGAÇÃO entre etapas (origem → destino) de qualquer roteiro A→B→C→D:
//   • quantos PERÍODOS o buffer aguenta no ritmo previsto do destino, SEM reposição (TIME_TO_STARVATION / PERIODOS_DE_COBERTURA);
//   • qual o saldo projetado ao fim de cada período COM a reposição prevista pelo plano e em que período há RUPTURA;
//   • qual o PONTO DE PEDIDO dinâmico (REORDER_POINT): estoque que o buffer precisa ter no início de cada período para que, ligando a origem
//     naquele período à capacidade máxima, o destino nunca fique sem peça (cobre o tempo até a reposição chegar + o tempo de produzi-la);
//   • o que é preciso ligar AGORA (ALAP: o mais tarde possível que ainda evita a ruptura), propagado para trás pela cadeia inteira: se a
//     etapa B precisa de reposição, a etapa A precisa produzi-la; se A não tem estoque para isso, a etapa anterior a A precisa produzir antes, etc.
//
// Produtos e etapas NÃO são conhecidos aqui: entram só nós (ids opacos), ligações e séries por período. Tudo em PEÇAS. Sem Date/IO/Supabase.
//
// Convenções de tempo (períodos 0..H-1, o 0 é o primeiro período ainda alterável):
//   mesmoPeriodo=false (REGRA CONSERVADORA publicada, producao_real_fluxo_mesmo_periodo=false): o destino de um período só consome o estoque do
//     INÍCIO dele; o que a origem produz no período chega para o destino no período SEGUINTE (o tempo físico de transferência não é modelado).
//   mesmoPeriodo=true (modelo antigo): a produção da origem no próprio período alimenta o destino no mesmo período (consumo ≤ estoque inicial + produção).
// Produção de um nó = min(previsto, material disponível nas ligações de entrada, demanda restante). Nó sem ligação de entrada = material externo (não limita).
//
// Limites assumidos (declarados): 1 peça de entrada = `rendimento` peças da origem por peça do destino (default 1); sem lead time além do flag acima;
// o consumo do destino é o que o plano o deixa fazer (previsto), não o que a demanda do cliente pede; ligações com 2+ origens no mesmo destino
// (Conector fundido com a Máquina 8) dividem a necessidade pelo `peso` (diagnóstico por destino = soma dos estoques das origens).

export const EPS_FB = 1e-6;

export type ConfiancaForecast = "alta" | "media" | "baixa";
/** De onde vem a produtividade usada no período: REAL (apontamento de período fechado), HISTORICO (posto×operação×produto, janela curta) ou META (fallback). */
export type FonteTaxa = "real" | "historico" | "meta";

export interface PeriodoForecast {
  rotulo: string; // "T1", "ter M2"... (só texto)
  duracaoMin: number; // para o minuto da ruptura dentro do período
  /** fração do período ainda por vir (default 1). Multiplica previsão e capacidade desse período; o estoque inicial já desconta o que passou. */
  fracao?: number;
}

export interface NoForecast {
  id: string;
  rotulo: string;
  /** Peças que o nó produziria em cada período SE tivesse material: postos do plano × produtividade (real/histórico/meta). */
  producaoPrevista: number[];
  /** Máximo que produziria se todos os postos possíveis fossem ligados (≥ producaoPrevista). Ausente = igual ao previsto (não há como ligar mais). */
  capacidadeMaxima?: number[];
  /** Teto cumulativo de produção do nó no horizonte (demanda restante). Ausente/null = sem teto. */
  demandaRestante?: number | null;
  fonteTaxa?: FonteTaxa[];
  /** Produtividade de UM posto por período (peças/posto) — converte peças em postos/pessoas-período. */
  pecasPorPosto?: number[];
  postosPrevistos?: number[];
}

export interface LigacaoForecast {
  id: string;
  rotulo?: string;
  origem: string;
  destino: string;
  /** Estoque entre as duas etapas no início do horizonte (cenário pessimista) e, opcionalmente, o otimista. */
  wipInicial: number;
  wipInicialHi?: number;
  confianca: ConfiancaForecast;
  /** Peças da origem consumidas por peça produzida no destino (default 1). */
  rendimento?: number;
  /** Fração da necessidade do destino atendida por esta origem quando há 2+ origens (default: 1 ÷ nº de origens). */
  peso?: number;
  /** Teto de WIP aceitável nesta ligação (peças); só para sinalizar `excedeTeto`. */
  tetoWip?: number;
}

export interface OpcoesForecast {
  /** Default false (regra conservadora). */
  mesmoPeriodo?: boolean;
  /** Estoque de segurança como fração do consumo do período, por confiança do WIP. Default 0 em todas: nenhum dado justifica um número (ver relatório). */
  margemPorConfianca?: Partial<Record<ConfiancaForecast, number>>;
  /** Fração (0..1] da produção prevista dos nós que ALIMENTAM outro nó em que se pode confiar (default 1). Deve vir de um quantil medido do histórico. */
  fatorReposicao?: number;
  /** Se false, só o plano produz (sem ligar mais postos): `capacidadeMaxima` é ignorada. Default true. */
  usarCapacidadeMaxima?: boolean;
}

export interface EntradaForecast {
  periodos: PeriodoForecast[];
  nos: NoForecast[];
  ligacoes: LigacaoForecast[];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------------------------------------------------------------

export interface Ruptura {
  periodo: number; // índice 0..H-1
  rotulo: string;
  faltaPecas: number; // consumo desejado − consumo possível nesse período
  /** minuto (dentro do período) em que o estoque zera, assumindo consumo linear; null se não faz sentido (estoque 0 no início ou consumo 0). */
  minuto: number | null;
}

export interface Cobertura {
  /** Períodos (fracionário) até o buffer zerar no ritmo previsto do destino, SEM reposição. null quando cobre todo o horizonte. */
  periodos: number | null;
  cobreHorizonte: boolean;
  /** período (índice) em que o estoque deixa de cobrir o consumo; null se cobre o horizonte */
  periodoDaRuptura: number | null;
  minutoDaRuptura: number | null;
}

export interface AcaoUpstream {
  tipo: "nenhuma" | "ligar_upstream" | "sem_fonte";
  /** primeiro período em que o upstream precisa produzir ALÉM do plano (null = o plano já cobre). */
  ligarEm: number | null;
  ligarEmRotulo: string | null;
  /** peças a acrescentar por período (além do plano), respeitando a capacidade máxima */
  adicionar: number[];
  postosAdicionais: number[];
  /** peças que NÃO dá para repor a tempo mesmo ligando tudo (capacidade/estoque): ruptura inevitável */
  inevitavel: number;
  inevitavelDesdePeriodo: number | null;
}

export interface DiagnosticoLigacao {
  ligacaoId: string;
  rotulo: string;
  origem: string;
  destino: string;
  confianca: ConfiancaForecast;
  wipInicial: number;
  /** consumo previsto do destino nesta ligação por período (peças da origem; = produção prevista do destino × rendimento × peso) */
  consumoPrevisto: number[];
  /** produção do nó de origem no plano por período (efetiva: limitada pelo próprio material dela) = reposição prevista */
  reposicaoPrevista: number[];
  /** saldo (estoque) ao FIM de cada período com a reposição do plano */
  saldoProjetado: number[];
  /** idem sem nenhuma reposição */
  saldoSemReposicao: number[];
  /** TIME_TO_STARVATION (sem reposição), com o ritmo previsto do destino */
  coberturaSemReposicao: Cobertura;
  /** ruptura prevista COM a reposição do plano (null = não rompe) */
  rupturaPrevista: Ruptura | null;
  /** ponto de pedido dinâmico por período: estoque necessário no INÍCIO do período p/ nunca faltar ligando a origem à capacidade máxima desse período em diante */
  pontoDePedido: number[];
  /** primeiro período em que o saldo projetado no início fica abaixo do ponto de pedido (a origem já deveria estar ligada) */
  gatilhoPontoDePedido: number | null;
  /** o que é preciso fazer na ORIGEM para a ligação nunca romper (propagado pela cadeia) */
  acao: AcaoUpstream;
  /** saldo ao fim de cada período se a ação for aplicada (auto-verificação) */
  saldoComAcao: number[];
  rupturaComAcao: Ruptura | null;
  excedeTeto: boolean;
  /** pico de WIP com a ação (peças) */
  picoWipComAcao: number;
}

export interface DiagnosticoNo {
  noId: string;
  rotulo: string;
  producaoPlano: number[]; // efetiva (limitada por material e demanda)
  producaoDesejada: number[]; // previsto sem a limitação de material
  /** ruptura de material DESTE nó (o consumo desejado não é atendido) segundo o plano */
  rupturaPrevista: Ruptura | null;
  /** producao total alvo = plano + ação */
  producaoAlvo: number[];
  /** peças que podiam deixar de ser produzidas aqui sem criar ruptura adiante, por período, SEM somar entre períodos (capacidade livre para outra necessidade) */
  removivel: number[];
  postosLivres: number[];
  fonteTaxa: FonteTaxa[];
}

export interface ResultadoForecast {
  periodos: PeriodoForecast[];
  mesmoPeriodo: boolean;
  ligacoes: DiagnosticoLigacao[];
  nos: DiagnosticoNo[];
  /** menor coberturaSemReposicao.periodos entre as ligações (null = todas cobrem o horizonte) */
  menorCobertura: number | null;
  confianca: ConfiancaForecast;
  avisos: string[];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Utilidades numéricas
// ---------------------------------------------------------------------------------------------------------------------------------

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const soma = (a: number[]) => a.reduce((s, v) => s + v, 0);
const zeros = (n: number) => new Array<number>(n).fill(0);
const PIOR: Record<ConfiancaForecast, number> = { alta: 0, media: 1, baixa: 2 };
const pior = (a: ConfiancaForecast, b: ConfiancaForecast) => (PIOR[b] > PIOR[a] ? b : a);

function cumulativa(v: number[]): number[] {
  const c: number[] = [];
  let s = 0;
  v.forEach((x) => c.push((s += x)));
  return c;
}

/**
 * TIME_TO_STARVATION: períodos (fracionário) até o estoque `s0` zerar consumindo `consumo[t]` por período, sem reposição. Períodos de consumo 0 contam como
 * tempo decorrido (o relógio anda) e não consomem. null em `periodos` ⇒ cobre todo o horizonte.
 */
export function coberturaSemReposicao(s0: number, consumo: number[], duracaoMin?: number[]): Cobertura {
  let s = Math.max(0, s0);
  for (let t = 0; t < consumo.length; t++) {
    const c = Math.max(0, consumo[t]);
    if (c <= EPS_FB) continue;
    if (s + EPS_FB >= c) {
      s -= c;
      continue;
    }
    const frac = s / c;
    return { periodos: r3(t + frac), cobreHorizonte: false, periodoDaRuptura: t, minutoDaRuptura: duracaoMin ? r3(frac * duracaoMin[t]) : null };
  }
  return { periodos: null, cobreHorizonte: true, periodoDaRuptura: null, minutoDaRuptura: null };
}

/**
 * Agenda a produção MÍNIMA e o mais TARDE possível (ALAP) de uma origem para atender ao consumo acumulado `consumoCum[k]` (k = 0..H-1) do destino, dado o
 * estoque inicial `s0`, a capacidade `cap[k]` e o estoque de segurança `ss[k]` (no início do período k). Devolve a produção por período e as peças que
 * não há como repor a tempo (`inevitavel`) com o 1º período afetado.
 * mesmoPeriodo=false: o consumo do período k precisa estar coberto pela produção acumulada até k-1 (a do próprio período chega depois).
 */
export function agendarMontante(consumoCum: number[], s0: number, cap: number[], ss: number[], mesmoPeriodo: boolean): { producao: number[]; inevitavel: number; inevitavelDesde: number | null } {
  const H = consumoCum.length;
  // req[i], i = k+1; i=0 é "antes do horizonte" (k = -1): produção acumulada que já precisaria existir
  const req = zeros(H + 1);
  for (let k = 0; k < H; k++) {
    // período de consumo t cujo requisito recai sobre a produção acumulada até k
    const t = mesmoPeriodo ? k : k + 1;
    if (t <= H - 1) req[k + 1] = Math.max(0, consumoCum[t] - s0 + (ss[t] ?? 0));
    else req[k + 1] = req[k];
  }
  if (!mesmoPeriodo) req[0] = Math.max(0, consumoCum[0] - s0 + (ss[0] ?? 0));
  // curva acumulada mínima: máximo corrente (não decrescente)
  const P = zeros(H + 1);
  P[0] = req[0];
  for (let i = 1; i <= H; i++) P[i] = Math.max(P[i - 1], req[i]);
  // empurra para trás o que excede a capacidade: P[k-1] ≥ P[k] − cap[k]
  for (let i = H; i >= 1; i--) P[i - 1] = Math.max(P[i - 1], P[i] - Math.max(0, cap[i - 1] ?? 0));
  const inevitavel = P[0]; // produção que teria que existir antes do horizonte
  let desde: number | null = null;
  if (inevitavel > EPS_FB) {
    // 1º período cujo requisito só é atendido pelo que falta
    desde = mesmoPeriodo ? 0 : 0;
  }
  // produção realizável: a partir do zero antes do horizonte, no máximo a capacidade por período
  const prod = zeros(H);
  let acum = 0;
  for (let k = 0; k < H; k++) {
    const alvo = Math.max(P[k + 1], P[0]);
    const x = Math.min(Math.max(0, cap[k] ?? 0), Math.max(0, alvo - acum));
    prod[k] = x;
    acum += x;
  }
  return { producao: prod.map(r3), inevitavel: r3(Math.max(0, inevitavel)), inevitavelDesde: desde };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ordem topológica e normalização
// ---------------------------------------------------------------------------------------------------------------------------------

function ordenar(nos: NoForecast[], ligacoes: LigacaoForecast[]): string[] {
  const grau = new Map<string, number>(nos.map((n) => [n.id, 0]));
  ligacoes.forEach((l) => grau.set(l.destino, (grau.get(l.destino) ?? 0) + 1));
  const fila = [...grau.entries()].filter(([, g]) => g === 0).map(([id]) => id).sort();
  const saida: string[] = [];
  const pend = new Map(grau);
  while (fila.length > 0) {
    const id = fila.shift() as string;
    saida.push(id);
    ligacoes.filter((l) => l.origem === id).forEach((l) => {
      const g = (pend.get(l.destino) ?? 0) - 1;
      pend.set(l.destino, g);
      if (g === 0) {
        fila.push(l.destino);
        fila.sort();
      }
    });
  }
  if (saida.length !== nos.length) throw new Error("forecastBuffer: o grafo de ligações tem ciclo");
  return saida;
}

interface NoN {
  id: string;
  rotulo: string;
  prod: number[]; // previsto (efetivo, já com fração e fatorReposicao)
  cap: number[]; // capacidade máxima (≥ prod)
  dem: number | null;
  pecasPorPosto: number[];
  fonteTaxa: FonteTaxa[];
  entradas: LigacaoForecast[];
  saidas: LigacaoForecast[];
}

function normalizar(e: EntradaForecast, op: OpcoesForecast): { nos: Map<string, NoN>; topo: string[]; ligs: LigacaoForecast[]; pesos: Map<string, number> } {
  const H = e.periodos.length;
  const ids = new Set(e.nos.map((n) => n.id));
  if (ids.size !== e.nos.length) throw new Error("forecastBuffer: ids de nó repetidos");
  e.ligacoes.forEach((l) => {
    if (!ids.has(l.origem) || !ids.has(l.destino)) throw new Error(`forecastBuffer: ligação ${l.id} refere nó inexistente`);
    if (l.origem === l.destino) throw new Error(`forecastBuffer: ligação ${l.id} liga o nó a ele mesmo`);
  });
  const f = op.fatorReposicao ?? 1;
  if (!(f > 0 && f <= 1)) throw new Error("forecastBuffer: fatorReposicao fora de (0,1]");
  const usarCap = op.usarCapacidadeMaxima !== false;
  const fr = e.periodos.map((p) => Math.max(0, Math.min(1, p.fracao ?? 1)));
  const nos = new Map<string, NoN>();
  e.nos.forEach((n) => {
    if (n.producaoPrevista.length !== H) throw new Error(`forecastBuffer: nó ${n.id} com ${n.producaoPrevista.length} períodos (esperado ${H})`);
    const alimenta = e.ligacoes.some((l) => l.origem === n.id);
    const esc = (alimenta ? f : 1);
    const prod = n.producaoPrevista.map((v, t) => Math.max(0, v) * fr[t] * esc);
    const capBase = usarCap ? (n.capacidadeMaxima ?? n.producaoPrevista) : n.producaoPrevista;
    const cap = capBase.map((v, t) => Math.max(prod[t], Math.max(0, v) * fr[t] * esc));
    nos.set(n.id, {
      id: n.id, rotulo: n.rotulo, prod, cap, dem: n.demandaRestante === undefined ? null : n.demandaRestante,
      pecasPorPosto: (n.pecasPorPosto ?? zeros(H)).map((v, t) => Math.max(0, v) * fr[t] * esc),
      fonteTaxa: n.fonteTaxa ?? new Array<FonteTaxa>(H).fill("meta"),
      entradas: e.ligacoes.filter((l) => l.destino === n.id), saidas: e.ligacoes.filter((l) => l.origem === n.id),
    });
  });
  const pesos = new Map<string, number>();
  nos.forEach((n) => {
    const somaDeclarada = n.entradas.reduce((s, l) => s + (l.peso ?? 0), 0);
    const semPeso = n.entradas.filter((l) => l.peso === undefined);
    n.entradas.forEach((l) => pesos.set(l.id, l.peso !== undefined ? l.peso : semPeso.length > 0 ? Math.max(0, 1 - somaDeclarada) / semPeso.length : 1));
  });
  return { nos, topo: ordenar(e.nos, e.ligacoes), ligs: e.ligacoes, pesos };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Simulação para a frente (plano + extras)
// ---------------------------------------------------------------------------------------------------------------------------------

interface Sim {
  x: Map<string, number[]>; // produção efetiva por nó
  desejado: Map<string, number[]>; // produção desejada (sem limite de material)
  wIni: Map<string, number[]>; // estoque no início do período, por ligação
  wFim: Map<string, number[]>;
  take: Map<string, number[]>; // consumo efetivo da ligação
  want: Map<string, number[]>; // consumo desejado atribuído à ligação (peso)
}

function simularAvante(nos: Map<string, NoN>, topo: string[], ligs: LigacaoForecast[], pesos: Map<string, number>, H: number, mesmo: boolean, extra: Map<string, number[]>, wip0: (l: LigacaoForecast) => number): Sim {
  const W = new Map<string, number>(ligs.map((l) => [l.id, Math.max(0, wip0(l))]));
  const sim: Sim = { x: new Map(), desejado: new Map(), wIni: new Map(), wFim: new Map(), take: new Map(), want: new Map() };
  nos.forEach((_, id) => { sim.x.set(id, zeros(H)); sim.desejado.set(id, zeros(H)); });
  ligs.forEach((l) => { sim.wIni.set(l.id, zeros(H)); sim.wFim.set(l.id, zeros(H)); sim.take.set(l.id, zeros(H)); sim.want.set(l.id, zeros(H)); });
  const cum = new Map<string, number>([...nos.keys()].map((k) => [k, 0])); // desejado acumulado (a demanda restante é consumida pelo que se QUIS produzir)
  for (let t = 0; t < H; t++) {
    const wIni = new Map(W);
    ligs.forEach((l) => (sim.wIni.get(l.id) as number[])[t] = wIni.get(l.id) as number);
    for (const id of topo) {
      const n = nos.get(id) as NoN;
      const des0 = n.prod[t] + (extra.get(id)?.[t] ?? 0);
      const rest = n.dem === null ? Number.POSITIVE_INFINITY : Math.max(0, n.dem - (cum.get(id) as number));
      const des = Math.min(des0, rest);
      (sim.desejado.get(id) as number[])[t] = des;
      cum.set(id, (cum.get(id) as number) + des);
      const disp = (l: LigacaoForecast) => (mesmo ? (W.get(l.id) as number) : (wIni.get(l.id) as number));
      let x = des;
      if (n.entradas.length > 0) {
        const avail = n.entradas.reduce((s, l) => s + disp(l) / (l.rendimento ?? 1), 0);
        x = Math.min(des, avail);
        const dispTotal = n.entradas.reduce((s, l) => s + disp(l), 0);
        n.entradas.forEach((l) => {
          const rend = l.rendimento ?? 1;
          (sim.want.get(l.id) as number[])[t] = des * (pesos.get(l.id) ?? 1) * rend;
          const tira = Math.min(W.get(l.id) as number, dispTotal > EPS_FB ? (disp(l) / dispTotal) * x * rend : 0);
          W.set(l.id, (W.get(l.id) as number) - tira);
          (sim.take.get(l.id) as number[])[t] = tira;
        });
      }
      (sim.x.get(id) as number[])[t] = x;
      n.saidas.forEach((l) => W.set(l.id, (W.get(l.id) as number) + x));
    }
    ligs.forEach((l) => (sim.wFim.get(l.id) as number[])[t] = W.get(l.id) as number);
  }
  return sim;
}

function ruptura(des: number[], efet: number[], wIniNo: number[], periodos: PeriodoForecast[]): Ruptura | null {
  for (let t = 0; t < des.length; t++) {
    if (efet[t] + 1e-4 < des[t]) {
      const falta = des[t] - efet[t];
      return { periodo: t, rotulo: periodos[t].rotulo, faltaPecas: r3(falta), minuto: des[t] > EPS_FB && wIniNo[t] > EPS_FB ? r3((wIniNo[t] / des[t]) * periodos[t].duracaoMin) : null };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------------------------------------------------------------

export function forecastBuffer(entrada: EntradaForecast, op: OpcoesForecast = {}): ResultadoForecast {
  const H = entrada.periodos.length;
  const mesmo = op.mesmoPeriodo === true;
  const margem = (c: ConfiancaForecast) => Math.max(0, op.margemPorConfianca?.[c] ?? 0);
  const { nos, topo, ligs, pesos } = normalizar(entrada, op);
  const avisos: string[] = [];
  const wip0 = (l: LigacaoForecast) => l.wipInicial;
  const sim1 = simularAvante(nos, topo, ligs, pesos, H, mesmo, new Map(), wip0);

  // ---- para trás (do destino final à origem): alvo de produção de cada nó = plano + extras ----
  const alvo = new Map<string, number[]>(); // produção total alvo
  const extra = new Map<string, number[]>();
  const inev = new Map<string, { pecas: number; desde: number | null }>();
  const reqDoDestino = new Map<string, number[]>(); // consumo requerido por ligação (peças da origem) por período
  const pontoPedido = new Map<string, number[]>();
  const removivel = new Map<string, number[]>();
  [...topo].reverse().forEach((id) => {
    const n = nos.get(id) as NoN;
    const x = sim1.x.get(id) as number[];
    if (n.saidas.length === 0) {
      // sorvedouro: o alvo é o desejado (previsto limitado pela demanda), não o que o material deixou passar
      alvo.set(id, [...(sim1.desejado.get(id) as number[])]);
      extra.set(id, zeros(H));
      inev.set(id, { pecas: 0, desde: null });
      removivel.set(id, zeros(H));
      return;
    }
    // consumo acumulado requerido de n por todos os destinos
    const consCum = zeros(H);
    const ssTot = zeros(H);
    let s0Tot = 0;
    n.saidas.forEach((l) => {
      const dest = l.destino;
      const T = alvo.get(dest) as number[];
      const rend = l.rendimento ?? 1;
      const w = pesos.get(l.id) ?? 1;
      const cons = T.map((v) => v * rend * w);
      reqDoDestino.set(l.id, cons);
      const cc = cumulativa(cons);
      cc.forEach((v, k) => (consCum[k] += v));
      cons.forEach((v, k) => (ssTot[k] += margem(l.confianca) * v));
      s0Tot += Math.max(0, wip0(l));
    });
    const capN = n.cap;
    // produção mínima ALAP para atender ao consumo (sem considerar o plano) — só informativa; a ação é a lacuna contra o plano
    const Xcum = cumulativa(x);
    // requisito acumulado (mesma regra de agendarMontante) para medir a lacuna do plano
    const req = zeros(H + 1);
    for (let k = 0; k < H; k++) {
      const t = mesmo ? k : k + 1;
      req[k + 1] = t <= H - 1 ? Math.max(0, consCum[t] - s0Tot + ssTot[t]) : req[k];
    }
    if (!mesmo) req[0] = Math.max(0, consCum[0] - s0Tot + ssTot[0]);
    const Ecum = zeros(H + 1); // extra acumulada necessária (índice i=k+1)
    Ecum[0] = Math.max(0, req[0] - 0);
    for (let i = 1; i <= H; i++) Ecum[i] = Math.max(Ecum[i - 1], req[i] - Xcum[i - 1]);
    const A = zeros(H);
    for (let k = 0; k < H; k++) A[k] = Math.max(0, Ecum[k + 1] - Ecum[k]);
    let pend0 = Ecum[0]; // antes do horizonte: só será "inevitável"
    // empurra para trás o que excede a sobra de capacidade e a demanda
    const room = capN.map((c, k) => Math.max(0, c - x[k]));
    for (let k = H - 1; k >= 0; k--) {
      if (A[k] > room[k] + EPS_FB) {
        const exc = A[k] - room[k];
        A[k] = room[k];
        if (k > 0) A[k - 1] += exc;
        else pend0 += exc;
      }
    }
    if (n.dem !== null) {
      let livre = Math.max(0, n.dem - soma(x));
      for (let k = 0; k < H; k++) {
        const aloc = Math.min(A[k], livre);
        livre -= aloc;
        if (A[k] > aloc + EPS_FB) pend0 += A[k] - aloc;
        A[k] = aloc;
      }
    }
    extra.set(id, A.map(r3));
    alvo.set(id, x.map((v, k) => v + A[k]));
    const primeiroInev = pend0 > EPS_FB ? 0 : null;
    inev.set(id, { pecas: r3(pend0), desde: primeiroInev });

    // ponto de pedido dinâmico por ligação de saída
    n.saidas.forEach((l) => {
      const cons = reqDoDestino.get(l.id) as number[];
      const pp = zeros(H);
      for (let k = 0; k < H; k++) {
        let melhor = 0;
        let somaC = 0;
        let somaCap = 0;
        for (let j = k; j < H; j++) {
          somaC += cons[j] + margem(l.confianca) * cons[j];
          // conservador: a produção do período j só chega depois de j (não conta p/ j); mesmoPeriodo conta
          const capJ = Math.max(0, capN[j]);
          const entrega = mesmo ? somaCap + capJ : somaCap;
          melhor = Math.max(melhor, somaC - entrega);
          somaCap += capJ;
        }
        pp[k] = r3(Math.max(0, melhor));
      }
      pontoPedido.set(l.id, pp);
    });

    // removível: produção do plano+ação acima do requisito, sem criar ruptura adiante (mínimo acumulado a partir do período)
    const T = alvo.get(id) as number[];
    const Tcum = cumulativa(T);
    const sobra = Tcum.map((v, k) => v - req[k + 1]);
    const rem = zeros(H);
    let minSuf = Number.POSITIVE_INFINITY;
    for (let k = H - 1; k >= 0; k--) {
      minSuf = Math.min(minSuf, sobra[k]);
      rem[k] = Math.max(0, Math.min(minSuf, T[k]));
    }
    removivel.set(id, rem.map(r3));
  });

  // ---- 2ª simulação com as ações aplicadas (auto-verificação) ----
  const sim2 = simularAvante(nos, topo, ligs, pesos, H, mesmo, extra, wip0);

  // ---- diagnósticos por nó ----
  const noDiag: DiagnosticoNo[] = [...nos.values()].map((n) => {
    const x = sim1.x.get(n.id) as number[];
    const des = sim1.desejado.get(n.id) as number[];
    const wIniNo = n.entradas.length === 0 ? zeros(H) : zeros(H).map((_, t) => n.entradas.reduce((s, l) => s + (sim1.wIni.get(l.id) as number[])[t], 0));
    const pp = n.pecasPorPosto;
    const rem = removivel.get(n.id) as number[];
    return {
      noId: n.id, rotulo: n.rotulo, producaoPlano: x.map(r3), producaoDesejada: des.map(r3),
      rupturaPrevista: n.entradas.length === 0 ? null : ruptura(des, x, wIniNo, entrada.periodos),
      producaoAlvo: (alvo.get(n.id) as number[]).map(r3), removivel: rem,
      postosLivres: rem.map((v, k) => (pp[k] > EPS_FB ? Math.floor(v / pp[k] + 1e-9) : 0)),
      fonteTaxa: n.fonteTaxa,
    };
  });
  const noPorId = new Map(noDiag.map((d) => [d.noId, d]));

  // ---- diagnósticos por ligação ----
  const durs = entrada.periodos.map((p) => p.duracaoMin);
  const lig: DiagnosticoLigacao[] = ligs.map((l) => {
    const dest = nos.get(l.destino) as NoN;
    const orig = nos.get(l.origem) as NoN;
    const w = pesos.get(l.id) ?? 1;
    const rend = l.rendimento ?? 1;
    // consumo PREVISTO do destino (sem material limitando): produção prevista do destino (limitada pela demanda) × rendimento × peso
    const consumoPrev = (sim1.desejado.get(dest.id) as number[]).map((v) => r3(v * rend * w));
    const cobertura = coberturaSemReposicao(Math.max(0, l.wipInicial), consumoPrev, durs);
    const saldoSem: number[] = [];
    let s = Math.max(0, l.wipInicial);
    consumoPrev.forEach((c) => { s = Math.max(0, s - c); saldoSem.push(r3(s)); });
    const wIniL = sim1.wIni.get(l.id) as number[];
    const rup = ruptura((sim1.want.get(l.id) as number[]).map((v, t) => v), sim1.take.get(l.id) as number[], wIniL, entrada.periodos);
    const rup2 = ruptura((sim2.want.get(l.id) as number[]), sim2.take.get(l.id) as number[], sim2.wIni.get(l.id) as number[], entrada.periodos);
    const pp = pontoPedido.get(l.id) as number[];
    let gatilho: number | null = null;
    for (let t = 0; t < H; t++) {
      if (wIniL[t] + 1e-4 < pp[t] && pp[t] > EPS_FB) { gatilho = t; break; }
    }
    const A = extra.get(orig.id) as number[];
    const iv = inev.get(orig.id) as { pecas: number; desde: number | null };
    const primeira = A.findIndex((v) => v > EPS_FB);
    const tipo: AcaoUpstream["tipo"] = iv.pecas > EPS_FB ? "sem_fonte" : primeira >= 0 ? "ligar_upstream" : "nenhuma";
    const ppo = orig.pecasPorPosto;
    const saldoPlano = (sim1.wFim.get(l.id) as number[]).map(r3);
    const saldoAcao = (sim2.wFim.get(l.id) as number[]).map(r3);
    return {
      ligacaoId: l.id, rotulo: l.rotulo ?? `${orig.rotulo}→${dest.rotulo}`, origem: l.origem, destino: l.destino, confianca: l.confianca, wipInicial: r3(l.wipInicial),
      consumoPrevisto: consumoPrev, reposicaoPrevista: (sim1.x.get(orig.id) as number[]).map(r3), saldoProjetado: saldoPlano, saldoSemReposicao: saldoSem,
      coberturaSemReposicao: cobertura, rupturaPrevista: rup, pontoDePedido: pp, gatilhoPontoDePedido: gatilho,
      acao: {
        tipo, ligarEm: primeira >= 0 ? primeira : null, ligarEmRotulo: primeira >= 0 ? entrada.periodos[primeira].rotulo : null, adicionar: A.map(r3),
        postosAdicionais: A.map((v, k) => (ppo[k] > EPS_FB ? Math.ceil(v / ppo[k] - 1e-9) : v > EPS_FB ? 1 : 0)), inevitavel: r3(iv.pecas), inevitavelDesdePeriodo: iv.desde,
      },
      saldoComAcao: saldoAcao, rupturaComAcao: rup2,
      excedeTeto: l.tetoWip !== undefined && Math.max(...saldoAcao, l.wipInicial) > l.tetoWip + EPS_FB,
      picoWipComAcao: r3(Math.max(l.wipInicial, ...saldoAcao)),
    };
  });
  void noPorId;

  const todasTaxas = entrada.nos.flatMap((n) => n.fonteTaxa ?? []);
  const confTaxa: ConfiancaForecast = todasTaxas.length === 0 ? "baixa" : todasTaxas.every((f) => f !== "meta") ? "alta" : todasTaxas.some((f) => f !== "meta") ? "media" : "baixa";
  const confWip = entrada.ligacoes.reduce<ConfiancaForecast>((w, l) => pior(w, l.confianca), "alta");
  const cobs = lig.map((l) => l.coberturaSemReposicao.periodos).filter((v): v is number => v !== null);
  if (lig.some((l) => l.acao.tipo === "sem_fonte")) avisos.push("Há ruptura inevitável: a capacidade da origem (ou o estoque a montante) não repõe a tempo.");
  return { periodos: entrada.periodos, mesmoPeriodo: mesmo, ligacoes: lig, nos: noDiag, menorCobertura: cobs.length > 0 ? Math.min(...cobs) : null, confianca: pior(confWip, confTaxa), avisos };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Texto de diagnóstico por ligação
// ---------------------------------------------------------------------------------------------------------------------------------

export function formatarDiagnosticoLigacao(d: DiagnosticoLigacao, periodos: PeriodoForecast[], max = 6): string {
  const n = (v: number) => Math.round(v).toLocaleString("pt-BR");
  const T = Math.min(max, periodos.length);
  const saldos = Array.from({ length: T }, (_, t) => `${periodos[t].rotulo} saldo ${n(d.saldoProjetado[t])}`).join(" | ");
  const rup = d.rupturaPrevista ? `RUPTURA ${d.rupturaPrevista.rotulo}${d.rupturaPrevista.minuto !== null ? ` (~min ${Math.round(d.rupturaPrevista.minuto)})` : ""}` : "sem ruptura";
  const cob = d.coberturaSemReposicao.periodos === null ? "cobre o horizonte" : `${d.coberturaSemReposicao.periodos.toFixed(2)} períodos`;
  const acao = d.acao.tipo === "nenhuma" ? "AÇÃO: nenhuma" : d.acao.tipo === "sem_fonte" ? `AÇÃO: ligar ${d.acao.ligarEmRotulo ?? "já"} e mesmo assim faltam ${n(d.acao.inevitavel)} pç` : `AÇÃO: ligar ${d.acao.ligarEmRotulo} (+${n(d.acao.adicionar.reduce((s, v) => s + v, 0))} pç)`;
  return `${d.rotulo}: WIP ${n(d.wipInicial)} | cobertura ${cob} | ${saldos} | ${rup} | ${acao}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Fontes alternativas de reposição (ex.: Máquina 8 × cadeia convencional) — RELATÓRIO, sem decisão
// ---------------------------------------------------------------------------------------------------------------------------------

export interface EstagioFonte {
  rotulo: string;
  pecasPorPosto: number[];
  /** capacidade máxima do estágio por período (peças) */
  capacidadeMaxima: number[];
  /** estoque já disponível na ENTRADA deste estágio (consumível); ignorado se materialExterno */
  wipEntrada: number;
  materialExterno?: boolean;
}
export interface FonteReposicao {
  id: string;
  rotulo: string;
  /** do estágio que ENTREGA ao buffer até o primeiro da cadeia */
  estagios: EstagioFonte[];
  valorUnitario?: number;
  /** restrições qualitativas já conhecidas (revezamento, pessoas elegíveis...) */
  restricoes?: string[];
}
export interface ResultadoFonte {
  id: string;
  rotulo: string;
  cobre: boolean;
  deficit: number;
  entregue: number;
  pessoasPeriodo: number;
  pessoasPorMilPecas: number | null;
  wipConsumido: number;
  porEstagio: { rotulo: string; producao: number[]; pessoasPeriodo: number }[];
  valorUnitario: number | null;
  restricoes: string[];
}
export interface ComparacaoFontes {
  necessidadeTotal: number;
  fontes: ResultadoFonte[];
  ordemSugerida: string[];
  criterio: string;
  aviso: string;
}

/** Quanto cada fonte precisaria produzir/quem precisaria ligar para entregar `necessidade[k]` (peças ao buffer no período k). Não escolhe nada. */
export function compararFontes(necessidade: number[], fontes: FonteReposicao[], op: { mesmoPeriodo?: boolean } = {}): ComparacaoFontes {
  const H = necessidade.length;
  const mesmo = op.mesmoPeriodo === true;
  const res: ResultadoFonte[] = fontes.map((f) => {
    let consumo = [...necessidade]; // o que o estágio i precisa produzir (peças por período)
    let deficit = 0;
    let entregue = 0;
    let wipUsado = 0;
    const porEstagio: ResultadoFonte["porEstagio"] = [];
    f.estagios.forEach((e, i) => {
      // produção do estágio i: a mínima que entrega `consumo` (acumulado), limitada pela capacidade (o excedente é empurrado para períodos anteriores)
      const wipSaida = i === 0 ? 0 : f.estagios[i - 1].wipEntrada; // estoque entre este estágio e o seguinte (que o consome)
      const ag = agendarMontante(cumulativa(consumo), i === 0 ? 0 : wipSaida, e.capacidadeMaxima, zeros(H), i === 0 ? true : mesmo);
      deficit += ag.inevitavel;
      if (i === 0) entregue = soma(ag.producao);
      const pess = ag.producao.reduce((s, v, k) => s + (e.pecasPorPosto[k] > EPS_FB ? Math.ceil(v / e.pecasPorPosto[k] - 1e-9) : v > EPS_FB ? 1 : 0), 0);
      porEstagio.push({ rotulo: e.rotulo, producao: ag.producao.map(r3), pessoasPeriodo: pess });
      if (i > 0) wipUsado += Math.min(wipSaida, soma(consumo));
      consumo = ag.producao;
    });
    const pessoas = porEstagio.reduce((s, e) => s + e.pessoasPeriodo, 0);
    return {
      id: f.id, rotulo: f.rotulo, cobre: deficit <= EPS_FB, deficit: r3(deficit), entregue: r3(entregue), pessoasPeriodo: pessoas, pessoasPorMilPecas: entregue > EPS_FB ? r3((pessoas / entregue) * 1000) : null,
      wipConsumido: r3(wipUsado), porEstagio, valorUnitario: f.valorUnitario ?? null, restricoes: f.restricoes ?? [],
    };
  });
  const ordem = [...res].sort((a, b) => Number(b.cobre) - Number(a.cobre) || a.deficit - b.deficit || (a.pessoasPorMilPecas ?? Infinity) - (b.pessoasPorMilPecas ?? Infinity) || (a.id < b.id ? -1 : 1)).map((r) => r.id);
  return {
    necessidadeTotal: r3(soma(necessidade)), fontes: res, ordemSugerida: ordem,
    criterio: "1º cobre a necessidade (sem déficit); 2º menor déficit; 3º menos pessoas-período por mil peças. Valor, revezamento e pessoas disponíveis entram como informação, NÃO como decisão.",
    aviso: "Relatório/sugestão: nenhuma alocação é feita por esta função.",
  };
}
