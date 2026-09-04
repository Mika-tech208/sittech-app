// Visão Geral da Produção Real V1 — tipos centrais. Estrutura pensada
// pra futuro consumo pelo Sittech Intelligence (§16, aprovado) — mas
// nenhum campo aqui é calculado de novo: tudo vem, sem exceção, dos
// motores já existentes (Indicadores, Paradas, Desvios, Validação da
// Previsão, ocorrências de máquina). Nenhuma fórmula paralela.

import type { IncidenteDesvio } from "@/features/producao-real/desvios/types";
import type { EstadoValidacao } from "@/features/producao-real/validacao-previsao/types";
import type { FiltrosIndicadores } from "@/features/producao-real/indicadores/calculations";

export interface JanelaRotulada {
  dataInicial: string;
  dataFinal: string;
  rotulo: string; // ex.: "Semana atual até agora" — nunca deixar implícito qual janela um número usa.
}

// Faixa 1 — Saúde da fábrica (§5). SEMPRE semana atual até agora
// (calcularJanelaOperacional().atual, mesma janela de Desvios V1).
export interface FactoryHealth {
  janela: JanelaRotulada;
  performancePct: number | null; // sem teto — pode passar de 100.
  disponibilidadePct: number | null; // conceito oficial atual: só períodos apontados.
  qualidadePct: number | null;
  oeePct: number | null;
  minutosParadosTotais: number;
  temDados: boolean; // false = nenhum apontamento na janela — nunca virar 0%/0min fictício na UI.
}

// Faixa 2 — Situação da semana (§6/§7). Reaproveita
// ResultadoValidacaoPrevisao inteiro — nunca soma peças entre produtos.
export interface MaiorDeficitSemana {
  produtoId: string;
  produtoNome: string;
  deficitProjetado: number;
}

export interface ForecastSemana {
  temPrevisao: boolean; // false = nenhuma previsão lançada pra esta semana.
  porEstado: Record<EstadoValidacao, number>;
  maiorDeficit: MaiorDeficitSemana | null; // sempre 1 produto — nunca somado entre produtos.
  filtrosDrillDown: FiltrosIndicadores;
}

// Faixa 3 — Agora (§8). Fonte: ocorrencias_maquina, encerrada_em IS NULL.
export interface OcorrenciaAbertaResumo {
  id: string;
  maquinaId: string;
  maquinaNome: string;
  motivoNome: string;
  descricao: string;
  abertaEm: string;
  tempoDecorridoRotulo: string; // já formatado (formatarTempoDecorrido), calculado no momento da geração do objeto.
}

// Faixa 3 — Principais atenções (§9). IncidenteDesvio já priorizado por
// gerarFilaDesvios — nenhum score novo, nenhuma reordenação aqui.
export type AttentionItem = IncidenteDesvio;

// Faixa 5 — Paradas (§10). Só funções oficiais de Paradas V1 — nunca
// misturar minutos/R$/peças no mesmo número.
export interface DowntimeResumo {
  janela: JanelaRotulada;
  temDados: boolean;
  minutosParadosTotal: number;
  principalMotivo: { motivoNome: string; minutos: number } | null;
  maquinaMaisAfetada: { maquinaNome: string; minutos: number } | null;
  capacidadePerdidaTotal: number | null; // peças — campo separado, nunca somado a minutos.
}

// Faixa 6 — Recurso mais pressionado (§11). SOMENTE o item mais
// pressionado de recursosPressionados — pctUso NUNCA capado em 100.
export interface RecursoPressionadoResumo {
  maquinaId: string;
  maquinaNome: string;
  horasNecessariasRestantes: number;
  horasRestantes: number;
  pctUso: number;
  gargalo: boolean;
}

export interface DataQuality {
  apontamentosSemanaAtual: boolean; // false = "Sem dados no período".
  previsaoLancada: boolean;
  ocorrenciasCarregadas: boolean;
}

export interface DrillDownVisaoGeral {
  produtividade: FiltrosIndicadores; // janela semana atual, sem produto/máquina — "Ver Produtividade".
  paradas: FiltrosIndicadores; // idem — "Ver Paradas".
}

// Estrutura completa — futuro objeto pra Sittech Intelligence (§16),
// nunca persistida nesta etapa.
export interface ResultadoVisaoGeralProducaoReal {
  geradoEm: string; // ISO — só informativo, nunca usado em cálculo.
  factoryHealth: FactoryHealth;
  forecast: ForecastSemana;
  openOccurrences: OcorrenciaAbertaResumo[];
  attentionItems: AttentionItem[];
  downtime: DowntimeResumo;
  pressuredResource: RecursoPressionadoResumo | null;
  dataQuality: DataQuality;
  drillDown: DrillDownVisaoGeral;
}
