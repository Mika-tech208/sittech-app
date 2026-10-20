// RECOMENDAÇÃO DE MÁQUINA POR CENÁRIO COMPLETO.
//
// Regra do produto: nenhuma máquina é avaliada isoladamente. Há recursos compartilhados entre produtos, então toda
// recomendação executa DE NOVO o cenário completo (o mesmo motor, a semana inteira, todos os produtos) com a máquina
// selecionada na etapa, e só aparece se melhorar GLOBALMENTE — atingibilidade do previsto, cobertura da equipe, ou ambos —
// sem piorar nenhum produto nem a cobertura. O motor nunca é alterado: isto só compara cenários.
//
// Cenário avaliado = previsto + (quando informado) a melhor carga adicional possível para esse cenário (`comAdicional`),
// porque uma máquina nova pode render cobertura exatamente por destravar o adicional.

import { analisarAtingibilidade, type StatusAtingibilidade } from "./atingibilidade";
import { analisarCobertura, calcularCobertura, comMaquinasAdicionadas } from "./cobertura";
import { EPS } from "./folga";
import { gerarEscala } from "./gerarEscala";
import { maquinaDisponivelNoSlot } from "./disponibilidade";
import { chavePool, type EntradaEscala, type PoolEscala } from "./types";

export interface AvaliacaoCenario {
  // PREVISTO apenas
  coberturaPrevisto: number;
  minutosSemPostoPrevisto: number;
  statusPrevisto: StatusAtingibilidade;
  faltaTotal: number; // peças de produto acabado em falta (Σ produtos)
  valorEmRisco: number;
  faltaPorProduto: Record<string, number>;
  statusPorProduto: Record<string, StatusAtingibilidade>;
  // PREVISTO + melhor adicional do cenário (só quando há avaliador de adicional)
  comAdicional: { cobertura: number; minutosSemPosto: number } | null;
}

export type AvaliadorAdicional = (entrada: EntradaEscala) => { cobertura: number; minutosSemPosto: number };

export interface PassoRecomendacao {
  maquinaId: string;
  alternativas: string[]; // máquinas que dão exatamente o mesmo resultado nesta etapa
  poolsAfetados: { produtoId: string; etapaId: string }[];
  depois: AvaliacaoCenario; // cenário completo ACUMULADO até este passo
}

export interface RecomendacaoGlobal {
  antes: AvaliacaoCenario;
  passos: PassoRecomendacao[];
  depois: AvaliacaoCenario;
  produtosMelhorados: { produtoId: string; de: StatusAtingibilidade; para: StatusAtingibilidade; faltaDe: number; faltaPara: number }[];
  cenariosSimulados: number; // quantos cenários completos foram executados
}

export function avaliarCenario(entrada: EntradaEscala, margem: number, avaliarAdicional?: AvaliadorAdicional): AvaliacaoCenario {
  const base = { ...entrada, pools: entrada.pools.map((p) => ({ ...p, adicionalMax: 0 })) };
  const r = gerarEscala(base);
  const cob = calcularCobertura(base, r);
  const at = analisarAtingibilidade(base, r, { margem });
  return {
    coberturaPrevisto: cob.percentual,
    minutosSemPostoPrevisto: cob.minutosSemPosto,
    statusPrevisto: at.status,
    faltaTotal: at.faltaTotalPlano,
    valorEmRisco: at.valorEmRisco,
    faltaPorProduto: Object.fromEntries(at.produtos.map((p) => [p.produtoId, Math.max(p.faltaPlano, p.faltaMinima)])),
    statusPorProduto: Object.fromEntries(at.produtos.map((p) => [p.produtoId, p.status])),
    comAdicional: avaliarAdicional ? avaliarAdicional(base) : null,
  };
}

const minutosEfetivos = (a: AvaliacaoCenario) => (a.comAdicional ? a.comAdicional.minutosSemPosto : a.minutosSemPostoPrevisto);
const ORDEM: Record<StatusAtingibilidade, number> = { atingivel: 0, em_risco: 1, impossivel: 2 };

