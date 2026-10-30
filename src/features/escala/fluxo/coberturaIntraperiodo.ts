// COBERTURA DE MATERIAL INTRAPERÍODO — núcleo PURO, DESLIGADO por padrão (nada no motor chama isto sem a opção `coberturaIntraperiodo`).
//
// Pergunta que responde: "se eu puser pessoa(s) neste posto durante o período INTEIRO, o material dura até o fim?".
//
//   materialDisponivel(τ) = WIP inicial + (taxa upstream) · τ          (upstream uniforme; `atrasoUpstreamMin` opcional)
//   consumo(τ)            = (taxa downstream) · τ
//   exige-se  materialDisponivel(τ) ≥ consumo(τ)·(1 + margem)  para TODO τ ∈ [0, duração].
//
// Como as duas curvas são lineares (por trechos, se houver atraso), o mínimo da folga ocorre nos extremos: basta testar τ = 0, τ = atraso e τ = duração.
// Isto reproduz exatamente o exemplo do usuário: upstream 700/h, downstream 1000/h, 80 min ⇒ bufferNecessario = 300/h × 80/60 h = 400 peças.
//
// Regras desta função:
//  • NÃO fracionar a pessoa dentro do período: o posto é válido pelo período inteiro ou não é válido (`sustentavel`);
//  • `margem` NUNCA tem valor embutido: quem chama passa um número derivado dos dados (ver `margemPorConfianca`); ausente = 0;
//  • menor confiança ⇒ margem maior (conservador), via `margemPorConfianca` fornecida por quem chama (calibrada com dados, não hardcoded aqui);
//  • período anterior sem apontamento não vira "produção planejada": o chamador entrega o PISO (lo) do WIP — esta função não supõe nada.

export type ConfiancaCobertura = "alta" | "media" | "baixa";

export interface EntradaCoberturaPosto {
  /** duração do período (min) */
  duracaoMin: number;
  /** material já parado na ENTRADA do posto no início do período (peças) — use o PISO (cenário lo) */
  wipInicial: number;
  /** peças que a(s) etapa(s) anterior(es) entregam ao longo do período (plano × f) */
  producaoUpstream: number;
  /** peças que o(s) posto(s) pedido(s) consumiriam no período inteiro (capacidade × nº de postos, já limitada pela demanda restante) */
  consumoPlanejado: number;
  /** minutos até o upstream começar a entregar (default 0 = entrega uniforme desde o início) */
  atrasoUpstreamMin?: number;
  /** fração ≥ 0 aplicada sobre o consumo (nunca embutida); default 0 */
  margem?: number;
}

export interface ResultadoCoberturaPosto {
  sustentavel: boolean;
  /** peças que o WIP inicial precisa cobrir = max(0, consumo(1+margem) − upstream), ou o pico de déficit quando há atraso */
  bufferNecessario: number;
  bufferDisponivel: number;
  /** bufferDisponivel − bufferNecessario (negativo = falta de material) */
  folga: number;
  /** minuto (desde o início do período) em que o material zera; null se dura o período todo */
  minutoEsgotamento: number | null;
  /** peças que o posto realmente conseguiria processar no período (≤ consumoPlanejado) */
  pecasViaveis: number;
  /** pecasViaveis / consumoPlanejado (1 = cobre) */
  fracaoViavel: number;
}

const EPS = 1e-9;

/** Folga mínima de material no período (peças). Negativa = falta. Mínimo nos extremos porque as curvas são lineares por trechos. */
function folgaMinima(e: EntradaCoberturaPosto, consumo: number): { folga: number; minutoEsgot: number | null } {
  const dur = Math.max(e.duracaoMin, EPS);
  const atraso = Math.min(Math.max(e.atrasoUpstreamMin ?? 0, 0), dur);
  const rd = consumo / dur; // peças/min
  const ru = atraso >= dur ? 0 : e.producaoUpstream / (dur - atraso); // upstream entrega TUDO o planejado entre `atraso` e o fim
  const material = (t: number) => e.wipInicial + ru * Math.max(0, t - atraso);
  const folgaEm = (t: number) => material(t) - rd * t;
  const pontos = [0, atraso, dur];
  let pior = Number.POSITIVE_INFINITY;
  let tPior = 0;
  pontos.forEach((t) => {
    const f = folgaEm(t);
    if (f < pior - EPS) {
      pior = f;
      tPior = t;
    }
  });
  let minuto: number | null = null;
  if (pior < -EPS) {
    // primeiro instante em que a folga cruza zero. Antes do `atraso` só há consumo (W0 − rd·τ = 0); depois, W0 + ru(τ − atraso) − rd·τ = 0.
    if (atraso > 0 && folgaEm(atraso) < -EPS) minuto = rd > EPS ? e.wipInicial / rd : 0;
    else {
      const den = rd - ru;
      minuto = den > EPS ? (e.wipInicial - ru * atraso) / den : tPior;
      minuto = Math.min(Math.max(minuto, atraso), dur);
    }
  }
  return { folga: pior, minutoEsgot: minuto };
}

export function coberturaPosto(e: EntradaCoberturaPosto): ResultadoCoberturaPosto {
  const margem = Math.max(0, e.margem ?? 0);
  const consumo = Math.max(0, e.consumoPlanejado);
  const consumoComMargem = consumo * (1 + margem);
  const wip = Math.max(0, e.wipInicial);
  const { folga, minutoEsgot } = folgaMinima({ ...e, wipInicial: wip }, consumoComMargem);
  const sustentavel = folga >= -EPS;
  // buffer necessário = quanto de WIP inicial faria a folga mínima chegar a zero
  const bufferNecessario = Math.max(0, wip - folga);
  // peças viáveis (sem margem): o que o WIP + o upstream (até o fim) permitem processar
  const pecasViaveis = Math.min(consumo, wip + Math.max(0, e.producaoUpstream));
  const frac = consumo > EPS ? pecasViaveis / consumo : 1;
  return {
    sustentavel,
    bufferNecessario,
    bufferDisponivel: wip,
    folga: wip - bufferNecessario,
    minutoEsgotamento: sustentavel ? null : minutoEsgot,
    pecasViaveis,
    fracaoViavel: frac,
  };
}

/** Maior nº de postos (cada um com capacidade `capacidadePosto` no período) que o material sustenta no período inteiro. 0 = nenhum posto é válido. */
export function maxPostosSustentaveis(e: Omit<EntradaCoberturaPosto, "consumoPlanejado">, capacidadePosto: number, postosPedidos: number): number {
  if (capacidadePosto <= EPS) return postosPedidos;
  let k = Math.max(0, Math.floor(postosPedidos));
  while (k > 0 && !coberturaPosto({ ...e, consumoPlanejado: k * capacidadePosto }).sustentavel) k--;
  return k;
}

/** Margem a aplicar para uma confiança, a partir de uma tabela FORNECIDA (calibrada com dados); confiança ausente da tabela ⇒ 0 (sem margem inventada). */
export function margemDaConfianca(confianca: ConfiancaCobertura | undefined, margemPorConfianca?: Partial<Record<ConfiancaCobertura, number>>): number {
  if (!confianca || !margemPorConfianca) return 0;
  const m = margemPorConfianca[confianca];
  return m !== undefined && Number.isFinite(m) && m > 0 ? m : 0;
}
