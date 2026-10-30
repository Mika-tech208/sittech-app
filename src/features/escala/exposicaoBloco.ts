// REVEZAMENTO POR BLOCO — núcleo PURO (sem IO, sem relógio). Fonte única da regra nova, usada por TODAS as camadas (motor, estabilização de pessoas,
// verificador independente, validação de troca manual, replanejamento restrito, auditoria de replay). O servidor (RPC escala_trocar_alocacoes) repete a mesma regra em SQL.
//
// REGRA (restrição DURA, não preferência): uma pessoa NÃO executa a MESMA OPERAÇÃO (operacao_id canônico) mais de uma vez dentro da MESMA MANHÃ (M1,M2,M3) nem da
// MESMA TARDE (T1,T2,T3). Formal: count(F, bloco, O) <= 1. Vale para outra máquina, outro produto, outra etapa_id (a identidade é a OPERAÇÃO). A exposição ZERA entre
// manhã e tarde (M3 Montar → T1 Montar é permitido) e no dia seguinte. Sem solução válida ⇒ o posto fica VAZIO + diagnóstico (nunca viola em silêncio).
//
// ESCOPO (flag `revezamento_escopo` em escala_parametros): "consecutivo" = regra anterior (mesma operação em períodos consecutivos; M3→T1 conta) — comportamento
// byte-idêntico; "bloco" = esta regra. Só tem efeito com o revezamento duro.
//
// PONTE M3 → T1 (flag `revezamento_ponte_m3_t1`, DESLIGADA por padrão; só tem efeito com o escopo "bloco" e o revezamento duro): ALÉM das regras de bloco, a mesma pessoa
// NÃO executa no PRIMEIRO período da tarde (T1) a mesma operação (ou equivalente) que executou no ÚLTIMO período da manhã imediatamente anterior (M3) do MESMO dia. Só M3 → T1:
// T2/T3 não olham para a manhã, T3 → M1 do dia seguinte continua livre. A exposição vem só de alocação congelada / troca manual registrada (nunca do funcionario_id do apontamento).
//
// EQUIVALÊNCIA DE OPERAÇÕES (opcional, VAZIA por padrão): `equivalenciaOperacoes[X] = [Y, Z]` significa "executar X EXPÕE também Y e Z". Executar X é proibido se
// {X} ∪ equivalencia[X] intersecta o que a pessoa já executou no bloco; depois de executar, todas essas operações ficam expostas. Para equivalência simétrica
// (Parafusar ≡ Parafusar (Pino)) declare as duas direções. Sem mapa, a identidade é o operacao_id — nunca se resolve por nome em silêncio.

export type EscopoRevezamento = "consecutivo" | "bloco";
export type BlocoDia = "manha" | "tarde";
export type EquivalenciaOperacoes = Record<string, string[]>;

/** Evidência do que a pessoa REALMENTE executou num período já iniciado (apontamento com funcionário). Substitui a alocação congelada daquele (período, pessoa). */
export interface ExposicaoExecutada {
  data: string;
  periodoId: string;
  funcionarioId: string;
  operacoes: string[];
}

export const ESCOPO_PADRAO: EscopoRevezamento = "consecutivo";

/** Manhã = M1..M3; tarde = T1..T3. Id fora do padrão (m1..t3): antes das 12:00 é manhã. */
export function blocoDoPeriodo(periodoId: string, inicioMin?: number): BlocoDia {
  const c = periodoId.trim().toLowerCase().charAt(0);
  if (c === "m") return "manha";
  if (c === "t") return "tarde";
  return (inicioMin ?? 0) < 12 * 60 ? "manha" : "tarde";
}
export const chaveBloco = (s: { data: string; periodoId: string; inicioMin?: number }): string => `${s.data}|${blocoDoPeriodo(s.periodoId, s.inicioMin)}`;

export function expansaoOperacao(op: string, eq?: EquivalenciaOperacoes): string[] {
  const extra = eq?.[op];
  return extra && extra.length > 0 ? [...new Set([op, ...extra])] : [op];
}

/** Memória de exposição do bloco corrente (por pessoa: operações já executadas). Mutável; o motor a limpa na virada de bloco. */
export class MemoriaBloco {
  private readonly por = new Map<string, Set<string>>();
  /** PONTE M3 → T1: operações que a pessoa executou no último período da manhã; só vale para o 1º período da tarde (o motor chama `limparPonte` a cada slot). */
  private readonly ponte = new Map<string, Set<string>>();
  constructor(private readonly eq?: EquivalenciaOperacoes) {}
  limpar(): void {
    this.por.clear();
    this.ponte.clear();
  }
  limparPonte(): void {
    this.ponte.clear();
  }
  registrarPonte(funcionarioId: string, op: string | null | undefined): void {
    if (!op) return;
    let s = this.ponte.get(funcionarioId);
    if (!s) this.ponte.set(funcionarioId, (s = new Set()));
    expansaoOperacao(op, this.eq).forEach((o) => s!.add(o));
  }
  registrar(funcionarioId: string, op: string | null | undefined): void {
    if (!op) return;
    let s = this.por.get(funcionarioId);
    if (!s) this.por.set(funcionarioId, (s = new Set()));
    expansaoOperacao(op, this.eq).forEach((o) => s!.add(o));
  }
  /** Executar `op` agora violaria a regra? */
  proibido(funcionarioId: string, op: string): boolean {
    const s = this.por.get(funcionarioId);
    const p = this.ponte.get(funcionarioId);
    if ((!s || s.size === 0) && (!p || p.size === 0)) return false;
    return expansaoOperacao(op, this.eq).some((o) => !!s?.has(o) || !!p?.has(o));
  }
  expostas(funcionarioId: string): ReadonlySet<string> {
    return this.por.get(funcionarioId) ?? new Set<string>();
  }
}

