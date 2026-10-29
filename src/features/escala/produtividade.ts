// PRODUTIVIDADE ESPERADA por PRODUTO × ETAPA × MÁQUINA/POSTO — núcleo PURO (sem IO, sem relógio: `agora` vem por parâmetro).
// NÃO está ligado ao motor. Documento: docs/escala-produtividade-esperada.md (metodologia, backtest e limites).
//
// Entrada: apontamentos (a mesma forma de `ApontamentoReal`, mais `fimPeriodoMs` opcional). A unidade é o POSTO (máquina): o apontamento
// NÃO prova autoria individual, então nada aqui estima desempenho de pessoa.
//
// Metodologia (cada passo calibrado por backtest — ver docs):
//  1. visão no corte: só linhas lançadas até `agora` (nada do futuro);
//  2. só linhas `produzindo` com meta > 0 do próprio posto contam; `sem_producao` (falta_operador / falta_material / outro) NÃO é produtividade baixa
//     — vira contagem separada no diagnóstico;
//  3. linha lançada mais de `toleranciaParcialMin` ANTES do fim do período (parcial) é sinalizada no diagnóstico; o backtest NÃO achou viés (a maioria é o último
//     período do dia, que rende menos por razão estrutural — ver passo 6b), então por padrão entra; `parcial: "excluir"` está disponível;
//  4. peso exponencial pela posição (0 = lançamento mais recente), meia-vida em OBSERVAÇÕES do posto (não em dias: robusto a feriados/paradas);
//     observações mais velhas que `idadeMaximaDias` saem (posto parado volta ao nominal);
//  5. proteção contra outlier: cada razão real/meta é winsorizada em mediana ± c·(1,4826·MAD) ponderadas (piso de escala `escalaMinima`);
//  6. nível = média ponderada das razões winsorizadas; encolhimento ao prior (nominal = 1 ou o nível do POOL produto×etapa):
//     fator = (neff·nível + k·prior) / (neff + k), neff = tamanho efetivo de amostra (Kish);
//  6b. ajuste por PERÍODO DO DIA (índice plantwide encolhido; o último período rende ~12% menos): razões divididas pelo índice do seu período e o fator
//     multiplicado pelo índice do período alvo (`periodoId`);
//  7. limitado a [PERF_MINIMA; PERF_MAXIMA] = [0,30; 1,30] (mesmo teto/piso do `f` atual de desempenho.ts).

import { PERF_MAXIMA, PERF_MINIMA } from "./desempenho";
import type { ApontamentoReal } from "./producaoReal";

export type ObsProdutividade = ApontamentoReal & { fimPeriodoMs?: number | null; inicioPeriodoMs?: number | null };
export type ModoParcial = "excluir" | "incluir" | "projetar";
export type PriorProdutividade = "nominal" | "pool";
export type FonteProdutividade = "observada" | "parcial" | "nominal";

