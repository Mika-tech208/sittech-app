// MODELO DE ROTAS (M0/M1) — tipos PUROS. Nada aqui lê banco, decide divisão entre rotas ou altera a Escala: são os blocos de leitura que o planejador (M2) vai usar.
// Produto SEM rotas = modelo LEGADO (rota única implícita, sequência/etapa final por `ordem`). Produto COM rotas: sequência por rota + pool comum; etapa final EXPLÍCITA.

export type PeriodoId = "m1" | "m2" | "m3" | "t1" | "t2" | "t3";
export const PERIODOS_DO_DIA: PeriodoId[] = ["m1", "m2", "m3", "t1", "t2", "t3"];

export interface EtapaCadastro {
  id: string;
  operacaoId: string;
  operacao: string;
  ordem: number;                       // rótulo de cadastro; NÃO define a sequência de um produto de rotas
  metas: Record<PeriodoId, number>;    // peças por MÁQUINA no período
  maquinasIds: string[];
}

export interface RotaEstrutura {
  id: string | null;                   // null = rota implícita (produto linear)
  codigo: string;                      // "CONV" | "AUTO" | "IMPLICITA"
  nome: string;
  ativa: boolean;
  preferencia: number;                 // menor = preferida (só desempate)
  etapas: string[];                    // etapas EXCLUSIVAS da rota, em ordem (produto linear: todas, por ordem)
}

export interface EstruturaProduto {
  produtoId: string;
  modelo: "linear" | "rotas";
  regraEtapaFinal: "max_ordem_legado" | "explicita";
  rotas: RotaEstrutura[];
  poolComum: { etapas: string[]; entradaId: string } | null;   // convergência explícita (null no produto linear)
  etapaFinalId: string | null;
}

export interface PeriodoDuracao { id: PeriodoId; minutos: number }

// Contexto de capacidade de UMA semana
export interface ContextoCapacidade {
  periodos: PeriodoDuracao[];
  diasProdutivos: number;
  maquinasIndisponiveis?: string[];                 // não produzem na semana
  // horas JÁ comprometidas por outros produtos em cada máquina (competição real por capacidade — nunca se assume uma máquina livre se ela está ocupada)
  horasComprometidasPorMaquina?: Record<string, number>;
}

export interface CapacidadeEtapa { etapaId: string; operacao: string; pecas: number; porMaquina: Record<string, number> }
export interface CapacidadeRota { rotaCodigo: string; pecas: number; limitante: CapacidadeEtapa | null; etapas: CapacidadeEtapa[] }
export type GargaloRotas =
  | { tipo: "comum"; etapaId: string; operacao: string }
  | { tipo: "entrada"; limitantes: { rotaCodigo: string; etapaId: string; operacao: string; pecas: number }[] }   // a soma das rotas exclusivas não cobre a demanda
  | null;
export interface AnaliseCapacidadeRotas {
  demanda: number;
  capacidadePorRota: CapacidadeRota[];
  capacidadeEntrada: number;          // Σ capacidade útil das rotas exclusivas (entrega ao pool comum)
  capacidadeComum: number;            // mínimo das etapas comuns (Etiquetar, Embalar, …)
  comum: CapacidadeEtapa[];
  maxEntregavel: number;              // min(entrada, comum): o que o produto final consegue entregar
  atende: boolean;
  falta: number;
  folga: number;                      // (maxEntregavel − demanda) / demanda; negativa = déficit
  gargalo: GargaloRotas;              // quem limita o produto final
}
