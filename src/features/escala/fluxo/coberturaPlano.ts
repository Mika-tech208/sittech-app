// COBERTURA INTRAPERÍODO SOBRE UM PLANO — avaliador (diagnóstico) e laço de reparo. PURO e DESLIGADO: nada no motor chama isto por padrão.
//
// Para cada (slot, nó com etapa anterior) do plano, usa o MESMO simulador de fluxo (cenário pessimista "lo") para obter:
//   wipInicial        = estoque na entrada do nó no início do período (piso);
//   producaoUpstream  = o que a(s) etapa(s) anterior(es) entregam NESSE período segundo o plano (já limitada pelo próprio material dela);
//   consumoPlanejado  = capacidade dos postos do nó no período (linhas do plano), limitada pela demanda restante do nó;
// e aplica `coberturaPosto`. Postos que não se sustentam o período inteiro são `violacoes`.
//
// Nós SEM etapa anterior (1ª etapa do roteiro) não têm material modelado (o simulador os trata como insumo infinito): ficam em `semMaterialModelado`
// — isto é uma LACUNA do modelo atual, não uma aprovação (ver relatório).

import { gerarEscala } from "../gerarEscala";
import type { AlocacaoEscala, EntradaEscala } from "../types";
import { capsDoPlano, rodar, selecionarFuturas } from "./avaliar";
import type { CtxFluxo } from "./estado";
import { coberturaPosto, margemDaConfianca, maxPostosSustentaveis, type ConfiancaCobertura, type ResultadoCoberturaPosto } from "./coberturaIntraperiodo";

export interface OpcoesCoberturaPlano {
  /** rem explícito (por nó) com que o plano foi gerado (limita a demanda restante); o mesmo de `avaliarPlano` */
  limites?: Record<string, number>;
  /** margem por confiança do WIP (calibrada com dados; ausente = 0) */
  margemPorConfianca?: Partial<Record<ConfiancaCobertura, number>>;
  /** minutos até o upstream começar a entregar (default 0) */
  atrasoUpstreamMin?: number;
}

export interface CelulaCobertura extends ResultadoCoberturaPosto {
  slot: number;
  data: string;
  periodoId: string;
  no: string;
  chave: string; // pool representante do nó
  /** todos os pools do nó (nós FUNDIDOS do Conector legado têm 2+): o teto vale para cada um */
  chaves: string[];
  postos: number;
  capacidadePosto: number;
  wipInicial: number;
  producaoUpstream: number;
  consumoPlanejado: number;
  confianca: ConfiancaCobertura;
  margem: number;
  /** maior nº de postos que o material sustenta no período inteiro (0..postos) */
  postosSustentaveis: number;
  duracaoMin: number;
}

export interface CoberturaDoPlano {
  celulas: CelulaCobertura[];
  violacoes: CelulaCobertura[];
  /** postos (linhas) em nós de entrada: material não modelado */
  semMaterialModelado: number;
  /** peças de capacidade que o plano promete mas o material não sustenta (Σ consumo − peças viáveis nas violações) */
  pecasSemMaterial: number;
}

const PIOR: Record<ConfiancaCobertura, number> = { alta: 0, media: 1, baixa: 2 };

