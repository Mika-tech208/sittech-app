// Dias produtivos e equipe produtiva POR SEMANA da Previsão. Funções puras.
//
// A capacidade semanal continua vindo de calcularHorasPorMaquinaSemana
// (lib/calculations/periodos.ts: horasPorDia × dias) — esta camada só decide
// QUANTOS dias e QUEM valem para uma semana específica, em vez de um número
// global único. Nenhuma fórmula de capacidade é duplicada aqui.

import { toISODate } from "@/lib/date";
import type { Previsao, MembroEquipeSemana } from "@/types/domain";

export function diasDaSemana(semanaInicio: string): string[] {
  const base = new Date(semanaInicio + "T00:00:00");
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return toISODate(d);
  });
}

// Mesmo padrão que a migration usa ao criar uma previsão nova: segunda em
// diante, N = parte inteira de dias_uteis_semana limitada a 0..7.
export function diasProdutivosPadrao(semanaInicio: string, diasUteisSemana: number): string[] {
  const n = Math.max(0, Math.min(7, Math.floor(Number.isFinite(diasUteisSemana) ? diasUteisSemana : 5)));
  return diasDaSemana(semanaInicio).slice(0, n);
}

// Dias efetivos da semana: o snapshot gravado, ou o padrão da empresa
// quando a semana ainda não tem snapshot. Sempre ordenado.
export function resolverDiasProdutivos(
  semana: Pick<Previsao, "semanaInicio" | "diasProdutivos">,
  diasUteisSemanaPadrao: number
): string[] {
  const doBanco = semana.diasProdutivos;
  const lista = doBanco !== undefined ? doBanco : diasProdutivosPadrao(semana.semanaInicio, diasUteisSemanaPadrao);
  return [...lista].sort();
}

export function alternarDia(dias: string[], dia: string): string[] {
  return (dias.includes(dia) ? dias.filter((d) => d !== dia) : [...dias, dia]).sort();
}

export interface FuncionarioBasico {
  id: string;
  ativo: boolean;
}

// Elenco efetivo. Com snapshot: o que foi gravado (inclusive quem está
// inativo hoje) + funcionários ativos que não existiam no snapshot,
// desmarcados — contratar alguém depois não o coloca em semana antiga.
// Sem snapshot: todos os ativos elegíveis, produtivos (padrão).
export function resolverEquipeProdutiva(
  semana: Pick<Previsao, "equipeSemana">,
  funcionarios: FuncionarioBasico[]
): MembroEquipeSemana[] {
  const gravada = semana.equipeSemana;
  if (!gravada || gravada.length === 0) {
    return funcionarios.filter((f) => f.ativo).map((f) => ({ funcionarioId: f.id, produtivo: true }));
  }
  const ids = new Set(gravada.map((m) => m.funcionarioId));
  const novosAtivos = funcionarios
    .filter((f) => f.ativo && !ids.has(f.id))
    .map((f) => ({ funcionarioId: f.id, produtivo: false }));
  return [...gravada, ...novosAtivos];
}

export function alternarMembro(equipe: MembroEquipeSemana[], funcionarioId: string): MembroEquipeSemana[] {
  return equipe.map((m) => (m.funcionarioId === funcionarioId ? { ...m, produtivo: !m.produtivo } : m));
}

export function marcarTodos(equipe: MembroEquipeSemana[], produtivo: boolean): MembroEquipeSemana[] {
  return equipe.map((m) => ({ ...m, produtivo }));
}

export interface ResumoEquipe {
  produtivos: number;
  total: number;
  nenhum: boolean;
  texto: string;
}

export function resumirEquipe(equipe: MembroEquipeSemana[]): ResumoEquipe {
  const total = equipe.length;
  const produtivos = equipe.filter((m) => m.produtivo).length;
  const nenhum = produtivos === 0;
  const texto = nenhum
    ? `Nenhum dos ${total} funcionários está marcado como produtivo nesta semana`
    : `${produtivos} de ${total} funcionário${total === 1 ? "" : "s"} considerado${produtivos === 1 ? "" : "s"} produtivo${produtivos === 1 ? "" : "s"} nesta semana`;
  return { produtivos, total, nenhum, texto };
}
