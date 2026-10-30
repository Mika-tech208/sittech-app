// PLANEJAMENTO DE CADEIA — CAMADA 3: REPARO (producao_real_cadeia_reparo). PURO. Só roda com a flag ligada; o resultado entra como CANDIDATO(S) em planejarComFluxo e é julgado pela MESMA
// tupla J do avaliador (peças finais, nunca "peças × preço"). Nenhuma ordem de fontes é hard-coded (Máquina 8 NÃO tem prioridade): cada variante coloca uma fonte diferente primeiro e o
// avaliador decide pelo produto final.
//
//   pedirReposicao — RETROPROPAGAÇÃO REAL com lead time: a necessidade do upstream NASCE do déficit do downstream (que por sua vez nasce, no último período, da demanda do próximo dia produtivo):
//                    demanda final → Embalar → Etiquetar → Parafusar → Rosquear. Cada violação (nó, período t) pede produção às fontes no ÚLTIMO período seguro (t − lag); se ali não há capacidade
//                    (máquina livre), no período anterior mais próximo; a produção pedida entra numa simulação-sombra e as violações das próprias fontes são reparadas em cascata
//                    (o mínimo necessário: nunca "sempre ligado"). Saída = postos mínimos por (slot, pool) para o hook `reposicaoMinima` do motor, que respeita revezamento (bloco + ponte),
//                    máquinas da Previsão, passado congelado e unicidade pessoa/máquina.
//   realocarPostosSemMaterial — pessoa em posto sem material (produção creditada nula/parcial) é movida para produção útil quando isso melhora a penalidade de cadeia ou a falta final, sem
//                    criar violação dura nem piorar nenhuma das duas; sem destino útil o posto fica e o diagnóstico registra.

import { maquinaDisponivelNoSlot } from "../disponibilidade";
import { metaNoSlot } from "../folga";
import { chavePool, type AlocacaoEscala, type EntradaEscala, type PoolEscala } from "../types";
import { avaliarComCtx, selecionarFuturas } from "./avaliar";
import { EPS_CADEIA, muDoNo, simularCadeia, type ExtraCadeia, type ViolacaoCadeia } from "./cadeia";
import type { CtxFluxo } from "./estado";
import { verificarRestricoesDuras } from "./restricoes";
import type { DiagnosticoItem } from "./tipos";

const r1 = (v: number) => Math.round(v * 10) / 10;

export interface Reposicao {
  /** slot (índice absoluto) → chave do pool representante → nº MÍNIMO de postos (formato de EntradaEscala.reposicaoMinima) */
  minimos: Record<string, Record<string, number>>;
  /** peças a somar ao `rem` do pool representante (a reposição pedida) */
  remExtra: Record<string, number>;
  /** violações que nenhuma reposição consegue evitar (sem capacidade/sem período anterior alterável) */
  inevitaveis: ViolacaoCadeia[];
  postosExtra: number;
}

/** Nº de variantes de ordem de fontes (= maior nº de ligações de entrada de um nó): a variante v coloca a v-ésima fonte (em ordem de id) na frente. */
export function numeroDeVariantes(ctx: CtxFluxo): number {
  return Math.max(1, ...Object.values(ctx.grafo.entradas).map((e) => e.length));
}

