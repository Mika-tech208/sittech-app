// DIAGNÓSTICO DE SATURAÇÃO de um posto — regra explícita e determinística. Pura. Nunca usa funcionário.
//
// Motivos (um posto pode ter vários; o PRIMÁRIO segue a precedência abaixo):
//   1 SATURADO_POR_MAQUINA    todos os postos (máquinas SELECIONADAS e disponíveis) já estão ocupados ⇒ +1 pessoa vale 0 (a seleção da Previsão é absoluta)
//   2 SATURADO_POR_PESSOA     há máquina livre com valor marginal > 0, mas não há pessoa elegível livre no período
//   3 SATURADO_POR_TEMPO      é o último período do horizonte (ou a cadeia à frente não cabe nos períodos restantes) e +1 pessoa/máquina não vira peça final
//   4 SATURADO_POR_WIP        há posto/pessoa, mas falta material/WIP para a etapa produzir
//   5 SATURADO_POR_DOWNSTREAM a etapa produz, mas o resto da cadeia (capacidade/posto à frente) não absorve
//   6 SATURADO_POR_DEMANDA    a demanda final da semana já está coberta (meta atendida ou capacidade dos períodos seguintes cobre todo o material)
// Precedência = ordem acima: o primeiro motivo verdadeiro é o primário (explica por que mais uma pessoa NÃO ajuda); os demais seguem em `motivos`.
export type MotivoSaturacao = "SATURADO_POR_MAQUINA" | "SATURADO_POR_PESSOA" | "SATURADO_POR_TEMPO" | "SATURADO_POR_WIP" | "SATURADO_POR_DOWNSTREAM" | "SATURADO_POR_DEMANDA";
export const PRECEDENCIA_SATURACAO: MotivoSaturacao[] = ["SATURADO_POR_MAQUINA", "SATURADO_POR_PESSOA", "SATURADO_POR_TEMPO", "SATURADO_POR_WIP", "SATURADO_POR_DOWNSTREAM", "SATURADO_POR_DEMANDA"];

export interface EntradaSaturacao {
  postosOcupados: number;
  postosMaximos: number;
  pessoasLivres: number;
  /** valor (R$) de +1 pessoa quando HÁ máquina livre (0 se não há) */
  valorMaisUmaPessoa: number;
  /** valor (R$) de +1 máquina, INFORMATIVO */
  valorMaisUmaMaquina: number;
  /** períodos que ainda existem DEPOIS deste até o fim do horizonte */
  periodosApos: number;
  etapaFinal: boolean;
  /** com TODOS os postos ocupados a etapa não produz a capacidade das máquinas por falta de material (entrada ≤ produção) */
  faltaMaterial: boolean;
  /** com todos os postos a etapa não produz a capacidade, havendo material: o que está à frente (ou a demanda do nó) limita */
  limitadaAFrente: boolean;
  /** meta final do produto já atendida pelo plano, ou capacidade futura cobre o material da semana (mais produção agora só antecipa) */
  demandaCoberta: boolean;
}

export interface ResultadoSaturacao { primaria: MotivoSaturacao | null; motivos: MotivoSaturacao[]; explicacao: string }

const EPS = 1e-6;
const TEXTO: Record<MotivoSaturacao, string> = {
  SATURADO_POR_MAQUINA: "todas as máquinas selecionadas na Previsão e disponíveis já estão ocupadas (+1 pessoa = R$ 0; +1 máquina não é recomendável)",
  SATURADO_POR_PESSOA: "há máquina livre com valor, mas não há pessoa elegível livre no período",
  SATURADO_POR_TEMPO: "último período do horizonte: mais produção agora não chega ao produto final até sexta",
  SATURADO_POR_WIP: "falta material/WIP para a etapa produzir mais",
  SATURADO_POR_DOWNSTREAM: "o resto da cadeia (capacidade à frente) não absorve mais",
  SATURADO_POR_DEMANDA: "a demanda final da semana já está coberta (a capacidade dos demais períodos cobre o material)",
};

export function classificarSaturacao(e: EntradaSaturacao): ResultadoSaturacao {
  const cond: Record<MotivoSaturacao, boolean> = {
    SATURADO_POR_MAQUINA: e.postosOcupados >= e.postosMaximos,
    SATURADO_POR_PESSOA: e.postosOcupados < e.postosMaximos && e.pessoasLivres <= 0 && e.valorMaisUmaPessoa > EPS,
    SATURADO_POR_TEMPO: e.periodosApos <= 0 && !e.etapaFinal && e.valorMaisUmaPessoa <= EPS && e.valorMaisUmaMaquina <= EPS,
    SATURADO_POR_WIP: e.faltaMaterial && e.valorMaisUmaPessoa <= EPS && e.valorMaisUmaMaquina <= EPS,
    SATURADO_POR_DOWNSTREAM: e.limitadaAFrente && !e.etapaFinal && e.valorMaisUmaPessoa <= EPS && e.valorMaisUmaMaquina <= EPS,
    SATURADO_POR_DEMANDA: (e.demandaCoberta || (e.limitadaAFrente && e.etapaFinal)) && e.valorMaisUmaPessoa <= EPS && e.valorMaisUmaMaquina <= EPS,
  };
  const motivos = PRECEDENCIA_SATURACAO.filter((m) => cond[m]);
  const primaria = motivos[0] ?? null;
  return { primaria, motivos, explicacao: motivos.map((m) => TEXTO[m]).join("; ") };
}