export interface SlotRef {
  data: string;
  periodoId: string;
  indice: number;
  primeiroDoDia?: boolean;
  inicioMin?: number;
}
interface LinhaRef {
  data: string;
  periodoId: string;
  funcionarioId: string;
  maquinaId: string | null;
  operacaoId: string | null;
}
const kSlot = (a: { data: string; periodoId: string }) => `${a.data}|${a.periodoId}`;

/** O slot `alvo` é o 1º período da tarde imediatamente depois do último da manhã do MESMO dia (T1 logo após M3)? É o único slot em que a ponte M3 → T1 atua. */
export function ehPeriodoPonte(slots: SlotRef[], alvo: number): boolean {
  const s = slots[alvo];
  const ant = slots[alvo - 1];
  if (!s || !ant) return false;
  return ant.data === s.data && blocoDoPeriodo(ant.periodoId, ant.inicioMin) === "manha" && blocoDoPeriodo(s.periodoId, s.inicioMin) === "tarde";
}

/** Registra em `mem` (ponte) o que cada pessoa executou no período imediatamente anterior a `alvo` (M3), SE `alvo` for T1 logo após M3. A evidência real, quando existe, substitui a congelada. */
export function registrarPonte(mem: MemoriaBloco, slots: SlotRef[], alvo: number, linhas: LinhaRef[], evidencias: ExposicaoExecutada[] = []): void {
  if (!ehPeriodoPonte(slots, alvo)) return;
  const k = kSlot(slots[alvo - 1]);
  const evi = new Set<string>();
  evidencias.forEach((e) => {
    if (kSlot(e) !== k) return;
    evi.add(e.funcionarioId);
    e.operacoes.forEach((o) => mem.registrarPonte(e.funcionarioId, o));
  });
  linhas.forEach((a) => {
    if (kSlot(a) !== k || !a.maquinaId || !a.operacaoId || evi.has(a.funcionarioId)) return;
    mem.registrarPonte(a.funcionarioId, a.operacaoId);
  });
}

/**
 * Registra na memória a exposição do bloco do slot `alvo` vinda do PASSADO: slots anteriores a `alvo` no MESMO bloco (alocação congelada; a evidência real,
 * quando existe para a (pessoa, período), SUBSTITUI a congelada). Evidência de pessoa sem linha congelada também entra. Não limpa a memória.
 */
export function registrarPassadoDoBloco(mem: MemoriaBloco, slots: SlotRef[], alvo: number, congeladas: LinhaRef[], evidencias: ExposicaoExecutada[] = [], ponte = false): void {
  if (ponte) registrarPonte(mem, slots, alvo, congeladas, evidencias);
  const bloco = chaveBloco(slots[alvo]);
  const idxBloco = new Set<string>();
  for (let u = alvo - 1; u >= 0 && chaveBloco(slots[u]) === bloco; u--) idxBloco.add(kSlot(slots[u]));
  if (idxBloco.size === 0) return;
  const evi = new Map<string, ExposicaoExecutada>();
  evidencias.forEach((e) => {
    if (idxBloco.has(kSlot(e))) evi.set(`${kSlot(e)}|${e.funcionarioId}`, e);
  });
  evi.forEach((e) => e.operacoes.forEach((o) => mem.registrar(e.funcionarioId, o)));
  congeladas.forEach((a) => {
    if (!idxBloco.has(kSlot(a)) || !a.maquinaId || !a.operacaoId) return;
    if (evi.has(`${kSlot(a)}|${a.funcionarioId}`)) return;
    mem.registrar(a.funcionarioId, a.operacaoId);
  });
}

export interface RepeticaoBloco {
  funcionarioId: string;
  data: string;
  bloco: BlocoDia;
  operacaoId: string;
  /** períodos (ids) em que executou a operação (ou uma equivalente) neste bloco, em ordem */
  periodos: string[];
  /** quantas execuções além da primeira */
  excesso: number;
}

