// FATOR DE DESEMPENHO (f) PARA O FLUXO — o mesmo f que a sombra usa (desempenho.ts: obs = Σ boas / Σ meta das linhas "produzindo" visíveis no corte, limitada a
// [0,30; 1,30], suavizada por n/(n+6); n < 3 ⇒ 1). PURO. O f entra EMBUTIDO nas metas de `entrada.pools` (como sombraCorte.ts faz): assim o simulador, a avaliação de
// qualquer plano (vigente, base, fluxo) e o próprio motor (que corta a última linha pelo restante) enxergam a MESMA capacidade efetiva, e f é aplicado UMA só vez.
// `OpcoesFluxo.fatoresEmbutidos` carrega o f para a checagem de compatibilidade do Conector legado (metas × f diferentes não tornam os pools incompatíveis).
//
// Pools FUNDIDOS (Conector: Etiquetar/Embalar comuns) recebem o MESMO f, calculado sobre o realizado dos dois membros juntos: a fábrica aponta tudo no produto
// convencional, e usar o f de cada membro separado daria f = 1 (sem amostras) ao ramo automática e capacidade nominal ao nó fundido (max dos membros).

import { desempenhoPorEtapa, fatorDesempenho } from "../desempenho";
import { visivelNoCorte, type ApontamentoReal } from "../producaoReal";
import { chavePool, type EntradaEscala } from "../types";
import { construirGrafo } from "./grafo";
import type { ParLegado } from "./tipos";

/** Último slot FECHADO (fim + fechamentoMinutos ≤ agora) limitado a aPartirDe−1; −1 se nenhum. */
export function ultimoSlotFechado(entrada: EntradaEscala, agoraMs: number, fechamentoMinutos = 10): number {
  let c = -1;
  entrada.slots.forEach((s) => { if (s.fimMs + fechamentoMinutos * 60_000 <= agoraMs) c = s.indice; });
  return Math.min(c, entrada.aPartirDe - 1);
}

/** f por pool ("produto|etapa") a partir do realizado visível no corte. Só devolve os pools com f ≠ 1 (vazio = metas nominais). `entrada.pools` deve estar NOMINAL. */
export function fatoresDeDesempenho(entrada: EntradaEscala, apontamentos: ApontamentoReal[], agoraMs: number, paresLegado: ParLegado[] = [], fechamentoMinutos = 10): Record<string, number> {
  const c = ultimoSlotFechado(entrada, agoraMs, fechamentoMinutos);
  if (c < 0) return {};
  const vis = visivelNoCorte(apontamentos, entrada.slots, c, agoraMs);
  const porPool = desempenhoPorEtapa(entrada.pools, vis);
  const f: Record<string, number> = Object.fromEntries(Object.entries(porPool).map(([k, d]) => [k, d.f]));
  if (paresLegado.length > 0) {
    const grafo = construirGrafo(entrada.pools, { paresLegado });
    grafo.fusoes.forEach((fu) => {
      const membros = new Set([fu.chaveConvencional, fu.chaveAutomatica]);
      const linhas = vis.filter((a) => a.status === "produzindo" && a.meta > 0 && a.produtoId && a.etapaId && membros.has(chavePool(a.produtoId, a.etapaId)));
      const boas = linhas.reduce((s, a) => s + a.boas, 0);
      const meta = linhas.reduce((s, a) => s + a.meta, 0);
      const fj = fatorDesempenho(linhas.length, boas, meta);
      membros.forEach((k) => (f[k] = fj));
    });
  }
  const out: Record<string, number> = {};
  Object.entries(f).forEach(([k, v]) => { if (Number.isFinite(v) && Math.abs(v - 1) > 1e-9) out[k] = v; });
  return out;
}

/** Metas × f embutidas em `entrada.pools` (devolve a própria entrada se não há f ≠ 1). Nunca muta a entrada. */
export function embutirFatores(entrada: EntradaEscala, fator: Record<string, number>): EntradaEscala {
  if (Object.keys(fator).length === 0) return entrada;
  return {
    ...entrada,
    pools: entrada.pools.map((p) => {
      const f = fator[chavePool(p.produtoId, p.etapaId)];
      return f === undefined || f === 1 ? p : { ...p, metas: Object.fromEntries(Object.entries(p.metas).map(([k, m]) => [k, m * f])) };
    }),
  };
}

