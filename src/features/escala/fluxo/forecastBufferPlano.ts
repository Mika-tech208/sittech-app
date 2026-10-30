// FORECAST DE BUFFER sobre um PLANO do motor — adaptador (CtxFluxo + alocações → EntradaForecast). PURO e DESLIGADO: nada no motor chama isto.
// Usa o mesmo grafo/estado do fluxo (pools fundidos do Conector incluídos), o WIP inicial lo/hi do corte, a capacidade das linhas do plano e a
// capacidade máxima (todas as máquinas disponíveis × pessoas disponíveis). Produtividade: meta×f do motor, ou razão real/meta do POSTO (estimador injetado).
import { maquinaDisponivelNoSlot } from "../disponibilidade";
import { chavePool, type AlocacaoEscala, type PoolEscala } from "../types";
import { capacidadeFuturaDoNo, type CtxFluxo } from "./estado";
import { selecionarFuturas } from "./avaliar";
import {
  forecastBuffer, type FonteReposicao, type EstagioFonte, type ModoTransferencia, type ConfiancaForecast, type EntradaForecast, type FonteTaxa, type LigacaoForecast, type NoForecast, type OpcoesForecast, type ResultadoForecast,
} from "./forecastBuffer";
import type { EstimadorTaxa } from "./produtividadePosto";

export interface OpcoesForecastPlano extends OpcoesForecast {
  /** rem explícito por nó com que o plano foi gerado (limita a demanda restante); ausente = Q − B0(lo) */
  limites?: Record<string, number>;
  /** razão real/meta por posto; ausente ⇒ meta × f do motor (fonte "meta") */
  estimador?: EstimadorTaxa;
  /** "maquinas" (default): capacidade máxima = máquinas disponíveis (limitadas pelas pessoas disponíveis); "plano": só o que o plano já tem */
  capacidadeMaxima?: "maquinas" | "plano";
  /** WIP do cenário: "lo" (default, pessimista) ou "hi" */
  cenarioWip?: "lo" | "hi";
  rotuloNo?: (chavePool: string) => string;
  /** modo de transferência de CADA ligação (aresta). Ausente ⇒ vale `mesmoPeriodo` (default lote de 1 período). Devolver `desconhecido` quando não se sabe: o forecast calcula os dois cenários. */
  modoLigacao?: (a: { arestaId: string; origemId: string; destinoId: string; produtoId: string; etapaOrigemId: string; etapaSeguinteId: string }) => { modo: ModoTransferencia; atrasoPeriodos?: number } | undefined;
}

export interface MapaForecast {
  /** índice do período do forecast → slot absoluto */
  slotDoPeriodo: number[];
  /** nó → pool representante (chave) e todos os membros */
  poolDoNo: Record<string, { representante: string; membros: string[] }>;
}

export interface ForecastDoPlano {
  entrada: EntradaForecast;
  mapa: MapaForecast;
  resultado: ResultadoForecast;
}

const PIOR: Record<ConfiancaForecast, number> = { alta: 0, media: 1, baixa: 2 };

