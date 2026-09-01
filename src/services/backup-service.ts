// Compatibilidade com o formato antigo (Etapa 7): serializar o estado atual
// no mesmo formato que o "Gerar backup" do sistema original produz, e
// validar minimamente um backup colado/importado antes de restaurar.
//
// Observação: o backup original não inclui `usuarios` nem `auditoria`
// (comportamento atual, preservado aqui de propósito).

import type {
  FixedCost, VariableEntry, Funcionario, Periodo, Faturamento, Produto, Maquina, Previsao,
} from "@/types/domain";

export interface BackupShape {
  fixedCosts: FixedCost[];
  variableEntries: VariableEntry[];
  categorias: string[];
  operacoes: string[];
  funcionarios: Funcionario[];
  periodos: Periodo[];
  diasUteis: string;
  diasUteisSemana: string;
  faturamentos: Faturamento[];
  produtos: Produto[];
  maquinas: Maquina[];
  previsoes: Previsao[];
}

export function serializeBackup(state: BackupShape): string {
  const {
    fixedCosts, variableEntries, categorias, operacoes, funcionarios, periodos, diasUteis, diasUteisSemana,
    faturamentos, produtos, maquinas, previsoes,
  } = state;
  return JSON.stringify({
    fixedCosts, variableEntries, categorias, operacoes, funcionarios, periodos, diasUteis, diasUteisSemana,
    faturamentos, produtos, maquinas, previsoes,
  });
}

// Validação estrutural mínima — não garante consistência de negócio, só que
// o texto é um JSON com o formato esperado o suficiente para não quebrar a
// restauração (ver COMPORTAMENTO ATUAL: campos numéricos às vezes vêm como
// string — normalização fica para a migração ao Supabase, não aqui).
export function validateBackupShape(parsed: unknown): parsed is Partial<BackupShape> {
  if (!parsed || typeof parsed !== "object") return false;
  const arrayFields: (keyof BackupShape)[] = [
    "fixedCosts", "variableEntries", "categorias", "operacoes", "funcionarios",
    "periodos", "faturamentos", "produtos", "maquinas", "previsoes",
  ];
  return arrayFields.every((field) => {
    const value = (parsed as Record<string, unknown>)[field];
    return value === undefined || Array.isArray(value);
  });
}