export interface OpcoesProdutividade {
  /** Meia-vida em observações do posto (Infinity = média simples). */
  meiaVida: number;
  /** Força do prior (pseudo-observações). 0 = sem encolhimento. */
  k: number;
  /** c da winsorização (mediana ± c·escala robusta). Infinity = sem winsorização. */
  c: number;
  /** Piso da escala robusta (evita winsorizar tudo quando o posto é "perfeito"). */
  escalaMinima: number;
  /** Mínimo de observações efetivas para sair do nominal. */
  amostraMinima: number;
  /** Observações (n) a partir das quais a fonte é "observada" (abaixo disso, "parcial"). */
  amostraCheia: number;
  /** Linhas lançadas antes do fim do período (mais que `toleranciaParcialMin` antes). */
  parcial: ModoParcial;
  toleranciaParcialMin: number;
  /** Observações mais antigas que isto (dias, contados de `agora`) saem. null = sem limite. */
  idadeMaximaDias: number | null;
  /** Prior do encolhimento. "pool" usa o nível robusto do produto×etapa (todas as máquinas) quando houver amostra, senão nominal. */
  prior: PriorProdutividade;
  /** Meta nominal em peças por período (número) ou por periodoId, para `pecasPorPeriodo`. Ausente: usa a meta mais recente do histórico. */
  metaNominal?: number | Record<string, number>;
  /** Período para o qual se quer `pecasPorPeriodo` (com `metaNominal` por periodoId). */
  periodoId?: string;
  /** Identifica o posto/pool pela OPERAÇÃO em vez do `etapaId`. Necessário quando o roteiro foi reordenado: em PROD (21/10/2026) as etapas da Caixa Amarela
   *  trocaram de operação mantendo o mesmo `etapa_id` (693 apontamentos, 25% do histórico, têm `operacao_id` ≠ operação atual da etapa). A operação gravada no
   *  apontamento é a que de fato foi executada (e a meta_periodo_vigente é a dela). Ausente ⇒ casa por `etapaId`. */
  operacaoId?: string | null;
  /** Z do intervalo (1,2816 ≈ 80% bilateral). */
  z: number;
  /** Ajuste por PERÍODO DO DIA (efeito estrutural de fábrica, ex.: último período do dia rende menos): divide cada razão pelo índice do seu período
   *  e multiplica o fator pelo índice do `periodoId` alvo. Exige `periodoId`. */
  ajustePeriodo: boolean;
  /** Índice por periodoId já calculado (ver `indicePorPeriodoDoDia`); ausente com `ajustePeriodo` ⇒ calculado do próprio histórico. */
  indicePeriodo?: Record<string, number>;
  /** Janela (dias) e encolhimento (pseudo-observações) do índice por período. */
  janelaIndiceDias: number;
  kIndice: number;
}

/** Defaults — VALORES CALIBRADOS no backtest (ver docs/escala-produtividade-esperada.md §4). */
export const PRODUTIVIDADE_PADRAO: OpcoesProdutividade = {
  meiaVida: 12,
  k: 6,
  c: 2.5,
  escalaMinima: 0.05,
  amostraMinima: 3,
  amostraCheia: 12,
  parcial: "incluir",
  toleranciaParcialMin: 10,
  idadeMaximaDias: 45,
  prior: "pool",
  z: 1.2816,
  ajustePeriodo: true,
  janelaIndiceDias: 35,
  kIndice: 30,
};

export interface DiagnosticoProdutividade {
  codigos: string[];
  observacoesUsadas: number;
  parciaisIgnoradas: number;
  parciaisProjetadas: number;
  parciaisIncluidas: number;
  outliersWinsorizados: number;
  tamanhoEfetivo: number;
  nivelBruto: number | null; // média ponderada ANTES do encolhimento e do cap
  prior: number;
  priorOrigem: "nominal" | "pool";
  ultimaObservacaoMs: number | null;
  /** sem_producao da MÁQUINA na janela das observações usadas — NÃO entra no fator (disponibilidade, não velocidade). */
  semProducao: { falta_operador: number; falta_material: number; outro: number };
  /** média simples das 5 últimas razões completas (só leitura; não entra no fator). */
  ultimas5: number | null;
  capado: boolean;
  /** índice do período do dia aplicado ao fator alvo (1 = sem ajuste). */
  indicePeriodoAplicado: number;
}

export interface ProdutividadeEsperada {
  pecasPorPeriodo: number | null; // fator × meta nominal; null se não há meta conhecida
  fator: number; // real/nominal esperado
  fonte: FonteProdutividade;
  amostra: number; // n de observações usadas
  intervalo: { lo: number; hi: number }; // faixa do FATOR (≈80%)
  diagnostico: DiagnosticoProdutividade;
}

const MIN_MS = 60_000;
const DIA_MS = 86_400_000;

interface Razao { r: number; w: number; ordem: number; parcial: boolean; meta: number; ts: number; per: string }

function mediana(v: number[], w?: number[]): number {
  if (v.length === 0) return NaN;
  const idx = v.map((_, i) => i).sort((a, b) => v[a] - v[b] || a - b);
  const pesos = w ?? v.map(() => 1);
  const total = idx.reduce((s, i) => s + pesos[i], 0);
  let acum = 0;
  for (const i of idx) { acum += pesos[i]; if (acum >= total / 2 - 1e-12) return v[i]; }
  return v[idx[idx.length - 1]];
}

const ts = (a: ObsProdutividade): number => a.fimPeriodoMs ?? a.lancadoEmMs;
const ehParcial = (a: ObsProdutividade, tolMin: number): boolean => a.fimPeriodoMs != null && a.fimPeriodoMs - a.lancadoEmMs > tolMin * MIN_MS;