// Melhora GLOBAL e sem regressão: nenhum produto com mais falta ou status pior, cobertura não menor e ao menos um ganho.
export function melhoraGlobal(antes: AvaliacaoCenario, depois: AvaliacaoCenario): boolean {
  const produtos = new Set([...Object.keys(antes.faltaPorProduto), ...Object.keys(depois.faltaPorProduto)]);
  for (const p of produtos) {
    if ((depois.faltaPorProduto[p] ?? 0) > (antes.faltaPorProduto[p] ?? 0) + EPS) return false;
    if (ORDEM[depois.statusPorProduto[p] ?? "atingivel"] > ORDEM[antes.statusPorProduto[p] ?? "atingivel"]) return false;
  }
  if (minutosEfetivos(depois) > minutosEfetivos(antes) + 1e-6) return false;
  if (depois.minutosSemPostoPrevisto > antes.minutosSemPostoPrevisto + 1e-6 && depois.faltaTotal >= antes.faltaTotal - EPS) return false;
  const ganhoFalta = antes.faltaTotal - depois.faltaTotal > EPS;
  const ganhoCobertura = minutosEfetivos(antes) - minutosEfetivos(depois) > 1e-6;
  const ganhoStatus = [...produtos].some((p) => ORDEM[depois.statusPorProduto[p] ?? "atingivel"] < ORDEM[antes.statusPorProduto[p] ?? "atingivel"]);
  return ganhoFalta || ganhoCobertura || ganhoStatus;
}

interface Par {
  poolKey: string;
  maquinaId: string;
}

function candidatosDe(entrada: EntradaEscala, permitidos: Set<string> | undefined, prioritarios: Set<string>): Par[] {
  const slots = entrada.slots.slice(entrada.aPartirDe);
  const pools: PoolEscala[] = [...entrada.pools, ...(entrada.poolsSemMaquina ?? [])];
  const vistos = new Set<string>();
  const saida: (Par & { prio: number })[] = [];
  pools.forEach((p) => {
    if (permitidos && !permitidos.has(p.produtoId)) return;
    (p.maquinasCompativeisIds ?? []).forEach((m) => {
      if (p.maquinasIds.includes(m)) return;
      if (!slots.some((s) => maquinaDisponivelNoSlot(entrada, m, s))) return;
      const k = `${chavePool(p.produtoId, p.etapaId)}#${m}`;
      if (vistos.has(k)) return;
      vistos.add(k);
      saida.push({ poolKey: chavePool(p.produtoId, p.etapaId), maquinaId: m, prio: prioritarios.has(chavePool(p.produtoId, p.etapaId)) ? 0 : 1 });
    });
  });
  return saida.sort((a, b) => a.prio - b.prio || (a.poolKey + a.maquinaId < b.poolKey + b.maquinaId ? -1 : 1));
}

