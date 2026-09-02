// Tipos derivados do código real (ver docs/legacy/sittech-custos.jsx e
// src/features/legacy/SittechApp.tsx, aba "Custo por hora"). Nenhum campo
// especulativo — só o que o sistema já calcula e exibe hoje.

import type { Funcionario } from "@/types/domain";

// Resultado agregado por operação — a MÉDIA (mediaHora) é exatamente o
// mesmo valor que alimenta custoHoraPorOperacao usado por Previsão/Capacidade
// para achar o lucro/hora de um produto (calcularCustoHoraEOperacoes).
export interface ResumoOperacao {
  operacao: string;
  funcionarios: Funcionario[];
  ativosGrupo: Funcionario[];
  totalMensalGrupo: number;
  totalHoraGrupo: number;
  totalHorasGrupo: number;
  mediaMensal: number;
  mediaHora: number;
}

export interface CustoHoraEOperacoes {
  // Chave é a operação; ausente quando a operação não tem nenhum funcionário
  // ativo (COMPORTAMENTO ATUAL — ver TODO em calcularCustoHoraEOperacoes).
  custoHoraPorOperacao: Record<string, number>;
  custoHoraEmpresa: number;
  rateioPorHora: number;
  totalFixo: number;
  totalCustoFuncionariosAtivos: number;
  horasProdutivasFuncionario: number;
  totalHorasProdutivasEmpresa: number;
  custoMedioFuncionarioMensal: number;
  resumoPorOperacao: ResumoOperacao[];
}
