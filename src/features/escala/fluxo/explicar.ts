// EXPLICAÇÃO DA MUDANÇA (critério J) — descreve o plano proposto CONTRA o plano de referência (o VIGENTE, que é o que o supervisor vê) com ganhos ADITIVOS.
//
// Cada decisão é um grupo (período, posto de → posto para) de pessoas. Partindo da capacidade do plano de referência, as decisões são aplicadas UMA A UMA e o simulador
// (a mesma régua de `avaliarPlano`, cenário pessimista) é re-executado: o ganho da decisão é a variação marginal do produto final previsto naquele passo. Cada ORDEM de
// aplicação soma exatamente (final do plano com todas as decisões) − (final da referência); o ganho reportado é a MÉDIA de vários caminhos (Shapley por amostragem
// determinística), também aditivo. O que sobra até o final previsto do plano devolvido (teto de demanda `rem` do motor, quantidades em postos mantidos) é o `residuo`,
// SEMPRE explicitado. Puro, determinístico, sem IO.

import type { AlocacaoEscala } from "../types";
import { capacidadeDaLinha, capsDoPlano, rodar, selecionarFuturas } from "./avaliar";
import { capacidadeFuturaDoNo, type CtxFluxo } from "./estado";
import { copiarCaps, type CapNo } from "./simulador";
import type { AvaliacaoPlano, DecisaoFluxo, PostoRef, ReconciliacaoGanho, ResumoDecisao } from "./tipos";

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Ordens pseudo-aleatórias (além da cronológica e da inversa) na média de caminhos do ganho aditivo. */
const PERMUTACOES_EXTRAS = 6;

export function postoDeLinha(a: AlocacaoEscala | undefined): PostoRef {
  if (!a || !a.maquinaId) return { maquinaId: null, produtoId: null, etapaId: null };
  const adicional = (a.pecasAdicional ?? 0) > 0 && !((a.pecas ?? 0) > 0);
  return { maquinaId: a.maquinaId, produtoId: a.produtoId ?? null, etapaId: a.etapaId ?? null, ...(adicional ? { adicional: true } : {}) };
}
export const chavePostoRef = (p: PostoRef) => `${p.maquinaId ?? ""}|${p.produtoId ?? ""}|${p.etapaId ?? ""}${p.adicional ? "|adic" : ""}`;

interface Metricas { final: number; wipFinal: number; legado: number; excesso: number }
const somaM = (a: Metricas, b: Metricas): Metricas => ({ final: a.final + b.final, wipFinal: a.wipFinal + b.wipFinal, legado: a.legado + b.legado, excesso: a.excesso + b.excesso });

export interface ExplicacaoMudanca {
  decisoes: DecisaoFluxo[];
  resumo: ResumoDecisao[];
  reconciliacao: ReconciliacaoGanho;
}

