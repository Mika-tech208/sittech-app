// Contratos entre o banco (adaptador Supabase) e o orquestrador do servidor.
// Tudo aqui é dado puro — o motor (src/features/escala) nunca vê Supabase.

import type { ParametrosEscala } from "@/features/escala/parametros";
import type { AlertaEscala, AlocacaoEscala, HistoricoEquidadeFuncionario, PeriodoEscala } from "@/features/escala/types";
import type { ProximaSemana } from "@/features/escala/wip";

export interface AvisoMontagem {
  tipo: "etapa_sem_maquina" | "sem_pools" | "sem_funcionarios_produtivos";
  produtoId?: string;
  etapaId?: string;
}

export interface DiaExistente {
  data: string;
  versao: number;
  periodosSnapshot: PeriodoEscala[];
}

export interface ItemPrevistoBruto {
  produtoId: string;
  quantidade: number;
  quantidadeAdicional?: number; // carga adicional (produto acabado) acima do previsto; padrão 0
  // Adicional POR ETAPA (etapaId -> peças), só usado com o WIP ativo. Item com ESTE campo: etapa sem valor = 0.
  // Sem o campo: o adicional do item (acabado) vale igual para todas as etapas (comportamento anterior).
  adicionalPorEtapa?: Record<string, number>;
  valorUnitario: number; // snapshot do item
  maquinasPorEtapa: Record<string, string[]>; // etapaId -> máquinas selecionadas
}

export interface EtapaBruta {
  id: string;
  produtoId: string;
  operacaoId: string;
  ordem: number;
  metas: Record<string, number>; // periodoId -> meta
  maquinasCompativeis?: string[]; // roteiro_etapa_maquinas (só para diagnóstico de cobertura)
}

export interface AusenciaBruta {
  funcionarioId: string;
  data: string;
  horarioInicio: string | null; // "HH:MM:SS" ou null (dia inteiro)
  horarioFim: string | null;
}

export interface IndisponibilidadeBruta {
  maquinaId: string;
  desde: string; // ISO
  liberadaEm: string | null; // ISO
}

export interface EstadoBruto {
  previsaoId: string;
  semanaInicio: string;
  diasProdutivos: string[]; // datas ISO ativas na Previsão
  periodosAtuais: PeriodoEscala[];
  diasExistentes: DiaExistente[];
  equipeProdutiva: { funcionarioId: string; nome?: string; ativo: boolean }[]; // só quem foi marcado produtivo
  itens: ItemPrevistoBruto[];
  etapas: EtapaBruta[];
  maquinasIndisponiveisPrevisao: string[];
  maquinasInativas: string[];
  ausencias: AusenciaBruta[];
  indisponibilidades: IndisponibilidadeBruta[];
  alocacoes: AlocacaoEscala[]; // todas as existentes nos dias da escala
  nomesOperacao: Record<string, string>;
  nomesMaquinas?: Record<string, string>; // para rótulos do diagnóstico de cobertura
  nomesProdutos?: Record<string, string>;
  // Equidade: histórico agregado da janela (escala realmente gravada, semanas ANTERIORES a esta).
  historicoEquidade?: HistoricoEquidadeFuncionario[];
  // Parâmetros da Escala (escala_parametros) — entradas canônicas do motor. Ausente = padrões (WIP desligado).
  parametros?: ParametrosEscala;
  // Necessidade da PRÓXIMA semana por produto, só se a Previsão dela estiver salva (limite de estoque, regra A). null = não existe.
  proximaSemana?: ProximaSemana | null;
}

export interface DiaParaAplicar {
  data: string;
  versao_base: number | null;
  periodos_snapshot: PeriodoEscala[];
}

export interface PayloadAplicacao {
  previsaoId: string;
  dias: DiaParaAplicar[];
  aPartirDeData: string;
  aPartirDePeriodo: string;
  alocacoes: AlocacaoEscala[];
  removerDias: string[];
  usuarioId: string | null;
  eventoIds: string[];
  resumo: Record<string, unknown>;
}

export interface ResultadoProcessamento {
  status: "processado" | "ignorado" | "sem_alteracao";
  motivoIgnorado?: string;
  tentativas: number;
  versoes?: Record<string, number>;
  alertas: (AlertaEscala | AvisoMontagem)[];
  aviso?: string;
  alocacoesGravadas: number;
}

export class ConflitoDeVersaoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConflitoDeVersaoError";
  }
}
