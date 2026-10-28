// Monta, para UMA decisão gravada (corte c), a entrada do motor no estilo da Escala oficial (aPartirDe = primeiro alterável) e os dados de Produção Real
// disponíveis NAQUELE instante. Nada daqui olha o futuro: apontamentos ≥ corte ficam fora (e o núcleo ainda os filtra por lancadoEmMs ≤ agoraMs).
import { embutirFatores, fatoresDeDesempenho } from "@/features/escala/fluxo/fatores";
import { paraParametrosCorte, desempacotarLinha } from "@/features/escala/snapshotSombra";
import { visaoNoCorte } from "@/features/escala/sombraCorte";
import { chavePool, type AlocacaoEscala, type EntradaEscala } from "@/features/escala/types";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import type { DadosProducaoReal, OpcoesFluxo, SaldoWipConfirmadoPar } from "@/features/escala/fluxo";
import type { DecisaoGravada } from "./dados";

export interface Cenario {
  dec: DecisaoGravada;
  /** Entrada do núcleo = a da integração (`insumosFluxo`): metas × f embutidas (f do realizado visível no corte; pools fundidos com f conjunto). */
  entrada: EntradaEscala;
  /** Entrada NOMINAL (como a Escala oficial a monta): base do oficial regenerado, do simulador independente e da régua legada. */
  entradaNominal: EntradaEscala;
  /** f por pool (só ≠ 1) já embutido em `entrada` e informado em `opcoes.fatoresEmbutidos`. */
  fator: Record<string, number>;
  dados: DadosProducaoReal;
  opcoes: OpcoesFluxo;
  c: number;
  aPartirDe: number;
  planoVigente: AlocacaoEscala[];
}

export interface OpcoesCenario {
  /** aPartirDe = c + offset (2 = regra real do horizonte comprometido: c+1 comprometido; 1 = spec §4 literal). */
  offset?: number;
  /** apontamentos visíveis no instante (default: os de `todos` com lancadoEmMs ≤ corte, de TODOS os períodos — o núcleo decide o resto). */
  apontamentos?: ApontamentoReal[];
  /** plano vigente substituto (replay encadeado). */
  planoVigente?: AlocacaoEscala[];
  paresLegado?: OpcoesFluxo["paresLegado"];
  extraOpcoes?: Partial<OpcoesFluxo>;
  semFator?: boolean;
}

export function montarCenario(dec: DecisaoGravada, todos: ApontamentoReal[], oc: OpcoesCenario = {}): Cenario {
  const e = dec.entrada;
  const par = paraParametrosCorte(e);
  const slots = par.base.slots;
  const offset = oc.offset ?? 2;
  const c = e.c;
  const aPartirDe = Math.min(slots.length, c + offset);
  const idx = (a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? Number.POSITIVE_INFINITY;
  const v = visaoNoCorte(par);
  const planoVigente = oc.planoVigente ?? par.planoOficial;
  // entrada OFICIAL (montarEntradaEscala): pools como estão, sem tetos dinâmicos do modo restrito
  const poolsBase = par.base.pools;
  const entradaNominal: EntradaEscala = {
    ...par.base,
    pools: poolsBase,
    aPartirDe,
    revezamentoDuro: true,
    ausencias: v.ausencias,
    indisponibilidades: v.indisponibilidades,
    congeladas: planoVigente.filter((a) => idx(a) < aPartirDe),
    ...(par.restrito ? { trocasManuais: planoVigente.filter((a) => a.origem === "manual" && idx(a) >= aPartirDe) } : {}),
  };
  // f de desempenho: a MESMA função da integração (src/features/escala/fluxo/fatores.ts) — realizado visível no corte, pools fundidos com f conjunto.
  // FREPLAY_FATOR=0 desliga o f (configuração antiga da revisão anterior, para comparação).
  const semFator = oc.semFator ?? process.env.FREPLAY_FATOR === "0";
  const fator = semFator ? {} : fatoresDeDesempenho(entradaNominal, oc.apontamentos ?? todos, dec.corteMs, oc.paresLegado ?? []);
  const entrada = embutirFatores(entradaNominal, fator);
  // saldo de WIP CONFIRMADO: a entrada gravada só tem `limites` (nenhum saldo/estoque confirmado em PROD nesses dias) -> lista vazia (tudo estimado)
  const wipConfirmado: SaldoWipConfirmadoPar[] = [];
  const st = e.wip as { saldo0?: Record<string, number>; estoqueConfirmado?: Record<string, number> } | undefined;
  const conf = st?.estoqueConfirmado ?? st?.saldo0 ?? {};
  Object.entries(conf).forEach(([k, saldo]) => {
    const [produtoId, etapaOrigemId] = k.split("|");
    const etapas = par.base.pools.filter((p) => p.produtoId === produtoId).sort((a, b) => a.ordemEtapa - b.ordemEtapa);
    const i = etapas.findIndex((p) => p.etapaId === etapaOrigemId);
    if (i >= 0 && etapas[i + 1] && saldo > 0) wipConfirmado.push({ produtoId, etapaOrigemId, etapaSeguinteId: etapas[i + 1].etapaId, saldo });
  });
  const dados: DadosProducaoReal = { apontamentos: oc.apontamentos ?? todos, agoraMs: dec.corteMs, fechamentoMinutos: 10, wipConfirmado, planoVigente };
  // Configuração da INTEGRAÇÃO (src/lib/escala/fluxo/integracao.ts › insumosFluxo): paresLegado + fatoresEmbutidos (f nas metas); θ = 0 e estabilização são o padrão do núcleo.
  // FREPLAY_FAILSAFE=0 desliga o fail-safe de estoque desconhecido (= comportamento anterior à v2.1), para A/B contra o código de PROD.
  const opcoes: OpcoesFluxo = {
    ...(oc.paresLegado ? { paresLegado: oc.paresLegado } : {}), ...(Object.keys(fator).length > 0 ? { fatoresEmbutidos: fator } : {}),
    ...(process.env.FREPLAY_FAILSAFE === "0" ? { failSafeWipDesconhecido: false } : {}), ...(oc.extraOpcoes ?? {}),
  };
  return { dec, entrada, entradaNominal, fator, dados, opcoes, c, aPartirDe, planoVigente };
}

export const chaveDe = chavePool;
export { desempacotarLinha };