export function explicarMudanca(ctx: CtxFluxo, referenciaLinhas: AlocacaoEscala[], novoLinhas: AlocacaoEscala[], avRef: AvaliacaoPlano, avNovo: AvaliacaoPlano, referencia: "vigente" | "base"): ExplicacaoMudanca {
  const { grafo } = ctx;
  const refF = selecionarFuturas(ctx, referenciaLinhas);
  const novoF = selecionarFuturas(ctx, novoLinhas);
  const chaveL = (a: AlocacaoEscala) => `${ctx.idxSlot.get(`${a.data}|${a.periodoId}`)}|${a.funcionarioId}`;
  const mRef = new Map(refF.map((a) => [chaveL(a), a]));
  const mNovo = new Map(novoF.map((a) => [chaveL(a), a]));

  // ---- 1. grupos (período, de → para) com TODAS as pessoas movidas ----
  interface G { slot: number; data: string; periodoId: string; de: PostoRef; para: PostoRef; pessoas: { f: string; a?: AlocacaoEscala; b?: AlocacaoEscala }[] }
  const grupos = new Map<string, G>();
  [...new Set([...mRef.keys(), ...mNovo.keys()])].sort().forEach((k) => {
    const a = mRef.get(k);
    const b = mNovo.get(k);
    const de = postoDeLinha(a);
    const para = postoDeLinha(b);
    if (chavePostoRef(de) === chavePostoRef(para)) return;
    const ref = (b ?? a) as AlocacaoEscala;
    const slot = ctx.idxSlot.get(`${ref.data}|${ref.periodoId}`) as number;
    const gk = `${String(slot).padStart(4, "0")}|${chavePostoRef(de)}|${chavePostoRef(para)}`;
    const g = grupos.get(gk) ?? { slot, data: ref.data, periodoId: ref.periodoId, de, para, pessoas: [] };
    g.pessoas.push({ f: ref.funcionarioId, a, b });
    grupos.set(gk, g);
  });
  const lista = [...grupos.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([, g]) => g);

  // ---- 2. atribuição aditiva: média de caminhos (Shapley por amostragem determinística de ordens) ----
  // Cada ORDEM de aplicação das decisões é um caminho completo referência → plano; o ganho de cada decisão num caminho é a variação marginal do simulador naquele passo
  // (aditivo: a soma do caminho é exatamente final(plano) − final(referência)). A média de vários caminhos (cronológico, inverso e ordens pseudo-aleatórias de semente fixa) mantém
  // a aditividade e reduz o viés de ordem: complementaridades (rebaixar a etapa anterior só vale com a seguinte reforçada) são divididas, em vez de punir o 1º movimento.
  const caps0: Record<string, CapNo> = capsDoPlano(ctx, refF);
  const grupoDoNo: Record<string, number> = {};
  grafo.grupos.forEach((g, gi) => g.nos.forEach((n) => (grupoDoNo[n] = gi)));
  const tetoAresta: Record<string, number> = {};
  Object.values(grafo.arestas).forEach((ar) => (tetoAresta[ar.id] = Math.max(ctx.iniAPartirDe.hi.W0[ar.id] ?? 0, capacidadeFuturaDoNo(ctx, ar.origem).tetoPeriodo)));
  const metricasGrupo = (caps: Record<string, CapNo>, gi: number): Metricas => {
    const g = grafo.grupos[gi];
    const lo = rodar(ctx, gi, caps, "lo", undefined, false);
    const hi = rodar(ctx, gi, caps, "hi", undefined, false);
    const Q = grafo.nos[g.sink].quantidade;
    let wipFinal = 0, legado = 0, excesso = 0;
    g.arestas.forEach((e) => {
      wipFinal += lo.W[e];
      legado += lo.L[e];
      excesso += Math.max(0, hi.W[e] - tetoAresta[e]);
    });
    return { final: Math.min(Q, lo.B[g.sink]), wipFinal, legado, excesso };
  };
  const metricas0: Metricas[] = grafo.grupos.map((_, gi) => metricasGrupo(caps0, gi));
  const zero: Metricas = { final: 0, wipFinal: 0, legado: 0, excesso: 0 };
  const somar = (ms: Metricas[]) => ms.reduce(somaM, zero);

  // grupos do grafo tocados por cada decisão, e as linhas (retirar a, pôr b)
  const tocadosPor: number[][] = lista.map((g) => {
    const t = new Set<number>();
    g.pessoas.forEach((p) => [p.a, p.b].forEach((l) => { const c = l ? capacidadeDaLinha(ctx, l) : null; if (c) t.add(grupoDoNo[c.no]); }));
    return [...t];
  });
  const aplicar = (caps: Record<string, CapNo>, a: AlocacaoEscala | undefined, sinal: 1 | -1) => {
    const c = a ? capacidadeDaLinha(ctx, a) : null;
    if (c) caps[c.no][c.tipo][c.t] = Math.max(0, caps[c.no][c.tipo][c.t] + sinal * c.valor);
  };
  const percorrer = (ordem: number[]) => {
    const caps = copiarCaps(caps0);
    const atual = metricas0.map((m) => ({ ...m }));
    const delta: Metricas[] = lista.map(() => ({ ...zero }));
    const consumo: number[] = lista.map(() => 0);
    const evitado: number[] = lista.map(() => 0);
    ordem.forEach((k) => {
      const antes = somar(atual);
      lista[k].pessoas.forEach((p) => { aplicar(caps, p.a, -1); aplicar(caps, p.b, 1); });
      tocadosPor[k].forEach((gi) => (atual[gi] = metricasGrupo(caps, gi)));
      const depois = somar(atual);
      delta[k] = { final: depois.final - antes.final, wipFinal: depois.wipFinal - antes.wipFinal, legado: depois.legado - antes.legado, excesso: depois.excesso - antes.excesso };
      consumo[k] = Math.max(0, antes.legado - depois.legado);
      evitado[k] = Math.max(0, antes.excesso - depois.excesso);
    });
    return { delta, consumo, evitado };
  };
  // ordens: cronológica, inversa e ordens pseudo-aleatórias (LCG de semente fixa — determinístico)
  const N = lista.length;
  const cronologica = lista.map((_, k) => k);
  const ordens: number[][] = [cronologica, [...cronologica].reverse()];
  let semente = 20261027 + N;
  const prox = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
  for (let r = 0; r < PERMUTACOES_EXTRAS && N > 2; r++) {
    const o = [...cronologica];
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(prox() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
    ordens.push(o);
  }
  const caminhos = ordens.map(percorrer);
  const media = (f: (c: (typeof caminhos)[number], k: number) => number, k: number) => caminhos.reduce((s, c) => s + f(c, k), 0) / caminhos.length;

  const decisoes: DecisaoFluxo[] = lista.map((g, k) => {
    const ganho = r3(media((c, i) => c.delta[i].final, k));
    const consumido = r3(media((c, i) => c.consumo[i], k));
    const evitado = r3(media((c, i) => c.evitado[i], k));
    const dWip = r3(media((c, i) => c.delta[i].wipFinal, k));
    const acao = !g.de.maquinaId ? "ocupa posto antes vazio" : !g.para.maquinaId ? "deixa o posto" : "troca de posto";
    return {
      data: g.data, periodoId: g.periodoId, slot: g.slot, de: g.de, para: g.para, quantidade: g.pessoas.length, funcionarios: g.pessoas.map((p) => p.f),
      motivo: {
        ganhoProdutoFinal: ganho, reducaoFalta: ganho, wipConsumido: consumido, wipEvitado: evitado, wipFinalVariacao: dWip,
        texto: `${acao}; ${ganho >= 0 ? "ganho" : "custo"} de ${Math.round(Math.abs(ganho))} peça(s) final(is) (média de ${caminhos.length} ordens de aplicação)${ganho < 0 ? ", compensado pelas decisões complementares" : ""}${consumido > 0 ? `; consome ~${Math.round(consumido)} de WIP existente` : ""}${evitado > 0 ? `; evita ~${Math.round(evitado)} de WIP excedente` : ""}${dWip !== 0 ? `; WIP final ${dWip > 0 ? "+" : ""}${Math.round(dWip)}` : ""}`,
      },
    };
  });

  // ---- 3. reconciliação ----
  const somaGanhos = r3(decisoes.reduce((s, d) => s + d.motivo.ganhoProdutoFinal, 0));
  const finalReferencia = r3(avRef.totais.finalEntregueLo);
  const finalPlano = r3(avNovo.totais.finalEntregueLo);
  const diferenca = r3(finalPlano - finalReferencia);
  const residuo = r3(diferenca - somaGanhos);
  const reconciliacao: ReconciliacaoGanho = {
    referencia, finalReferencia, finalPlano, diferenca, somaGanhos, residuo,
    explicacaoResiduo: Math.abs(residuo) < 0.5
      ? "Sem resíduo relevante: as decisões explicam toda a diferença de produto final previsto."
      : "Resíduo = efeito do teto de demanda (rem de fluxo) aplicado pelo motor e/ou de quantidades diferentes em postos mantidos; não atribuído a nenhuma decisão.",
  };

  // ---- 4. resumo agregado por pool de origem → destino (cobre 100% das decisões) ----
  const resumo = new Map<string, ResumoDecisao>();
  decisoes.forEach((d) => {
    const k = `${d.de.produtoId}|${d.de.etapaId}>${d.para.produtoId}|${d.para.etapaId}`;
    const r = resumo.get(k) ?? { de: { produtoId: d.de.produtoId, etapaId: d.de.etapaId }, para: { produtoId: d.para.produtoId, etapaId: d.para.etapaId }, pessoasPeriodo: 0, slots: 0, ganhoProdutoFinal: 0, porSlot: [] };
    r.pessoasPeriodo += d.quantidade;
    r.ganhoProdutoFinal = r3(r.ganhoProdutoFinal + d.motivo.ganhoProdutoFinal);
    const ps = r.porSlot.find((x) => x.slot === d.slot);
    if (ps) {
      ps.pessoas += d.quantidade;
      ps.ganhoProdutoFinal = r3(ps.ganhoProdutoFinal + d.motivo.ganhoProdutoFinal);
    } else r.porSlot.push({ slot: d.slot, pessoas: d.quantidade, ganhoProdutoFinal: d.motivo.ganhoProdutoFinal });
    r.slots = r.porSlot.length;
    resumo.set(k, r);
  });
  const resumoLista = [...resumo.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, r]) => ({ ...r, porSlot: [...r.porSlot].sort((x, y) => x.slot - y.slot) }));
  return { decisoes, resumo: resumoLista, reconciliacao };
}