/** Razões real/meta do posto (já visíveis em `agora`), da mais NOVA (ordem 0) para a mais velha. */
function razoesDoPosto(hist: ObsProdutividade[], agora: number, filtro: (a: ObsProdutividade) => boolean, o: OpcoesProdutividade): { razoes: Razao[]; parciaisIgnoradas: number; parciaisProjetadas: number } {
  const linhas = hist
    .filter((a) => a.status === "produzindo" && a.meta > 0 && a.lancadoEmMs <= agora && filtro(a))
    .filter((a) => o.idadeMaximaDias === null || agora - ts(a) <= o.idadeMaximaDias * DIA_MS)
    .sort((x, y) => ts(y) - ts(x) || y.lancadoEmMs - x.lancadoEmMs);
  const razoes: Razao[] = [];
  let ign = 0, proj = 0;
  linhas.forEach((a) => {
    const parcial = ehParcial(a, o.toleranciaParcialMin);
    let r = Math.max(0, a.boas) / a.meta;
    if (parcial) {
      if (o.parcial === "excluir") { ign++; return; }
      if (o.parcial === "projetar" && a.fimPeriodoMs != null) {
        // fração decorrida do período no lançamento; só projeta se o início é conhecido e a fração é plausível (> 50%)
        if (a.inicioPeriodoMs != null) { const fr = (a.lancadoEmMs - a.inicioPeriodoMs) / (a.fimPeriodoMs - a.inicioPeriodoMs); if (fr > 0.5 && fr < 1) { r = r / fr; proj++; } }
      }
    }
    razoes.push({ r: Math.min(r, 2), w: 1, ordem: razoes.length, parcial, meta: a.meta, ts: ts(a), per: a.periodoId });
  });
  return { razoes, parciaisIgnoradas: ign, parciaisProjetadas: proj };
}

interface Nivel { nivel: number | null; neff: number; outliers: number; escala: number }

/** Nível robusto: pesos exponenciais por posição, winsorização por mediana ± c·MAD, média ponderada. */
function nivelRobusto(razoes: Razao[], o: OpcoesProdutividade): Nivel {
  if (razoes.length === 0) return { nivel: null, neff: 0, outliers: 0, escala: 0 };
  const lambda = Number.isFinite(o.meiaVida) ? Math.pow(0.5, 1 / o.meiaVida) : 1;
  const w = razoes.map((x) => Math.pow(lambda, x.ordem));
  const v = razoes.map((x) => x.r);
  let lo = -Infinity, hi = Infinity, escala = 0;
  if (Number.isFinite(o.c)) {
    const m = mediana(v, w);
    const mad = mediana(v.map((x) => Math.abs(x - m)), w);
    escala = Math.max(o.escalaMinima, 1.4826 * mad);
    lo = m - o.c * escala; hi = m + o.c * escala;
  }
  let outliers = 0;
  const vw = v.map((x) => { const y = Math.min(hi, Math.max(lo, x)); if (y !== x) outliers++; return y; });
  const sw = w.reduce((s, x) => s + x, 0);
  const nivel = vw.reduce((s, x, i) => s + x * w[i], 0) / sw;
  const neff = (sw * sw) / w.reduce((s, x) => s + x * x, 0);
  return { nivel, neff, outliers, escala };
}

/** Índice relativo de cada período do dia = média das razões real/meta do período ÷ média geral, encolhido a 1 (kIndice pseudo-observações), sobre a
 *  janela recente e TODOS os postos com `produzindo` e meta conhecida visíveis em `agora` (parciais incluídos: o efeito do fim do dia é justamente isso). */
