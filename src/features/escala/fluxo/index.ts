// Escala Inteligente (fluxo) — API pública do núcleo puro.
export * from "./tipos";
export { estadoDaProducao } from "./estado";
export { avaliarPlano } from "./avaliar";
export { planejarComFluxo } from "./planejar";
export { verificarRestricoesDuras } from "./restricoes";
export { construirGrafo } from "./grafo";
export { fatoresDeDesempenho, embutirFatores, ultimoSlotFechado } from "./fatores";
export { explicarMudanca } from "./explicar";
export { aderenciaPorPeriodo } from "./aderencia";
