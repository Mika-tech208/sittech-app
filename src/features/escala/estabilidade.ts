// ESTABILIDADE COMO DESEMPATE (replanejamento restrito) — núcleo PURO.
//
// O replanejamento decide QUAIS postos funcionam em cada período; QUEM ocupa cada posto é, no mais das vezes, indiferente para o resultado produtivo.
// Para a Escala não "dançar" sem benefício, os postos da proposta são re-atribuídos às pessoas de modo a manter ao máximo a alocação vigente:
// por período, atribuição de custo mínimo (húngaro) em que cada pessoa que continua no MESMO posto custa 0 e qualquer outra custa 1, respeitando o
// revezamento duro (par proibido = mesma operação do período anterior da mesma pessoa, já com as escolhas feitas) e as trocas manuais (fixas).
// O resultado produtivo (postos, máquinas, produtos, peças) NÃO muda — só quem ocupa. Sem solução em algum período => devolve a proposta original.

import { atribuicaoMinima } from "./matching";
import { chaveBloco, ehPeriodoPonte, expansaoOperacao, MemoriaBloco, registrarPassadoDoBloco, registrarPonte, type EquivalenciaOperacoes, type ExposicaoExecutada } from "./exposicaoBloco";
import type { AlocacaoEscala, SlotEscala } from "./types";

const PROIBIDO = 1_000_000;
const CUSTO_TROCA = 1;
const chavePosto = (a: AlocacaoEscala) => (a.maquinaId ? `${a.maquinaId}|${a.produtoId}|${a.etapaId}` : "ocioso");

export interface ResultadoEstabilidade { linhas: AlocacaoEscala[]; estabilizou: boolean; periodosAjustados: number }

// `proposta`: linhas da região (já com origem manual marcada). `oficial`: Escala vigente na região. `antes`: tudo que vem antes da região (executado + comprometido).
/** Regras de revezamento da re-atribuição. Ausente/escopo consecutivo = a regra anterior (mesma operação do período imediatamente anterior). Escopo "bloco" = a pessoa
 *  não repete a operação (nem equivalente) dentro da manhã/tarde: memória do bloco = `antes` + períodos já estabilizados + evidência real. */
export interface RegrasRevezamento { escopo?: "consecutivo" | "bloco"; equivalencias?: EquivalenciaOperacoes; exposicaoExecutada?: ExposicaoExecutada[]; /** ponte M3 → T1 (só com escopo "bloco") */ ponteM3T1?: boolean }

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
    if (memBloco) registrarPassadoDoBloco(memBloco, slots, i, [...antes, ...saida], regras.exposicaoExecutada, regras.ponteM3T1 === true);
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

