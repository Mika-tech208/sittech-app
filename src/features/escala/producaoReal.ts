// PRODUÇÃO REAL como sinal do modo sombra (Fase 4c) — núcleo PURO. Nada lê banco: recebe linhas de apontamento já carregadas.
//
// Regras:
//  1. SÓ INFORMAÇÃO DO CORTE: entram apenas linhas de períodos ≤ c lançadas até o instante do corte. Nada posterior (nem "dado tardio")
//     pode mudar uma decisão já tomada — `visivelNoCorte` é a única porta de entrada.
//  2. EXPOSIÇÃO ERGONÔMICA (revezamento), abordagem CONSERVADORA:
//       - linha "produzindo" => a operação da própria linha;
//       - linha "sem_producao" COM funcionário + máquina + alocação oficial inequívoca (daquela pessoa, naquela máquina, data e período)
//         => a operacao_id da alocação oficial. "0 peças" NÃO significa "0 exposição";
//       - linha "sem_producao" COM funcionário e sem vínculo inequívoco => operação DESCONHECIDA: proíbe, no período seguinte, TODAS as
//         operações que a máquina pode executar nos pools da semana (superconjunto conservador) e registra a incerteza;
//       - linha "sem_producao" SEM funcionário (é o caso real hoje) não identifica pessoa: `falta_operador` ⇒ ninguém exposto (o
//         lançamento diz que não havia operador); `falta_material`/`outro` ⇒ quem tem a ÚNICA alocação oficial naquela máquina/período
//         e nenhum apontamento próprio é tratado como EXPOSTO àquela operação (presunção conservadora, marcada `presumida`).
//       Nunca se inventa produto/etapa/operação; incerteza sempre fica registrada.
//  3. Pessoa sem nenhum apontamento no período: sem exposição conhecida (registrado como incerteza `sem_apontamento` só para diagnóstico).

import { chavePool, type AlocacaoEscala, type PoolEscala, type SlotEscala } from "./types";

export type StatusApontamento = "produzindo" | "sem_producao";

export interface ApontamentoReal {
  data: string;
  periodoId: string;
  funcionarioId: string | null;
  maquinaId: string | null;
  produtoId: string | null;
  etapaId: string | null;
  operacaoId: string | null;
  boas: number; // quantidade_produzida − refugo
  refugo: number;
  meta: number; // meta_periodo_vigente (por linha)
  status: StatusApontamento;
  motivo: string | null; // falta_operador | falta_material | outro | null
  lancadoEmMs: number; // instante do lançamento (epoch ms)
}

