// DEMANDA FUTURA da próxima semana por produto (PURO, sem hardcode por produto). Base do TETO DE ANTECIPAÇÃO e do VALOR FUTURO.
// Fonte, em ordem de prioridade: (a) Previsão da próxima semana (se tiver itens), (b) pedido/demanda conhecida, (c) histórico recorrente das Previsões das últimas
// semanas (qtd mediana das últimas ocorrências × frequência × fator de maturidade × fator de dias produtivos), (d) configuração explícita de produto recorrente.
// Produto ausente das duas últimas semanas = descontinuado (0). Nada aqui lê PROD; os dados entram por parâmetro.
export interface PrevistoHistorico { semana: string; produtoId: string; quantidade: number }
export type FonteDemandaFutura = "previsao_proxima" | "pedido" | "historico" | "configuracao" | "nenhuma";
export type ConfiancaDemanda = "alta" | "media" | "baixa";

export interface EntradaDemandaFutura {
  /** produtos que existem hoje (Previsão atual) — só estes podem ser antecipados (rota e máquinas conhecidas) */
  produtos: string[];
  /** segunda-feira da próxima semana ("YYYY-MM-DD") */
  proximaSemana: string;
  /** itens PREVISTOS da Previsão da próxima semana; `null` = não existe Previsão; `[]` = existe vazia (casca) */
  previsaoProxima: { produtoId: string; quantidade: number }[] | null;
  pedidos?: { produtoId: string; quantidade: number }[];
  /** itens previstos das semanas anteriores (inclui a semana atual) */
  historico: PrevistoHistorico[];
  /** produto recorrente declarado: quantidade semanal esperada */
  configuracao?: Record<string, number>;
  /** nº de semanas olhadas para trás (default 6) */
  janelaSemanas?: number;
  /** dias produtivos da próxima semana / dias produtivos de uma semana típica (default 5) → fator de escala da demanda histórica */
  diasProdutivosProxima?: number;
  diasProdutivosTipicos?: number;
}

export interface DemandaFuturaProduto {
  produtoId: string;
  fonte: FonteDemandaFutura;
  quantidade: number;
  confianca: ConfiancaDemanda;
  detalhe: string;
}

const mediana = (v: number[]) => { const o = [...v].sort((a, b) => a - b); const n = o.length; return n === 0 ? 0 : n % 2 ? o[(n - 1) / 2] : (o[n / 2 - 1] + o[n / 2]) / 2; };
const somaDias = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

export function demandaFutura(e: EntradaDemandaFutura): DemandaFuturaProduto[] {
  const janela = e.janelaSemanas ?? 6;
  const fDias = (e.diasProdutivosProxima ?? e.diasProdutivosTipicos ?? 5) / Math.max(1, e.diasProdutivosTipicos ?? 5);
  const semanasJanela = Array.from({ length: janela }, (_, i) => somaDias(e.proximaSemana, -7 * (i + 1))).reverse(); // as `janela` semanas imediatamente anteriores
  const temPrevisaoComItens = e.previsaoProxima !== null && e.previsaoProxima.length > 0;
  return [...e.produtos].sort().map((produtoId): DemandaFuturaProduto => {
    if (temPrevisaoComItens) {
      const q = e.previsaoProxima!.filter((i) => i.produtoId === produtoId).reduce((s, i) => s + i.quantidade, 0);
      return { produtoId, fonte: "previsao_proxima", quantidade: q, confianca: "alta", detalhe: "Previsão da próxima semana" };
    }
    const ped = (e.pedidos ?? []).filter((i) => i.produtoId === produtoId).reduce((s, i) => s + i.quantidade, 0);
    if (ped > 0) return { produtoId, fonte: "pedido", quantidade: ped, confianca: "media", detalhe: "pedido/demanda conhecida" };
    const obs = semanasJanela.flatMap((s) => { const q = e.historico.filter((h) => h.semana === s && h.produtoId === produtoId).reduce((t, h) => t + h.quantidade, 0); return q > 0 ? [{ s, q }] : []; });
    const ultimas2 = semanasJanela.slice(-2);
    if (obs.length > 0 && obs.some((o) => ultimas2.includes(o.s))) {
      const primeira = obs[0].s;
      const idade = semanasJanela.filter((s) => s >= primeira).length; // semanas desde a 1ª aparição dentro da janela
      const freq = obs.length / Math.max(1, idade);
      const maturidade = Math.min(1, obs.length / 3);
      const q = mediana(obs.slice(-3).map((o) => o.q)) * freq * maturidade * fDias;
      return {
        produtoId, fonte: "historico", quantidade: Math.round(q), confianca: obs.length >= 3 && freq >= 0.8 ? "media" : "baixa",
        detalhe: `${obs.length} de ${idade} semanas com item (freq ${(freq * 100).toFixed(0)}%), mediana das últimas ${Math.min(3, obs.length)} ocorrências × freq × maturidade ${maturidade.toFixed(2)} × dias ${fDias.toFixed(2)}`,
      };
    }
    const cfg = e.configuracao?.[produtoId];
    if (cfg && cfg > 0) return { produtoId, fonte: "configuracao", quantidade: Math.round(cfg * fDias), confianca: "baixa", detalhe: "produto recorrente configurado" };
    return { produtoId, fonte: "nenhuma", quantidade: 0, confianca: "baixa", detalhe: obs.length ? "descontinuado (ausente nas 2 últimas semanas)" : "sem histórico" };
  });
}
