// ESTABILIDADE COMO DESEMPATE (replanejamento restrito) — núcleo PURO.
//
// O replanejamento decide QUAIS postos funcionam em cada período; QUEM ocupa cada posto é, no mais das vezes, indiferente para o resultado produtivo.
// Para a Escala não "dançar" sem benefício, os postos da proposta são re-atribuídos às pessoas de modo a manter ao máximo a alocação vigente:
// por período, atribuição de custo mínimo (húngaro) em que cada pessoa que continua no MESMO posto custa 0 e qualquer outra custa 1, respeitando o
// revezamento duro (par proibido = mesma operação do período anterior da mesma pessoa, já com as escolhas feitas) e as trocas manuais (fixas).
// O resultado produtivo (postos, máquinas, produtos, peças) NÃO muda — só quem ocupa. Sem solução em algum período => devolve a proposta original.

import { atribuicaoMinima } from "./matching";
import { chaveBloco, MemoriaBloco, registrarPassadoDoBloco, type EquivalenciaOperacoes, type ExposicaoExecutada } from "./exposicaoBloco";
import type { AlocacaoEscala, SlotEscala } from "./types";

const PROIBIDO = 1_000_000;
const CUSTO_TROCA = 1;
const chavePosto = (a: AlocacaoEscala) => (a.maquinaId ? `${a.maquinaId}|${a.produtoId}|${a.etapaId}` : "ocioso");

export interface ResultadoEstabilidade { linhas: AlocacaoEscala[]; estabilizou: boolean; periodosAjustados: number }

// `proposta`: linhas da região (já com origem manual marcada). `oficial`: Escala vigente na região. `antes`: tudo que vem antes da região (executado + comprometido).
/** Regras de revezamento da re-atribuição. Ausente/escopo consecutivo = a regra anterior (mesma operação do período imediatamente anterior). Escopo "bloco" = a pessoa
 *  não repete a operação (nem equivalente) dentro da manhã/tarde: memória do bloco = `antes` + períodos já estabilizados + evidência real. */
export interface RegrasRevezamento { escopo?: "consecutivo" | "bloco"; equivalencias?: EquivalenciaOperacoes; exposicaoExecutada?: ExposicaoExecutada[] }

