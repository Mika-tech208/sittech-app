// Fixture com os ids REAIS de PROD (Conector 3/4 Convencional/Automática) e um canônico fictício (ids "c…").
import type { ModeloCanonico } from "../tipos";

export const CONV = "27c229d7-f192-41eb-aad1-0c69ece53eba";
export const AUTO = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee";
export const CAIXA = "238ca607-2111-4aff-9a19-a9ae6f20da7e";
export const CAN = "c0000000-0000-4000-8000-000000000001";

export const L = { ros: "ca90456c-9077-40f4-a058-bd0f467e87ec", par: "78aaa207-b8cc-412a-8a8b-d17bd95a1930", eti: "34371af3-2608-42cc-9ded-1f7815a635a8", emb: "b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4", m8: "1b72bf46-5d13-43c5-89b4-6169436085b7", etiA: "1863b452-77f3-4d5c-9c49-a6d28ae77131", embA: "fb96d08d-bd64-43d3-8694-40230c695c39", caixaEti: "c765eb93-4597-405f-803a-91c7fab9ad8e" };
export const C = { m8: "c1000000-0000-4000-8000-000000000000", ros: "c1000000-0000-4000-8000-000000000001", par: "c1000000-0000-4000-8000-000000000002", eti: "c1000000-0000-4000-8000-000000000003", emb: "c1000000-0000-4000-8000-000000000004" };
export const ROTA1 = "c2000000-0000-4000-8000-000000000001";
export const ROTA2 = "c2000000-0000-4000-8000-000000000002";
export const MAQ = { r3: "4b48df30-62cb-4763-8749-1b2abae1b451", p9: "ddb9fd47-614d-467a-980f-88b4b89c708c", m8: "a118f430-f854-4e89-9e3c-ce6fcbbc52cf", et15: "49472af4-f5af-4427-992b-17a3f00a6c38", em17: "ba7adcbd-835c-45a3-92c6-f93fa87d3775" };

export function modelo(): ModeloCanonico {
  return {
    produtoCanonicoId: CAN, codigo: "CONECTOR_3_4", nomeExibicao: 'Conector 3/4"',
    rotas: [
      { id: ROTA1, codigo: "CONVENCIONAL", nome: "ROTA 1 — Convencional", tipo: "convencional", ordem: 1, ativa: true },
      { id: ROTA2, codigo: "AUTOMATICA", nome: "ROTA 2 — Automática", tipo: "automatica", ordem: 2, ativa: true },
    ],
    etapas: [
      { etapaId: C.m8, papel: "ROTA", rotaId: ROTA2, maquinasIds: [MAQ.m8] },
      { etapaId: C.ros, papel: "ROTA", rotaId: ROTA1, maquinasIds: [MAQ.r3] },
      { etapaId: C.par, papel: "ROTA", rotaId: ROTA1, maquinasIds: [MAQ.p9] },
      { etapaId: C.eti, papel: "COMUM", rotaId: null, maquinasIds: [MAQ.et15] },
      { etapaId: C.emb, papel: "FINAL", rotaId: null, maquinasIds: [MAQ.em17] },
    ],
    arestas: [
      { origemEtapaId: C.ros, destinoEtapaId: C.par }, { origemEtapaId: C.par, destinoEtapaId: C.eti },
      { origemEtapaId: C.m8, destinoEtapaId: C.eti }, { origemEtapaId: C.eti, destinoEtapaId: C.emb },
    ],
    produtosLegado: { [CONV]: { produtoCanonicoId: CAN, rotaId: ROTA1 }, [AUTO]: { produtoCanonicoId: CAN, rotaId: ROTA2 } },
    etapasLegado: {
      [L.ros]: { etapaCanonicaId: C.ros, produtoLegadoId: CONV }, [L.par]: { etapaCanonicaId: C.par, produtoLegadoId: CONV },
      [L.eti]: { etapaCanonicaId: C.eti, produtoLegadoId: CONV }, [L.emb]: { etapaCanonicaId: C.emb, produtoLegadoId: CONV },
      [L.m8]: { etapaCanonicaId: C.m8, produtoLegadoId: AUTO }, [L.etiA]: { etapaCanonicaId: C.eti, produtoLegadoId: AUTO }, [L.embA]: { etapaCanonicaId: C.emb, produtoLegadoId: AUTO },
    },
  };
}

export function profundoCongelado<T>(o: T): T {
  if (o && typeof o === "object") { Object.values(o as object).forEach(profundoCongelado); Object.freeze(o); }
  return o;
}
