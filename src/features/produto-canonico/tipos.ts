// PRODUTO CANÔNICO + ROTAS + MAPA DE LEGADO — tipos (PURO, sem IO). Espelha as tabelas da migration 20261107100000_produto_canonico_estrutura.
// Nada neste diretório é lido pelo motor/telas enquanto `produto_unico_cutover` for null (flag desligada => comportamento byte-idêntico ao anterior).

export type PapelEtapa = "ROTA" | "COMUM" | "FINAL";
export type TipoRota = "convencional" | "automatica" | "outra";

export interface RotaCanonica {
  id: string;
  codigo: string; // CONVENCIONAL | AUTOMATICA
  nome: string; // "ROTA 1 — Convencional"
  tipo: TipoRota;
  ordem: number;
  ativa: boolean;
  /** Sobrescritas opcionais por rota; ausente = derivado do roteiro/máquinas/custo-hora. */
  parametros?: { custoPeca?: number; capacidadeSemanalMax?: number; pessoasPorPosto?: number };
}

export interface EtapaCanonica {
  etapaId: string;
  papel: PapelEtapa;
  /** null nas etapas COMUM/FINAL (pós-convergência). */
  rotaId: string | null;
  operacaoId?: string;
  maquinasIds?: string[];
}

export interface ArestaCanonica {
  origemEtapaId: string;
  destinoEtapaId: string;
}

export interface MapaProdutoLegado {
  produtoCanonicoId: string;
  rotaId: string;
}

export interface MapaEtapaLegada {
  etapaCanonicaId: string;
  produtoLegadoId: string;
}

export interface ModeloCanonico {
  produtoCanonicoId: string;
  codigo: string;
  nomeExibicao: string;
  rotas: RotaCanonica[];
  etapas: EtapaCanonica[];
  arestas: ArestaCanonica[];
  /** produto legado -> canônico + rota */
  produtosLegado: Record<string, MapaProdutoLegado>;
  /** etapa legada -> etapa canônica */
  etapasLegado: Record<string, MapaEtapaLegada>;
}

export interface ResolucaoProduto {
  produtoId: string;
  /** "legado" = estava no mapa e foi trocado; "canonico" = já era; "fora" = produto sem relação com o canônico (passa intacto). */
  entrada: "legado" | "canonico" | "fora";
  rotaId: string | null;
}

export interface ResolucaoEtapa {
  etapaId: string;
  produtoId: string | null;
  entrada: "legado" | "canonico" | "fora";
  papel: PapelEtapa | null;
  /** Rota da etapa (exclusiva) ou, em etapa comum vinda de legado, a rota do produto legado de origem (informativo). */
  rotaId: string | null;
}