export function coberturaDoPlano(ctx: CtxFluxo, alocacoes: AlocacaoEscala[], op: OpcoesCoberturaPlano = {}): CoberturaDoPlano {
  const { grafo } = ctx;
  const futuras = selecionarFuturas(ctx, alocacoes);
  const caps = capsDoPlano(ctx, futuras);
  const T = ctx.entrada.slots.length;
  const celulas: CelulaCobertura[] = [];
  let semMaterialModelado = 0;
  // linhas (postos) por nó/slot — só previsto e adicional com posto
  const postosPor = new Map<string, number>();
  futuras.forEach((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId) return;
    const t = ctx.idxSlot.get(`${a.data}|${a.periodoId}`);
    const no = grafo.noDoPool[`${a.produtoId}|${a.etapaId}`];
    if (t === undefined || !no) return;
    postosPor.set(`${t}|${no}`, (postosPor.get(`${t}|${no}`) ?? 0) + 1);
  });
  const confiancaDe = (e: string): ConfiancaCobertura => {
    const ar = grafo.arestas[e];
    const par = ctx.pares.find((p) => p.produtoId === ar.produtoId && p.etapaOrigemId === ar.etapaOrigemId && p.etapaSeguinteId === ar.etapaSeguinteId);
    return par?.confianca ?? "baixa";
  };

  grafo.grupos.forEach((g, gi) => {
    const r = rodar(ctx, gi, caps, "lo", op.limites, true);
    g.nos.forEach((n) => {
      const ins = grafo.entradas[n];
      const no = grafo.nos[n];
      const restanteIni = op.limites?.[n] ?? Math.max(0, no.quantidade - (ctx.iniAPartirDe.lo.B0[n] ?? 0));
      let acumulado = 0;
      for (let t = ctx.aPartirDe; t < T; t++) {
        const i = t - ctx.aPartirDe;
        const base = caps[n].base[t];
        const adic = caps[n].adic[t];
        const x = r.x[n][i] ?? 0;
        const restante = Math.max(0, restanteIni - acumulado);
        acumulado += x;
        const postos = postosPor.get(`${t}|${n}`) ?? 0;
        if (postos === 0 || base + adic <= 0) continue;
        if (ins.length === 0) {
          semMaterialModelado += postos;
          continue;
        }
        const slot = ctx.entrada.slots[t];
        const wip = ins.reduce((s, e) => s + (i === 0 ? ctx.iniAPartirDe.lo.W0[e] ?? 0 : r.traj[e][i - 1] ?? 0), 0);
        const up = ins.reduce((s, e) => s + (r.x[grafo.arestas[e].origem]?.[i] ?? 0), 0);
        const consumo = Math.min(base, restante) + adic;
        const conf = ins.map(confiancaDe).reduce<ConfiancaCobertura>((w, c) => (PIOR[c] > PIOR[w] ? c : w), "alta");
        const margem = margemDaConfianca(conf, op.margemPorConfianca);
        const dur = slot.fimMin - slot.inicioMin;
        const base0 = { duracaoMin: dur, wipInicial: wip, producaoUpstream: up, atrasoUpstreamMin: op.atrasoUpstreamMin, margem };
        const res = coberturaPosto({ ...base0, consumoPlanejado: consumo });
        const capPosto = (base + adic) / postos;
        const sust = maxPostosSustentaveis(base0, capPosto, postos);
        celulas.push({
          ...res, slot: t, data: slot.data, periodoId: slot.periodoId, no: n, chave: no.membros[0] ?? n, chaves: no.membros.length > 0 ? [...no.membros] : [n], postos, capacidadePosto: capPosto, wipInicial: wip,
          producaoUpstream: up, consumoPlanejado: consumo, confianca: conf, margem, postosSustentaveis: sust, duracaoMin: dur,
        });
      }
    });
  });
  celulas.sort((a, b) => a.slot - b.slot || (a.no < b.no ? -1 : 1));
  const violacoes = celulas.filter((c) => !c.sustentavel);
  return { celulas, violacoes, semMaterialModelado, pecasSemMaterial: violacoes.reduce((s, c) => s + (c.consumoPlanejado - c.pecasViaveis), 0) };
}

/** Teto de postos por (slot, pool) que respeita a cobertura — formato de `EntradaEscala.coberturaMax`. Só entram as violações. */
export function coberturaMaxDe(violacoes: CelulaCobertura[], base: Record<string, Record<string, number>> = {}): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = JSON.parse(JSON.stringify(base));
  violacoes.forEach((v) => {
    const s = (out[String(v.slot)] ??= {});
    v.chaves.forEach((k) => (s[k] = Math.min(s[k] ?? Number.POSITIVE_INFINITY, v.postosSustentaveis)));
  });
  return out;
}

export interface ResultadoReparo {
  alocacoes: AlocacaoEscala[];
  coberturaMax: Record<string, Record<string, number>>;
  iteracoes: number;
  violacoesIniciais: number;
  violacoesFinais: number;
  /** Σ de postos removidos pelo teto (nas violações da 1ª passada) */
  postosRetirados: number;
}

/**
 * Laço de reparo: gera o plano, mede a cobertura, impõe tetos (`coberturaMax`) nos (slot, pool) que não se sustentam e regera até não haver violação
 * (os tetos só diminuem ⇒ termina). As pessoas liberadas vão para outros postos válidos do motor ou ficam sem posto (nunca fracionadas).
 * `entradaPlano` é a entrada com que o plano foi gerado (inclui `remPorPool`/`ordemPostos` do fluxo, se houver).
 */
export function repararCobertura(ctx: CtxFluxo, entradaPlano: EntradaEscala, op: OpcoesCoberturaPlano = {}, maxIter = 8): ResultadoReparo {
  let cobMax: Record<string, Record<string, number>> = {};
  let res = gerarEscala(entradaPlano);
  let cov = coberturaDoPlano(ctx, res.alocacoes, { ...op, limites: op.limites });
  const iniciais = cov.violacoes.length;
  const retiradosIni = cov.violacoes.reduce((s, v) => s + (v.postos - v.postosSustentaveis), 0);
  let it = 0;
  while (cov.violacoes.length > 0 && it < maxIter) {
    cobMax = coberturaMaxDe(cov.violacoes, cobMax);
    res = gerarEscala({ ...entradaPlano, coberturaMax: cobMax });
    cov = coberturaDoPlano(ctx, res.alocacoes, op);
    it++;
  }
  return { alocacoes: res.alocacoes, coberturaMax: cobMax, iteracoes: it, violacoesIniciais: iniciais, violacoesFinais: cov.violacoes.length, postosRetirados: retiradosIni };
}