export function indicePorPeriodoDoDia(historico: ObsProdutividade[], agora: number, o: Pick<OpcoesProdutividade, "janelaIndiceDias" | "kIndice"> = PRODUTIVIDADE_PADRAO): Record<string, number> {
  const v = historico.filter((a) => a.status === "produzindo" && a.meta > 0 && a.lancadoEmMs <= agora && agora - ts(a) <= o.janelaIndiceDias * DIA_MS);
  if (v.length === 0) return {};
  const razao = (a: ObsProdutividade) => Math.min(2, Math.max(0, a.boas) / a.meta);
  const geral = v.reduce((s, a) => s + razao(a), 0) / v.length;
  if (!(geral > 0)) return {};
  const g = new Map<string, { s: number; n: number }>();
  v.forEach((a) => { const x = g.get(a.periodoId) ?? { s: 0, n: 0 }; x.s += razao(a); x.n++; g.set(a.periodoId, x); });
  const out: Record<string, number> = {};
  g.forEach((x, per) => { out[per] = (x.n * (x.s / x.n / geral) + o.kIndice) / (x.n + o.kIndice); });
  return out;
}

const limitar = (x: number) => Math.min(PERF_MAXIMA, Math.max(PERF_MINIMA, x));

export function produtividadeEsperada(
  historico: ObsProdutividade[],
  produtoId: string,
  etapaId: string,
  maquinaId: string,
  agora: number,
  opcoes: Partial<OpcoesProdutividade> = {},
): ProdutividadeEsperada {
  const o: OpcoesProdutividade = { ...PRODUTIVIDADE_PADRAO, ...opcoes };
  const mesmaEtapa = (a: ObsProdutividade) => (o.operacaoId ? a.operacaoId === o.operacaoId : a.etapaId === etapaId);
  const doPosto = (a: ObsProdutividade) => a.produtoId === produtoId && mesmaEtapa(a) && a.maquinaId === maquinaId;
  const idxMap = o.ajustePeriodo && o.periodoId ? o.indicePeriodo ?? indicePorPeriodoDoDia(historico, agora, o) : null;
  const idxDe = (per: string) => (idxMap && idxMap[per] > 0 ? idxMap[per] : 1);
  const idxAlvo = idxMap && o.periodoId ? idxDe(o.periodoId) : 1;
  const ajusta = (rs: Razao[]): Razao[] => (idxMap ? rs.map((x) => ({ ...x, r: x.r / idxDe(x.per) })) : rs);
  const bruta = razoesDoPosto(historico, agora, doPosto, o);
  const { parciaisIgnoradas, parciaisProjetadas } = bruta;
  const parciaisIncluidas = o.parcial === "incluir" ? bruta.razoes.filter((x) => x.parcial).length : 0;
  const razoes = ajusta(bruta.razoes);
  const nv = nivelRobusto(razoes, o);
  const codigos: string[] = [];

  // prior
  let prior = 1, priorOrigem: "nominal" | "pool" = "nominal";
  if (o.prior === "pool") {
    const pool = razoesDoPosto(historico, agora, (a) => a.produtoId === produtoId && mesmaEtapa(a), o);
    const np = nivelRobusto(ajusta(pool.razoes), o);
    if (np.nivel !== null && pool.razoes.length >= o.amostraMinima && pool.razoes.length > razoes.length) {
      // o pool também é encolhido ao nominal (mesma regra), para não importar ruído de um pool pequeno
      prior = limitar((np.neff * np.nivel + o.k * 1) / (np.neff + o.k));
      priorOrigem = "pool";
    }
  }

  // sem_producao da máquina na janela das observações usadas (separado: não é velocidade)
  const desde = razoes.length > 0 ? razoes[razoes.length - 1].ts : agora - 30 * DIA_MS;
  const semProducao = { falta_operador: 0, falta_material: 0, outro: 0 };
  historico.forEach((a) => {
    if (a.status !== "sem_producao" || a.maquinaId !== maquinaId || a.lancadoEmMs > agora || a.lancadoEmMs < desde) return;
    if (a.motivo === "falta_operador") semProducao.falta_operador++;
    else if (a.motivo === "falta_material") semProducao.falta_material++;
    else semProducao.outro++;
  });

  const n = razoes.length;
  const ultimas5 = n === 0 ? null : razoes.slice(0, 5).reduce((s, x) => s + x.r, 0) / Math.min(5, n);
  let fator = 1, fonte: FonteProdutividade = "nominal", lo = 1, hi = 1, capado = false;
  if (parciaisIgnoradas > 0) codigos.push("PARCIAIS_IGNORADAS");
  if (semProducao.falta_material > 0) codigos.push("FALTA_MATERIAL_NA_JANELA");
  if (nv.nivel === null || n < o.amostraMinima) {
    codigos.push(n === 0 ? "SEM_HISTORICO_NOMINAL" : "AMOSTRA_INSUFICIENTE_NOMINAL");
    if (priorOrigem === "pool") { fator = limitar(prior * idxAlvo); fonte = "parcial"; lo = limitar(fator - 0.15); hi = limitar(fator + 0.15); codigos.push("PRIOR_DO_POOL"); }
  } else {
    const bruto = (nv.neff * nv.nivel + o.k * prior) / (nv.neff + o.k);
    fator = limitar(bruto * idxAlvo);
    capado = fator !== bruto * idxAlvo;
    fonte = n >= o.amostraCheia ? "observada" : "parcial";
    // erro-padrão do nível (escala robusta/√neff) reduzido pelo encolhimento; piso de 0,02
    const se = Math.max(0.02, (Math.max(nv.escala, o.escalaMinima) / Math.sqrt(Math.max(1, nv.neff))) * (nv.neff / (nv.neff + o.k)));
    lo = limitar(fator - o.z * se * idxAlvo); hi = limitar(fator + o.z * se * idxAlvo);
    if (nv.outliers > 0) codigos.push("OUTLIERS_WINSORIZADOS");
    if (capado) codigos.push("FATOR_LIMITADO");
    if (priorOrigem === "pool") codigos.push("PRIOR_DO_POOL");
  }

  let meta: number | null = null;
  if (typeof o.metaNominal === "number") meta = o.metaNominal;
  else if (o.metaNominal && o.periodoId && o.metaNominal[o.periodoId] !== undefined) meta = o.metaNominal[o.periodoId];
  else if (razoes.length > 0) meta = razoes[0].meta;

  return {
    pecasPorPeriodo: meta !== null && meta > 0 ? fator * meta : null,
    fator, fonte, amostra: n, intervalo: { lo, hi },
    diagnostico: {
      codigos, observacoesUsadas: n, parciaisIgnoradas, parciaisProjetadas, parciaisIncluidas, outliersWinsorizados: nv.outliers, tamanhoEfetivo: nv.neff,
      nivelBruto: nv.nivel, prior, priorOrigem, ultimaObservacaoMs: n > 0 ? razoes[0].ts : null, semProducao, ultimas5, capado, indicePeriodoAplicado: idxAlvo,
    },
  };
}

