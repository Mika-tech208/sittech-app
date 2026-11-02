// PLANEJAMENTO DE CADEIA — retropropagação da necessidade com LEAD TIME por ligação, validação do plano período a período e reparo mínimo.
// PURO, GENÉRICO (ids opacos; qualquer roteiro A→B→C→D, DAG com destino de 2+ origens), DESLIGADO e OFFLINE: nada no motor chama isto.
//
// A pergunta deste módulo NÃO é "tenho material agora?" nem "quando o buffer zera?", e sim:
//     "com ESTE plano completo (todos os postos de todas as etapas, em todos os períodos), todos os buffers da cadeia permanecem suficientes?"
//
// Convenções (períodos 0..H-1; 0 = primeiro período ainda alterável; H = primeiro período do PRÓXIMO DIA PRODUTIVO quando `proximoDia` é informado):
//   • LEAD TIME por ligação = `atrasoPeriodos` (default 1 = LOTE_PROXIMO_PERIODO, a regra única da Sittech): o que a origem produz em Tk só existe para o
//     destino no INÍCIO de Tk+lag. Um destino que produz em Tn só pode consumir o que existia no início de Tn.
//   • Contagem física é a verdade do estoque AGORA; o módulo calcula QUANTO TEMPO ela dura no ritmo do plano (cobertura em períodos) e QUANDO a origem
//     precisa voltar a produzir para que o destino nunca fique sem peça (ÚLTIMO PERÍODO SEGURO).
//   • Períodos fechados (`producaoReal[no][t] != null`) são REAL: entram no estoque como aconteceram e não geram violação (geram o sinal
//     `consumoRealMaiorQueDisponivel` quando o consumo real excede o estoque conhecido: dado conflitante, pede recontagem). Futuros: previsão do chamador
//     (produtividade do POSTO — produto×operação×máquina — nunca de pessoa; meta é fallback).
//   • Tudo em PEÇAS. Sem Date/IO/Supabase.
//
// Três peças:
//   (a) `necessidadeRetropropagada`  — de trás para frente: meta do(s) último(s) nó(s) → consumo requerido por ligação → produção necessária da origem
//                                       (ALAP: o mais tarde possível, empurrada para trás pela capacidade) → vira meta da etapa anterior → …
//   (b) `validarCadeia` / `simularCadeia` — de frente para trás: estoque início − consumo + produção do período anterior = estoque seguinte; violação =
//                                       destino produzindo mais do que o material disponível no início do período.
//   (c) `repararCadeia`              — candidatos: religar upstream no último período seguro, trocar a fonte (ex.: Máquina 8), reduzir o downstream,
//                                       combinações; custo de oportunidade pelo PRODUTO FINAL via callback `avaliar` (ex.: avaliarPlano do fluxo).
import { EPS_FB, coberturaSemReposicao, type Cobertura, type ConfiancaForecast, type EntradaForecast, type FonteTaxa, type LigacaoForecast } from "./forecastBuffer";

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const zeros = (n: number) => new Array<number>(n).fill(0);
const soma = (a: number[]) => a.reduce((s, v) => s + v, 0);
const cum = (v: number[]) => { let s = 0; return v.map((x) => (s += x)); };
const PIOR: Record<ConfiancaForecast, number> = { alta: 0, media: 1, baixa: 2 };

/** Próximo dia produtivo (ex.: terça 03/11 M1; segunda 02/11 não é produtiva): a produção DESEJADA dos nós no 1º período desse dia exige estoque no fim do horizonte. */
export interface ProximoDia {
  rotulo: string;
  duracaoMin: number;
  /** produção desejada de cada nó nesse período (nós ausentes = 0). */
  producaoPorNo: Record<string, number>;
}

