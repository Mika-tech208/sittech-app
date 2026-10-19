// Construtores de cenário para os testes do motor (não é um arquivo de teste).
import { construirSlots } from "../tempo";
import type { AlocacaoEscala, EntradaEscala, PeriodoEscala, PoolEscala, SlotEscala } from "../types";

export const PERIODOS_REAIS: PeriodoEscala[] = [
  { id: "m1", nome: "M1", inicio: "07:12", fim: "08:48" },
  { id: "m2", nome: "M2", inicio: "08:48", fim: "10:24" },
  { id: "m3", nome: "M3", inicio: "10:24", fim: "11:55" },
  { id: "t1", nome: "T1", inicio: "13:00", fim: "14:20" },
  { id: "t2", nome: "T2", inicio: "14:20", fim: "15:40" },
  { id: "t3", nome: "T3", inicio: "15:40", fim: "17:00" },
];

export const IDS_PERIODOS = PERIODOS_REAIS.map((p) => p.id);

export function slotsDe(dias: string[]): SlotEscala[] {
  return construirSlots(dias, PERIODOS_REAIS);
}

export function metasUniformes(mu: number): Record<string, number> {
  return Object.fromEntries(IDS_PERIODOS.map((id) => [id, mu]));
}

export function pool(p: {
  produto: string; etapa?: string; op: string; ordem?: number; q: number; maquinas: string[];
  mu?: number; metas?: Record<string, number>; valor?: number;
}): PoolEscala {
  return {
    produtoId: p.produto,
    etapaId: p.etapa ?? `${p.produto}-e${p.ordem ?? 1}`,
    operacaoId: p.op,
    ordemEtapa: p.ordem ?? 1,
    quantidade: p.q,
    maquinasIds: p.maquinas,
    metas: p.metas ?? metasUniformes(p.mu ?? 100),
    valorUnitario: p.valor ?? 1,
  };
}

export function equipe(n: number, prefixo = "f"): { id: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefixo}${String(i + 1).padStart(2, "0")}` }));
}

export function entrada(parcial: Partial<EntradaEscala> & Pick<EntradaEscala, "pools" | "funcionarios">, dias = ["2026-10-19"]): EntradaEscala {
  return {
    slots: slotsDe(dias),
    aPartirDe: 0,
    ausencias: [],
    maquinasIndisponiveisPrevisao: [],
    indisponibilidades: [],
    congeladas: [],
    ...parcial,
  };
}

export function doSlot(alocs: AlocacaoEscala[], data: string, periodoId: string): AlocacaoEscala[] {
  return alocs.filter((a) => a.data === data && a.periodoId === periodoId);
}

export function dePessoa(alocs: AlocacaoEscala[], funcionarioId: string): AlocacaoEscala[] {
  return alocs.filter((a) => a.funcionarioId === funcionarioId);
}

// Invariantes que valem para QUALQUER saída do motor.
export function checarInvariantes(e: EntradaEscala, r: { alocacoes: AlocacaoEscala[] }): string[] {
  const erros: string[] = [];
  const maqSlot = new Set<string>();
  const funcSlot = new Set<string>();
  const credito = new Map<string, number>();
  r.alocacoes.forEach((a) => {
    const kf = `${a.data}|${a.periodoId}|${a.funcionarioId}`;
    if (funcSlot.has(kf)) erros.push(`funcionário repetido no slot: ${kf}`);
    funcSlot.add(kf);
    if (a.maquinaId) {
      const km = `${a.data}|${a.periodoId}|${a.maquinaId}`;
      if (maqSlot.has(km)) erros.push(`máquina com 2 operadores: ${km}`);
      maqSlot.add(km);
      const p = e.pools.find((x) => x.produtoId === a.produtoId && x.etapaId === a.etapaId);
      if (!p) erros.push(`alocação fora dos pools da Previsão: ${a.produtoId}|${a.etapaId}`);
      else if (!p.maquinasIds.includes(a.maquinaId)) erros.push(`máquina ${a.maquinaId} não selecionada para ${a.produtoId}|${a.etapaId}`);
      else if (p.operacaoId !== a.operacaoId) erros.push("operação diferente da etapa");
      if (a.motivoSemPosto) erros.push("posto com motivo_sem_posto");
      const k = `${a.produtoId}|${a.etapaId}`;
      credito.set(k, (credito.get(k) ?? 0) + a.pecas);
    } else {
      if (!a.motivoSemPosto) erros.push(`sem posto sem motivo: ${kf}`);
      if (a.pecas !== 0) erros.push("sem posto com peças");
    }
    if (a.excecaoRevezamento && !a.motivoExcecao) erros.push("exceção sem motivo");
  });
  e.pools.forEach((p) => {
    const congelado = e.congeladas.filter((c) => c.maquinaId && c.produtoId === p.produtoId && c.etapaId === p.etapaId).reduce((s, c) => s + c.pecas, 0);
    const total = (credito.get(`${p.produtoId}|${p.etapaId}`) ?? 0) + congelado;
    if (total > p.quantidade + 1e-6) erros.push(`excedeu a quantidade do pool ${p.produtoId}|${p.etapaId}: ${total} > ${p.quantidade}`);
  });
  return erros;
}
