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
  constructor(private readonly eq?: EquivalenciaOperacoes) {}
  limpar(): void {
    this.por.clear();
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
    if (!s || s.size === 0) return false;
    return expansaoOperacao(op, this.eq).some((o) => s.has(o));
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

/**
 * Registra na memória a exposição do bloco do slot `alvo` vinda do PASSADO: slots anteriores a `alvo` no MESMO bloco (alocação congelada; a evidência real,
 * quando existe para a (pessoa, período), SUBSTITUI a congelada). Evidência de pessoa sem linha congelada também entra. Não limpa a memória.
 */
export function registrarPassadoDoBloco(mem: MemoriaBloco, slots: SlotRef[], alvo: number, congeladas: LinhaRef[], evidencias: ExposicaoExecutada[] = []): void {
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
export function repeticoesPorBloco(linhas: LinhaRef[], slots: SlotRef[], eq?: EquivalenciaOperacoes): RepeticaoBloco[] {
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