export function entradaForecastDoPlano(ctx: CtxFluxo, alocacoes: AlocacaoEscala[], op: OpcoesForecastPlano = {}): { entrada: EntradaForecast; mapa: MapaForecast } {
  const { grafo } = ctx;
  const T = ctx.entrada.slots.length;
  const a0 = ctx.aPartirDe;
  const H = Math.max(0, T - a0);
  const futuras = selecionarFuturas(ctx, alocacoes);
  const cen = op.cenarioWip ?? "lo";
  const ini = ctx.iniAPartirDe[cen];
  const rotulo = op.rotuloNo ?? ((k: string) => k);
  const periodos = Array.from({ length: H }, (_, i) => {
    const s = ctx.entrada.slots[a0 + i];
    return { rotulo: `${s.data.slice(5)} ${s.periodoId.toUpperCase()}`, duracaoMin: s.fimMin - s.inicioMin };
  });
  const nPessoas = (t: number) => {
    const slot = ctx.entrada.slots[t];
    const aus = new Set((ctx.entrada.ausencias ?? []).filter((x) => x.data === slot.data && (x.inicioMin === null || x.fimMin === null || (x.inicioMin < slot.fimMin && x.fimMin > slot.inicioMin))).map((x) => x.funcionarioId));
    return ctx.entrada.funcionarios.filter((f) => !aus.has(f.id)).length;
  };
  const pessoas = Array.from({ length: H }, (_, i) => nPessoas(a0 + i));

  // produção prevista por nó/período a partir das linhas do plano
  const prod: Record<string, number[]> = {};
  const postos: Record<string, number[]> = {};
  const fontes: Record<string, FonteTaxa[]> = {};
  const hist: Record<string, number[]> = {}; // quantas linhas usaram histórico
  Object.keys(grafo.nos).forEach((n) => { prod[n] = new Array(H).fill(0); postos[n] = new Array(H).fill(0); fontes[n] = new Array<FonteTaxa>(H).fill("meta"); hist[n] = new Array(H).fill(0); });
  futuras.forEach((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId) return;
    const t = ctx.idxSlot.get(`${a.data}|${a.periodoId}`);
    const k = chavePool(a.produtoId, a.etapaId);
    const n = grafo.noDoPool[k];
    const pool = ctx.poolsPorChave.get(k);
    if (t === undefined || !n || !pool) return;
    const i = t - a0;
    let mu = (pool.metas[a.periodoId] ?? 0) * (ctx.fator[k] ?? 1);
    if (mu <= 0) return;
    if (op.estimador) {
      const tx = op.estimador({ produtoId: a.produtoId, operacaoId: pool.operacaoId, maquinaId: a.maquinaId });
      if (tx.fonte === "historico") { mu = ((pool.metas[a.periodoId] ?? 0) / (ctx.fator[k] || 1)) * tx.razao; hist[n][i]++; }
    }
    if ((a.pecasAdicional ?? 0) > 0 && !((a.pecas ?? 0) > 0)) mu = Math.min(mu, a.pecasAdicional as number);
    prod[n][i] += mu;
    postos[n][i]++;
  });
  Object.keys(grafo.nos).forEach((n) => hist[n].forEach((h, i) => { if (h > 0 && h === postos[n][i]) fontes[n][i] = "historico"; }));

  const nos: NoForecast[] = Object.values(grafo.nos).map((no) => {
    const pools = no.membros.map((m) => ctx.poolsPorChave.get(m) as PoolEscala);
    const maquinas = [...new Set(pools.flatMap((p) => p.maquinasIds))].sort();
    const pecasPorPosto = new Array(H).fill(0);
    const cap = new Array(H).fill(0);
    for (let i = 0; i < H; i++) {
      const slot = ctx.entrada.slots[a0 + i];
      const muNom = Math.max(...pools.map((p) => (p.metas[slot.periodoId] ?? 0) * (ctx.fator[chavePool(p.produtoId, p.etapaId)] ?? 1)), 0);
      const pp = postos[no.id][i] > 0 ? prod[no.id][i] / postos[no.id][i] : muNom;
      pecasPorPosto[i] = pp;
      const disp = maquinas.filter((m) => maquinaDisponivelNoSlot(ctx.entrada, m, slot)).length;
      const capMax = (op.capacidadeMaxima ?? "maquinas") === "plano" ? prod[no.id][i] : Math.min(disp, pessoas[i]) * pp;
      cap[i] = Math.max(prod[no.id][i], capMax);
    }
    const dem = op.limites?.[no.id] ?? Math.max(0, no.quantidade - (ini.B0[no.id] ?? 0));
    return { id: no.id, rotulo: rotulo(no.id), producaoPrevista: prod[no.id], capacidadeMaxima: cap, demandaRestante: dem, fonteTaxa: fontes[no.id], pecasPorPosto, postosPrevistos: postos[no.id] };
  });

  const ligacoes: LigacaoForecast[] = Object.values(grafo.arestas).map((e) => {
    const par = ctx.pares.find((p) => p.produtoId === e.produtoId && p.etapaOrigemId === e.etapaOrigemId && p.etapaSeguinteId === e.etapaSeguinteId);
    const w0hi = ctx.iniAPartirDe.hi.W0[e.id] ?? 0;
    const md = op.modoLigacao?.({ arestaId: e.id, origemId: e.origem, destinoId: e.destino, produtoId: e.produtoId, etapaOrigemId: e.etapaOrigemId, etapaSeguinteId: e.etapaSeguinteId });
    return {
      ...(md ? { transferencia: md.modo, ...(md.atrasoPeriodos !== undefined ? { atrasoPeriodos: md.atrasoPeriodos } : {}) } : {}),
      id: e.id, rotulo: `${rotulo(e.origem)}→${rotulo(e.destino)}`, origem: e.origem, destino: e.destino, wipInicial: ini.W0[e.id] ?? 0, wipInicialHi: w0hi,
      confianca: (par?.confianca ?? "baixa") as ConfiancaForecast, peso: e.peso, tetoWip: Math.max(w0hi, capacidadeFuturaDoNo(ctx, e.origem).tetoPeriodo),
    };
  });
  const poolDoNo: MapaForecast["poolDoNo"] = {};
  Object.values(grafo.nos).forEach((n) => (poolDoNo[n.id] = { representante: n.membros[0] ?? n.id, membros: n.membros }));
  return { entrada: { periodos, nos, ligacoes }, mapa: { slotDoPeriodo: Array.from({ length: H }, (_, i) => a0 + i), poolDoNo } };
}

