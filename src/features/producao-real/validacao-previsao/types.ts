// Validação da Previsão V1 — tipos centrais. Reaproveita literalmente o
// vocabulário já aprovado em Desvios V1 (Evidencia) — nunca redefinido
// com outro sentido. Nenhuma fórmula oficial mora aqui.

import type { Evidencia } from "@/features/producao-real/desvios/types";
import type { FiltrosIndicadores } from "@/features/producao-real/indicadores/calculations";

export type { Evidencia };

export interface Janela {
  dataInicial: string;
  dataFinal: string;
}

export interface AmostraSimples {
  suficiente: boolean;
  periodos: number;
  minutosProdutivos: number;
  motivoInsuficiencia: string | null;
}

// Contexto usado para o fator provável (§8/§10, aprovado): produto +
// operação + máquina — nunca um OEE médio único do produto.
export interface ContextoOperacional {
  produtoId: string;
  operacaoNome: string;
  maquinaId: string;
  maquinaNome: string;
}

export interface FatorProvavelContexto {
  contexto: ContextoOperacional;
  amostra: AmostraSimples;
  performancePct: number | null;
  disponibilidadePct: number | null;
  qualidadePct: number | null;
  oeePct: number | null; // já é Performance × Disponibilidade × Qualidade / 10000 (calcularResumoIndicadores) — nunca recalculado aqui.
  performanceSustentadaAcimaDeMeta: boolean; // >100%, informativo — nunca capado.
}

// §13, aprovado — só estes 5 estados, sem score.
export type EstadoValidacao = "concluido" | "no_ritmo" | "atencao" | "inviavel_teoricamente" | "sem_estimativa";

export interface RestricaoTeorica {
  etapaOuMaquina: string | null; // nome da operação/etapa limitante, ou nome da máquina limitante (visão fábrica)
  fonte: "capacidadeMaximaSemana"; // sempre o motor já existente, nunca recalculado
}

export interface EvidenciaProdutoForaDaPrevisao {
  produtoId: string;
  produtoNome: string;
  maquinaId: string;
  maquinaNome: string;
  minutosObservados: number;
  quantidadeObservada: number;
  periodos: number;
}

export type MotivoSemProducao = "sem_programacao" | "falta_material" | "falta_operador" | "manutencao_programada" | "outro";

export interface EvidenciaSemProducao {
  motivo: MotivoSemProducao;
  maquinaNome: string;
  quantidadeRegistros: number;
}

// Estrutura reutilizável pelo futuro Sittech Intelligence (§21, aprovado)
// — nunca persistida no banco nesta etapa.
export interface ItemValidacaoPrevisao {
  itemId: string;
  produtoId: string;
  produtoNome: string;
  semanaInicio: string;

  previsto: number;
  realizadoOficial: number; // previsao_itens tipo='realizado' — fonte oficial intocada
  producaoAcabadaObservada: number; // Produção Real, good, só última etapa
  divergenciaRealizado: number; // producaoAcabadaObservada - realizadoOficial
  faltaOperacional: number; // max(previsto - producaoAcabadaObservada, 0)

  tempoRestanteHoras: number;

  capacidadeTeoricaRestante: number;
  capacidadeProvavelRestante: number | null; // null = indisponível (amostra insuficiente)
  fatoresProvaveisUsados: FatorProvavelContexto[]; // contextos produto+operação+máquina que compuseram o fator (§8)

  projecaoFinal: number | null; // só quando capacidadeProvavelRestante !== null
  deficitProjetado: number | null;

  estado: EstadoValidacao;
  confianca: "calculado" | "estimativa" | "indisponivel";

  restricaoTeorica: RestricaoTeorica | null;
  restricoesObservadas: Evidencia[];

  wipLimitacaoAplicavel: boolean; // sempre true quando o roteiro tem >1 etapa — sinaliza a aproximação conservadora (§7)

  filtrosDrillDown: FiltrosIndicadores;
}

export interface RecursoPressionado {
  maquinaId: string;
  maquinaNome: string;
  horasRestantes: number;
  horasNecessariasRestantes: number;
  pctUso: number; // sem teto — mesma regra de calcularAnaliseCapacidadeSemanal
  gargalo: boolean;
}

export interface ResultadoValidacaoPrevisao {
  semanaInicio: string;
  tempoRestanteHoras: number;
  itens: ItemValidacaoPrevisao[];
  recursosPressionados: RecursoPressionado[];
  // Produção não programada (§15) — sempre visão da semana/fábrica, nunca
  // atribuída a um item específico da previsão (o produto, por
  // definição, não está em nenhum item previsto).
  produtosForaDaPrevisao: EvidenciaProdutoForaDaPrevisao[];
  // Sem produção (§16) — também sempre visão da semana/fábrica: o status
  // 'sem_producao' tem produto_id NULL por design (não existe produto
  // associado), então não há como atribuir a um item específico.
  evidenciasSemProducao: EvidenciaSemProducao[];
}
