// ATINGIBILIDADE DE EXECUÇÃO e RECUPERAÇÃO (Fase 4c) — núcleo PURO, modo sombra.
//
// Situações (partição, avaliada em cada corte c):
//   OK  — o plano oficial futuro ainda fecha o restante real (falta ≤ tolerância);
//   A   — PROGRAMAÇÃO IMPOSSÍVEL NA ORIGEM: já não cabia quando foi programada (atingibilidade de planejamento, Fase 2);
//   B→C — cabia na origem, o realizado conhecido a deteriorou (oficial deixa de fechar) e a MELHOR escala válida a partir do primeiro
//         período alterável (comprometido já reparado) ainda fecha => EM RISCO, RECUPERÁVEL;
//   B→D — idem, mas nem a melhor escala futura válida (comprometido, revezamento, máquinas, equipe, gargalos) fecha => NÃO RECUPERÁVEL.
// "B" é a entrada em risco; "C"/"D" é o desfecho da recuperação. A recuperação só mexe do primeiro período alterável em diante.
//
// Recuperação (ordem no alterável): 1) previsto restante; 2) gargalo/atraso; 3) acabado adicional; 4) WIP; (5) antecipação = Fase 5.
// Quando o previsto precisa de capacidade, o motor já tira primeiro o adicional/WIP futuro (camada 2 só usa o que a 1 deixa).
// Nunca mexe no comprometido (já reparado) só para ganhar produção.

import { CADEIA_COMUM, cadeiaDe } from "@/features/rotas/adaptador";
import { chavePool, MOTIVO_REVEZAMENTO, type AlocacaoEscala, type PoolEscala } from "./types";

export type Situacao = "OK" | "A" | "B→C" | "B→D";

// Σ peças por pool × f (linhas com posto)
export function projetarProducao(rows: AlocacaoEscala[], fator: Record<string, number> | null): Record<string, number> {
  const r: Record<string, number> = {};
  rows.forEach((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId) return;
    const k = chavePool(a.produtoId, a.etapaId);
    r[k] = (r[k] ?? 0) + (a.pecas ?? 0) * (fator ? fator[k] ?? 1 : 1);
  });
  return r;
}
export const somarProducao = (...ps: Record<string, number>[]): Record<string, number> => {
  const r: Record<string, number> = {};
  ps.forEach((p) => Object.entries(p).forEach(([k, v]) => (r[k] = (r[k] ?? 0) + v)));
  return r;
};

export interface FaltaProjetada {
  porPool: Record<string, number>; // restante − min(restante, projetado)
  porProduto: Record<string, number>; // pior elo da cadeia
  total: number; // Σ falta por produto acabado
  capacidade: number; // Σ min(projetado, restante)
  gargalo: { poolKey: string; falta: number } | null;
}
export function faltaProjetada(pools: PoolEscala[], restante: Record<string, number>, projetado: Record<string, number>): FaltaProjetada {
  const porPool: Record<string, number> = {};
  let capacidade = 0;
  pools.forEach((p) => {
    const k = chavePool(p.produtoId, p.etapaId);
    const rem = restante[k] ?? 0;
    const prod = Math.min(rem, projetado[k] ?? 0);
    porPool[k] = rem - prod;
    capacidade += prod;
  });
  const porProduto: Record<string, number> = {};
  pools.forEach((p) => { porProduto[p.produtoId] = Math.max(porProduto[p.produtoId] ?? 0, porPool[chavePool(p.produtoId, p.etapaId)]); });
  const total = Object.values(porProduto).reduce((s, v) => s + v, 0);
  const ordenado = Object.entries(porPool).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
  return { porPool, porProduto, total, capacidade, gargalo: ordenado.length && ordenado[0][1] > 0 ? { poolKey: ordenado[0][0], falta: ordenado[0][1] } : null };
}