export function forecastDoPlano(ctx: CtxFluxo, alocacoes: AlocacaoEscala[], op: OpcoesForecastPlano = {}): ForecastDoPlano {
  const { entrada, mapa } = entradaForecastDoPlano(ctx, alocacoes, op);
  const resultado = forecastBuffer(entrada, { mesmoPeriodo: ctx.opcoes.fluxoMesmoPeriodo === true, ...op });
  return { entrada, mapa, resultado };
}

/** Traduz as ações do forecast em postos mínimos por (slot, pool) (só os `maxPeriodos` primeiros períodos: "ligar AGORA" com horizonte rolante) — formato de `EntradaEscala.reposicaoMinima` — e as peças extras a somar ao `rem` do pool. */
export function reposicaoMinimaDe(f: ForecastDoPlano, maxPeriodos = Number.POSITIVE_INFINITY): { reposicaoMinima: Record<string, Record<string, number>>; remExtra: Record<string, number> } {
  const reposicaoMinima: Record<string, Record<string, number>> = {};
  const remExtra: Record<string, number> = {};
  f.resultado.ligacoes.forEach((l) => {
    if (l.acao.tipo === "nenhuma") return;
    const n = f.mapa.poolDoNo[l.origem];
    const planejados = f.entrada.nos.find((x) => x.id === l.origem)?.postosPrevistos ?? [];
    l.acao.postosAdicionais.forEach((extra, i) => {
      if (extra <= 0 || i >= maxPeriodos) return;
      const slot = String(f.mapa.slotDoPeriodo[i]);
      const chave = n.representante;
      const total = (planejados[i] ?? 0) + extra;
      (reposicaoMinima[slot] ??= {})[chave] = Math.max(reposicaoMinima[slot]?.[chave] ?? 0, total);
      remExtra[chave] = (remExtra[chave] ?? 0) + l.acao.adicionar[i];
    });
  });
  return { reposicaoMinima, remExtra };
}

export const piorConfianca = (a: ConfiancaForecast, b: ConfiancaForecast) => (PIOR[b] > PIOR[a] ? b : a);

/** Fontes de reposição que alimentam o nó `destinoId` (uma por ligação de entrada), cada uma como cadeia de estágios (do que entrega ao buffer até a primeira etapa). */
export function fontesDoNo(f: ForecastDoPlano, destinoId: string, restricoes: Record<string, string[]> = {}): FonteReposicao[] {
  const nosPorId = new Map(f.entrada.nos.map((n) => [n.id, n]));
  const entradas = (id: string) => f.entrada.ligacoes.filter((l) => l.destino === id);
  return entradas(destinoId).map((l0) => {
    const estagios: EstagioFonte[] = [];
    let l: typeof l0 | undefined = l0;
    const vistos = new Set<string>();
    while (l && !vistos.has(l.origem)) {
      vistos.add(l.origem);
      const n = nosPorId.get(l.origem) as NonNullable<ReturnType<typeof nosPorId.get>>;
      const ins = entradas(n.id);
      const lin: typeof l0 | undefined = ins.length === 1 ? ins[0] : undefined;
      estagios.push({
        rotulo: n.rotulo, pecasPorPosto: n.pecasPorPosto ?? n.producaoPrevista.map(() => 0), capacidadeMaxima: n.capacidadeMaxima ?? n.producaoPrevista,
        wipEntrada: lin ? lin.wipInicial : 0, materialExterno: ins.length === 0,
      });
      l = lin;
    }
    return { id: l0.id, rotulo: l0.rotulo ?? l0.id, estagios, restricoes: restricoes[l0.id] ?? [] };
  });
}

/** Defasagem por aresta (id da aresta → períodos) de um cenário, para o SIMULADOR (`OpcoesFluxo.transferenciaPorAresta`). Ligação sem modo declarado fica de fora (vale o global). */
export function transferenciaPorArestaDe(entrada: EntradaForecast, cenario: "conservador" | "continuo"): Record<string, number> {
  const out: Record<string, number> = {};
  entrada.ligacoes.forEach((l) => {
    if (!l.transferencia) return;
    const lote = Math.max(1, Math.round(l.atrasoPeriodos ?? 1));
    out[l.id] = l.transferencia === "continuo" ? 0 : l.transferencia === "lote" ? lote : cenario === "continuo" ? 0 : lote;
  });
  return out;
}

/** O mesmo forecast, mas apontando para o cenário CONTÍNUO das ligações desconhecidas (para derivar ações/mínimos desse cenário). */
export function cenarioContinuo(f: ForecastDoPlano): ForecastDoPlano {
  return f.resultado.alternativo ? { ...f, resultado: f.resultado.alternativo } : f;
}