/** Pedidos de reposição que eliminam o que for eliminável das violações do plano `linhas`. `base` = mínimos já pedidos (monotônico entre rodadas). */
export function pedirReposicao(ctx: CtxFluxo, linhas: AlocacaoEscala[], variante: number, base?: Record<string, Record<string, number>>): Reposicao {
  const { grafo, entrada } = ctx;
  const a0 = ctx.aPartirDe;
  const planejados: Record<string, Record<number, number>> = {};
  selecionarFuturas(ctx, linhas).forEach((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId) return;
    const n = grafo.noDoPool[chavePool(a.produtoId, a.etapaId)];
    const t = ctx.idxSlot.get(`${a.data}|${a.periodoId}`);
    if (n === undefined || t === undefined) return;
    (planejados[n] ??= {})[t] = (planejados[n][t] ?? 0) + 1;
  });
  const extraPostos: Record<string, Record<number, number>> = {};
  const extra: ExtraCadeia = { producao: {} };
  const inev = new Set<string>();
  const inevitaveis: ViolacaoCadeia[] = [];
  const postos = (n: string, t: number) => (planejados[n]?.[t] ?? 0) + (extraPostos[n]?.[t] ?? 0);
  const livres = (n: string, t: number) => {
    const slot = entrada.slots[t];
    const maq = [...new Set(grafo.nos[n].membros.flatMap((m) => (ctx.poolsPorChave.get(m) as PoolEscala).maquinasIds))].filter((m) => maquinaDisponivelNoSlot(entrada, m, slot)).length;
    return maq - postos(n, t);
  };
  for (let it = 0; it < 80; it++) {
    const sim = simularCadeia(ctx, linhas, { extra });
    const v = sim.violacoes.filter((x) => !inev.has(`${x.noId}|${x.slot}`)).sort((a, b) => a.slot - b.slot)[0];
    if (!v) break;
    const ordem = grafo.entradas[v.noId].map((e) => grafo.arestas[e].origem).sort();
    const fontes = ordem.length > 1 ? [...ordem.slice(variante % ordem.length), ...ordem.slice(0, variante % ordem.length)] : ordem;
    let feito = false;
    for (const u of fontes) {
      for (let s = Math.min(v.ultimoSeguro, entrada.slots.length - 1); s >= a0 && !feito; s--) {
        const mu = muDoNo(ctx, u, entrada.slots[s].periodoId);
        const livre = livres(u, s);
        if (mu <= EPS_CADEIA || livre <= 0) continue;
        const k = Math.min(livre, Math.max(1, Math.ceil((v.deficit - EPS_CADEIA) / mu)));
        (extraPostos[u] ??= {})[s] = (extraPostos[u][s] ?? 0) + k;
        (extra.producao[u] ??= {})[s] = (extra.producao[u][s] ?? 0) + k * mu;
        feito = true;
      }
      if (feito) break;
    }
    if (!feito) {
      inev.add(`${v.noId}|${v.slot}`);
      inevitaveis.push(v);
    }
  }
  const minimos: Record<string, Record<string, number>> = {};
  Object.entries(base ?? {}).forEach(([s, m]) => (minimos[s] = { ...m }));
  const remExtra: Record<string, number> = {};
  let postosExtra = 0;
  Object.entries(extraPostos).forEach(([n, porSlot]) => {
    const rep = grafo.nos[n].membros[0];
    Object.entries(porSlot).forEach(([s, k]) => {
      const total = (planejados[n]?.[Number(s)] ?? 0) + k;
      (minimos[s] ??= {})[rep] = Math.max(minimos[s]?.[rep] ?? 0, total);
      postosExtra += k;
    });
    remExtra[rep] = Object.values(extra.producao[n] ?? {}).reduce((a, b) => a + b, 0);
  });
  return { minimos, remExtra, inevitaveis, postosExtra };
}

/** Pessoas sem posto que PODERIAM ter um (há máquina de pool com meta > 0, disponível e livre no slot) — portão: o reparo nunca aumenta isto. */
export function ociosasEvitaveis(ctx: CtxFluxo, linhas: AlocacaoEscala[]): number {
  const { entrada } = ctx;
  let n = 0;
  const futuras = selecionarFuturas(ctx, linhas);
  for (let t = ctx.aPartirDe; t < entrada.slots.length; t++) {
    const slot = entrada.slots[t];
    const doSlot = futuras.filter((a) => ctx.idxSlot.get(`${a.data}|${a.periodoId}`) === t);
    const usadas = new Set(doSlot.filter((a) => a.maquinaId).map((a) => a.maquinaId as string));
    const livres = new Set<string>();
    entrada.pools.forEach((p) => { if (metaNoSlot(p, slot) > 0) p.maquinasIds.forEach((m) => { if (!usadas.has(m) && maquinaDisponivelNoSlot(entrada, m, slot)) livres.add(m); }); });
    n += Math.min(doSlot.filter((a) => !a.maquinaId).length, livres.size);
  }
  return n;
}

export interface ResultadoRealocacao {
  linhas: AlocacaoEscala[];
  realocadas: number;
  semDestino: number;
  diagnosticos: DiagnosticoItem[];
}

/**
 * Para cada posto cuja produção creditada fica nula/parcial por falta de material (violação do plano, períodos da semana), tenta mover a PESSOA para produção útil: primeiro as fontes do próprio
 * nó (upstream, para os períodos seguintes), depois qualquer outro posto livre. Aceita a troca só se (a) não cria violação dura, (b) melhora a penalidade de cadeia ou a falta final do avaliador
 * e (c) não piora nenhuma das duas. Linhas manuais nunca são movidas. Só slots ≥ aPartirDe.
 */
