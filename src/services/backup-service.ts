// Gera o texto de "Backup completo" (aba "Importar dados") a partir dos
// dados reais do Supabase (cada campo já lido pela tela via seu hook —
// useCustos, useCadastrosBase, useFuncionarios, useFaturamentos,
// useProdutos, useMaquinas, usePrevisoes), nunca de um estado local
// potencialmente desatualizado. Somente exportação — restaurar um backup
// antigo de volta pro Supabase não é feito por aqui (ver painel
// "Restaurar backup" no app pra explicação).
//
// Observação: o backup não inclui `usuarios` nem `auditoria` (mesmo
// comportamento do formato antigo, preservado aqui de propósito).

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
