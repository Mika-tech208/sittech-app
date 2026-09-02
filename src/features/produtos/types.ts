import type { Prioridade } from "@/types/domain";

// Estado de formulário local — os campos numéricos ficam como string
// enquanto o usuário digita (mesmo padrão de Funcionários/Custo por Hora).
// A conversão pra número acontece só na hora de persistir
// (ver `roteiroParaPersistencia`/`produtoParaPersistencia`).

export interface RoteiroEtapaMetasForm {
  m1: string;
  m2: string;
  m3: string;
  t1: string;
  t2: string;
  t3: string;
}

export interface RoteiroEtapaForm {
  id: string;
  operacao: string;
  metas: RoteiroEtapaMetasForm;
  maquinasIds: string[];
}

export interface ProdutoForm {
  nome: string;
  referencia: string;
  valorUnitario: string;
  prioridade: Prioridade;
}

export const EMPTY_PRODUTO_FORM: ProdutoForm = { nome: "", referencia: "", valorUnitario: "", prioridade: "media" };

// ---- integridade referencial em memória (ver Etapa 15 do briefing) ----
// Não bloqueia nada hoje — só torna visível o que já pode acontecer com os
// dados atuais (roteiro apontando pra máquina que não existe mais, etc.).

export interface EtapaIntegridade {
  etapaId: string;
  operacao: string;
  semOperacao: boolean;
  semMaquinas: boolean;
  maquinasInexistentes: string[]; // ids em maquinasIds sem Maquina correspondente
  maquinasInativas: string[]; // ids que existem mas estão com ativo=false
  // ids que existem, estão ativos, mas cuja Maquina.operacao atual não bate
  // mais com etapa.operacao — ex.: a máquina foi editada e mudou de
  // operação depois de já estar marcada como elegível nesse roteiro (ver
  // Etapa 8 do briefing de Máquinas). `calcularMaquinasDaEtapa` não faz essa
  // checagem (uma seleção explícita em maquinasIds sempre é respeitada,
  // mesmo com operação divergente) — é comportamento atual preservado, só
  // sinalizado aqui.
  maquinasOperacaoDivergente: string[];
}