export function realocarPostosSemMaterial(ctx: CtxFluxo, entrada: EntradaEscala, linhas: AlocacaoEscala[], limites?: Record<string, number>): ResultadoRealocacao {
  const { grafo } = ctx;
  let atual = linhas;
  const diag: DiagnosticoItem[] = [];
  let realocadas = 0;
  let semDestino = 0;
  const avalia = (l: AlocacaoEscala[]) => avaliarComCtx(ctx, l, { contribuicoes: false, trajetoria: false, ...(limites ? { limites } : {}) }).totais.faltaFinalLo;
  const ruins = (l: AlocacaoEscala[]) => verificarRestricoesDuras(entrada, l, { somenteLinhasNovas: true }).length;
  const tentados = new Set<string>();
  for (let guarda = 0; guarda < 40; guarda++) {
    const sim = simularCadeia(ctx, atual, { semProximoDia: true });
    const v = sim.violacoes.find((x) => !tentados.has(`${x.noId}|${x.slot}`));
    if (!v) break;
    tentados.add(`${v.noId}|${v.slot}`);
    const slot = entrada.slots[v.slot];
    const mu = muDoNo(ctx, v.noId, slot.periodoId);
    const noLinha = (a: AlocacaoEscala) => a.maquinaId && a.produtoId && a.etapaId && grafo.noDoPool[chavePool(a.produtoId, a.etapaId)] === v.noId && a.data === slot.data && a.periodoId === slot.periodoId;
    const doNo = atual.filter((a) => noLinha(a) && a.origem !== "manual");
    const nIdle = Math.min(doNo.length, Math.max(1, Math.ceil((v.deficit - EPS_CADEIA) / Math.max(mu, 1e-6))));
    const fontes = new Set(grafo.entradas[v.noId].map((e) => grafo.arestas[e].origem));
    const noDe = (p: PoolEscala) => grafo.noDoPool[chavePool(p.produtoId, p.etapaId)];
    const destinos = [...entrada.pools].filter((p) => metaNoSlot(p, slot) > 0 && noDe(p) !== v.noId)
      .sort((x, y) => Number(fontes.has(noDe(y))) - Number(fontes.has(noDe(x))) || (chavePool(x.produtoId, x.etapaId) < chavePool(y.produtoId, y.etapaId) ? -1 : 1));
    for (const linha of doNo.slice(-nIdle)) {
      const falta0 = avalia(atual);
      const pen0 = simularCadeia(ctx, atual).deficit;
      const ruins0 = ruins(atual);
      let melhor: { linhas: AlocacaoEscala[]; falta: number; pen: number } | null = null;
      for (const p of destinos) {
        const usadas = new Set(atual.filter((a) => a.maquinaId && a.data === slot.data && a.periodoId === slot.periodoId && a !== linha).map((a) => a.maquinaId as string));
        const m = [...new Set(p.maquinasIds)].sort().find((x) => !usadas.has(x) && maquinaDisponivelNoSlot(entrada, x, slot));
        if (!m) continue;
        const nova: AlocacaoEscala = { ...linha, maquinaId: m, produtoId: p.produtoId, etapaId: p.etapaId, operacaoId: p.operacaoId, pecas: metaNoSlot(p, slot), motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null };
        delete nova.pecasAdicional;
        delete nova.tipoAdicional;
        const cand = atual.map((a) => (a === linha ? nova : a));
        if (ruins(cand) > ruins0) continue;
        const falta = avalia(cand);
        const pen = simularCadeia(ctx, cand).deficit;
        if (falta > falta0 + EPS_CADEIA || pen > pen0 + EPS_CADEIA) continue;
        if (!(falta < falta0 - EPS_CADEIA || pen < pen0 - EPS_CADEIA)) continue;
        if (melhor === null || pen < melhor.pen - EPS_CADEIA || (Math.abs(pen - melhor.pen) <= EPS_CADEIA && falta < melhor.falta - EPS_CADEIA)) melhor = { linhas: cand, falta, pen };
      }
      if (melhor) {
        atual = melhor.linhas;
        realocadas++;
        diag.push({ codigo: "POSTO_SEM_MATERIAL_REALOCADO", severidade: "info", produtoId: v.produtoId, etapaId: v.etapaId, slot: v.slot, mensagem: `Posto sem material em ${slot.data} ${slot.periodoId} (faltam ${Math.round(v.deficit)} peça(s) de material): pessoa realocada para produção útil`, detalhes: { deficit: r1(v.deficit), faltaDepois: r1(melhor.falta), penalidadeDepois: r1(melhor.pen) } });
      } else {
        semDestino++;
        diag.push({ codigo: "POSTO_SEM_MATERIAL_SEM_DESTINO", severidade: "aviso", produtoId: v.produtoId, etapaId: v.etapaId, slot: v.slot, mensagem: `Posto sem material em ${slot.data} ${slot.periodoId} (faltam ${Math.round(v.deficit)} peça(s) de material) e nenhum destino de produção útil sem violação: posto mantido`, detalhes: { deficit: r1(v.deficit) } });
      }
    }
  }
  return { linhas: atual, realocadas, semDestino, diagnosticos: diag };
}