export function estabilizarPessoas(proposta: AlocacaoEscala[], oficial: AlocacaoEscala[], antes: AlocacaoEscala[], slots: SlotEscala[], regras: RegrasRevezamento = {}): ResultadoEstabilidade {
  const porBloco = regras.escopo === "bloco";
  const idx = (a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? -1;
  const slotsRegiao = [...new Set(proposta.map(idx))].sort((x, y) => x - y);
  const opAnterior = new Map<string, string | null>(); // pessoa -> operação no período imediatamente anterior (mesmo dia)
  const registrar = (rows: AlocacaoEscala[]) => { opAnterior.clear(); rows.forEach((a) => opAnterior.set(a.funcionarioId, a.maquinaId ? a.operacaoId : null)); };
  const saida: AlocacaoEscala[] = [];
  let ajustados = 0;
  for (const i of slotsRegiao) {
    const slot = slots[i];
    const rows = proposta.filter((a) => idx(a) === i);
    // período anterior da pessoa: linhas finais do slot i-1 (da região, já estabilizadas, ou de `antes`)
    const daRegiao = saida.filter((a) => idx(a) === i - 1);
    registrar(i > 0 && !slot.primeiroDoDia ? (daRegiao.length > 0 ? daRegiao : antes.filter((a) => idx(a) === i - 1)) : []);
    const memBloco = porBloco ? new MemoriaBloco(regras.equivalencias) : null;
    if (memBloco) registrarPassadoDoBloco(memBloco, slots, i, [...antes, ...saida], regras.exposicaoExecutada);
    const pessoas = rows.map((r) => r.funcionarioId);
    const oficiais = new Map(oficial.filter((a) => idx(a) === i).map((a) => [a.funcionarioId, a]));
    const n = rows.length;
    const custo: number[][] = pessoas.map((p) => rows.map((tok) => {
      if (tok.origem === "manual") return tok.funcionarioId === p ? 0 : PROIBIDO; // decisão humana: não troca de pessoa
      if (tok.maquinaId && tok.operacaoId && (memBloco ? memBloco.proibido(p, tok.operacaoId) : opAnterior.get(p) === tok.operacaoId)) return PROIBIDO;
      const of = oficiais.get(p);
      return of && chavePosto(of) === chavePosto(tok) ? 0 : CUSTO_TROCA;
    }));
    const sol = n > 0 ? atribuicaoMinima(custo) : [];
    if (sol.some((j, pi) => custo[pi][j] >= PROIBIDO)) return { linhas: proposta, estabilizou: false, periodosAjustados: 0 }; // sem solução estável: mantém a proposta
    const novo = rows.map((tok, j) => ({ ...tok, funcionarioId: pessoas[sol.indexOf(j)] }));
    if (novo.some((r, k) => r.funcionarioId !== rows[k].funcionarioId)) ajustados++;
    saida.push(...novo);
  }
  const ordenada = saida.sort((a, b) => idx(a) - idx(b) || (a.funcionarioId < b.funcionarioId ? -1 : 1));
  return { linhas: ordenada, estabilizou: ajustados > 0, periodosAjustados: ajustados };
}

// Mudança produtiva real × troca equivalente de pessoa (mesmo conjunto de postos no período)
export function classificarMudancas(oficial: AlocacaoEscala[], novo: AlocacaoEscala[], slots: SlotEscala[], linhasAlteradas: number): { produtivas: number; trocasEquivalentes: number } {
  const idx = (a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? -1;
  const token = (a: AlocacaoEscala) => `${chavePosto(a)}|${Math.round(a.pecas)}|${Math.round(a.pecasAdicional ?? 0)}`;
  const por = (rows: AlocacaoEscala[]) => { const m = new Map<number, Map<string, number>>(); rows.filter((a) => a.maquinaId).forEach((a) => { const i = idx(a); if (!m.has(i)) m.set(i, new Map()); const t = token(a); m.get(i)!.set(t, (m.get(i)!.get(t) ?? 0) + 1); }); return m; };
  const A = por(oficial), B = por(novo);
  let adicionados = 0, removidos = 0;
  new Set([...A.keys(), ...B.keys()]).forEach((i) => {
    const a = A.get(i) ?? new Map<string, number>(), b = B.get(i) ?? new Map<string, number>();
    new Set([...a.keys(), ...b.keys()]).forEach((t) => { const d = (b.get(t) ?? 0) - (a.get(t) ?? 0); if (d > 0) adicionados += d; else removidos -= d; });
  });
  const produtivas = Math.min(linhasAlteradas, Math.max(adicionados, removidos));
  return { produtivas, trocasEquivalentes: linhasAlteradas - produtivas };
}

// ---------- REATRIBUIÇÃO DE PESSOAS NO BLOCO (revezamento por bloco) ----------
// Mantém EXATAMENTE os postos (máquina/produto/etapa/peças) das `linhas` de cada período e só decide QUEM ocupa cada um, de modo que ninguém repita a operação (nem
// equivalente) dentro da manhã/tarde. Os postos e a falta final não mudam — só as pessoas. Busca por bloco: atribuição de custo mínimo período a período (pessoa que mantém o
// posto original custa 0, outra custa 1), com checagem de viabilidade dos períodos seguintes do bloco (lookahead) e reinícios determinísticos (PRNG semeado) para
// desempatar. Sem solução em algum bloco ⇒ null (o chamador descarta o candidato). Determinístico.
function prng(semente: number): () => number {
  let a = (semente + 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function reatribuirPessoasBloco(linhas: AlocacaoEscala[], antes: AlocacaoEscala[], slots: SlotEscala[], regras: RegrasRevezamento, tentativas = 400): ResultadoEstabilidade | null {
  const idx = (a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? -1;
  const porSlot = new Map<number, AlocacaoEscala[]>();
  linhas.forEach((a) => porSlot.set(idx(a), [...(porSlot.get(idx(a)) ?? []), a]));
  const ordem = [...porSlot.keys()].sort((x, y) => x - y);
  // blocos contíguos da região
  const blocos: number[][] = [];
  ordem.forEach((i) => {
    const ult = blocos[blocos.length - 1];
    if (ult && ult.length > 0 && chaveBlocoDe(slots[ult[ult.length - 1]]) === chaveBlocoDe(slots[i]) && ult[ult.length - 1] === i - 1) ult.push(i);
    else blocos.push([i]);
  });
  const saida: AlocacaoEscala[] = [];
  let ajustados = 0;
  for (const bloco of blocos) {
    let melhor: { linhas: AlocacaoEscala[]; custo: number } | null = null;
    let viaveis = 0;
    for (let t = 0; t < tentativas && viaveis < 40; t++) {
      const rnd = prng(t + 1);
      const jitter = t === 0 ? 0 : t < 100 ? 0.45 : 2.5;
      const mem = new MemoriaBloco(regras.equivalencias);
      registrarPassadoDoBloco(mem, slots, bloco[0], antes, regras.exposicaoExecutada);
      const escolhido: AlocacaoEscala[] = [];
      let ok = true;
      let custoTotal = 0;
      for (let k = 0; k < bloco.length && ok; k++) {
        const rows = porSlot.get(bloco[k]) as AlocacaoEscala[];
        const pessoas = rows.map((r) => r.funcionarioId);
        const original = new Map(rows.map((r) => [r.funcionarioId, r]));
        const custo = pessoas.map((p) => rows.map((tok) => {
          if (tok.origem === "manual") return tok.funcionarioId === p ? 0 : PROIBIDO;
          if (tok.maquinaId && tok.operacaoId && mem.proibido(p, tok.operacaoId)) return PROIBIDO;
          const of = original.get(p);
          return (of && chavePosto(of) === chavePosto(tok) ? 0 : CUSTO_TROCA) + (jitter > 0 ? rnd() * jitter : 0);
        }));
        const sol = atribuicaoMinima(custo);
        if (sol.some((j, pi) => custo[pi][j] >= PROIBIDO)) { ok = false; break; }
        const novo = rows.map((tok, j) => ({ ...tok, funcionarioId: pessoas[sol.indexOf(j)] }));
        custoTotal += novo.filter((n, j) => n.funcionarioId !== rows[j].funcionarioId).length;
        novo.forEach((n) => mem.registrar(n.funcionarioId, n.maquinaId ? n.operacaoId : null));
        escolhido.push(...novo);
        // lookahead: cada período seguinte do bloco ainda admite uma atribuição válida com a exposição atual?
        for (let k2 = k + 1; k2 < bloco.length && ok; k2++) {
          const r2 = porSlot.get(bloco[k2]) as AlocacaoEscala[];
          const c2 = r2.map((r) => r2.map((tok) => (tok.origem === "manual" ? (tok.funcionarioId === r.funcionarioId ? 0 : PROIBIDO) : tok.maquinaId && tok.operacaoId && mem.proibido(r.funcionarioId, tok.operacaoId) ? PROIBIDO : 0)));
          const s2 = atribuicaoMinima(c2);
          if (s2.some((j, pi) => c2[pi][j] >= PROIBIDO)) ok = false;
        }
      }
      if (!ok) continue;
      viaveis++;
      if (melhor === null || custoTotal < melhor.custo) melhor = { linhas: escolhido, custo: custoTotal };
      if (custoTotal === 0) break;
    }
    if (melhor === null) return null;
    if (melhor.custo > 0) ajustados += bloco.length;
    saida.push(...melhor.linhas);
  }
  const ordenada = saida.sort((a, b) => idx(a) - idx(b) || (a.funcionarioId < b.funcionarioId ? -1 : 1));
  return { linhas: ordenada, estabilizou: ajustados > 0, periodosAjustados: ajustados };
}
const chaveBlocoDe = (s: SlotEscala) => chaveBloco(s);
