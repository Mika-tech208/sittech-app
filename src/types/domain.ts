// Formato dos dados conforme documentado no briefing de migração
// (Parte 2 — Formato exato dos dados atuais). Não inventar propriedades
// além das já existentes no sistema em produção.

export type Prioridade = "alta" | "media" | "baixa";

export interface FixedCost {
  id: string;
  descricao: string;
  categoria: string;
  valor: number;
  ativo: boolean;
}

export interface VariableEntry {
  id: string;
  mes: string; // "AAAA-MM"
  descricao: string;
  categoria: string;
  valor: number;
}

export interface FuncionarioCusto {
  id: string;
  descricao: string;
  valor: number;
}

export interface Funcionario {
  id: string;
  nome: string;
  operacao: string;
  salarioBase: number;
  ativo: boolean;
  custos: FuncionarioCusto[];
}

export interface Periodo {
  id: string; // "m1".."t3"
  nome: string;
  inicio: string; // "07:12"
  fim: string;
}

export interface PeriodoComDuracao extends Periodo {
  duracaoHoras: number;
}

export interface Receita {
  id: string;
  data: string;
  descricao: string;
  valor: number;
}

export interface Faturamento {
  mes: string;
  receitas: Receita[];
  numFuncionarios: string | number;
  custoFuncionariosTotal: string | number;
  custoFixoTotal: string | number;
}

export interface RoteiroEtapaMetas {
  m1: number;
  m2: number;
  m3: number;
  t1: number;
  t2: number;
  t3: number;
}

export interface RoteiroEtapa {
  id: string;
  operacao: string;
  metas: RoteiroEtapaMetas;
  maquinasIds: string[]; // referência a Maquina.id
}

export interface Produto {
  id: string;
  nome: string;
  referencia: string;
  valorUnitario: number;
  ativo: boolean;
  prioridade: Prioridade; // ainda não usado em cálculo
  roteiro: RoteiroEtapa[];
}

export interface Maquina {
  id: string;
  nome: string;
  operacao: string;
  ativo: boolean;
}

export interface PrevisaoItem {
  id: string;
  produtoId: string;
  produtoNome: string; // cópia no momento do lançamento, não referência viva
  valorUnitario: number; // cópia no momento do lançamento
  quantidade: number;
  // Presente em `previsoes[].itens`. Ausente em `previsoes[].itensRealizados`
  // na prática (apesar do briefing dizer "mesmo formato de itens") — o
  // código de submitRealItem nunca preencheu esse campo. Documentado aqui
  // como opcional para refletir o dado real, não o que estava especificado.
  maquinasPorEtapa?: { [etapaId: string]: string[] };
}

export interface Previsao {
  semanaInicio: string; // "AAAA-MM-DD", sempre segunda-feira
  itens: PrevisaoItem[];
  itensRealizados: PrevisaoItem[];
  maquinasIndisponiveis?: string[];
}

