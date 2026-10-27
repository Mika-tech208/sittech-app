// Fixtures REAIS (PROD, 27/10/2026): entradas gravadas em escala_sombra_decisoes.entrada (formato EntradaCanonicaCorte) → (entrada, dados) do fluxo.
// Não é um arquivo de teste. Fonte dos JSON: SELECT em PROD (somente leitura); nenhum dado de pessoa além de ids opacos.
import * as fs from "fs";
import * as path from "path";
import { desempenhoPorEtapa } from "../../desempenho";
import { visaoNoCorte } from "../../sombraCorte";
import { paraParametrosCorte, type EntradaCanonicaCorte } from "../../snapshotSombra";
import { primeiroSlotFuturo } from "../../tempo";
import type { EntradaEscala, PoolEscala } from "../../types";
import { chavePool } from "../../types";
import type { DadosProducaoReal, ParLegado } from "../tipos";

export interface FixtureReal {
  decisaoId: string;
  criadoEm: string;
  data: string;
  periodoId: string;
  revisao: number;
  hashDecisao: string;
  hashPlanoSombra: string;
  hashPlanoOficial: string;
  entrada: EntradaCanonicaCorte;
}

export function carregarFixtures(): Record<string, FixtureReal> {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "__fixtures__", "caixa_conector_27out.json"), "utf8"));
}

// Ids de PROD (spec §5): convencional 27c229d7…, automática a027ac97…; etapas comuns Etiquetar (34371af3 + 1863b452) e Embalar (b3db9629 + fb96d08d).
export function parConectorProd(entrada: EntradaCanonicaCorte): ParLegado | null {
  const conv = entrada.pools.filter((p) => p.produtoId.startsWith("27c229d7"));
  const auto = entrada.pools.filter((p) => p.produtoId.startsWith("a027ac97"));
  if (!conv.length || !auto.length) return null;
  const et = (l: PoolEscala[], pref: string) => l.find((p) => p.etapaId.startsWith(pref))?.etapaId as string;
  return {
    id: "conector-legado",
    produtoConvencionalId: conv[0].produtoId,
    produtoAutomaticaId: auto[0].produtoId,
    etapasComuns: [
      { rotulo: "Etiquetar", etapaConvencionalId: et(conv, "34371af3"), etapaAutomaticaId: et(auto, "1863b452") },
      { rotulo: "Embalar", etapaConvencionalId: et(conv, "b3db9629"), etapaAutomaticaId: et(auto, "fb96d08d") },
    ],
  };
}

export function prefixo(entrada: EntradaCanonicaCorte, pref: string): string {
  return entrada.pools.find((p) => p.produtoId.startsWith(pref))?.produtoId as string;
}

/** (entrada, dados) do fluxo a partir da entrada canônica: metas × f (como a sombra), aPartirDe = 1º período não iniciado no corte, congeladas = plano gravado antes dele. */
export function montarDeCanonica(e: EntradaCanonicaCorte, opts: { semAdicional?: boolean } = {}): { entrada: EntradaEscala; dados: DadosProducaoReal; fatoresEmbutidos: Record<string, number> } {
  const par = paraParametrosCorte(e);
  const v = visaoNoCorte(par);
  const desemp = desempenhoPorEtapa(par.base.pools, v.apontamentos);
  const pools = par.base.pools.map((p) => {
    const f = desemp[chavePool(p.produtoId, p.etapaId)]?.f ?? 1;
    return { ...p, metas: Object.fromEntries(Object.entries(p.metas).map(([k, m]) => [k, m * f])), ...(opts.semAdicional ? { adicionalMax: 0 } : {}) };
  });
  const slots = par.base.slots;
  const aPartirDe = primeiroSlotFuturo(slots, e.corteMs);
  const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const entrada: EntradaEscala = {
    ...par.base, pools, ausencias: v.ausencias, indisponibilidades: v.indisponibilidades, aPartirDe,
    congeladas: par.planoOficial.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) as number) < aPartirDe),
    ...(opts.semAdicional ? { wip: undefined } : {}),
  };
  const dados: DadosProducaoReal = { apontamentos: v.apontamentos, agoraMs: e.corteMs, planoVigente: par.planoOficial };
  const fatoresEmbutidos = Object.fromEntries(Object.entries(desemp).map(([k, d]) => [k, d.f]));
  return { entrada, dados, fatoresEmbutidos };
}
