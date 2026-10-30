// TETO DE ANTECIPAÇÃO (PURO) por produto × ponto do fluxo (par origem→seguinte): quanto de WIP adicional ainda faz sentido produzir hoje para a próxima semana. Sem estoque infinito.
//
// TETO DINÂMICO (arquitetura final) = MIN de seis fatores, menos o que já existe:
//   (a) demanda futura válida no par;            (b) capacidade do downstream na próxima semana;   (c) necessidade/capacidade do gargalo futuro da cadeia;
//   (d) WIP já existente (e o já antecipado) — é SUBTRAÍDO do alvo;
//   (e) limite/cobertura de estoque: cobertura máxima em DIAS DE DEMANDA × demanda diária  ⚠ PARÂMETRO PROVISÓRIO (explícito, nunca escondido);
//   (f) capacidade que REALMENTE será consumida na próxima semana (produção planejada do destino no plano-base da próxima semana).
// TETO PROVISÓRIO DE SEGURANÇA (sombra): a fórmula antiga (a, b, c, d) limitada a `maxPeriodosAntecipados` períodos do posto de origem (padrão 6). NÃO é regra de negócio.
// TETO EFETIVO em sombra = min(dinâmico, provisório). O resultado diz QUAL fator limita cada par e quantos períodos equivalentes o teto representa.
export interface EntradaTeto {
  /** (a) peças que a próxima semana precisa passar por este par (demanda futura válida convertida ao par) */
  demandaFuturaNoPar: number;
  /** (d) WIP físico/simulado já disponível no par (antes da antecipação) */
  wipDisponivel: number;
  /** (d) peças já antecipadas neste par por decisões anteriores (mesmo cálculo) */
  jaAntecipado?: number;
  /** (b) capacidade do posto de DESTINO do par na próxima semana (peças) */
  capacidadeDownstreamProx: number;
  /** (c) capacidade do gargalo da cadeia do produto na próxima semana (peças) */
  capacidadeGargaloProx?: number;
  /** (e) cobertura máxima de estoque em dias de demanda ⚠ PROVISÓRIO; exige `diasProdutivosProx` */
  coberturaMaxDias?: number;
  diasProdutivosProx?: number;
  /** (f) peças que o destino realmente consumirá na próxima semana (plano-base da próxima semana) */
  consumoProxSemana?: number;
  /** TETO PROVISÓRIO: períodos já antecipados neste par e o máximo permitido (padrão de segurança 6) */
  periodosAntecipados?: number;
  maxPeriodosAntecipados?: number;
  /** peças por posto-período do ORIGEM do par (converte teto em períodos equivalentes) */
  pecasPorPeriodoOrigem?: number;
}
export type LimitadoPor =
  | "demanda_futura" | "capacidade_downstream" | "gargalo_proxima_semana" | "cobertura_estoque" | "consumo_proxima_semana"
  | "wip_ja_cobre" | "periodos_antecipados";
export interface ResultadoTeto {
  /** teto EFETIVO em sombra = min(dinâmico, provisório) — mantido como `.teto` por compatibilidade */
  teto: number;
  limitadoPor: LimitadoPor;
  tetoDinamico: number;
  limitadoPorDinamico: LimitadoPor;
  tetoProvisorio: number;
  /** alvo de WIP total útil no par por fator (antes de subtrair o WIP): quanto cada fator permitiria */
  fatores: { demanda: number; downstream: number; gargalo: number; cobertura: number | null; consumo: number | null };
  periodosEquivalentes: { dinamico: number | null; provisorio: number | null; efetivo: number | null };
  detalhe: Record<string, number>;
}

const INF = Number.POSITIVE_INFINITY;
export function tetoAntecipacao(e: EntradaTeto): ResultadoTeto {
  const ja = Math.max(0, e.jaAntecipado ?? 0), wip = Math.max(0, e.wipDisponivel);
  const a = Math.max(0, e.demandaFuturaNoPar);
  const b = Math.max(0, e.capacidadeDownstreamProx);
  const c = e.capacidadeGargaloProx === undefined ? INF : Math.max(0, e.capacidadeGargaloProx);
  const cobertura = e.coberturaMaxDias !== undefined && e.diasProdutivosProx !== undefined && e.diasProdutivosProx > 0 ? (a / e.diasProdutivosProx) * Math.max(0, e.coberturaMaxDias) : null;
  const eF = cobertura === null ? INF : cobertura;
  const f = e.consumoProxSemana === undefined ? INF : Math.max(0, e.consumoProxSemana);
  // ordem de desempate quando dois fatores empatam: a, b, c, f, e
  const ordem: [LimitadoPor, number][] = [["demanda_futura", a], ["capacidade_downstream", b], ["gargalo_proxima_semana", c], ["consumo_proxima_semana", f], ["cobertura_estoque", eF]];
  const alvoDin = Math.min(...ordem.map(([, v]) => v));
  const fatorDin = ordem.find(([, v]) => v === alvoDin)![0];
  const tetoDin = Math.max(0, alvoDin - wip - ja);
  const limDin: LimitadoPor = tetoDin === 0 && alvoDin > 0 ? "wip_ja_cobre" : fatorDin;
  // provisório (fórmula antiga a,b,c,d + limite de períodos)
  const alvoProv = Math.min(a, b, c);
  let tetoProv = Math.max(0, alvoProv - wip - ja);
  const ppo = e.pecasPorPeriodoOrigem !== undefined ? Math.max(0, e.pecasPorPeriodoOrigem) : undefined;
  let limProv: LimitadoPor = tetoProv === 0 && alvoProv > 0 ? "wip_ja_cobre" : alvoProv === c && c <= a && c <= b ? "gargalo_proxima_semana" : alvoProv === b && b < a ? "capacidade_downstream" : "demanda_futura";
  if (e.maxPeriodosAntecipados !== undefined && ppo !== undefined) {
    const porPeriodos = Math.max(0, e.maxPeriodosAntecipados - (e.periodosAntecipados ?? 0)) * ppo;
    if (porPeriodos < tetoProv) { tetoProv = porPeriodos; limProv = "periodos_antecipados"; }
  }
  // efetivo = min(dinâmico, provisório)
  const efetivo = Math.min(tetoDin, tetoProv);
  const limEf: LimitadoPor = efetivo === tetoDin && (tetoDin <= tetoProv) ? limDin : limProv;
  const peq = (x: number) => (ppo && ppo > 0 ? x / ppo : null);
  return {
    teto: efetivo, limitadoPor: limEf, tetoDinamico: tetoDin, limitadoPorDinamico: limDin, tetoProvisorio: tetoProv,
    fatores: { demanda: a, downstream: b, gargalo: Number.isFinite(c) ? c : -1, cobertura: cobertura, consumo: Number.isFinite(f) ? f : null },
    periodosEquivalentes: { dinamico: peq(tetoDin), provisorio: peq(tetoProv), efetivo: peq(efetivo) },
    detalhe: { demanda: a, downstream: b, gargalo: Number.isFinite(c) ? c : -1, wip, jaAntecipado: ja },
  };
}