export function recomendarMaquinas(
  entrada: EntradaEscala,
  opcoes: { produtosPermitidos?: Set<string>; margem?: number; maxPassos?: number; maxCandidatos?: number; maxAvaliacoesCaras?: number; avaliarAdicional?: AvaliadorAdicional } = {}
): RecomendacaoGlobal | null {
  const margem = opcoes.margem ?? 0.1;
  const maxPassos = opcoes.maxPassos ?? 2;
  const maxCandidatos = opcoes.maxCandidatos ?? 20;
  const maxCaras = opcoes.maxAvaliacoesCaras ?? 6;
  let simulados = 0;

  const antes = avaliarCenario(entrada, margem, opcoes.avaliarAdicional);
  simulados++;

  // pools que merecem máquina: produto com falta/risco, ou onde o diagnóstico de cobertura achou ocupação possível
  const base = { ...entrada, pools: entrada.pools.map((p) => ({ ...p, adicionalMax: 0 })) };
  const rBase = gerarEscala(base);
  const at = analisarAtingibilidade(base, rBase, { margem });
  const prioritarios = new Set<string>();
  at.produtos.filter((p) => p.status !== "atingivel").forEach((p) => p.etapas.filter((e) => e.status !== "atingivel").forEach((e) => prioritarios.add(chavePool(e.produtoId, e.etapaId))));
  const cobCand = analisarCobertura(base, rBase, opcoes.produtosPermitidos).candidatos;
  cobCand.forEach((c) => c.pools.forEach((k) => prioritarios.add(k)));

  let atual = entrada;
  let avaliacaoAtual = antes;
  const passos: PassoRecomendacao[] = [];
  const escolhidos = new Map<string, Set<string>>();

  for (let passo = 0; passo < maxPassos; passo++) {
    const pares = candidatosDe(atual, opcoes.produtosPermitidos, prioritarios).slice(0, maxCandidatos);
    if (pares.length === 0) break;
    // 1) triagem barata: cenário completo SEM avaliar adicional
    const triados = pares.map((par) => {
      const nova = comMaquinasAdicionadas(atual, new Map([[par.poolKey, new Set([par.maquinaId])]]));
      const ava = avaliarCenario(nova, margem);
      simulados++;
      return { par, nova, ava };
    });
    // 2) avaliação completa (com o adicional do cenário) dos que mais prometem — e dos que só destravariam adicional
    const comGanhoBarato = triados.filter((t) => t.ava.faltaTotal < avaliacaoAtual.faltaTotal - EPS || t.ava.minutosSemPostoPrevisto < avaliacaoAtual.minutosSemPostoPrevisto - 1e-6);
    const escolhaCara = opcoes.avaliarAdicional
      ? [...comGanhoBarato.sort((a, b) => a.ava.faltaTotal - b.ava.faltaTotal || a.ava.minutosSemPostoPrevisto - b.ava.minutosSemPostoPrevisto), ...triados.filter((t) => !comGanhoBarato.includes(t))].slice(0, maxCaras)
      : comGanhoBarato;
    const avaliados = escolhaCara.map((t) => {
      const ava = opcoes.avaliarAdicional ? avaliarCenario(t.nova, margem, opcoes.avaliarAdicional) : t.ava;
      if (opcoes.avaliarAdicional) simulados++;
      return { ...t, ava };
    });
    const bons = avaliados.filter((t) => melhoraGlobal(avaliacaoAtual, t.ava));
    if (bons.length === 0) break;
    bons.sort(
      (a, b) =>
        a.ava.valorEmRisco - b.ava.valorEmRisco ||
        a.ava.faltaTotal - b.ava.faltaTotal ||
        minutosEfetivos(a.ava) - minutosEfetivos(b.ava) ||
        (a.par.maquinaId < b.par.maquinaId ? -1 : 1)
    );
    const melhor = bons[0];
    const alternativas = bons
      .filter((t) => t !== melhor && t.par.poolKey === melhor.par.poolKey && Math.abs(t.ava.faltaTotal - melhor.ava.faltaTotal) < EPS && Math.abs(minutosEfetivos(t.ava) - minutosEfetivos(melhor.ava)) < 1e-6)
      .map((t) => t.par.maquinaId)
      .sort();
    atual = melhor.nova;
    avaliacaoAtual = melhor.ava;
    if (!escolhidos.has(melhor.par.poolKey)) escolhidos.set(melhor.par.poolKey, new Set());
    escolhidos.get(melhor.par.poolKey)!.add(melhor.par.maquinaId);
    const [produtoId, etapaId] = melhor.par.poolKey.split("|");
    passos.push({ maquinaId: melhor.par.maquinaId, alternativas, poolsAfetados: [{ produtoId, etapaId }], depois: melhor.ava });
  }
  if (passos.length === 0) return null;

  const depois = avaliacaoAtual;
  const produtosMelhorados = Object.keys({ ...antes.faltaPorProduto, ...depois.faltaPorProduto })
    .filter((p) => (depois.faltaPorProduto[p] ?? 0) < (antes.faltaPorProduto[p] ?? 0) - EPS || ORDEM[depois.statusPorProduto[p] ?? "atingivel"] < ORDEM[antes.statusPorProduto[p] ?? "atingivel"])
    .sort()
    .map((p) => ({ produtoId: p, de: antes.statusPorProduto[p] ?? "atingivel", para: depois.statusPorProduto[p] ?? "atingivel", faltaDe: antes.faltaPorProduto[p] ?? 0, faltaPara: depois.faltaPorProduto[p] ?? 0 }));
  return { antes, passos, depois, produtosMelhorados, cenariosSimulados: simulados };
}