export interface OpcoesCadeia {
  /** WIP inicial usado: "lo" (default, pessimista = `wipInicial`) ou "hi" (`wipInicialHi`). */
  cenarioWip?: "lo" | "hi";
  /** Estoque de segurança como fração do consumo do período, por confiança da ligação (default 0 em todas: nenhum dado justifica um número — é POLÍTICA, não medida). */
  margemPorConfianca?: Partial<Record<ConfiancaForecast, number>>;
  /** Fração (0,1] da produção prevista dos nós que ALIMENTAM outros e capacidade deles (default 1): produtividade de reposição conservadora (quantil medido do histórico). */
  fatorReposicao?: number;
  /** Tolerância (peças) para considerar violação (default 1). */
  toleranciaPecas?: number;
  /** Se false, só o plano produz (sem ligar mais postos): `capacidadeMaxima` é ignorada. */
  usarCapacidadeMaxima?: boolean;
  proximoDia?: ProximoDia;
  /** Produção REAL de períodos já fechados, por nó (null/ausente = período aberto). Índices = períodos do forecast. */
  producaoReal?: Record<string, (number | null)[]>;
  /** Meta do(s) nó(s) final(is) na retropropagação (default = produção prevista do plano). */
  metaPorNo?: Record<string, number[]>;
  /** Preferência de fonte de reposição por DESTINO com 2+ ligações de entrada: ids das ligações em ordem (a 1ª é usada até a capacidade, a seguinte cobre o resto). Default = ordem das ligações. */
  fontes?: Record<string, string[]>;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Preparação
// ---------------------------------------------------------------------------------------------------------------------------------
interface NoP {
  id: string; rotulo: string; prod: number[]; cap: number[]; dem: number | null; pp: number[]; postosPlano: number[]; fonteTaxa: FonteTaxa[];
  entradas: LigacaoForecast[]; saidas: LigacaoForecast[]; real: (number | null)[];
}
interface LigP { l: LigacaoForecast; lag: number; rend: number; s0: number; margem: number; }
interface Prep {
  H: number; periodos: { rotulo: string; duracaoMin: number }[]; nos: Map<string, NoP>; topo: string[]; ligs: Map<string, LigP>; op: Required<Pick<OpcoesCadeia, "toleranciaPecas">> & OpcoesCadeia; temProximoDia: boolean; Hbase: number;
}

function topologia(ids: string[], ligs: LigacaoForecast[]): string[] {
  const grau = new Map(ids.map((i) => [i, 0]));
  ligs.forEach((l) => grau.set(l.destino, (grau.get(l.destino) ?? 0) + 1));
  const fila = [...grau.entries()].filter(([, g]) => g === 0).map(([i]) => i).sort();
  const out: string[] = [];
  while (fila.length) {
    const id = fila.shift() as string;
    out.push(id);
    ligs.filter((l) => l.origem === id).forEach((l) => { const g = (grau.get(l.destino) ?? 0) - 1; grau.set(l.destino, g); if (g === 0) { fila.push(l.destino); fila.sort(); } });
  }
  if (out.length !== ids.length) throw new Error("planejamentoCadeia: o grafo de ligações tem ciclo");
  return out;
}

export function prepararCadeia(e: EntradaForecast, op: OpcoesCadeia = {}): Prep {
  const Hb = e.periodos.length;
  const ext = op.proximoDia ? 1 : 0;
  const H = Hb + ext;
  const f = op.fatorReposicao ?? 1;
  if (!(f > 0 && f <= 1)) throw new Error("planejamentoCadeia: fatorReposicao fora de (0,1]");
  const ids = new Set(e.nos.map((n) => n.id));
  if (ids.size !== e.nos.length) throw new Error("planejamentoCadeia: ids de nó repetidos");
  e.ligacoes.forEach((l) => { if (!ids.has(l.origem) || !ids.has(l.destino) || l.origem === l.destino) throw new Error(`planejamentoCadeia: ligação ${l.id} inválida`); });
  const fr = [...e.periodos.map((p) => Math.max(0, Math.min(1, p.fracao ?? 1))), ...(ext ? [1] : [])];
  const usarCap = op.usarCapacidadeMaxima !== false;
  const nos = new Map<string, NoP>();
  e.nos.forEach((n) => {
    if (n.producaoPrevista.length !== Hb) throw new Error(`planejamentoCadeia: nó ${n.id} com ${n.producaoPrevista.length} períodos (esperado ${Hb})`);
    const alimenta = e.ligacoes.some((l) => l.origem === n.id);
    const esc = alimenta ? f : 1;
    const ppx = n.pecasPorPosto ?? zeros(Hb);
    const ex = (v: number[], d = 0) => [...v, ...(ext ? [d] : [])];
    const dprox = op.proximoDia?.producaoPorNo[n.id] ?? 0;
    const prod = ex(n.producaoPrevista.map((v, t) => Math.max(0, v) * fr[t] * esc), dprox);
    const capB = usarCap ? (n.capacidadeMaxima ?? n.producaoPrevista) : n.producaoPrevista;
    const cap = ex(capB.map((v, t) => Math.max(0, v) * fr[t] * esc), dprox).map((v, t) => Math.max(prod[t], v));
    const real: (number | null)[] = [...((op.producaoReal?.[n.id] ?? new Array<number | null>(Hb).fill(null)) as (number | null)[]), ...(ext ? [null] : [])];
    nos.set(n.id, {
      id: n.id, rotulo: n.rotulo, prod, cap, dem: n.demandaRestante === undefined ? null : n.demandaRestante, pp: ex(ppx.map((v, t) => Math.max(0, v) * fr[t] * esc)),
      postosPlano: ex(n.postosPrevistos ?? zeros(Hb)), fonteTaxa: n.fonteTaxa ?? new Array<FonteTaxa>(Hb).fill("meta"),
      entradas: e.ligacoes.filter((l) => l.destino === n.id), saidas: e.ligacoes.filter((l) => l.origem === n.id), real,
    });
  });
  const ligs = new Map<string, LigP>();
  e.ligacoes.forEach((l) => {
    const s0 = (op.cenarioWip ?? "lo") === "hi" ? (l.wipInicialHi ?? l.wipInicial) : l.wipInicial;
    ligs.set(l.id, { l, lag: Math.max(1, Math.round(l.atrasoPeriodos ?? 1)), rend: l.rendimento && l.rendimento > 0 ? l.rendimento : 1, s0: Math.max(0, s0), margem: Math.max(0, op.margemPorConfianca?.[l.confianca] ?? 0) });
  });
  return {
    H, Hbase: Hb, temProximoDia: ext === 1, nos, ligs, topo: topologia([...ids], e.ligacoes),
    periodos: [...e.periodos.map((p) => ({ rotulo: p.rotulo, duracaoMin: p.duracaoMin })), ...(op.proximoDia ? [{ rotulo: op.proximoDia.rotulo, duracaoMin: op.proximoDia.duracaoMin }] : [])],
    op: { toleranciaPecas: op.toleranciaPecas ?? 1, ...op },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// (b) Forward: simulação período a período + validação
// ---------------------------------------------------------------------------------------------------------------------------------
export interface ViolacaoCadeia {
  noId: string; rotulo: string; periodo: number; periodoRotulo: string; proximoDia: boolean;
  /** produção desejada do nó no período e o que o material permite */
  desejada: number; disponivel: number; falta: number;
  /** minuto (dentro do período) em que o material acaba, assumindo consumo linear */
  minuto: number | null;
  ligacoesEntrada: string[];
}
export interface SimLigacao { ligacaoId: string; rotulo: string; saldoInicial: number[]; entrada: number[]; consumo: number[]; saldoFinal: number[]; }
export interface SimNo { noId: string; rotulo: string; desejada: number[]; efetiva: number[]; disponivelMax: number[]; semMaterial: number[]; postosSemMaterial: number[]; }
export interface SimulacaoCadeia {
  ligacoes: SimLigacao[]; nos: SimNo[]; violacoes: ViolacaoCadeia[];
  /** períodos fechados em que o consumo REAL excedeu o estoque conhecido (dado conflitante: recontar) */
  consumoRealMaiorQueDisponivel: { noId: string; periodo: number; excesso: number }[];
  valido: boolean;
}

export type PlanoProducao = Record<string, number[]>;
const planoDe = (p: Prep): PlanoProducao => Object.fromEntries([...p.nos.values()].map((n) => [n.id, [...n.prod]]));

export function simularPrep(p: Prep, plano: PlanoProducao = planoDe(p)): SimulacaoCadeia {
  const { H } = p;
  const tol = p.op.toleranciaPecas;
  const st = new Map<string, number[]>(); // saldo no início de cada período
  const consumo = new Map<string, number[]>();
  const chega = new Map<string, number[]>(); // chegada no início do período
  p.ligs.forEach((lp, id) => { const s = zeros(H + 1); s[0] = lp.s0; st.set(id, s); consumo.set(id, zeros(H)); chega.set(id, zeros(H + 1)); });
  const desejada = new Map<string, number[]>(), efetiva = new Map<string, number[]>(), dispMax = new Map<string, number[]>();
  p.nos.forEach((n, id) => { desejada.set(id, zeros(H)); efetiva.set(id, zeros(H)); dispMax.set(id, zeros(H)); });
  const violacoes: ViolacaoCadeia[] = [];
  const conflitos: SimulacaoCadeia["consumoRealMaiorQueDisponivel"] = [];
  const cumProd = new Map<string, number>();
  for (let t = 0; t < H; t++) {
    for (const nid of p.topo) {
      const n = p.nos.get(nid) as NoP;
      let des = Math.max(0, plano[nid]?.[t] ?? 0);
      if (n.dem !== null) des = Math.min(des, Math.max(0, n.dem - (cumProd.get(nid) ?? 0)));
      desejada.get(nid)![t] = des;
      const disp = n.entradas.length === 0 ? Number.POSITIVE_INFINITY : n.entradas.reduce((s, l) => s + (st.get(l.id) as number[])[t] / (p.ligs.get(l.id) as LigP).rend, 0);
      dispMax.get(nid)![t] = disp;
      const real = n.real[t];
      let eff: number;
      if (real !== null && real !== undefined) {
        eff = Math.max(0, real);
        if (eff > disp + tol) conflitos.push({ noId: nid, periodo: t, excesso: r3(eff - disp) });
      } else {
        eff = Math.min(des, disp);
        if (des > disp + tol) {
          violacoes.push({
            noId: nid, rotulo: n.rotulo, periodo: t, periodoRotulo: p.periodos[t].rotulo, proximoDia: p.temProximoDia && t === p.Hbase, desejada: r3(des), disponivel: r3(disp), falta: r3(des - disp),
            minuto: des > 0 ? r3((disp / des) * p.periodos[t].duracaoMin) : null, ligacoesEntrada: n.entradas.map((l) => l.id),
          });
        }
      }
      efetiva.get(nid)![t] = eff;
      cumProd.set(nid, (cumProd.get(nid) ?? 0) + eff);
      // consumo proporcional ao estoque de cada ligação de entrada
      if (n.entradas.length > 0) {
        const dispReal = Number.isFinite(disp) ? disp : 0;
        n.entradas.forEach((l) => {
          const lp = p.ligs.get(l.id) as LigP;
          const s = (st.get(l.id) as number[])[t];
          const share = dispReal > EPS_FB ? (s / lp.rend) / dispReal : 0;
          (consumo.get(l.id) as number[])[t] = Math.min(s, eff * share * lp.rend);
        });
      }
      // produção chega às ligações de saída no início de t+lag (a produção se reparte igualmente se o nó alimenta 2+ ligações)
      n.saidas.forEach((l) => {
        const lp = p.ligs.get(l.id) as LigP;
        const alvo = t + lp.lag;
        if (alvo <= H) (chega.get(l.id) as number[])[alvo] += eff / n.saidas.length;
      });
    }
    p.ligs.forEach((lp, id) => {
      const s = st.get(id) as number[];
      s[t + 1] = Math.max(0, s[t] - (consumo.get(id) as number[])[t]) + (chega.get(id) as number[])[t + 1];
    });
  }
  const ligacoes: SimLigacao[] = [...p.ligs.entries()].map(([id, lp]) => {
    const s = st.get(id) as number[];
    return { ligacaoId: id, rotulo: lp.l.rotulo ?? id, saldoInicial: s.slice(0, H).map(r3), entrada: (chega.get(id) as number[]).slice(0, H).map(r3), consumo: (consumo.get(id) as number[]).map(r3), saldoFinal: s.slice(1, H + 1).map(r3) };
  });
  const nos: SimNo[] = [...p.nos.values()].map((n) => {
    const d = desejada.get(n.id) as number[], e = efetiva.get(n.id) as number[];
    const sm = d.map((v, t) => Math.max(0, v - e[t]));
    return { noId: n.id, rotulo: n.rotulo, desejada: d.map(r3), efetiva: e.map(r3), disponivelMax: (dispMax.get(n.id) as number[]).map((v) => (Number.isFinite(v) ? r3(v) : Number.POSITIVE_INFINITY)), semMaterial: sm.map(r3), postosSemMaterial: sm.map((v, t) => (n.pp[t] > EPS_FB ? r3(v / n.pp[t]) : 0)) };
  });
  return { ligacoes, nos, violacoes, consumoRealMaiorQueDisponivel: conflitos, valido: violacoes.length === 0 };
}

/** Valida o plano completo: `plano` = produção desejada por nó/período (default = produção prevista da entrada). */
export function validarCadeia(e: EntradaForecast, plano?: PlanoProducao, op: OpcoesCadeia = {}): SimulacaoCadeia {
  return simularPrep(prepararCadeia(e, op), plano);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// (a) Backward: necessidade retropropagada
// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * ALAP com lead time: produção cumulativa mínima até o fim do período k (`req[k]`) → produção por período o MAIS TARDE possível, empurrada para trás pela
 * capacidade. `req` já é "produção acumulada necessária até o fim de k". O que só existiria ANTES do horizonte é `inevitavel` (peça produzida depois do prazo não evita a ruptura).
 */
export function alapCurva(req: number[], cap: number[]): { producao: number[]; inevitavel: number } {
  const H = req.length;
  const P = zeros(H);
  let m = 0;
  for (let k = 0; k < H; k++) { m = Math.max(m, req[k]); P[k] = m; }
  let base = 0; // produção acumulada "antes do horizonte"
  for (let k = H - 1; k >= 0; k--) {
    const ant = k > 0 ? P[k - 1] : base;
    const novo = Math.max(ant, P[k] - Math.max(0, cap[k] ?? 0));
    if (k > 0) P[k - 1] = novo; else base = novo;
  }
  const prod = zeros(H);
  for (let k = 0; k < H; k++) prod[k] = Math.max(0, P[k] - (k > 0 ? P[k - 1] : base));
  return { producao: prod.map(r3), inevitavel: r3(Math.max(0, base)) };
}

/** Produção acumulada necessária até o fim de cada período para sustentar o consumo `C` com estoque `s0`, lead time `lag` e estoque de segurança `ss` (≥ 0). */
export function requisitoAcumulado(C: number[], s0: number, lag: number, ss: number[]): number[] {
  const H = C.length;
  const cc = cum(C);
  // consumo do período t (e a segurança no início de t) exige produção acumulada até t-lag
  const req = zeros(H);
  let base = 0;
  for (let t = 0; t < H; t++) {
    const need = Math.max(0, cc[t] - s0 + (ss[t] ?? 0));
    const k = t - lag;
    if (k >= 0) req[k] = Math.max(req[k], need); else base = Math.max(base, need);
  }
  // o que precisaria existir antes do horizonte entra no 1º período como "inevitável" (requisito > 0 em k=-1): somamos a todos os k para ser contado
  if (base > 0) for (let k = 0; k < H; k++) req[k] = Math.max(req[k], base);
  return req;
}

export interface NecessidadeLigacao {
  ligacaoId: string; rotulo: string; origem: string; destino: string; confianca: ConfiancaForecast; lagPeriodos: number;
  /** o destino tem 2+ origens: estoque, cobertura e ruptura são do estoque TOTAL do destino */
  compartilhada: boolean;
  wipInicial: number;
  /** consumo requerido do destino nesta ligação (peças da origem) para cumprir a meta do destino */
  consumoRequerido: number[];
  /** produção que a ORIGEM precisa fazer em cada período (ALAP), peças da origem */
  producaoNecessariaOrigem: number[];
  /** estoque no início de cada período com a produção necessária (e só ela) */
  wipProjetado: number[];
  /** quantos períodos o estoque ATUAL dura no ritmo requerido, sem reposição (6.000 ÷ 3.000 ⇒ 2,0) */
  cobertura: Cobertura;
  /** período em que o buffer romperia sem reposição */
  periodoDaRuptura: number | null; periodoDaRupturaRotulo: string | null; minutoDaRuptura: number | null;
  /** ÚLTIMO PERÍODO SEGURO para a origem estar produzindo (1º período com produção necessária); null = não precisa ligar no horizonte */
  ultimoPeriodoSeguroLigar: number | null; ultimoPeriodoSeguroLigarRotulo: string | null;
  /** períodos entre ligar e a ruptura (≥ lead time; maior quando a capacidade obriga a começar antes) */
  antecedenciaPeriodos: number | null;
  /** peças que não dá para repor a tempo mesmo no limite da capacidade */
  inevitavel: number;
  /** pessoas-período (postos) que a produção necessária exige da origem */
  postosNecessarios: number[];
}
export interface NecessidadeNo {
  noId: string; rotulo: string;
  /** produção alvo do nó (meta para os finais; necessidade derivada para os demais) */
  producaoNecessaria: number[];
  producaoPlano: number[];
  /** peças que o plano produz a mais do que a cadeia precisa, SEM somar entre períodos (capacidade livre para outra necessidade/antecipação) */
  removivel: number[]; postosLivres: number[];
  /** lacuna do plano para a necessidade (necessária acumulada − plano acumulado, ≥ 0) por período */
  lacunaAcumulada: number[];
}
export interface ResultadoNecessidade { periodos: { rotulo: string; duracaoMin: number }[]; ligacoes: NecessidadeLigacao[]; nos: NecessidadeNo[]; avisos: string[]; }

/** Ordem de fontes de um destino (ids das ligações de entrada). */
function ordemFontes(n: NoP, op: OpcoesCadeia): LigacaoForecast[] {
  const pref = op.fontes?.[n.id];
  if (!pref) return n.entradas;
  const por = new Map(n.entradas.map((l) => [l.id, l]));
  const ord = pref.map((i) => por.get(i)).filter((x): x is LigacaoForecast => !!x);
  n.entradas.forEach((l) => { if (!ord.includes(l)) ord.push(l); });
  return pref.length > 0 ? ord.filter((l) => pref.includes(l.id)) : ord; // só as fontes pedidas
}

export function necessidadePrep(p: Prep, plano: PlanoProducao = planoDe(p)): ResultadoNecessidade {
  const { H } = p;
  const req = new Map<string, number[]>(); // produção necessária por nó
  const ligsOut: NecessidadeLigacao[] = [];
  const avisos: string[] = [];
  p.nos.forEach((n, id) => {
    if (n.saidas.length === 0) {
      const meta = p.op.metaPorNo?.[id];
      const base = meta ? [...meta, ...(p.temProximoDia && meta.length === p.Hbase ? [p.op.proximoDia?.producaoPorNo[id] ?? 0] : [])] : plano[id] ?? n.prod;
      let acc = 0;
      req.set(id, base.slice(0, H).map((v) => { let x = Math.max(0, v); if (n.dem !== null) { x = Math.min(x, Math.max(0, n.dem - acc)); acc += x; } return x; }));
    } else req.set(id, zeros(H));
  });
  [...p.topo].reverse().forEach((nid) => {
    const n = p.nos.get(nid) as NoP;
    const R = req.get(nid) as number[];
    if (n.entradas.length === 0) return;
    const fontes = ordemFontes(n, p.op);
    const compart = n.entradas.length > 1;
    // consumo total do destino (peças da origem, mesma unidade de estoque); com 2+ origens o estoque é o total (unidade = peças do destino × rend; assume rend igual)
    const rend = (p.ligs.get(fontes[0].id) as LigP).rend;
    const C = R.map((v) => v * rend);
    const s0 = n.entradas.reduce((s, l) => s + (p.ligs.get(l.id) as LigP).s0, 0);
    const margem = Math.max(...n.entradas.map((l) => (p.ligs.get(l.id) as LigP).margem));
    const ss = C.map((c) => margem * c);
    // cobertura (sem reposição) e ruptura do estoque total
    const cob = coberturaSemReposicao(s0, C, p.periodos.map((x) => x.duracaoMin));
    // requisito acumulado total; as fontes cobrem em ordem (a 1ª até a capacidade, o resto vai para a seguinte)
    let resid = requisitoAcumulado(C, s0, (p.ligs.get(fontes[0].id) as LigP).lag, ss);
    const reqTotal = [...resid];
    fontes.forEach((lg, ix) => {
      const lp = p.ligs.get(lg.id) as LigP;
      const orig = p.nos.get(lg.origem) as NoP;
      const aloc = alapCurva(resid, orig.cap);
      const nova = ix === fontes.length - 1 ? aloc : aloc;
      (req.get(orig.id) as number[]).forEach((_, k) => { (req.get(orig.id) as number[])[k] += nova.producao[k]; });
      const pc = cum(nova.producao);
      const wip = zeros(H);
      // estoque do destino (total) no início de t com a produção desta fonte: s0 + chegadas − consumo; reportado por ligação (compartilhado = total das fontes)
      resid = resid.map((v, k) => Math.max(0, v - pc[k]));
      const primeiro = nova.producao.findIndex((v) => v > EPS_FB);
      const rup = cob.periodoDaRuptura;
      ligsOut.push({
        ligacaoId: lg.id, rotulo: lg.rotulo ?? lg.id, origem: lg.origem, destino: lg.destino, confianca: lg.confianca, lagPeriodos: lp.lag, compartilhada: compart, wipInicial: lp.s0,
        consumoRequerido: C.map(r3), producaoNecessariaOrigem: nova.producao, wipProjetado: wip, cobertura: cob,
        periodoDaRuptura: rup, periodoDaRupturaRotulo: rup === null ? null : p.periodos[rup].rotulo, minutoDaRuptura: cob.minutoDaRuptura,
        ultimoPeriodoSeguroLigar: primeiro < 0 ? null : primeiro, ultimoPeriodoSeguroLigarRotulo: primeiro < 0 ? null : p.periodos[primeiro].rotulo,
        antecedenciaPeriodos: primeiro < 0 || rup === null ? null : rup - primeiro,
        inevitavel: ix === fontes.length - 1 ? nova.inevitavel : 0,
        postosNecessarios: nova.producao.map((v, k) => (v > EPS_FB && orig.pp[k] > EPS_FB ? Math.ceil(v / orig.pp[k] - 1e-9) : 0)),
      });
    });
    // wip projetado (total do destino) preenchido com a produção de TODAS as fontes
    const desta = ligsOut.filter((x) => x.destino === nid);
    const arr = zeros(H + 1);
    desta.forEach((x) => x.producaoNecessariaOrigem.forEach((v, k) => { const a = k + x.lagPeriodos; if (a <= H) arr[a] += v; }));
    const wip = zeros(H);
    let s = s0;
    for (let t = 0; t < H; t++) { s += arr[t]; wip[t] = r3(s); s = Math.max(0, s - C[t]); }
    desta.forEach((x) => (x.wipProjetado = wip));
    void reqTotal;
  });
  // nós: removível / lacuna
  const nos: NecessidadeNo[] = [...p.nos.values()].map((n) => {
    const need = req.get(n.id) as number[];
    const pc = cum(plano[n.id] ?? n.prod), nc = cum(need);
    const lac = pc.map((v, k) => Math.max(0, nc[k] - v));
    const folga = pc.map((v, k) => v - nc[k]);
    const remov = (plano[n.id] ?? n.prod).map((v, t) => { let m = Number.POSITIVE_INFINITY; for (let k = t; k < H; k++) m = Math.min(m, folga[k]); return r3(Math.min(v, Math.max(0, m))); });
    return { noId: n.id, rotulo: n.rotulo, producaoNecessaria: need.map(r3), producaoPlano: (plano[n.id] ?? n.prod).map(r3), removivel: remov, postosLivres: remov.map((v, t) => (n.pp[t] > EPS_FB ? r3(v / n.pp[t]) : 0)), lacunaAcumulada: lac.map(r3) };
  });
  if (ligsOut.some((l) => l.inevitavel > EPS_FB)) avisos.push("há reposição inevitável: a capacidade das origens não alcança a necessidade a tempo");
  return { periodos: p.periodos, ligacoes: ligsOut, nos, avisos };
}

/** Retropropagação da necessidade: meta dos nós finais → por ligação, produção upstream necessária, cobertura, ruptura e ÚLTIMO PERÍODO SEGURO. */
export function necessidadeRetropropagada(e: EntradaForecast, op: OpcoesCadeia = {}): ResultadoNecessidade {
  return necessidadePrep(prepararCadeia(e, op));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// (c) Reparo: candidatos
// ---------------------------------------------------------------------------------------------------------------------------------
export type TipoCandidato = "manter" | "religar_upstream" | "trocar_fonte" | "reduzir_downstream" | "religar_e_reduzir";

export interface CandidatoCadeia {
  id: string; tipo: TipoCandidato; descricao: string;
  /** fonte de reposição por destino com 2+ origens (ordem de preferência) */
  fontes: Record<string, string[]>;
  /** produção desejada por nó/período do candidato (plano + extra − corte) */
  plano: PlanoProducao;
  extra: PlanoProducao; corte: PlanoProducao;
  /** postos (pessoas-período) a ADICIONAR por nó/período = ceil(extra ÷ peças por posto), líquido dos postos já no plano */
  postosExtra: Record<string, number[]>; pessoasPeriodoExtra: number;
  /** capacidade que fica livre: postos que deixam de produzir sem material (corte) — vai para outra necessidade/antecipação, nunca pessoa parada */
  postosLivresPorCorte: Record<string, number[]>; pessoasPeriodoLivres: number;
  simulacao: SimulacaoCadeia; valida: boolean; violacoesRestantes: number;
  /** peças dos nós FINAIS: desejadas pelo plano original × efetivas neste candidato */
  pecasFinaisDesejadas: number; pecasFinais: number;
  /** peças efetivas dos nós finais no 1º período do PRÓXIMO DIA PRODUTIVO (0 sem `proximoDia`): o estoque de saída que a sexta deixa para a terça */
  pecasProximoDia: number;
  wipFinal: number; picoWip: number;
  /** valor do callback `avaliar` (ex.: peças finais × valor pelo avaliador de fluxo); null se ausente */
  valor: number | null;
}
export interface OpcoesReparo extends OpcoesCadeia {
  /** custo de oportunidade pelo PRODUTO FINAL do candidato (ex.: avaliador do fluxo). Maior = melhor. */
  avaliar?: (c: CandidatoCadeia) => number | null;
  maxIteracoes?: number;
  /** peso das peças finais do 1º período do próximo dia produtivo no critério de desempate sem `avaliar` (default 1; 0 ignora). Só vale se o plano do dia seguinte as realizar. */
  pesoProximoDia?: number;
  /** quais famílias de candidato gerar (default todas) */
  familias?: TipoCandidato[];
}
export interface ResultadoReparo { original: SimulacaoCadeia; candidatos: CandidatoCadeia[]; escolhido: CandidatoCadeia; necessidade: ResultadoNecessidade; avisos: string[]; }

function clonar(pl: PlanoProducao): PlanoProducao { return Object.fromEntries(Object.entries(pl).map(([k, v]) => [k, [...v]])); }

/** religa upstream no ÚLTIMO período seguro, violação a violação (a mais cedo primeiro), cascateando pela cadeia; `inev` = (nó|período) sem como repor. */
function religar(p: Prep, base: PlanoProducao, fontes: Record<string, string[]>, maxIt: number): { plano: PlanoProducao; extra: PlanoProducao } {
  const plano = clonar(base);
  const extra: PlanoProducao = Object.fromEntries([...p.nos.keys()].map((k) => [k, zeros(p.H)]));
  const inev = new Set<string>(); // violações que não têm mais como ser resolvidas
  const inevOrig = new Set<string>(); // origem|período sem mais material (não adianta somar)
  const ordemTopo = new Map(p.topo.map((id, i) => [id, i]));
  for (let it = 0; it < maxIt; it++) {
    const sim = simularPrep(p, plano);
    const vs = sim.violacoes.filter((v) => !inev.has(`${v.noId}|${v.periodo}`)).sort((a, b) => a.periodo - b.periodo || (ordemTopo.get(b.noId) as number) - (ordemTopo.get(a.noId) as number));
    if (vs.length === 0) break;
    const v = vs[0];
    const n = p.nos.get(v.noId) as NoP;
    const ord = ordemFontes(n, { ...p.op, fontes });
    let falta = v.falta;
    for (const lg of ord) {
      if (falta <= p.op.toleranciaPecas) break;
      const lp = p.ligs.get(lg.id) as LigP;
      const orig = p.nos.get(lg.origem) as NoP;
      const dispOrig = sim.nos.find((x) => x.noId === orig.id)?.disponivelMax ?? [];
      for (let q = v.periodo - lp.lag; q >= 0 && falta > p.op.toleranciaPecas; q--) {
        // sem material para a origem nesse período (já provado): só o que a origem consegue com o material que tem
        const teto = inevOrig.has(`${orig.id}|${q}`) ? Math.min(orig.cap[q], dispOrig[q] ?? Number.POSITIVE_INFINITY) : orig.cap[q];
        const room = Math.max(0, teto - plano[orig.id][q]);
        if (room <= EPS_FB) continue;
        const put = Math.min(room, falta * lp.rend);
        plano[orig.id][q] += put;
        extra[orig.id][q] += put;
        falta -= put / lp.rend;
      }
    }
    if (falta > p.op.toleranciaPecas) {
      inev.add(`${v.noId}|${v.periodo}`);
      // as origens com violação remanescente já não conseguem material adicional nesses períodos
      ord.forEach((lg) => { for (let q = 0; q < v.periodo; q++) inevOrig.add(`${lg.origem}|${q}`); });
    }
  }
  return { plano, extra };
}

/** corta o desejado ao efetivo (material) até não haver violação; devolve o corte por nó/período */
function reduzir(p: Prep, base: PlanoProducao): { plano: PlanoProducao; corte: PlanoProducao } {
  const plano = clonar(base);
  const corte: PlanoProducao = Object.fromEntries([...p.nos.keys()].map((k) => [k, zeros(p.H)]));
  for (let it = 0; it < p.H * p.nos.size + 4; it++) {
    const sim = simularPrep(p, plano);
    if (sim.valido) break;
    sim.violacoes.forEach((v) => {
      const no = sim.nos.find((x) => x.noId === v.noId) as SimNo;
      const alvo = Math.max(0, v.disponivel);
      const antes = plano[v.noId][v.periodo];
      plano[v.noId][v.periodo] = Math.min(antes, alvo);
      corte[v.noId][v.periodo] += Math.max(0, antes - alvo);
      void no;
    });
  }
  return { plano, corte };
}

function montarCandidato(p: Prep, id: string, tipo: TipoCandidato, descricao: string, fontes: Record<string, string[]>, original: PlanoProducao, plano: PlanoProducao, extra: PlanoProducao, corte: PlanoProducao): CandidatoCadeia {
  const sim = simularPrep(p, plano);
  const finais = [...p.nos.values()].filter((n) => n.saidas.length === 0);
  const postosExtra: Record<string, number[]> = {};
  const livres: Record<string, number[]> = {};
  p.nos.forEach((n) => {
    postosExtra[n.id] = extra[n.id].map((e, t) => {
      if (e <= EPS_FB || n.pp[t] <= EPS_FB) return 0;
      const pl = n.postosPlano[t] > 0 ? n.postosPlano[t] : Math.ceil((original[n.id][t]) / n.pp[t] - 1e-9);
      return Math.max(0, Math.ceil((original[n.id][t] + e) / n.pp[t] - 1e-9) - pl);
    });
    livres[n.id] = corte[n.id].map((c, t) => (c > EPS_FB && n.pp[t] > EPS_FB ? r3(c / n.pp[t]) : 0));
  });
  const wipFinal = soma(sim.ligacoes.map((l) => l.saldoFinal[p.H - 1] ?? 0));
  const c: CandidatoCadeia = {
    id, tipo, descricao, fontes, plano, extra, corte, postosExtra, pessoasPeriodoExtra: soma(Object.values(postosExtra).map(soma)), postosLivresPorCorte: livres, pessoasPeriodoLivres: r3(soma(Object.values(livres).map(soma))),
    simulacao: sim, valida: sim.valido, violacoesRestantes: sim.violacoes.length,
    pecasFinaisDesejadas: r3(soma(finais.map((n) => soma(original[n.id].slice(0, p.Hbase))))), pecasFinais: r3(soma(finais.map((n) => soma((sim.nos.find((x) => x.noId === n.id) as SimNo).efetiva.slice(0, p.Hbase))))),
    pecasProximoDia: p.temProximoDia ? r3(soma(finais.map((n) => (sim.nos.find((x) => x.noId === n.id) as SimNo).efetiva[p.Hbase] ?? 0))) : 0,
    wipFinal: r3(wipFinal), picoWip: r3(Math.max(0, ...sim.ligacoes.flatMap((l) => l.saldoFinal))), valor: null,
  };
  return c;
}

function permutacoes<T>(a: T[]): T[][] { return a.length <= 1 ? [a] : a.flatMap((x, i) => permutacoes([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])); }

/**
 * Gera candidatos (manter, religar upstream, trocar fonte, reduzir downstream, religar+reduzir), simula cada um na cadeia inteira e escolhe:
 * 1º válido (nenhum downstream produzindo mais do que o material), 2º maior valor (callback `avaliar`, senão peças finais efetivas), 3º menos pessoas-período extras.
 */
export function repararCadeia(e: EntradaForecast, plano?: PlanoProducao, op: OpcoesReparo = {}): ResultadoReparo {
  const p = prepararCadeia(e, op);
  const original = plano ? clonar(plano) : planoDe(p);
  // garante vetor com o período extra
  p.nos.forEach((n, id) => { if (!original[id]) original[id] = [...n.prod]; else while (original[id].length < p.H) original[id].push(n.prod[original[id].length] ?? 0); });
  const maxIt = op.maxIteracoes ?? 400;
  const fam = new Set(op.familias ?? ["manter", "religar_upstream", "trocar_fonte", "reduzir_downstream", "religar_e_reduzir"]);
  const orig = simularPrep(p, original);
  const necess = necessidadePrep(p, original);
  const zer = () => Object.fromEntries([...p.nos.keys()].map((k) => [k, zeros(p.H)])) as PlanoProducao;
  const destinosMulti = [...p.nos.values()].filter((n) => n.entradas.length > 1);
  // combinações de ordem de fontes (limitadas)
  let combos: Record<string, string[]>[] = [{}];
  destinosMulti.forEach((n) => {
    const perms = permutacoes(n.entradas.map((l) => l.id)).slice(0, 6);
    combos = combos.flatMap((c) => perms.map((pm) => ({ ...c, [n.id]: pm }))).slice(0, 12);
  });
  const nomeFonte = (fontes: Record<string, string[]>) => Object.entries(fontes).map(([d, pm]) => `${p.nos.get(d)?.rotulo ?? d}: ${pm.map((i) => (p.ligs.get(i) as LigP).l.rotulo ?? i).join(" > ")}`).join("; ");
  const cands: CandidatoCadeia[] = [];
  if (fam.has("manter")) cands.push(montarCandidato(p, "manter", "manter", "plano vigente sem alterar", {}, original, original, zer(), zer()));
  combos.forEach((fontes, i) => {
    const sufixo = destinosMulti.length > 0 ? ` [fonte: ${nomeFonte(fontes)}]` : "";
    const r = religar(p, original, fontes, maxIt);
    const tipoR: TipoCandidato = i === 0 ? "religar_upstream" : "trocar_fonte";
    if (fam.has(tipoR) || (i > 0 && fam.has("trocar_fonte"))) cands.push(montarCandidato(p, `${tipoR}#${i}`, tipoR, `religar upstream no último período seguro${sufixo}`, fontes, original, r.plano, r.extra, zer()));
    if (fam.has("religar_e_reduzir")) {
      const rr = reduzir(p, r.plano);
      if (soma(Object.values(rr.corte).map(soma)) > EPS_FB) cands.push(montarCandidato(p, `religar_e_reduzir#${i}`, "religar_e_reduzir", `religar upstream e reduzir o que não tiver material${sufixo}`, fontes, original, rr.plano, r.extra, rr.corte));
    }
  });
  if (fam.has("reduzir_downstream")) {
    const r = reduzir(p, original);
    cands.push(montarCandidato(p, "reduzir_downstream", "reduzir_downstream", "reduzir o downstream ao que o material permite (nada upstream)", {}, original, r.plano, zer(), r.corte));
  }
  cands.forEach((c) => { c.valor = op.avaliar ? op.avaliar(c) : null; });
  const ordenado = [...cands].sort((a, b) => {
    if (a.valida !== b.valida) return a.valida ? -1 : 1;
    if (!a.valida && a.violacoesRestantes !== b.violacoesRestantes) return a.violacoesRestantes - b.violacoesRestantes;
    const w = op.pesoProximoDia ?? 1;
    const va = a.valor ?? a.pecasFinais + w * a.pecasProximoDia, vb = b.valor ?? b.pecasFinais + w * b.pecasProximoDia;
    if (Math.abs(va - vb) > 1e-6) return vb - va;
    if (a.pessoasPeriodoExtra !== b.pessoasPeriodoExtra) return a.pessoasPeriodoExtra - b.pessoasPeriodoExtra;
    return a.id.localeCompare(b.id);
  });
  const avisos: string[] = [];
  if (orig.consumoRealMaiorQueDisponivel.length > 0) avisos.push("CONSUMO_REAL_MAIOR_QUE_DISPONIVEL em período fechado: contagem/apontamento conflitantes — recontar");
  if (!ordenado[0]?.valida) avisos.push("nenhum candidato elimina todas as rupturas");
  return { original: orig, candidatos: ordenado, escolhido: ordenado[0], necessidade: necess, avisos };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Fontes alternativas (ex.: Rosquear convencional + Parafusar × Máquina 8) para UM destino, cada uma avaliada SOZINHA (sem contar o benefício duas vezes)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface AvaliacaoFonte {
  ligacaoId: string; rotulo: string;
  /** cobre toda a necessidade do destino no horizonte sozinha? */
  cobre: boolean; inevitavel: number;
  /** pessoas-período da cadeia desta fonte (todas as etapas a montante inclusive) */
  pessoasPeriodo: number;
  /** peças do WIP a montante consumidas por esta fonte (a Máquina 8 não consome o rosqueado do buffer) */
  wipMontanteConsumido: number;
  ligarEm: number | null; ligarEmRotulo: string | null;
  producaoPorEtapa: { no: string; rotulo: string; producao: number[] }[];
}
export function fontesAlternativas(e: EntradaForecast, destinoId: string, op: OpcoesCadeia = {}): AvaliacaoFonte[] {
  const p = prepararCadeia(e, op);
  const d = p.nos.get(destinoId);
  if (!d) throw new Error("planejamentoCadeia: destino inexistente");
  const ids = d.entradas.map((l) => l.id);
  // cada fonte sozinha e, com 2+ fontes, cada ordem de uso conjunto (a 1ª até a capacidade, a seguinte cobre o resto)
  const ordens: string[][] = [...ids.map((i) => [i]), ...(ids.length > 1 ? permutacoes(ids) : [])];
  return ordens.map((ordem) => {
    const pp = prepararCadeia(e, { ...op, fontes: { ...(op.fontes ?? {}), [destinoId]: ordem } });
    const nec = necessidadePrep(pp);
    const montante = new Set<string>();
    const visita = (id: string) => { if (montante.has(id)) return; montante.add(id); (pp.nos.get(id) as NoP).entradas.forEach((l) => { if (id !== destinoId || ordem.includes(l.id)) visita(l.origem); }); };
    ordem.forEach((i) => visita((pp.ligs.get(i) as LigP).l.origem));
    const etapas = nec.nos.filter((n) => montante.has(n.noId));
    const ligsMont = nec.ligacoes.filter((l) => montante.has(l.destino) && l.destino !== destinoId);
    const todos = nec.ligacoes.filter((l) => l.destino === destinoId && ordem.includes(l.ligacaoId));
    const inev = todos.reduce((s, l) => s + l.inevitavel, 0);
    const primeiro = todos.map((l) => l.ultimoPeriodoSeguroLigar).filter((x): x is number => x !== null);
    const ligarEm = primeiro.length ? Math.min(...primeiro) : null;
    return {
      ligacaoId: ordem.join(" > "), rotulo: ordem.map((i) => (pp.ligs.get(i) as LigP).l.rotulo ?? i).join(" > "), cobre: inev <= p.op.toleranciaPecas, inevitavel: r3(inev),
      pessoasPeriodo: soma(etapas.map((n) => soma(nec.ligacoes.filter((l) => l.origem === n.noId && (l.destino !== destinoId || ordem.includes(l.ligacaoId))).flatMap((l) => l.postosNecessarios)))),
      wipMontanteConsumido: r3(soma(ligsMont.map((l) => soma(l.consumoRequerido)))),
      ligarEm, ligarEmRotulo: ligarEm === null ? null : p.periodos[ligarEm].rotulo,
      producaoPorEtapa: etapas.map((n) => ({ no: n.noId, rotulo: n.rotulo, producao: n.producaoNecessaria })),
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Utilitários de apresentação / integração
// ---------------------------------------------------------------------------------------------------------------------------------
export const piorConfiancaCadeia = (a: ConfiancaForecast, b: ConfiancaForecast) => (PIOR[b] > PIOR[a] ? b : a);

/**
 * Hook opcional (NÃO ligado a nada): critério de plano para o planejador. `0` = cadeia válida; senão, soma das peças sem material (penalidade).
 * `planejar.ts` poderia usar `(violacoes)` como 1ª componente da tupla J (lexicográfica) — ver relatório D4 §Integração.
 */
export function penalidadeDeCadeia(sim: SimulacaoCadeia): { invalido: boolean; pecasSemMaterial: number; violacoes: number } {
  return { invalido: !sim.valido, pecasSemMaterial: r3(soma(sim.violacoes.map((v) => v.falta))), violacoes: sim.violacoes.length };
}