export function reatribuirPessoasBloco(linhas: AlocacaoEscala[], antes: AlocacaoEscala[], slots: SlotEscala[], regras: RegrasRevezamento, tentativas = 400, fallbackExato = true): ResultadoEstabilidade | null {
  const idx = (a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? -1;
  const porSlot = new Map<number, AlocacaoEscala[]>();
  linhas.forEach((a) => porSlot.set(idx(a), [...(porSlot.get(idx(a)) ?? []), a]));
  const ordem = [...porSlot.keys()].sort((x, y) => x - y);
  // blocos contíguos da região
  // (com a ponte M3 → T1 a cadeia da manhã e a da tarde do mesmo dia formam UM grupo: as escolhas de M3 limitam T1)
  const ponte = regras.ponteM3T1 === true;
  const blocos: number[][] = [];
  ordem.forEach((i) => {
    const ult = blocos[blocos.length - 1];
    if (ult && ult.length > 0 && ult[ult.length - 1] === i - 1 && (chaveBlocoDe(slots[ult[ult.length - 1]]) === chaveBlocoDe(slots[i]) || (ponte && ehPeriodoPonte(slots, i)))) ult.push(i);
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
      registrarPassadoDoBloco(mem, slots, bloco[0], antes, regras.exposicaoExecutada, ponte);
      const escolhido: AlocacaoEscala[] = [];
      let ok = true;
      let custoTotal = 0;
      for (let k = 0; k < bloco.length && ok; k++) {
        const rows = porSlot.get(bloco[k]) as AlocacaoEscala[];
        if (k > 0 && ponte && ehPeriodoPonte(slots, bloco[k])) {
          // virada manhã → tarde: a memória da manhã zera, MENOS o que cada pessoa fez em M3 (já escolhido), que vale só para T1
          mem.limpar();
          registrarPonte(mem, slots, bloco[k], escolhido, regras.exposicaoExecutada);
        }
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
        if (ponte && ehPeriodoPonte(slots, bloco[k])) mem.limparPonte(); // a ponte vale só para o T1
        escolhido.push(...novo);
        // lookahead: cada período seguinte do bloco ainda admite uma atribuição válida com a exposição atual?
        for (let k2 = k + 1; k2 < bloco.length && ok; k2++) {
          // ponte: a exposição da manhã não vale na tarde, exceto M3 → T1 (só olhada quando k2 é o T1 logo após o M3 recém-escolhido)
          if (ponte && chaveBlocoDe(slots[bloco[k2]]) !== chaveBlocoDe(slots[bloco[k]])) {
            if (k2 !== k + 1 || !ehPeriodoPonte(slots, bloco[k2])) break;
          }
          const r2 = porSlot.get(bloco[k2]) as AlocacaoEscala[];
          const memLook = ponte && chaveBlocoDe(slots[bloco[k2]]) !== chaveBlocoDe(slots[bloco[k]]) ? (() => { const m = new MemoriaBloco(regras.equivalencias); registrarPonte(m, slots, bloco[k2], escolhido, regras.exposicaoExecutada); return m; })() : mem;
          const c2 = r2.map((r) => r2.map((tok) => (tok.origem === "manual" ? (tok.funcionarioId === r.funcionarioId ? 0 : PROIBIDO) : tok.maquinaId && tok.operacaoId && memLook.proibido(r.funcionarioId, tok.operacaoId) ? PROIBIDO : 0)));
          const s2 = atribuicaoMinima(c2);
          if (s2.some((j, pi) => c2[pi][j] >= PROIBIDO)) ok = false;
        }
      }
      if (!ok) continue;
      viaveis++;
      if (melhor === null || custoTotal < melhor.custo) melhor = { linhas: escolhido, custo: custoTotal };
      if (custoTotal === 0) break;
    }
    if (melhor === null) {
      // A heurística (húngaro por período + lookahead período a período, com jitter) pode falhar mesmo quando EXISTE uma atribuição CONJUNTA válida. Antes de desistir do bloco,
      // busca EXATA (backtracking com poda): só aceita o que cumpre TODAS as regras (nenhuma é relaxada); esgotada sem solução = inviável de verdade.
      const exato = fallbackExato ? resolverBlocoExato(bloco, porSlot, slots, antes, regras, ponte) : null;
      if (!exato || exato === "limite") return null;
      melhor = { linhas: exato, custo: 1 };
    }
    if (melhor.custo > 0) ajustados += bloco.length;
    saida.push(...melhor.linhas);
  }
  const ordenada = saida.sort((a, b) => idx(a) - idx(b) || (a.funcionarioId < b.funcionarioId ? -1 : 1));
  return { linhas: ordenada, estabilizou: ajustados > 0, periodosAjustados: ajustados };
}
const chaveBlocoDe = (s: SlotEscala) => chaveBloco(s);

// ---------- BUSCA EXATA da atribuição de pessoas de UM bloco (fallback da heurística acima) ----------
// Mesmas regras, nenhuma relaxada: uma pessoa por posto e um posto por pessoa em cada período; a mesma operação (ou equivalente) não repete para a mesma pessoa no bloco; ponte M3 → T1;
// memória do passado do bloco (congelado + evidência) via `registrarPassadoDoBloco`; tokens manuais fixos. É um CSP com duas famílias de "todos-diferentes" (por período e por operação no bloco):
// variáveis = postos, domínio = pessoas permitidas; busca com MRV global (posto mais restrito de QUALQUER período primeiro), propagação (checagem adiante + emparelhamento de Kuhn em cada grupo
// todos-diferentes, que detecta violações de Hall) e pessoa original primeiro. Determinístico. `"limite"` = orçamento de nós esgotado (inconclusivo); `null` = INVIÁVEL provado (busca esgotada).
export const NOS_BUSCA_EXATA = 200_000;

export function resolverBlocoExato(bloco: number[], porSlot: Map<number, AlocacaoEscala[]>, slots: SlotEscala[], antes: AlocacaoEscala[], regras: RegrasRevezamento, ponte: boolean, maxNos = NOS_BUSCA_EXATA): AlocacaoEscala[] | null | "limite" {
  const eq = regras.equivalencias;
  const mem0 = new MemoriaBloco(eq);
  registrarPassadoDoBloco(mem0, slots, bloco[0], antes, regras.exposicaoExecutada, ponte);
  const rowsDe = (k: number) => porSlot.get(bloco[k]) as AlocacaoEscala[];
  const pessoasDe = (k: number) => rowsDe(k).map((r) => r.funcionarioId);
  type V = { k: number; tok: AlocacaoEscala; exp: string[]; dom: Set<string> };
  const vars: V[] = [];
  const escopo = (k: number) => chaveBlocoDe(slots[bloco[k]]);
  const ehPonte = (k: number) => k > 0 && ponte && ehPeriodoPonte(slots, bloco[k]);
  for (let k = 0; k < bloco.length; k++) {
    for (const tok of rowsDe(k)) {
      if (!tok.maquinaId || !tok.operacaoId) continue;
      const exp = expansaoOperacao(tok.operacaoId, eq);
      const dom = new Set<string>();
      for (const p of pessoasDe(k)) {
        if (tok.origem === "manual") { if (tok.funcionarioId === p) dom.add(p); continue; }
        // exposição inicial (passado do bloco) vale no escopo do 1º período; a ponte só no 1º período; depois da virada manhã → tarde a memória zera
        const noEscopo0 = escopo(k) === escopo(0);
        const barrado = (noEscopo0 && exp.some((o) => mem0.expostas(p).has(o))) || (k === 0 && exp.some((o) => mem0.expostasPonte(p).has(o)));
        if (!barrado) dom.add(p);
      }
      vars.push({ k, tok, exp, dom });
    }
  }
  if (vars.some((v) => v.dom.size === 0)) return null;
  for (let k = 0; k < bloco.length; k++) if (vars.filter((v) => v.k === k).length > pessoasDe(k).length) return null;
  const n = vars.length;
  // conflitos: mesmo período; mesma operação (expansão) no mesmo escopo; ponte M3 → T1 (períodos k-1 e k)
  const conflita = (a: V, b: V) => {
    if (a.k === b.k) return true;
    const inter = a.exp.some((o) => b.exp.includes(o));
    if (!inter) return false;
    if (escopo(a.k) === escopo(b.k)) return true;
    const [x, y] = a.k < b.k ? [a, b] : [b, a];
    return y.k === x.k + 1 && ehPonte(y.k);
  };
  const conf: number[][] = vars.map((a, i) => vars.map((b, j) => (i !== j && conflita(a, b) ? j : -1)).filter((j) => j >= 0));
  // grupos todos-diferentes (cliques): por período e por (operação, escopo) [+ ponte]
  const grupos: number[][] = [];
  for (let k = 0; k < bloco.length; k++) grupos.push(vars.map((v, i) => (v.k === k ? i : -1)).filter((i) => i >= 0));
  const ops = [...new Set(vars.flatMap((v) => v.exp))];
  for (const o of ops) {
    for (const esc of new Set(vars.map((v) => escopo(v.k)))) grupos.push(vars.map((v, i) => (v.exp.includes(o) && escopo(v.k) === esc ? i : -1)).filter((i) => i >= 0));
    for (let k = 1; k < bloco.length; k++) if (ehPonte(k)) grupos.push(vars.map((v, i) => (v.exp.includes(o) && (v.k === k || v.k === k - 1) ? i : -1)).filter((i) => i >= 0));
  }
  const gruposUteis = grupos.filter((g) => g.length > 1);
  const hallOk = (dom: Set<string>[], g: number[]): boolean => {
    const dono = new Map<string, number>();
    const tenta = (i: number, vis: Set<string>): boolean => {
      for (const p of dom[g[i]]) {
        if (vis.has(p)) continue;
        vis.add(p);
        const o = dono.get(p);
        if (o === undefined || tenta(o, vis)) { dono.set(p, i); return true; }
      }
      return false;
    };
    for (let i = 0; i < g.length; i++) if (!tenta(i, new Set())) return false;
    return true;
  };
  let nos = 0, estourou = false;
  // atribui i := p e propaga (remove p dos conflitantes; singletons em cascata); devolve false se algum domínio esvaziar
  const atribuir = (dom: Set<string>[], i: number, p: string): boolean => {
    const fila: [number, string][] = [[i, p]];
    while (fila.length) {
      const [vi, vp] = fila.pop() as [number, string];
      if (dom[vi].size !== 1 || !dom[vi].has(vp)) dom[vi] = new Set([vp]);
      for (const j of conf[vi]) {
        if (!dom[j].has(vp)) continue;
        if (dom[j].size === 1) return false;
        dom[j] = new Set([...dom[j]].filter((x) => x !== vp));
        if (dom[j].size === 1) fila.push([j, [...dom[j]][0]]);
      }
    }
    return gruposUteis.every((g) => hallOk(dom, g));
  };
  const dom0 = vars.map((v) => new Set(v.dom));
  if (!gruposUteis.every((g) => hallOk(dom0, g))) return null;
  const busca = (dom: Set<string>[]): Set<string>[] | null => {
    if (estourou) return null;
    let alvo = -1;
    for (let i = 0; i < n; i++) if (dom[i].size > 1 && (alvo < 0 || dom[i].size < dom[alvo].size || (dom[i].size === dom[alvo].size && conf[i].length > conf[alvo].length))) alvo = i;
    if (alvo < 0) return dom;
    if (++nos > maxNos) { estourou = true; return null; }
    const orig = vars[alvo].tok.funcionarioId;
    const valores = [...dom[alvo]].sort((a, b) => Number(b === orig) - Number(a === orig));
    for (const p of valores) {
      const d2 = dom.map((s) => new Set(s));
      if (!atribuir(d2, alvo, p)) continue;
      const r = busca(d2);
      if (r) return r;
      if (estourou) return null;
    }
    return null;
  };
  // singletons iniciais propagam antes da busca
  const inicio = dom0.map((s) => new Set(s));
  for (let i = 0; i < n; i++) if (inicio[i].size === 1 && !atribuir(inicio, i, [...inicio[i]][0])) return null;
  const sol = busca(inicio);
  if (!sol) return estourou ? "limite" : null;
  const saida: AlocacaoEscala[] = [];
  for (let k = 0; k < bloco.length; k++) {
    const rows = rowsDe(k);
    const usadas = new Set<string>();
    const postos = vars.map((v, i) => ({ v, i })).filter((x) => x.v.k === k).map((x) => { const pessoa = [...sol[x.i]][0]; usadas.add(pessoa); return { ...x.v.tok, funcionarioId: pessoa }; });
    const sobra = pessoasDe(k).filter((p) => !usadas.has(p));
    const ociosos = rows.filter((r) => !(r.maquinaId && r.operacaoId)).map((t, i) => ({ ...t, funcionarioId: sobra[i] }));
    saida.push(...postos, ...ociosos);
  }
  return saida;
}