/** Auditoria independente: todas as (pessoa, bloco, operação) com mais de uma execução. `linhas` = plano completo (com ou sem passado). */
export function repeticoesPorBloco(linhas: LinhaRef[], slots: SlotRef[], eq?: EquivalenciaOperacoes, ponte = false): RepeticaoBloco[] {
  const ordem = new Map(slots.map((s) => [kSlot(s), s.indice]));
  const slotPor = new Map(slots.map((s) => [kSlot(s), s]));
  const grupos = new Map<string, LinhaRef[]>();
  linhas.forEach((a) => {
    if (!a.maquinaId || !a.operacaoId) return;
    const s = slotPor.get(kSlot(a));
    if (!s) return;
    const k = `${a.funcionarioId}|${chaveBloco(s)}`;
    grupos.set(k, [...(grupos.get(k) ?? []), a]);
  });
  const saida: RepeticaoBloco[] = [];
  grupos.forEach((ls) => {
    ls.sort((x, y) => (ordem.get(kSlot(x)) as number) - (ordem.get(kSlot(y)) as number));
    const porOp = new Map<string, LinhaRef[]>();
    const vistas = new MemoriaBloco(eq);
    ls.forEach((a) => {
      const op = a.operacaoId as string;
      if (vistas.proibido(a.funcionarioId, op)) {
        // repetição: agrupa sob a operação da PRIMEIRA execução que a expõe (ou a própria)
        const chave = [...porOp.keys()].find((k) => expansaoOperacao(k, eq).some((o) => expansaoOperacao(op, eq).includes(o))) ?? op;
        porOp.set(chave, [...(porOp.get(chave) ?? []), a]);
      } else porOp.set(op, [a]);
      vistas.registrar(a.funcionarioId, op);
    });
    porOp.forEach((l, op) => {
      if (l.length > 1) {
        const s0 = slotPor.get(kSlot(l[0])) as SlotRef;
        saida.push({ funcionarioId: l[0].funcionarioId, data: l[0].data, bloco: blocoDoPeriodo(s0.periodoId, s0.inicioMin), operacaoId: op, periodos: l.map((x) => x.periodoId), excesso: l.length - 1 });
      }
    });
  });
  if (ponte) {
    // PONTE M3 → T1: (pessoa, T1) cuja operação (ou equivalente) já foi executada pela mesma pessoa em M3 do mesmo dia. Entra como repetição da TARDE, períodos [M3, T1].
    const porSlotPessoa = new Map<string, LinhaRef>();
    linhas.forEach((a) => a.maquinaId && a.operacaoId && porSlotPessoa.set(`${kSlot(a)}|${a.funcionarioId}`, a));
    slots.forEach((s, i) => {
      if (!ehPeriodoPonte(slots, i)) return;
      const m3 = slots[i - 1];
      porSlotPessoa.forEach((a) => {
        if (kSlot(a) !== kSlot(s)) return;
        const ant = porSlotPessoa.get(`${kSlot(m3)}|${a.funcionarioId}`);
        if (!ant) return;
        const mem = new MemoriaBloco(eq);
        mem.registrar(a.funcionarioId, ant.operacaoId);
        if (mem.proibido(a.funcionarioId, a.operacaoId as string)) saida.push({ funcionarioId: a.funcionarioId, data: s.data, bloco: "tarde", operacaoId: a.operacaoId as string, periodos: [m3.periodoId, s.periodoId], excesso: 1 });
      });
    });
  }
  return saida.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.bloco < b.bloco ? -1 : a.bloco > b.bloco ? 1 : a.funcionarioId < b.funcionarioId ? -1 : 1));
}

/** Apontamento mínimo (subconjunto de ApontamentoReal) para derivar a evidência de execução. */
export interface ApontamentoParaExposicao {
  data: string;
  periodoId: string;
  funcionarioId: string | null;
  operacaoId: string | null;
  status: "produzindo" | "sem_producao";
  lancadoEmMs: number;
}

/**
 * Evidência de execução: apontamentos "produzindo" com funcionário e operação, lançados até `agoraMs`, de períodos anteriores a `aPartirDe`.
 * ("sem_producao" NÃO é evidência de execução da operação: a alocação congelada continua valendo para a pessoa naquele período — conservador.)
 */
export function exposicaoDeApontamentos(apontamentos: ApontamentoParaExposicao[], slots: SlotRef[], aPartirDe: number, agoraMs: number): ExposicaoExecutada[] {
  const idx = new Map(slots.map((s) => [kSlot(s), s.indice]));
  const por = new Map<string, ExposicaoExecutada>();
  apontamentos.forEach((a) => {
    if (a.status !== "produzindo" || !a.funcionarioId || !a.operacaoId || a.lancadoEmMs > agoraMs) return;
    const i = idx.get(kSlot(a));
    if (i === undefined || i >= aPartirDe) return;
    const k = `${kSlot(a)}|${a.funcionarioId}`;
    const atual = por.get(k);
    if (atual) {
      if (!atual.operacoes.includes(a.operacaoId)) atual.operacoes.push(a.operacaoId);
    } else por.set(k, { data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId, operacoes: [a.operacaoId] });
  });
  return [...por.values()].sort((x, y) => (idx.get(kSlot(x)) as number) - (idx.get(kSlot(y)) as number) || (x.funcionarioId < y.funcionarioId ? -1 : 1));
}