export interface PostoProdutividade { produtoId: string; etapaId: string; maquinaId: string }
export const chavePosto = (p: PostoProdutividade): string => `${p.produtoId}|${p.etapaId}|${p.maquinaId}`;

/** Lote: um resultado por posto (chave `produto|etapa|maquina`). Postos sem histórico saem nominais. */
export function produtividadePorPosto(historico: ObsProdutividade[], postos: PostoProdutividade[], agora: number, opcoes: Partial<OpcoesProdutividade> = {}): Record<string, ProdutividadeEsperada> {
  const r: Record<string, ProdutividadeEsperada> = {};
  postos.forEach((p) => { r[chavePosto(p)] = produtividadeEsperada(historico, p.produtoId, p.etapaId, p.maquinaId, agora, opcoes); });
  return r;
}

/** Fator por POOL (`produto|etapa`) derivado dos postos — agregação para consumidores que só entendem pool: média dos fatores dos postos,
 *  ponderada pelo n de cada posto (e só pelos postos informados, i.e. os candidatos do período). Sem posto observado ⇒ 1. */
export function fatorPorPoolDosPostos(porPosto: Record<string, ProdutividadeEsperada>): Record<string, number> {
  const acum: Record<string, { s: number; w: number }> = {};
  Object.entries(porPosto).forEach(([k, v]) => {
    const [p, e] = k.split("|");
    const kk = `${p}|${e}`;
    const w = Math.max(1, v.amostra);
    const a = (acum[kk] ??= { s: 0, w: 0 });
    a.s += v.fator * w; a.w += w;
  });
  const out: Record<string, number> = {};
  Object.entries(acum).forEach(([k, a]) => { out[k] = a.w > 0 ? a.s / a.w : 1; });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// INTERFACE PARA O MOTOR (proposta; nada daqui é chamado pelo motor ainda) — docs/escala-produtividade-esperada.md §6
// ---------------------------------------------------------------------------------------------------------------------------------
export interface PoolParaProdutividade { produtoId: string; etapaId: string; operacaoId?: string | null; maquinasIds: string[] }
export interface FatoresMotor {
  /** pool "produto|etapa" → fator médio (neutro ao período). DROP-IN no lugar de `fatoresDeDesempenho` (mesma forma: só pools com fator ≠ 1). */
  porPool: Record<string, number>;
  /** pool → periodoId → fator do pool NAQUELE período do dia (inclui o índice do período). Embutível em `pool.metas[periodoId]` sem mexer no núcleo. */
  porPoolPeriodo: Record<string, Record<string, number>>;
  /** "produto|etapa|maquina" → fator do posto ÷ fator do pool (≈ 1). Aplicado por linha (fase 2); postos sem histórico = 1. */
  residualPosto: Record<string, number>;
  /** estimativa completa por posto (diagnóstico/explicação). */
  postos: Record<string, ProdutividadeEsperada>;
}

/** Agrega o fator por posto em pool/período/resíduo para o motor. Pool = média dos postos OBSERVADOS (amostra ≥ mínimo) ponderada por n; sem posto observado ⇒ 1. */
export function fatoresParaMotor(historico: ObsProdutividade[], pools: PoolParaProdutividade[], periodos: string[], agora: number, opcoes: Partial<OpcoesProdutividade> = {}): FatoresMotor {
  const o: OpcoesProdutividade = { ...PRODUTIVIDADE_PADRAO, ...opcoes };
  const indice = o.ajustePeriodo ? o.indicePeriodo ?? indicePorPeriodoDoDia(historico, agora, o) : undefined;
  const out: FatoresMotor = { porPool: {}, porPoolPeriodo: {}, residualPosto: {}, postos: {} };
  const media = (xs: { f: number; w: number }[]) => (xs.length > 0 ? xs.reduce((s, x) => s + x.f * x.w, 0) / xs.reduce((s, x) => s + x.w, 0) : 1);
  pools.forEach((p) => {
    const kp = `${p.produtoId}|${p.etapaId}`;
    const base: Partial<OpcoesProdutividade> = { ...opcoes, operacaoId: p.operacaoId ?? opcoes.operacaoId, ...(indice ? { indicePeriodo: indice } : {}) };
    // neutro ao período (periodoId ausente ⇒ índice 1)
    const neutros = p.maquinasIds.map((m) => ({ m, e: produtividadeEsperada(historico, p.produtoId, p.etapaId, m, agora, { ...base, periodoId: undefined }) }));
    neutros.forEach(({ m, e }) => { out.postos[`${kp}|${m}`] = e; });
    const obs = neutros.filter(({ e }) => e.fonte !== "nominal").map(({ e }) => ({ f: e.fator, w: e.amostra }));
    const fPool = media(obs);
    if (Math.abs(fPool - 1) > 1e-9) out.porPool[kp] = fPool;
    neutros.forEach(({ m, e }) => { out.residualPosto[`${kp}|${m}`] = e.fonte === "nominal" || fPool <= 0 ? 1 : e.fator / fPool; });
    out.porPoolPeriodo[kp] = {};
    periodos.forEach((per) => {
      const xs = p.maquinasIds.map((m) => produtividadeEsperada(historico, p.produtoId, p.etapaId, m, agora, { ...base, periodoId: per })).filter((e) => e.fonte !== "nominal").map((e) => ({ f: e.fator, w: e.amostra }));
      out.porPoolPeriodo[kp][per] = media(xs);
    });
  });
  return out;
}

/** Aplica `porPoolPeriodo` às metas dos pools (nova cópia; mesmo efeito de `embutirFatores`, mas por período do dia). Pools sem fator ficam intactos. */
export function embutirFatoresPorPeriodo<T extends { produtoId: string; etapaId: string; metas: Record<string, number> }>(pools: T[], porPoolPeriodo: FatoresMotor["porPoolPeriodo"]): T[] {
  return pools.map((p) => {
    const f = porPoolPeriodo[`${p.produtoId}|${p.etapaId}`];
    if (!f) return p;
    return { ...p, metas: Object.fromEntries(Object.entries(p.metas).map(([per, m]) => [per, m * (f[per] ?? 1)])) };
  });
}
