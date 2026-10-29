// TETO DE ANTECIPAÇÃO (PURO) por produto/etapa(par): quanto de WIP adicional ainda faz sentido produzir hoje para a próxima semana. Sem estoque infinito.
// Considera: demanda futura estimada, WIP já disponível, o que já foi antecipado, capacidade do downstream, gargalo da próxima semana e nº de períodos antecipados.
export interface EntradaTeto {
  /** peças que a próxima semana precisa passar por este par (demanda futura estimada convertida ao par) */
  demandaFuturaNoPar: number;
  /** WIP físico/simulado já disponível no par (antes da antecipação) */
  wipDisponivel: number;
  /** peças já antecipadas neste par por decisões anteriores (mesmo cálculo) */
  jaAntecipado?: number;
  /** capacidade do posto de DESTINO do par na próxima semana (peças) */
  capacidadeDownstreamProx: number;
  /** capacidade do gargalo da cadeia do produto na próxima semana (peças): não adianta empilhar acima do que o gargalo escoa */
  capacidadeGargaloProx?: number;
  /** períodos já antecipados neste par e o máximo permitido (cada período antecipado consome 1 posto-período que poderia ser outra coisa) */
  periodosAntecipados?: number;
  maxPeriodosAntecipados?: number;
  /** peças por posto-período do ORIGEM do par (para converter limite de períodos em peças) */
  pecasPorPeriodoOrigem?: number;
}
export type LimitadoPor = "demanda_futura" | "capacidade_downstream" | "gargalo_proxima_semana" | "periodos_antecipados" | "wip_ja_cobre";
export interface ResultadoTeto { teto: number; limitadoPor: LimitadoPor; detalhe: Record<string, number> }

export function tetoAntecipacao(e: EntradaTeto): ResultadoTeto {
  const ja = Math.max(0, e.jaAntecipado ?? 0), wip = Math.max(0, e.wipDisponivel);
  const porDemanda = Math.max(0, e.demandaFuturaNoPar);
  const porDownstream = Math.max(0, e.capacidadeDownstreamProx);
  const porGargalo = e.capacidadeGargaloProx === undefined ? Number.POSITIVE_INFINITY : Math.max(0, e.capacidadeGargaloProx);
  const alvo = Math.min(porDemanda, porDownstream, porGargalo); // WIP total útil no par
  const limitadoPor: LimitadoPor = alvo === porGargalo && porGargalo <= porDemanda && porGargalo <= porDownstream ? "gargalo_proxima_semana" : alvo === porDownstream && porDownstream < porDemanda ? "capacidade_downstream" : "demanda_futura";
  let teto = Math.max(0, alvo - wip - ja);
  let lim: LimitadoPor = teto === 0 && alvo > 0 ? "wip_ja_cobre" : limitadoPor;
  if (e.maxPeriodosAntecipados !== undefined && e.pecasPorPeriodoOrigem !== undefined) {
    const restantes = Math.max(0, e.maxPeriodosAntecipados - (e.periodosAntecipados ?? 0));
    const porPeriodos = restantes * Math.max(0, e.pecasPorPeriodoOrigem);
    if (porPeriodos < teto) { teto = porPeriodos; lim = "periodos_antecipados"; }
  }
  return { teto, limitadoPor: lim, detalhe: { demanda: porDemanda, downstream: porDownstream, gargalo: Number.isFinite(porGargalo) ? porGargalo : -1, wip, jaAntecipado: ja } };
}
