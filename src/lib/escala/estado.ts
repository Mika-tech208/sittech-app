// Contratos entre o banco (adaptador Supabase) e o orquestrador do servidor.
// Tudo aqui é dado puro — o motor (src/features/escala) nunca vê Supabase.

import type { ParametrosEscala } from "@/features/escala/parametros";
import type { AlertaEscala, AlocacaoEscala, HistoricoEquidadeFuncionario, PeriodoEscala } from "@/features/escala/types";
import type { ProximaSemana } from "@/features/escala/wip";
import type { EntradaWip } from "@/features/escala/wipSaldo";
import type { ContagemFisicaPar, DiagnosticoItem, ParLegado } from "@/features/escala/fluxo/tipos";
import type { ApontamentoReal } from "@/features/escala/producaoReal";

export interface AvisoMontagem {
  tipo: "etapa_sem_maquina" | "sem_pools" | "sem_funcionarios_produtivos" | "selecao_maquina_invalida";
  produtoId?: string;
  etapaId?: string;
  operacaoId?: string; // selecao_maquina_invalida: operação da etapa no roteiro atual
  maquinaId?: string; // selecao_maquina_invalida: máquina selecionada na Previsão que NÃO é elegível nessa etapa
  semanaInicio?: string;
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
  // Assinatura dos alertas do ÚLTIMO recálculo gravado desta semana (resumo.assinaturaAlertas). Ausente/null = não conhecida => nunca é no-op (comportamento anterior).
  ultimaAssinaturaAlertas?: string | null;
  // ESCALA INTELIGENTE (fluxo): presente SOMENTE quando o modo EFETIVO da semana é sombra/ativo (producao_real_modo + producao_real_semanas_ativas).
  // Ausente = desligado: o caminho atual roda sem nenhuma diferença (nem o núcleo do fluxo é chamado).
  producaoReal?: EstadoProducaoReal;
}

export interface EstadoProducaoReal {
  modoEfetivo: "sombra" | "ativo";
  limiar: number | null; // producao_real_limiar_estabilidade (θ em peças finais); null = derivado pelo núcleo
  paresLegado: ParLegado[]; // producao_real_pares_legado
  contagensFisicas?: ContagemFisicaPar[]; // producao_real_contagens_fisicas (itens bem formados; o núcleo revalida)
  contagensFisicasDescartadas?: DiagnosticoItem[]; // itens malformados dessa chave (ignorados, com diagnóstico)
  apontamentos: ApontamentoReal[]; // TODAS as linhas de apontamento da semana (produzindo e sem_producao, com motivo e carimbo)
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
  // Só com o fluxo em modo efetivo ativo/sombra: o que o fluxo fez neste recálculo (ausente com `desligado`).
  fluxo?: { modo: "sombra" | "ativo"; resultado: "ok" | "fallback" | "erro"; usado: boolean };
}

export class ConflitoDeVersaoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConflitoDeVersaoError";
  }
}
