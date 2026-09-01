import type { Produto } from "@/types/domain";

// Tipos derivados do código real (ver docs/legacy/sittech-custos.jsx,
// funções calcularHorasPorMaquina, calcularAnaliseCapacidadeSemanal,
// calcularCapacidadeMaximaSemana, calcularUsoPorMaquina,
// calcularCapacidadeMaximaProduto, calcularObservacoesSetup e o useMemo de
// alocacaoSemanal). Nenhum campo especulativo — só o que o sistema já
// calcula e exibe hoje.

export type StatusCapacidadeMaquina = "gargalo" | "proximo" | "atencao" | "normal";

export interface ProdutoConsumidorHoras {
  nome: string;
  horas: number;
}

export interface HorasMaquina {
  horasNecessarias: number;
  produtos: Record<string, number>;
}

// Saída de calcularHorasPorMaquina — chave é o id da máquina.
export type HorasPorMaquina = Record<string, HorasMaquina>;

export interface AnaliseMaquina {
  maquinaId: string;
  nome: string;
  operacao: string;
  horasNecessarias: number;
  horasDisponiveis: number;
  // Utilização real, SEM teto em 100 — uma máquina sobrecarregada aparece
  // como 130, não 100 (ver Fase 1 — Etapa "capacidade", regra confirmada).
  pct: number;
  deficit: number;
  status: StatusCapacidadeMaquina;
  produtosConsumidores: ProdutoConsumidorHoras[];
}

export interface AnaliseCapacidadeSemanal {
  maquinas: AnaliseMaquina[];
  gargalos: AnaliseMaquina[];
  atingivel: boolean;
  maquinaMaisCarregada: AnaliseMaquina | null;
}

export interface ResultadoItemCapacidadeMaxima {
  itemId: string;
  produtoNome: string;
  valorUnitario: number;
  previsto: number;
  maximoPossivel: number;
  etapaLimitante: string | null;
}

export interface CapacidadeMaximaSemana {
  temDados: boolean;
  temGargalo: boolean;
  resultadosPorItem: ResultadoItemCapacidadeMaxima[];
  previstoTotalReais: number;
  maximoTotalReais: number;
  capacidadeEstimadaReais: number;
  maquinaLimitante: { nome: string; pct: number } | null;
}

export interface UsoMaquinaPeriodo {
  manha: number;
  tarde: number;
}

export interface UsoMaquina {
  maquinaId: string;
  nome: string;
  produtos: Record<string, UsoMaquinaPeriodo>;
  totalManha: number;
  totalTarde: number;
  pct: number;
  excedeu: boolean;
  capacidadePeriodo: number;
  livre: number;
}

export interface CapacidadeMaximaProduto {
  maxPecas: number;
  gargalo: string | null;
}

export interface ViabilidadeItem {
  atingivel: boolean;
  maxPecas: number;
  gargalo: string | null;
  funcionariosNecessarios: number;
}

export interface PeriodosEtapa {
  manha: number;
  tarde: number;
  diasCompletos: number;
  restantes: number;
  totalPeriodos: number;
  horasCalendario: number;
}

export interface ObservacaoSetupProduto extends ProdutoConsumidorHoras {
  lucroHora: number;
}

export interface ObservacaoSetupMaquina {
  maquinaId: string;
  nome: string;
  ordenados: ObservacaoSetupProduto[];
}

export interface ItemSemanaAgregado {
  produtoId: string;
  produtoNome: string;
  quantidade: number;
}

export interface ResumoSemana {
  valorPrevisto: number;
  valorRealizado: number;
  percentualConcluido: number;
  diferenca: number;
}

export interface HistoricoSemanaResumo {
  semanaInicio: string;
  previsto: number;
  realizado: number;
  pct: number;
}

export interface AlocacaoItemResultado {
  produtoId: string;
  produtoNome: string;
  quantidade: number;
  produto: Produto | null;
  lucroHora: number;
  quantidadeAlocada: number;
  deficit: number;
  semFluxo: boolean;
  semProduto: boolean;
  gargalo: string | null;
}

export interface DiasPeriodos {
  dias: number;
  periodos: number;
}

export interface UsoPorOperacao {
  operacao: string;
  total: number;
  restante: number;
  usado: number;
  numMaquinas: number;
  maquinasIntegrais: number;
  horasParcial: number;
  restanteDiasPeriodos: DiasPeriodos;
}

export interface AlocacaoSemanal {
  resultados: AlocacaoItemResultado[];
  usoPorOperacao: UsoPorOperacao[];
  resumo: {
    atendidos: AlocacaoItemResultado[];
    comDeficit: AlocacaoItemResultado[];
    operacoesComSobra: UsoPorOperacao[];
  };
}