const indiceDoSlot = (slots: SlotEscala[], a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? -1;

// Única porta de entrada: períodos já iniciados até c e lançados até o corte.
export function visivelNoCorte(apontamentos: ApontamentoReal[], slots: SlotEscala[], c: number, corteMs: number): ApontamentoReal[] {
  return apontamentos.filter((a) => {
    const i = indiceDoSlot(slots, a);
    return i >= 0 && i <= c && a.lancadoEmMs <= corteMs;
  });
}

// Boas reais acumuladas por pool ("produto|etapa").
export function boasPorPool(apontamentos: ApontamentoReal[]): Record<string, number> {
  const r: Record<string, number> = {};
  apontamentos.forEach((a) => {
    if (a.status !== "produzindo" || !a.produtoId || !a.etapaId) return;
    const k = chavePool(a.produtoId, a.etapaId);
    r[k] = (r[k] ?? 0) + a.boas;
  });
  return r;
}

// Quantidade restante REAL por pool: previsto − boas reais (nunca negativa). Tem mais peso conceitual que a performance.
export function restantePorPool(pools: PoolEscala[], boas: Record<string, number>): Record<string, number> {
  const r: Record<string, number> = {};
  pools.forEach((p) => {
    const k = chavePool(p.produtoId, p.etapaId);
    r[k] = Math.max(0, p.quantidade - (boas[k] ?? 0));
  });
  return r;
}

export type OrigemExposicao = "apontamento" | "sem_producao_vinculada" | "sem_producao_desconhecida" | "sem_producao_presumida";
export interface ExposicaoPessoa {
  funcionarioId: string;
  slot: number;
  maquinaId: string | null;
  operacoes: string[]; // operações a considerar como exercidas (1 = conhecida; várias = desconhecida, superconjunto conservador)
  origem: OrigemExposicao;
  incerta: boolean; // true quando a operação NÃO é inequívoca
}
export interface IncertezaExposicao {
  tipo: "sem_producao_sem_vinculo" | "sem_producao_sem_funcionario_presumida" | "sem_apontamento";
  funcionarioId: string | null;
  slot: number;
  maquinaId: string | null;
  candidatas: string[];
}

const operacoesDaMaquina = (pools: PoolEscala[], maquinaId: string) => [...new Set(pools.filter((p) => p.maquinasIds.includes(maquinaId)).map((p) => p.operacaoId))].sort();

// Exposição de cada pessoa no período `slot`, a partir do que foi apontado e da alocação oficial daquele período.
export function exposicoesDoPeriodo(slot: SlotEscala, apontamentos: ApontamentoReal[], oficial: AlocacaoEscala[], pools: PoolEscala[]): { exposicoes: ExposicaoPessoa[]; incertezas: IncertezaExposicao[] } {
  const doPeriodo = apontamentos.filter((a) => a.data === slot.data && a.periodoId === slot.periodoId);
  const oficiais = oficial.filter((a) => a.data === slot.data && a.periodoId === slot.periodoId && a.maquinaId);
  const exposicoes = new Map<string, ExposicaoPessoa>();
  const incertezas: IncertezaExposicao[] = [];
  const comLinhaPropria = new Set(doPeriodo.filter((a) => a.funcionarioId).map((a) => a.funcionarioId as string));

  doPeriodo.filter((a) => a.funcionarioId).forEach((a) => {
    const f = a.funcionarioId as string;
    if (a.status === "produzindo" && a.operacaoId) {
      exposicoes.set(f, { funcionarioId: f, slot: slot.indice, maquinaId: a.maquinaId, operacoes: [a.operacaoId], origem: "apontamento", incerta: false });
      return;
    }
    // sem_producao (ou produzindo sem operação): vínculo inequívoco com a alocação oficial da MESMA pessoa na MESMA máquina?
    const candidatas = oficiais.filter((o) => o.funcionarioId === f && o.maquinaId === a.maquinaId && o.operacaoId);
    if (candidatas.length === 1) {
      exposicoes.set(f, { funcionarioId: f, slot: slot.indice, maquinaId: a.maquinaId, operacoes: [candidatas[0].operacaoId as string], origem: "sem_producao_vinculada", incerta: false });
      return;
    }
    const ops = a.maquinaId ? operacoesDaMaquina(pools, a.maquinaId) : [];
    exposicoes.set(f, { funcionarioId: f, slot: slot.indice, maquinaId: a.maquinaId, operacoes: ops, origem: "sem_producao_desconhecida", incerta: true });
    incertezas.push({ tipo: "sem_producao_sem_vinculo", funcionarioId: f, slot: slot.indice, maquinaId: a.maquinaId, candidatas: ops });
  });

  // linhas sem funcionário (caso real de sem_producao): não identificam pessoa
  doPeriodo.filter((a) => !a.funcionarioId && a.status === "sem_producao" && a.maquinaId && a.motivo !== "falta_operador").forEach((a) => {
    const naMaquina = oficiais.filter((o) => o.maquinaId === a.maquinaId);
    if (naMaquina.length !== 1) return;
    const o = naMaquina[0];
    if (comLinhaPropria.has(o.funcionarioId) || exposicoes.has(o.funcionarioId)) return;
    exposicoes.set(o.funcionarioId, { funcionarioId: o.funcionarioId, slot: slot.indice, maquinaId: a.maquinaId, operacoes: [o.operacaoId as string], origem: "sem_producao_presumida", incerta: true });
    incertezas.push({ tipo: "sem_producao_sem_funcionario_presumida", funcionarioId: o.funcionarioId, slot: slot.indice, maquinaId: a.maquinaId, candidatas: [o.operacaoId as string] });
  });

  oficiais.forEach((o) => {
    if (!exposicoes.has(o.funcionarioId)) incertezas.push({ tipo: "sem_apontamento", funcionarioId: o.funcionarioId, slot: slot.indice, maquinaId: o.maquinaId, candidatas: [] });
  });
  return { exposicoes: [...exposicoes.values()].sort((x, y) => (x.funcionarioId < y.funcionarioId ? -1 : 1)), incertezas };
}

// Linhas "executadas" (entrada congelada do motor) para os períodos 0..c. pecas = 0 (o saldo real entra por `restantePorPool`).
export function linhasExecutadas(slots: SlotEscala[], c: number, funcionarios: string[], apontamentos: ApontamentoReal[], oficial: AlocacaoEscala[], pools: PoolEscala[]): { linhas: AlocacaoEscala[]; exposicoes: ExposicaoPessoa[]; incertezas: IncertezaExposicao[] } {
  const linhas: AlocacaoEscala[] = [];
  const exposicoes: ExposicaoPessoa[] = [];
  const incertezas: IncertezaExposicao[] = [];
  for (let s = 0; s <= c && s < slots.length; s++) {
    const slot = slots[s];
    const ex = exposicoesDoPeriodo(slot, apontamentos, oficial, pools);
    exposicoes.push(...ex.exposicoes);
    incertezas.push(...ex.incertezas);
    const exPor = new Map(ex.exposicoes.map((e) => [e.funcionarioId, e]));
    const doPeriodo = apontamentos.filter((a) => a.data === slot.data && a.periodoId === slot.periodoId && a.funcionarioId);
    funcionarios.forEach((f) => {
      const e = exPor.get(f);
      const ap = doPeriodo.find((a) => a.funcionarioId === f);
      const base = { data: slot.data, periodoId: slot.periodoId, funcionarioId: f, pecas: 0, excecaoRevezamento: false, motivoExcecao: null };
      if (e && e.maquinaId) {
        const of = oficial.find((o) => o.data === slot.data && o.periodoId === slot.periodoId && o.funcionarioId === f && o.maquinaId === e.maquinaId);
        const known = ap && ap.status === "produzindo" ? ap : of;
        linhas.push({ ...base, maquinaId: e.maquinaId, produtoId: known?.produtoId ?? null, etapaId: known?.etapaId ?? null, operacaoId: e.incerta ? null : e.operacoes[0] ?? null, motivoSemPosto: null });
      } else linhas.push({ ...base, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, motivoSemPosto: "sem apontamento" });
    });
  }
  return { linhas, exposicoes, incertezas };
}