// restante do ACABADO (última etapa de cada produto) — base da tolerância
export function restanteAcabado(pools: PoolEscala[], restante: Record<string, number>): number {
  const ultima = new Map<string, PoolEscala>();
  pools.forEach((p) => {
    const cadeia = cadeiaDe(p.produtoId);
    if (cadeia !== null && cadeia !== CADEIA_COMUM) return;   // produto de ROTAS: só a cadeia do fluxo comum (Etiquetar → Embalar) tem o acabado; a última etapa de CONV/AUTO é semiacabado
    const u = ultima.get(p.produtoId); if (!u || p.ordemEtapa > u.ordemEtapa) ultima.set(p.produtoId, p);
  });
  return [...ultima.values()].reduce((s, p) => s + (restante[chavePool(p.produtoId, p.etapaId)] ?? 0), 0);
}
export const toleranciaFalta = (restanteAcabadoTotal: number, relativa = 0.01) => Math.max(1, relativa * restanteAcabadoTotal);

export function classificarSituacao(p: { impossivelNaOrigem: boolean; faltaOficial: number; faltaSombra: number; tolerancia: number }): Situacao {
  if (p.impossivelNaOrigem) return "A";
  if (p.faltaOficial <= p.tolerancia) return "OK";
  return p.faltaSombra <= p.tolerancia ? "B→C" : "B→D";
}

export interface ResumoRecuperacao {
  faltaAntes: number; // oficial
  faltaDepois: number; // sombra
  recuperado: number; // quanto a replanificação conseguiu recuperar
  adicionalOficial: number;
  adicionalSombra: number;
  adicionalRetirado: number; // capacidade de adicional/WIP cedida ao previsto
  wipOficial: number;
  wipSombra: number;
}
export function resumirRecuperacao(faltaOficial: number, faltaSombra: number, oficialFuturo: AlocacaoEscala[], sombraFuturo: AlocacaoEscala[]): ResumoRecuperacao {
  const adic = (rows: AlocacaoEscala[]) => rows.reduce((s, a) => s + (a.maquinaId ? a.pecasAdicional ?? 0 : 0), 0);
  const wip = (rows: AlocacaoEscala[]) => rows.reduce((s, a) => s + (a.maquinaId && a.tipoAdicional === "intermediario" ? a.pecasAdicional ?? 0 : 0), 0);
  return {
    faltaAntes: faltaOficial, faltaDepois: faltaSombra, recuperado: Math.max(0, faltaOficial - faltaSombra),
    adicionalOficial: adic(oficialFuturo), adicionalSombra: adic(sombraFuturo), adicionalRetirado: Math.max(0, adic(oficialFuturo) - adic(sombraFuturo)),
    wipOficial: wip(oficialFuturo), wipSombra: wip(sombraFuturo),
  };
}

export const postosVaziosPorRevezamento = (rows: AlocacaoEscala[]) => rows.filter((a) => !a.maquinaId && a.motivoSemPosto === MOTIVO_REVEZAMENTO).length;
export const coberturaFutura = (rows: AlocacaoEscala[]) => (rows.length ? (100 * rows.filter((a) => a.maquinaId).length) / rows.length : 100);

// ---------- "Se a sombra pudesse escrever na Escala agora": o que preencheria / esvaziaria no futuro ALTERÁVEL (especificação do preenchimento) ----------
export interface ResumoPreenchimento {
  vaziosOficial: number; // pessoa-períodos sem posto no futuro alterável da Escala oficial
  vaziosSombra: number;
  wipOficialPecas: number; // adicional/WIP planejado pela Escala oficial no futuro alterável
  wipSombraPecas: number;
  wipOficialPostos: number;
  wipSombraPostos: number;
  wipMantido: number; // postos de WIP oficiais que a sombra também teria (mesmo período, máquina, produto e etapa)
  wipRetirado: number; // postos de WIP oficiais que a sombra NÃO teria
  wipRetiradoParaPrevisto: number; // ... porque a sombra usa aquela máquina/período para o PREVISTO (recuperação)
  wipRetiradoOutro: number;
  novosPostosPrevisto: number; // postos de previsto que a sombra teria e o oficial não
  novosPostosWip: number; // postos de WIP que a sombra teria e o oficial não
  preencheria: number; // pessoa-períodos ociosos no oficial que a sombra ocuparia
  esvaziaria: number; // pessoa-períodos ocupados no oficial que a sombra deixaria ociosos
  alteracoes: number; // pessoa-períodos cuja máquina/posto muda (oficial → sombra)
  alteracoesSoPreenchimento: number; // subconjunto: oficial ocioso→ocupado ou WIP→qualquer coisa (o que um preenchimento restrito mexeria)
}

