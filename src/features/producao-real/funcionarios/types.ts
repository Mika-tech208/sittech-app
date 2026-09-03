// Funcionários V1 — tipos centrais. Reaproveita literalmente o
// vocabulário/tipos já aprovados em Desvios V1 (Janela, Evidencia,
// NivelMagnitude) — nunca redefinidos com outro sentido. Nenhuma fórmula
// oficial mora aqui.

import type { Janela, Evidencia, NivelMagnitude } from "@/features/producao-real/desvios/types";
import type { FiltrosIndicadores } from "@/features/producao-real/indicadores/calculations";

export type { Janela, Evidencia, NivelMagnitude };

// Contexto oficial V1 (§3, aprovado): produto + operação + máquina —
// nunca agregado entre máquinas, nunca entre produtos/operações.
export interface ContextoFuncionario {
  produtoId: string;
  produtoNome: string;
  operacaoId: string;
  operacaoNome: string;
  maquinaId: string;
  maquinaNome: string;
}

export interface AmostraSimples {
  suficiente: boolean;
  periodos: number;
  minutosProdutivos: number;
  motivoInsuficiencia: string | null;
}

export type ReferenciaTipo = "pares" | "meta" | "historico_proprio";
export type PolaridadeSinal = "atencao" | "positivo" | "neutro";
export type MetricaFuncionario = "performance" | "qualidade";

// Estrutura reutilizável pelo futuro Sittech Intelligence (§19, aprovado)
// — nunca persistida no banco nesta etapa.
export interface SinalFuncionario {
  id: string;
  funcionarioId: string;
  funcionarioNome: string;
  contexto: ContextoFuncionario;
  janela: Janela;
  metrica: MetricaFuncionario;
  valorFuncionario: number;
  referenciaTipo: ReferenciaTipo;
  valorReferencia: number;
  delta: number;
  deltaPercentual: number | null;
  magnitude: NivelMagnitude;
  persistencia: { percentual: number | null; persistente: boolean };
  amostraFuncionario: AmostraSimples;
  amostraPares: AmostraSimples | null;
  polaridade: PolaridadeSinal;
  evidencias: Evidencia[];
  confianca: "calculado";
  filtrosDrillDown: FiltrosIndicadores;
}

// Evidência contextual (§11/§12) — nunca gera sinal/card próprio, só
// acompanha o detalhe do contexto.
export interface EvidenciaParadasContexto {
  minutosParados: number;
  quantidadeParadas: number;
  duracaoMediaMinutos: number | null;
  principaisMotivos: { motivoNome: string; minutos: number; quantidade: number }[];
  motivoRecorrente: { motivoNome: string; percentualPeriodosAfetados: number } | null;
  custoTempoOciosoTotal: number | null;
  capacidadePerdidaTotal: number | null;
}

export interface EvidenciaEconomicaContexto {
  custoMedioPorPecaProduzida: number | null;
  diferencaCustoTeoricoObservadoMedia: number | null;
  custoTempoParadoTotal: number | null;
  impactoRefugoTotal: number | null;
  margemPct: number | null; // null quando o contexto não é a última etapa do roteiro
  margemDisponivel: boolean;
}

// Evolução (§13) — SOMENTE mesmo contexto entre as duas janelas; nunca
// atravessa produto/operação/máquina diferentes.
export interface EvolucaoContexto {
  disponivel: boolean;
  motivoIndisponivel: string | null;
  janelaAtual: Janela;
  janelaAnterior: Janela;
  performanceAtual: number | null;
  performanceAnterior: number | null;
  qualidadeAtual: number | null;
  qualidadeAnterior: number | null;
  minutosParadosAtual: number;
  minutosParadosAnterior: number;
  custoPecaAtual: number | null;
  custoPecaAnterior: number | null;
}

// Cobertura operacional (§14) — só fatos, nunca nota/competência.
export interface CoberturaOperacional {
  quantidadeProdutos: number;
  quantidadeOperacoes: number;
  quantidadeMaquinas: number;
  quantidadeContextosDistintos: number;
  porContexto: { contexto: ContextoFuncionario; periodos: number }[];
}

// Pacote completo por funcionário+contexto — base de tudo (cards B/C e
// detalhe E/F/G/H). Contém os sinais já filtrados por amostra, MAIS os
// dados brutos necessários pra UI explicar "amostra insuficiente" quando
// for o caso (§5/§6 pedem isso mostrado explicitamente).
export interface AnaliseFuncionarioContexto {
  funcionarioId: string;
  funcionarioNome: string;
  contexto: ContextoFuncionario;
  janelaAtual: Janela;
  amostraFuncionario: AmostraSimples;
  amostraPares: AmostraSimples;
  performanceFuncionario: number | null;
  performancePares: number | null;
  sinalPerformance: SinalFuncionario | null;
  qualidadeFuncionario: number | null;
  qualidadePares: number | null;
  amostraFuncionarioQualidade: AmostraSimples;
  amostraParesQualidade: AmostraSimples;
  sinalQualidade: SinalFuncionario | null;
  paradas: EvidenciaParadasContexto;
  economia: EvidenciaEconomicaContexto;
  evolucao: EvolucaoContexto;
  filtrosDrillDown: FiltrosIndicadores;
}

export interface ResultadoAnaliseFuncionarios {
  analises: AnaliseFuncionarioContexto[];
  atencao: SinalFuncionario[];
  destaques: SinalFuncionario[];
  coberturaPorFuncionario: Map<string, { funcionarioNome: string; cobertura: CoberturaOperacional }>;
}
