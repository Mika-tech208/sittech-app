// Contratos entre o banco (adaptador Supabase) e o orquestrador do servidor.
// Tudo aqui é dado puro — o motor (src/features/escala) nunca vê Supabase.

import type { ParametrosEscala } from "@/features/escala/parametros";
import type { AlertaEscala, AlocacaoEscala, HistoricoEquidadeFuncionario, PeriodoEscala } from "@/features/escala/types";
import type { ProximaSemana } from "@/features/escala/wip";
import type { EntradaWip } from "@/features/escala/wipSaldo";
import type { EstruturaProduto } from "@/features/rotas/tipos";

export interface AvisoMontagem {
  tipo: "etapa_sem_maquina" | "sem_pools" | "sem_funcionarios_produtivos" | "selecao_maquina_invalida" | "producao_presumida";
  produtoId?: string;
  etapaId?: string;
  operacaoId?: string; // selecao_maquina_invalida: operação da etapa no roteiro atual
  maquinaId?: string; // selecao_maquina_invalida: máquina selecionada na Previsão que NÃO é elegível nessa etapa
  semanaInicio?: string;
  pecas?: number; // producao_presumida: peças dos períodos passados SEM apontamento que o replanejamento de produto de rotas presumiu como produzidas (não confirmadas)
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
  registradaEm?: string; // ISO (criado_em): permite enxergar só o que existia em um corte (modo sombra)
  // Atraso em aberto: o funcionário ainda não chegou; horarioFim é NULL e a indisponibilidade vai de horarioInicio até o fim do dia
  // (nunca é lido como "dia inteiro"). Fechado = janela exata [horarioInicio, horarioFim).
  emAberto?: boolean;
  // Mudanças posteriores (append-only, ausencia_funcionario_historico): permitem reconstruir o que a ausência era em um corte.
  historico?: AusenciaHistorico[];
}

// Linha do tempo de situação do funcionário (funcionario_situacao_historico): bitemporal (efetivo x registrado)
export interface SituacaoFuncionarioEvento {
  acao: "desativado" | "reativado";
  efetivoEm: string; // ISO
  registradoEm: string; // ISO
  ativoAntes: boolean;
  ativoDepois: boolean;
}

export interface AusenciaHistorico {
  alteradoEm: string; // ISO
  // estado ANTES desta mudança; null quando a linha é a abertura (a ausência ainda não existia)
  anterior: { horarioInicio: string | null; horarioFim: string | null; emAberto: boolean } | null;
}

export interface IndisponibilidadeBruta {
  maquinaId: string;
  desde: string; // ISO
  liberadaEm: string | null; // ISO
}

// Produtos de ROTAS (M3) presentes na semana. Ausente = semana só de produtos lineares (caminho legado, sem nenhuma mudança). Só é preenchido quando a Previsão da semana está no modelo de rotas.
export interface RotasDoEstado {
  estruturas: Record<string, EstruturaProduto>;                       // produtoId -> estrutura (rotas, convergência, pool comum, etapa final explícita)
  custoHoraPorOperacao?: Record<string, number>; custoHoraPadrao?: number;   // opcional: sem custo a divisão desempata pela preferência da rota
  toleranciaEstabilidade?: number;                                     // opcional (SEM valor = estabilidade desligada)
  divisaoAnterior?: Record<string, Record<string, number>>;            // produtoId -> rota -> entrega da rodada anterior
  maxRodadas?: number;                                                 // padrão 3
  // REPLANEJAMENTO no meio da semana: Produção Real BOA acumulada da semana por etapa (apontamentos). Etapa sem chave = ainda sem apontamento ⇒ vale o planejado congelado.
  producaoReal?: Record<string, number>;
  // Cobertura dos apontamentos da semana (granular, vem de rotas_cobertura_apontamentos): separa produção CONFIRMADA (apontamento 'produzindo'), SEM PRODUÇÃO (apontamento 'sem_producao')
  // e PRESUMIDA (o período passou e não há apontamento algum). Presumida preserva o plano congelado para não replanejar de forma caótica, mas NUNCA é produção real confirmada.
  cobertura?: { data: string; periodoId: string; maquinaId: string; etapaId: string | null; status: string; boas: number }[];
  // WIP inicial confirmado por produto (só com o WIP ativo): saldo do pool (pronto para a 1ª etapa comum) no início da semana
  wipInicial?: Record<string, { pool?: number; entreEtapasComuns?: Record<string, number> }>;
}

export interface EstadoBruto {
  previsaoId: string;
  semanaInicio: string;
  diasProdutivos: string[]; // datas ISO ativas na Previsão
  periodosAtuais: PeriodoEscala[];
  diasExistentes: DiaExistente[];
  equipeProdutiva: { funcionarioId: string; nome?: string; ativo: boolean }[]; // só quem foi marcado produtivo
  // eventos de ativação/desativação por funcionário (todos os que têm linha do tempo): permitem reconstruir `ativo` em um corte passado (sombra sem hindsight)
  situacaoFuncionarios?: Record<string, SituacaoFuncionarioEvento[]>;
  itens: ItemPrevistoBruto[];
  etapas: EtapaBruta[];
  maquinasIndisponiveisPrevisao: string[];
  maquinasInativas: string[];
  ausencias: AusenciaBruta[];
  indisponibilidades: IndisponibilidadeBruta[];
  alocacoes: AlocacaoEscala[]; // todas as existentes nos dias da escala
  nomesOperacao: Record<string, string>;
  nomesMaquinas?: Record<string, string>; // para rótulos do diagnóstico de cobertura
  operacaoDaMaquina?: Record<string, string>; // maquinas.operacao_id: elegibilidade por operação quando a etapa não lista máquinas (regra de calcularMaquinasDaEtapa)
  nomesProdutos?: Record<string, string>;
  // Equidade: histórico agregado da janela (escala realmente gravada, semanas ANTERIORES a esta).
  historicoEquidade?: HistoricoEquidadeFuncionario[];
  // Parâmetros da Escala (escala_parametros) — entradas canônicas do motor. Ausente = padrões (WIP desligado).
  parametros?: Pick<ParametrosEscala, "wipModo" | "wipDiasLimite"> & Partial<ParametrosEscala>;
  // Necessidade da PRÓXIMA semana por produto, só se a Previsão dela estiver salva (limite de estoque, regra A). null = não existe.
  proximaSemana?: ProximaSemana | null;
  // Controle de estoque intermediário (Fase 3): dados BRUTOS (controles, ajustes, confirmações, Produção Real, fotos, previsões).
  // Só carregado com wip_modo = "ativo". `hoje` é derivado do relógio da execução. Ausente/vazio = nenhum saldo (comportamento anterior).
  wipControle?: Omit<EntradaWip, "hoje">;
  rotas?: RotasDoEstado;
}

export interface DiaParaAplicar {
  data: string;
  versao_base: number | null;
  periodos_snapshot: PeriodoEscala[];
}

// Foto de abertura da semana (gravada UMA vez, nunca recalculada) — o orquestrador persiste antes de aplicar a escala.
export interface SnapshotWipParaGravar {
  controleId: string;
  saldoEstimado: number;
  saldoConfirmadoDisponivel: number;
  saldoAlocado: number;
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