export function compararPreenchimento(oficialAlteravel: AlocacaoEscala[], sombraAlteravel: AlocacaoEscala[]): ResumoPreenchimento {
  const ehWip = (a: AlocacaoEscala) => !!a.maquinaId && (a.pecasAdicional ?? 0) > 0;
  const posto = (a: AlocacaoEscala) => `${a.data}|${a.periodoId}|${a.maquinaId}|${a.produtoId}|${a.etapaId}`;
  const maqPeriodo = (a: AlocacaoEscala) => `${a.data}|${a.periodoId}|${a.maquinaId}`;
  const wipO = new Set(oficialAlteravel.filter(ehWip).map(posto));
  const wipS = new Set(sombraAlteravel.filter(ehWip).map(posto));
  const prevS = new Set(sombraAlteravel.filter((a) => a.maquinaId && a.pecas > 0).map(maqPeriodo));
  const prevO = new Set(oficialAlteravel.filter((a) => a.maquinaId && a.pecas > 0).map(posto));
  const prevSPostos = new Set(sombraAlteravel.filter((a) => a.maquinaId && a.pecas > 0).map(posto));
  const retirados = [...wipO].filter((k) => !wipS.has(k));
  const porPessoa = new Map(oficialAlteravel.map((a) => [`${a.data}|${a.periodoId}|${a.funcionarioId}`, a]));
  let preencheria = 0, esvaziaria = 0, alteracoes = 0, soPreench = 0;
  sombraAlteravel.forEach((s) => {
    const o = porPessoa.get(`${s.data}|${s.periodoId}|${s.funcionarioId}`);
    if (!o) return;
    const mudou = (o.maquinaId ?? "") !== (s.maquinaId ?? "") || (o.maquinaId && (o.produtoId !== s.produtoId || o.etapaId !== s.etapaId));
    if (!mudou) return;
    alteracoes++;
    if (!o.maquinaId && s.maquinaId) { preencheria++; soPreench++; } else if (o.maquinaId && !s.maquinaId) { esvaziaria++; if (ehWip(o)) soPreench++; } else if (ehWip(o)) soPreench++;
  });
  return {
    vaziosOficial: oficialAlteravel.filter((a) => !a.maquinaId).length,
    vaziosSombra: sombraAlteravel.filter((a) => !a.maquinaId).length,
    wipOficialPecas: oficialAlteravel.filter(ehWip).reduce((s, a) => s + (a.pecasAdicional ?? 0), 0),
    wipSombraPecas: sombraAlteravel.filter(ehWip).reduce((s, a) => s + (a.pecasAdicional ?? 0), 0),
    wipOficialPostos: wipO.size, wipSombraPostos: wipS.size,
    wipMantido: [...wipO].filter((k) => wipS.has(k)).length,
    wipRetirado: retirados.length,
    wipRetiradoParaPrevisto: retirados.filter((k) => { const [d, p, m] = k.split("|"); return prevS.has(`${d}|${p}|${m}`); }).length,
    wipRetiradoOutro: retirados.filter((k) => { const [d, p, m] = k.split("|"); return !prevS.has(`${d}|${p}|${m}`); }).length,
    novosPostosPrevisto: [...prevSPostos].filter((k) => !prevO.has(k)).length,
    novosPostosWip: [...wipS].filter((k) => !wipO.has(k)).length,
    preencheria, esvaziaria, alteracoes, alteracoesSoPreenchimento: soPreench,
  };
}
